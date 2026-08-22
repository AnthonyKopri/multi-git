// @vitest-environment happy-dom
//
// The navbar overflow menu, against the real index.html and the real dropdown
// registry.
//
// Two things are worth pinning. The rows come from the command list rather
// than from a second list written beside it, so a command that gains a `menu`
// group appears here without anything else being edited — and one that has no
// group stays palette-only. And the controls that moved out of the toolbar are
// still the same elements: their ids and their handlers did not move with
// their markup, which is what stops F5 and the protocol chip quietly dying in
// a reshuffle.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import type { Command } from '../src/renderer/features/palette';

const run = vi.fn();

function commands(): Command[] {
  return [
    { id: 'maintenance', group: 'Repository', title: 'Repository maintenance', menu: 'Repository', icon: 'mop', run },
    { id: 'worktrees', group: 'Worktrees', title: 'Manage worktrees', menu: 'Repository', icon: 'account_tree', run },
    { id: 'recovery', group: 'Safety Net', title: 'Recovery points and reflog', menu: 'Safety Net', icon: 'history', run },
    { id: 'search', group: 'Find', title: 'Search commits', menu: 'History', icon: 'search', run },
    // No `menu`: reachable with Ctrl+K and nowhere else.
    { id: 'stage-all', group: 'Staging', title: 'Stage everything', run }
  ];
}

async function mount(provider: () => Command[] = commands) {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const dropdown = await import('../src/renderer/ui/dropdown');
  const feature = await import('../src/renderer/features/app-menu');

  dropdown.initDropdowns();
  feature.initAppMenu(resolveElements(), provider);

  return feature;
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

const open = (): void => $('btn-app-menu').click();

/**
 * The visible label of each row.
 *
 * The label span rather than the row's text: an icon font puts its ligature
 * name in the DOM, so a row's `textContent` reads "mopRepository maintenance".
 */
const rowTitles = (): string[] =>
  [...$('app-menu-list').querySelectorAll<HTMLElement>('[data-command-id] span:not(.material-symbols-outlined)')].map(
    (label) => label.textContent?.trim() ?? ''
  );

beforeEach(() => {
  run.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('what the menu offers', () => {
  it('shows every command that claims a menu group, and no others', async () => {
    await mount();
    open();

    expect(rowTitles()).toEqual([
      'Repository maintenance',
      'Manage worktrees',
      'Search commits',
      'Recovery points and reflog'
    ]);
    // The palette keeps indexing it; the menu is a curated subset.
    expect(rowTitles()).not.toContain('Stage everything');
  });

  it('groups the rows and heads each group', async () => {
    await mount();
    open();

    const headings = [...$('app-menu-list').querySelectorAll('.dropdown-title')].map(
      (heading) => heading.textContent
    );

    expect(headings).toEqual(['Repository', 'History', 'Safety Net']);
  });

  it('asks for the commands each time it opens', async () => {
    const provider = vi.fn(() => commands());
    await mount(provider);

    open();
    document.body.click();
    open();

    // What is worth offering depends on the repository and the branch, so a
    // set captured once at startup would go stale behind a closed menu.
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('says so rather than showing an empty box when there is nothing to offer', async () => {
    await mount(() => []);
    open();

    expect($('app-menu-list').textContent).toContain('Open a repository first');
  });
});

describe('running something from the menu', () => {
  it('runs the command the row names', async () => {
    await mount();
    open();

    const row = [...$('app-menu-list').querySelectorAll<HTMLElement>('[data-command-id]')].find(
      (candidate) => candidate.dataset['commandId'] === 'worktrees'
    ) as HTMLElement;
    row.click();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('closes itself first, so it is not left standing over what it opened', async () => {
    await mount();
    open();
    expect($('app-menu-dropdown').classList.contains('hidden')).toBe(false);

    ($('app-menu-list').querySelector('[data-command-id]') as HTMLElement).click();

    expect($('app-menu-dropdown').classList.contains('hidden')).toBe(true);
  });

  it('closes on a click outside it', async () => {
    await mount();
    open();

    document.body.click();

    expect($('app-menu-dropdown').classList.contains('hidden')).toBe(true);
  });

  it('closes the header dropdowns when it opens', async () => {
    await mount();

    // Registered by the same helper, so opening one must close the others.
    const { registerDropdown } = await import('../src/renderer/ui/dropdown');
    registerDropdown($('repo-segment'), $('repo-dropdown'));
    $('repo-segment').click();
    expect($('repo-dropdown').classList.contains('hidden')).toBe(false);

    open();

    expect($('repo-dropdown').classList.contains('hidden')).toBe(true);
    expect($('app-menu-dropdown').classList.contains('hidden')).toBe(false);
  });
});

describe('the controls that moved out of the toolbar', () => {
  it('keeps them as the same elements, inside the menu', async () => {
    await mount();

    for (const id of ['btn-repo-hub', 'btn-open-logs', 'btn-refresh', 'btn-remote-protocol', 'btn-settings']) {
      const button = $(id);
      // Same id, same element, same handlers — only the shape changed. A
      // reshuffle that recreated these would silently drop their listeners.
      expect(button.closest('#app-menu-dropdown')).not.toBeNull();
    }
  });

  it('leaves the five that stay in the strip alone', async () => {
    await mount();

    for (const id of ['btn-auto-pull', 'btn-fetch', 'btn-pull', 'btn-push', 'btn-create-pr']) {
      expect($(id).closest('.global-actions')).not.toBeNull();
      expect($(id).closest('#app-menu-dropdown')).toBeNull();
    }
  });

  it('keeps the update button in the strip, where news belongs', async () => {
    await mount();

    expect($('btn-update').closest('.global-actions')).not.toBeNull();
    expect($('btn-update').closest('#app-menu-dropdown')).toBeNull();
  });
});
