// @vitest-environment happy-dom
//
// The precision staging UI, driven through the real markup in
// public/index.html. A renamed id or a removed button fails here rather than
// only in the app. The API module is stubbed: what matters is which selection
// the pane sends, not that a server answers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import type { DiffFile } from '../src/shared/diff-types';

const endpoints = vi.hoisted(() => ({
  getStructuredDiff: vi.fn(),
  applyDiffSelection: vi.fn(),
  getCommitDiff: vi.fn()
}));

const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn() }));

// A real enough store: the pane writes the active file on load and reads it
// back when it needs to reload, so a stub that always answers null would hide
// exactly the path the reload tests are about.
const store = vi.hoisted(() => {
  const state: Record<string, unknown> = { activeRepo: '/repo', activeDiffFile: null };
  return {
    state,
    getState: () => state,
    update: (patch: Record<string, unknown>) => Object.assign(state, patch),
    shouldWarnBeforeDelete: () => true
  };
});

vi.mock('../src/renderer/api/endpoints', () => endpoints);
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn(), initToasts: vi.fn() }));
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));
vi.mock('../src/renderer/ui/dialogs', () => dialogs);
vi.mock('../src/renderer/state/store', () => store);

/** A two-hunk diff of a tracked file. */
function twoHunkDiff(): DiffFile {
  const hunkLines = (hunkId: string, from: number) => [
    {
      id: `${hunkId}:0`,
      kind: 'context' as const,
      content: `line ${from}`,
      oldLine: from,
      newLine: from,
      noNewline: false
    },
    {
      id: `${hunkId}:1`,
      kind: 'deletion' as const,
      content: `line ${from + 1}`,
      oldLine: from + 1,
      newLine: null,
      noNewline: false
    },
    {
      id: `${hunkId}:2`,
      kind: 'addition' as const,
      content: `line ${from + 1} CHANGED`,
      oldLine: null,
      newLine: from + 1,
      noNewline: false
    }
  ];

  return {
    oldPath: 'lines.txt',
    newPath: 'lines.txt',
    status: 'modified',
    additions: 2,
    deletions: 2,
    binary: false,
    modeChanged: false,
    headerLines: ['diff --git a/lines.txt b/lines.txt'],
    hunks: [
      {
        id: 'hunk-a',
        header: '@@ -1,3 +1,3 @@',
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 3,
        lines: hunkLines('hunk-a', 1)
      },
      {
        id: 'hunk-b',
        header: '@@ -20,3 +20,3 @@',
        oldStart: 20,
        oldCount: 3,
        newStart: 20,
        newCount: 3,
        lines: hunkLines('hunk-b', 20)
      }
    ]
  };
}

function pageMarkup(): string {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

async function mount() {
  document.body.innerHTML = pageMarkup();

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const feature = await import('../src/renderer/features/diff');

  const ui = resolveElements();
  feature.initDiff(ui, { refreshAll: async () => {} });

  return { ui, feature };
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function rowFor(lineId: string): HTMLElement {
  return document.querySelector(`[data-line-id="${lineId}"]`) as HTMLElement;
}

function structuredResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    file: twoHunkDiff(),
    source: 'working-tree',
    untracked: false,
    tooLarge: false,
    sizeBytes: 200,
    limitBytes: 2 * 1024 * 1024,
    ...overrides
  };
}

beforeEach(() => {
  endpoints.getStructuredDiff.mockReset();
  endpoints.applyDiffSelection.mockReset();
  dialogs.confirmDialog.mockReset();
  store.state['activeDiffFile'] = null;

  endpoints.getStructuredDiff.mockResolvedValue(structuredResponse());
  endpoints.applyDiffSelection.mockResolvedValue({
    success: true,
    action: 'stage',
    filePath: 'lines.txt',
    hunksApplied: 1,
    linesApplied: 2
  });
  dialogs.confirmDialog.mockResolvedValue({ confirmed: true, checked: false });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('rendering a structured diff', () => {
  it('draws a row per line and a header per hunk', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    expect(document.querySelectorAll('.diff-line-hunk')).toHaveLength(2);
    expect(document.querySelectorAll('[data-line-id]')).toHaveLength(4);
    // Context lines are not selectable, so they carry no line id.
    expect(document.querySelectorAll('.diff-line').length).toBe(8);
  });

  it('offers stage and discard on a working-tree hunk, not unstage', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    const actions = [...document.querySelectorAll('[data-hunk-action]')].map(
      (button) => (button as HTMLElement).dataset['hunkAction']
    );

    expect(new Set(actions)).toEqual(new Set(['stage', 'discard']));
  });

  it('offers only unstage on a hunk read from the index', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', true, false, 'M');

    const actions = [...document.querySelectorAll('[data-hunk-action]')].map(
      (button) => (button as HTMLElement).dataset['hunkAction']
    );

    expect(new Set(actions)).toEqual(new Set(['unstage']));
    expect(endpoints.getStructuredDiff).toHaveBeenCalledWith('lines.txt', 'index', false);
  });

  it('does not offer discard on an untracked file', async () => {
    endpoints.getStructuredDiff.mockResolvedValue(structuredResponse({ untracked: true }));

    const { feature } = await mount();
    await feature.loadDiff('fresh.txt', false, true, '?');

    const actions = [...document.querySelectorAll('[data-hunk-action]')].map(
      (button) => (button as HTMLElement).dataset['hunkAction']
    );

    expect(actions).not.toContain('discard');
  });

  it('renders line content as text, never as markup', async () => {
    const file = twoHunkDiff();
    (file.hunks[0]?.lines[2] as { content: string }).content = '<img src=x onerror=alert(1)>';
    endpoints.getStructuredDiff.mockResolvedValue(structuredResponse({ file }));

    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    expect(document.querySelector('#diff-content img')).toBeNull();
    expect(rowFor('hunk-a:2').textContent).toContain('<img');
  });

  it('explains a diff held back for size and can load it anyway', async () => {
    endpoints.getStructuredDiff.mockResolvedValueOnce(
      structuredResponse({ file: null, tooLarge: true, sizeBytes: 5 * 1024 * 1024 })
    );

    const { feature } = await mount();
    await feature.loadDiff('huge.txt', false, false, 'M');

    const button = document.querySelector('#diff-content button') as HTMLButtonElement;
    expect($('diff-content').textContent).toContain('5.0 MB');
    expect(button.textContent).toBe('Load anyway');

    button.click();
    await vi.waitFor(() =>
      expect(endpoints.getStructuredDiff).toHaveBeenLastCalledWith('huge.txt', 'working-tree', true)
    );
  });
});

describe('selecting lines', () => {
  it('keeps the selection bar hidden until something is picked', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    expect($('diff-selection-bar').classList.contains('hidden')).toBe(true);
  });

  it('counts what is selected and marks the row', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    feature.toggleLineSelection('hunk-a:2');

    expect($('diff-selection-bar').classList.contains('hidden')).toBe(false);
    expect($('diff-selection-count').textContent).toBe('1 line selected');
    expect(rowFor('hunk-a:2').classList.contains('diff-line-selected')).toBe(true);
    expect(rowFor('hunk-a:2').getAttribute('aria-checked')).toBe('true');

    feature.toggleLineSelection('hunk-b:1');
    expect($('diff-selection-count').textContent).toBe('2 lines selected');
  });

  it('deselects a line that is picked twice', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    feature.toggleLineSelection('hunk-a:2');
    feature.toggleLineSelection('hunk-a:2');

    expect($('diff-selection-bar').classList.contains('hidden')).toBe(true);
    expect(rowFor('hunk-a:2').getAttribute('aria-checked')).toBe('false');
  });

  it('selects and clears a whole hunk', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    feature.toggleHunkSelection('hunk-a');
    expect($('diff-selection-count').textContent).toBe('2 lines selected');

    feature.toggleHunkSelection('hunk-a');
    expect($('diff-selection-bar').classList.contains('hidden')).toBe(true);
  });

  it('hides the actions the current source cannot perform', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', true, false, 'M');
    feature.toggleLineSelection('hunk-a:2');

    expect($('btn-diff-unstage-selection').classList.contains('hidden')).toBe(false);
    expect($('btn-diff-stage-selection').classList.contains('hidden')).toBe(true);
    expect($('btn-diff-discard-selection').classList.contains('hidden')).toBe(true);
  });

  it('drops the selection when a different diff is loaded', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');
    feature.toggleLineSelection('hunk-a:2');

    await feature.loadDiff('lines.txt', false, false, 'M');

    expect($('diff-selection-bar').classList.contains('hidden')).toBe(true);
  });
});

describe('acting on a selection', () => {
  it('sends exactly the picked line ids', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    feature.toggleLineSelection('hunk-a:2');
    feature.toggleLineSelection('hunk-b:1');
    feature.applySelectedLines('stage');

    await vi.waitFor(() =>
      expect(endpoints.applyDiffSelection).toHaveBeenCalledWith({
        action: 'stage',
        filePath: 'lines.txt',
        lineIds: ['hunk-a:2', 'hunk-b:1']
      })
    );
  });

  it('sends one hunk id when a hunk button is used', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    feature.applyHunk('stage', 'hunk-b');

    await vi.waitFor(() =>
      expect(endpoints.applyDiffSelection).toHaveBeenCalledWith({
        action: 'stage',
        filePath: 'lines.txt',
        hunkIds: ['hunk-b']
      })
    );
  });

  it('confirms before discarding and sends nothing when refused', async () => {
    dialogs.confirmDialog.mockResolvedValue({ confirmed: false, checked: false });

    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    feature.toggleLineSelection('hunk-a:2');
    feature.applySelectedLines('discard');

    await vi.waitFor(() => expect(dialogs.confirmDialog).toHaveBeenCalled());
    expect(endpoints.applyDiffSelection).not.toHaveBeenCalled();
  });

  it('does nothing when no line is selected', async () => {
    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');

    feature.applySelectedLines('stage');

    expect(endpoints.applyDiffSelection).not.toHaveBeenCalled();
  });

  it('reloads the diff after a rejected selection, so the user can retry', async () => {
    endpoints.applyDiffSelection.mockRejectedValue(new Error('The file changed since'));

    const { feature } = await mount();
    await feature.loadDiff('lines.txt', false, false, 'M');
    endpoints.getStructuredDiff.mockClear();

    feature.toggleLineSelection('hunk-a:2');
    feature.applySelectedLines('stage');

    await vi.waitFor(() => expect(endpoints.getStructuredDiff).toHaveBeenCalled());
  });
});
