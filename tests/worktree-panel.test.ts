// @vitest-environment happy-dom
//
// The worktree lists, against the real index.html.
//
// Mounting the actual markup is what makes a renamed element id fail the suite
// rather than produce a panel that silently never renders. The behaviour worth
// pinning here is the removal guard: a clean worktree asks once, a dirty one
// demands its folder name, and a name that does not match removes nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import type { WorktreeInfo } from '../src/shared/worktree-types';

function worktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: 'D:\\work\\app.worktrees\\login',
    head: 'aa696a17eadd68fd8d98001239dac9feb2075842',
    branch: 'refs/heads/feature/login',
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
    isMain: false,
    present: true,
    ...overrides
  };
}

const main = worktree({
  path: 'D:\\work\\app',
  branch: 'refs/heads/main',
  isMain: true
});

const endpoints = vi.hoisted(() => ({
  getWorktrees: vi.fn(),
  getWorktreeStatus: vi.fn(),
  createWorktree: vi.fn(),
  moveWorktree: vi.fn(),
  lockWorktree: vi.fn(),
  unlockWorktree: vi.fn(),
  repairWorktrees: vi.fn(),
  previewWorktreePrune: vi.fn(),
  removeWorktree: vi.fn()
}));

const dialogs = vi.hoisted(() => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn()
}));

const state = vi.hoisted(() => ({ activeRepo: 'D:\\work\\app', recentRepos: [] as string[] }));

vi.mock('../src/renderer/api/endpoints', () => endpoints);
vi.mock('../src/renderer/ui/dialogs', () => dialogs);
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));
vi.mock('../src/renderer/state/store', () => ({ getState: () => state }));
vi.mock('../src/renderer/ui/busy', () => ({
  withButtonBusy: async (_button: unknown, run: () => Promise<void>) => run()
}));
// Opening a repository or a window is another feature's job; stubbed so this
// file is about the lists and nothing else.
vi.mock('../src/renderer/features/repo', () => ({
  openRepository: vi.fn(),
  pickFolderPath: vi.fn()
}));
vi.mock('../src/renderer/features/windows', () => ({ openRepoInNewWindow: vi.fn() }));
vi.mock('../src/renderer/features/agents', () => ({ launchAgentFor: vi.fn() }));

async function mount() {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const feature = await import('../src/renderer/features/worktrees');

  feature.initWorktrees(resolveElements(), async () => {});
  return feature;
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

const LINKED = 'D:\\work\\app.worktrees\\login';

/**
 * The row for a worktree path.
 *
 * Matched on the dataset rather than with an attribute selector, because a
 * Windows path is full of backslashes and CSS reads those as escapes.
 */
function findRow(listId: string, worktreePath: string): HTMLElement {
  const row = [...$(listId).querySelectorAll<HTMLElement>('[data-worktree-path]')].find(
    (candidate) => candidate.dataset['worktreePath'] === worktreePath
  );

  if (!row) {
    throw new Error(`No row for ${worktreePath} in #${listId}`);
  }

  return row;
}

/** Clicks the action button on the row for a worktree path. */
function clickAction(
  listId: string,
  worktreePath: string,
  action: string,
  handler: (target: HTMLElement) => void
): void {
  const button = findRow(listId, worktreePath).querySelector<HTMLElement>(
    `[data-action="${action}"]`
  );

  if (!button) {
    throw new Error(`No "${action}" action on ${worktreePath} in #${listId}`);
  }

  handler(button);
}

beforeEach(() => {
  for (const mock of Object.values(endpoints)) {
    mock.mockReset();
  }
  dialogs.confirmDialog.mockReset();
  dialogs.promptDialog.mockReset();

  endpoints.getWorktrees.mockResolvedValue({
    success: true,
    familyKey: 'd:\\work\\app\\.git',
    mainPath: main.path,
    worktrees: [main, worktree()],
    suggestedParent: 'D:\\work\\app.worktrees'
  });
  endpoints.getWorktreeStatus.mockResolvedValue({
    success: true,
    worktrees: [main, worktree()],
    cancelled: false
  });
  endpoints.previewWorktreePrune.mockResolvedValue({ success: true, entries: [] });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the sidebar list', () => {
  it('renders a row for every worktree', async () => {
    const feature = await mount();
    await feature.refreshWorktrees();

    expect($('worktree-list').querySelectorAll('[data-worktree-path]')).toHaveLength(2);
  });

  it('counts only the linked worktrees, not the repository itself', async () => {
    const feature = await mount();
    await feature.refreshWorktrees();

    expect($('worktree-count').textContent).toBe('1');
  });

  it('shows nothing to open for a worktree whose folder is gone', async () => {
    endpoints.getWorktrees.mockResolvedValue({
      success: true,
      familyKey: 'k',
      mainPath: main.path,
      worktrees: [main, worktree({ present: false })],
      suggestedParent: 'D:\\work\\app.worktrees'
    });
    endpoints.getWorktreeStatus.mockRejectedValue(new Error('no status for a missing folder'));

    const feature = await mount();
    await feature.refreshWorktrees();

    const row = findRow('worktree-list', LINKED);

    expect(row.textContent).toContain('folder missing');
    expect(row.querySelector<HTMLButtonElement>('[data-action="open"]')?.disabled).toBe(true);
  });

  it('describes a detached worktree by its commit', async () => {
    endpoints.getWorktrees.mockResolvedValue({
      success: true,
      familyKey: 'k',
      mainPath: main.path,
      worktrees: [main, worktree({ detached: true, branch: undefined })],
      suggestedParent: 'D:\\work\\app.worktrees'
    });
    endpoints.getWorktreeStatus.mockResolvedValue({
      success: true,
      worktrees: [main, worktree({ detached: true, branch: undefined })],
      cancelled: false
    });

    const feature = await mount();
    await feature.refreshWorktrees();

    expect($('worktree-list').textContent).toContain('detached at aa696a17');
  });

  it('repeats a lock reason, so the reason is where the lock is', async () => {
    const locked = worktree({ locked: true, lockReason: 'on a USB drive' });
    endpoints.getWorktrees.mockResolvedValue({
      success: true,
      familyKey: 'k',
      mainPath: main.path,
      worktrees: [main, locked],
      suggestedParent: 'D:\\work\\app.worktrees'
    });
    endpoints.getWorktreeStatus.mockResolvedValue({
      success: true,
      worktrees: [main, locked],
      cancelled: false
    });

    const feature = await mount();
    await feature.refreshWorktrees();

    expect($('worktree-list').textContent).toContain('on a USB drive');
  });

  it('summarises the dirty counts once the status pass lands', async () => {
    const dirty = worktree({
      status: {
        staged: 1,
        unstaged: 2,
        untracked: 3,
        conflicts: 0,
        ahead: 4,
        behind: 5,
        tracking: 'origin/feature/login'
      }
    });
    endpoints.getWorktreeStatus.mockResolvedValue({
      success: true,
      worktrees: [main, dirty],
      cancelled: false
    });

    const feature = await mount();
    await feature.refreshWorktrees();

    const text = $('worktree-list').textContent ?? '';
    expect(text).toContain('1 staged, 2 modified, 3 untracked');
    expect(text).toContain('4↑ 5↓');
  });

  it('still shows the list when the status pass fails', async () => {
    endpoints.getWorktreeStatus.mockRejectedValue(new Error('cancelled'));

    const feature = await mount();
    await feature.refreshWorktrees();

    expect($('worktree-list').querySelectorAll('[data-worktree-path]')).toHaveLength(2);
  });
});

describe('the manager', () => {
  it('offers remove and move on a linked worktree but not on the main one', async () => {
    const feature = await mount();
    await feature.refreshWorktrees();

    const mainRow = findRow('worktree-manager-list', 'D:\\work\\app');
    const linkedRow = findRow('worktree-manager-list', LINKED);

    expect(mainRow.querySelector<HTMLButtonElement>('[data-action="remove"]')?.disabled).toBe(true);
    expect(mainRow.querySelector<HTMLButtonElement>('[data-action="move"]')?.disabled).toBe(true);
    expect(linkedRow.querySelector<HTMLButtonElement>('[data-action="remove"]')?.disabled).toBe(
      false
    );
  });

  it('previews the folder before anything is created', async () => {
    const feature = await mount();
    feature.openWorktreeManager();
    await feature.refreshWorktrees();

    (document.getElementById('worktree-branch-input') as HTMLInputElement).value = 'feature/login';
    feature.onCreateFormChanged();

    // The absolute path, not "somewhere sensible".
    expect($('worktree-path-preview').textContent).toBe(
      'D:\\work\\app.worktrees\\feature-login'
    );
  });

  it('mirrors the server\'s folder-name rule in the preview', async () => {
    const feature = await mount();
    feature.openWorktreeManager();
    await feature.refreshWorktrees();

    (document.getElementById('worktree-branch-input') as HTMLInputElement).value = 'fix: crash?now';
    feature.onCreateFormChanged();

    expect($('worktree-path-preview').textContent).toBe('D:\\work\\app.worktrees\\fix--crash-now');
  });

  it('stops suggesting once the user types a path of their own', async () => {
    const feature = await mount();
    feature.openWorktreeManager();
    await feature.refreshWorktrees();

    const pathInput = document.getElementById('worktree-path-input') as HTMLInputElement;
    pathInput.value = 'E:\\somewhere\\else';
    feature.markPathTouched();

    (document.getElementById('worktree-branch-input') as HTMLInputElement).value = 'other';
    feature.onCreateFormChanged();

    expect(pathInput.value).toBe('E:\\somewhere\\else');
  });

  it('hides the branch field for a detached worktree', async () => {
    const feature = await mount();
    feature.openWorktreeManager();
    await feature.refreshWorktrees();

    (document.getElementById('worktree-branch-mode') as HTMLSelectElement).value = 'detached';
    feature.onCreateFormChanged();

    expect($('worktree-branch-row').classList.contains('hidden')).toBe(true);
  });
});

describe('removing from the manager', () => {
  beforeEach(() => {
    endpoints.removeWorktree.mockResolvedValue({
      success: true,
      removedPath: 'D:\\work\\app.worktrees\\login',
      worktrees: [main]
    });
  });

  it('asks once for a clean worktree', async () => {
    dialogs.confirmDialog.mockResolvedValue({ confirmed: true, checked: false });

    const feature = await mount();
    await feature.refreshWorktrees();

    clickAction(
      'worktree-manager-list',
      'D:\\work\\app.worktrees\\login',
      'remove',
      feature.handleWorktreeAction
    );
    await vi.waitFor(() => expect(endpoints.removeWorktree).toHaveBeenCalled());

    expect(endpoints.removeWorktree).toHaveBeenCalledWith({
      path: 'D:\\work\\app.worktrees\\login'
    });
    expect(dialogs.promptDialog).not.toHaveBeenCalled();
  });

  it('removes nothing when the confirmation is declined', async () => {
    dialogs.confirmDialog.mockResolvedValue({ confirmed: false, checked: false });

    const feature = await mount();
    await feature.refreshWorktrees();

    clickAction(
      'worktree-manager-list',
      'D:\\work\\app.worktrees\\login',
      'remove',
      feature.handleWorktreeAction
    );
    await vi.waitFor(() => expect(dialogs.confirmDialog).toHaveBeenCalled());

    expect(endpoints.removeWorktree).not.toHaveBeenCalled();
  });

  it('demands the folder name when there is uncommitted work', async () => {
    const dirty = worktree({
      status: {
        staged: 0,
        unstaged: 1,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
        tracking: ''
      }
    });
    endpoints.getWorktreeStatus.mockResolvedValue({
      success: true,
      worktrees: [main, dirty],
      cancelled: false
    });
    dialogs.promptDialog.mockResolvedValue('login');

    const feature = await mount();
    await feature.refreshWorktrees();

    clickAction(
      'worktree-manager-list',
      'D:\\work\\app.worktrees\\login',
      'remove',
      feature.handleWorktreeAction
    );
    await vi.waitFor(() => expect(endpoints.removeWorktree).toHaveBeenCalled());

    // No plain confirm at all for this case: the typed name is the gate.
    expect(dialogs.confirmDialog).not.toHaveBeenCalled();
    expect(endpoints.removeWorktree).toHaveBeenCalledWith({
      path: 'D:\\work\\app.worktrees\\login',
      force: true,
      confirmName: 'login'
    });
  });

  it('removes nothing when the typed name does not match', async () => {
    const dirty = worktree({
      status: {
        staged: 0,
        unstaged: 1,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
        tracking: ''
      }
    });
    endpoints.getWorktreeStatus.mockResolvedValue({
      success: true,
      worktrees: [main, dirty],
      cancelled: false
    });
    dialogs.promptDialog.mockResolvedValue('lgoin');

    const feature = await mount();
    await feature.refreshWorktrees();

    clickAction(
      'worktree-manager-list',
      'D:\\work\\app.worktrees\\login',
      'remove',
      feature.handleWorktreeAction
    );
    await vi.waitFor(() => expect(dialogs.promptDialog).toHaveBeenCalled());

    expect(endpoints.removeWorktree).not.toHaveBeenCalled();
  });

  it('treats untracked files alone as work worth protecting', async () => {
    const dirty = worktree({
      status: {
        staged: 0,
        unstaged: 0,
        untracked: 2,
        conflicts: 0,
        ahead: 0,
        behind: 0,
        tracking: ''
      }
    });
    endpoints.getWorktreeStatus.mockResolvedValue({
      success: true,
      worktrees: [main, dirty],
      cancelled: false
    });
    dialogs.promptDialog.mockResolvedValue(null);

    const feature = await mount();
    await feature.refreshWorktrees();

    clickAction(
      'worktree-manager-list',
      'D:\\work\\app.worktrees\\login',
      'remove',
      feature.handleWorktreeAction
    );
    await vi.waitFor(() => expect(dialogs.promptDialog).toHaveBeenCalled());

    expect(endpoints.removeWorktree).not.toHaveBeenCalled();
  });
});
