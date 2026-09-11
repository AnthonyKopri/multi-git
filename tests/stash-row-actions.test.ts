// @vitest-environment happy-dom
//
// What a stash row offers, and where.
//
// Six icon buttons on a sidebar row left no room for the message they belong
// to, so only the two applying actions stay in the row and the rest moved
// behind "...". Both halves are asserted here: the row's buttons, and that a
// menu pick reaches the same handler the row's own buttons do.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';

const endpoints = vi.hoisted(() => ({
  getStashes: vi.fn(),
  searchStashes: vi.fn(),
  showStash: vi.fn(),
  applyStash: vi.fn(),
  dropStash: vi.fn(),
  branchFromStash: vi.fn(),
  pushStash: vi.fn(),
  getTags: vi.fn(),
  pushTag: vi.fn(),
  deleteTag: vi.fn(),
  createTag: vi.fn()
}));

const dialogs = vi.hoisted(() => ({
  confirmDialog: vi.fn(async () => ({ confirmed: true })),
  promptDialog: vi.fn()
}));

vi.mock('../src/renderer/api/endpoints', () => endpoints);
vi.mock('../src/renderer/ui/dialogs', () => dialogs);
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));
vi.mock('../src/renderer/features/accounts', () => ({ activeProfile: () => null }));

/** Mounts the real markup and renders two stashes into it. */
async function mount(): Promise<typeof import('../src/renderer/features/shelf')> {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const { delegate } = await import('../src/renderer/dom/create');
  const shelf = await import('../src/renderer/features/shelf');

  const ui = resolveElements();
  shelf.initShelf(ui, async () => {});
  // The same one line main.ts uses to wire the list.
  delegate(ui.stashList, 'click', '[data-action]', shelf.handleStashAction);
  endpoints.getStashes.mockResolvedValue({
    stashes: [
      { ref: 'stash@{0}', message: 'On main: the row layout', date: '2 hours ago' },
      { ref: 'stash@{1}', message: 'On main: the config loader', date: 'yesterday' }
    ]
  });
  await shelf.refreshStashList();

  return shelf;
}

const actionsOf = (row: Element): string[] =>
  [...row.querySelectorAll<HTMLElement>('.stash-actions [data-action]')].map(
    (button) => button.dataset['action'] ?? ''
  );

const firstRow = (): HTMLElement =>
  document.querySelector<HTMLElement>('#stash-list .stash-item') as HTMLElement;

const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('.overflow-menu');

beforeEach(() => {
  vi.clearAllMocks();
  menu()?.remove();
});

describe('a stash row', () => {
  it('keeps applying in the row and everything else behind "..."', async () => {
    await mount();

    expect(actionsOf(firstRow())).toEqual(['pop', 'apply', 'more']);
  });

  it('shows the message the width the hidden buttons free up', async () => {
    await mount();

    // The row's own text is not truncated in the markup; the space it gets is
    // a CSS matter, and the rule that frees it is the one asserted here.
    const css = fs.readFileSync(fromAppRoot('public', 'style.css'), 'utf8');
    const collapsed = /\.stash-actions \{[^}]*\}/.exec(css)?.[0] ?? '';

    expect(collapsed).toMatch(/width:\s*0/);
    expect(css).toMatch(/\.stash-item:hover \.stash-actions[^{]*\{[^}]*width:\s*auto/);
  });

  it('opens the rest of the actions from "..."', async () => {
    await mount();

    firstRow().querySelector<HTMLElement>('[data-action="more"]')?.click();

    const items = [...(menu()?.querySelectorAll<HTMLElement>('[data-action]') ?? [])];
    expect(items.map((item) => item.dataset['action'])).toEqual([
      'inspect',
      'apply-index',
      'branch',
      'drop'
    ]);
    // A lone icon in a menu says nothing, so each entry is labelled.
    expect(items.every((item) => (item.textContent ?? '').trim().length > 0)).toBe(true);
    expect(menu()?.querySelector('[data-action="drop"]')?.classList.contains('danger')).toBe(true);
  });

  it('runs a menu pick against the row it was opened from', async () => {
    await mount();
    endpoints.showStash.mockResolvedValue({ files: [], diff: [] });

    const row = [...document.querySelectorAll<HTMLElement>('#stash-list .stash-item')][1] as HTMLElement;
    row.querySelector<HTMLElement>('[data-action="more"]')?.click();
    menu()?.querySelector<HTMLElement>('[data-action="inspect"]')?.click();

    expect(endpoints.showStash).toHaveBeenCalledWith('stash@{1}');
    // The menu is a one-shot: picking closes it rather than leaving it over
    // the row below.
    expect(menu()).toBeNull();
  });

  it('applies from the row without opening anything', async () => {
    await mount();

    firstRow().querySelector<HTMLElement>('[data-action="pop"]')?.click();

    expect(endpoints.applyStash).toHaveBeenCalledWith('stash@{0}', true, false);
    expect(menu()).toBeNull();
  });
});
