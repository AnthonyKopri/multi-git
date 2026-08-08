// @vitest-environment happy-dom
//
// The command palette, driven through the real markup. Its matching rules are
// pure and get exercised directly; the rest goes through the DOM so a renamed
// id or a removed list fails here rather than only in the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';

vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn(), initToasts: vi.fn() }));

function pageMarkup(): string {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

async function mount() {
  document.body.innerHTML = pageMarkup();

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const palette = await import('../src/renderer/features/palette');

  const ui = resolveElements();
  palette.initPalette(ui);
  palette.attachPaletteInput();

  return { ui, palette };
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function press(key: string): void {
  $('palette-input').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function type(text: string): void {
  ($('palette-input') as HTMLInputElement).value = text;
  $('palette-input').dispatchEvent(new Event('input', { bubbles: true }));
}

function visibleTitles(): string[] {
  return [...document.querySelectorAll('#palette-list .palette-title')].map(
    (node) => node.textContent ?? ''
  );
}

let ran: string[] = [];

function sampleCommands(palette: typeof import('../src/renderer/features/palette')) {
  ran = [];
  const make = (id: string, group: string, title: string, keywords?: string) => ({
    id,
    group,
    title,
    ...(keywords ? { keywords } : {}),
    run: () => ran.push(id)
  });

  palette.setCommands([
    make('search', 'Find', 'Search commits', 'log grep'),
    make('branches', 'Branch', 'Branch maintenance', 'prune stale'),
    make('push', 'Sync', 'Push'),
    make('stash', 'Stash', 'Stash changes')
  ]);
}

beforeEach(() => {
  ran = [];
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('matching', () => {
  it('accepts letters that appear in order, not just substrings', async () => {
    const { matches } = await import('../src/renderer/features/palette');

    expect(matches('brmnt', 'Branch Branch maintenance')).toBe(true);
    expect(matches('push', 'Sync Push')).toBe(true);
    expect(matches('zzz', 'Sync Push')).toBe(false);
  });

  it('ignores case and spaces in the query', async () => {
    const { matches } = await import('../src/renderer/features/palette');

    expect(matches('BR MNT', 'Branch maintenance')).toBe(true);
  });

  it('ranks an exact substring above a scattered match', async () => {
    const { rankCommands } = await import('../src/renderer/features/palette');
    const command = (id: string, title: string) => ({ id, group: '', title, run: () => {} });

    const ranked = rankCommands('stash', [
      command('scattered', 'Set the upstream and hash'),
      command('exact', 'Stash changes')
    ]);

    expect(ranked[0]?.id).toBe('exact');
  });
});

describe('driving the palette', () => {
  it('lists every command when the query is empty', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();

    expect(visibleTitles()).toHaveLength(4);
    expect($('palette-modal').classList.contains('hidden')).toBe(false);
  });

  it('narrows as you type, matching the group as well as the title', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();

    type('sync');
    expect(visibleTitles()).toEqual(['Push']);
  });

  it('matches a keyword that never appears in the title', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();

    type('prune');
    expect(visibleTitles()).toEqual(['Branch maintenance']);
  });

  it('says so rather than showing nothing when there is no match', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();

    type('qqqq');
    expect($('palette-list').textContent).toContain('No matching command');
  });

  it('runs the highlighted command on Enter and closes', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();

    type('push');
    press('Enter');

    expect(ran).toEqual(['push']);
    expect($('palette-modal').classList.contains('hidden')).toBe(true);
  });

  it('moves the highlight with the arrow keys and wraps around', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();

    press('ArrowDown');
    press('ArrowDown');
    press('Enter');
    expect(ran).toEqual(['push']);

    palette.openPalette();
    // Up from the first entry wraps to the last.
    press('ArrowUp');
    press('Enter');
    expect(ran).toEqual(['push', 'stash']);
  });

  it('marks the highlighted row for assistive technology', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();

    const rows = [...document.querySelectorAll('#palette-list li')];
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true');
    expect(rows[1]?.getAttribute('aria-selected')).toBe('false');
  });

  it('closes on Escape without running anything', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();

    press('Escape');

    expect(ran).toEqual([]);
    expect($('palette-modal').classList.contains('hidden')).toBe(true);
  });

  it('runs a command that was clicked', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();

    palette.runCommandById('stash');

    expect(ran).toEqual(['stash']);
    expect(palette.isPaletteOpen()).toBe(false);
  });

  it('starts each opening from an empty query', async () => {
    const { palette } = await mount();
    sampleCommands(palette);
    palette.openPalette();
    type('push');
    palette.closePalette();

    palette.openPalette();

    expect(($('palette-input') as HTMLInputElement).value).toBe('');
    expect(visibleTitles()).toHaveLength(4);
  });

  it('renders a command title as text, never as markup', async () => {
    const { palette } = await mount();
    palette.setCommands([
      { id: 'x', group: 'Branch', title: '<img src=x onerror=alert(1)>', run: () => {} }
    ]);
    palette.openPalette();

    expect(document.querySelector('#palette-list img')).toBeNull();
    expect($('palette-list').textContent).toContain('<img');
  });
});
