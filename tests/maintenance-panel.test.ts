// @vitest-environment happy-dom
//
// The Maintenance tab, against the real index.html.
//
// The behaviour worth pinning here is what the panel refuses to do quietly: a
// worktree holding uncommitted work cannot be ticked until the extra opt-in is
// on, the purge sends exactly the ticked rows, and force-deleting an unmerged
// branch is only ever offered as a confirmation the user has to agree to.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import { DEFAULT_STALE_RULES } from '../src/shared/maintenance-types';
import type {
  MaintenanceSurvey,
  MergedBranchCandidate,
  WorktreeCandidate
} from '../src/shared/maintenance-types';

const endpoints = vi.hoisted(() => ({
  getMaintenanceSurvey: vi.fn(),
  purgeStaleWorktrees: vi.fn(),
  deleteBranches: vi.fn(),
  saveAppSettings: vi.fn()
}));

const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(), promptDialog: vi.fn() }));
const hub = vi.hoisted(() => ({ registerHubTab: vi.fn(), openRepoHub: vi.fn() }));

vi.mock('../src/renderer/api/endpoints', () => endpoints);
vi.mock('../src/renderer/ui/dialogs', () => dialogs);
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));
vi.mock('../src/renderer/ui/busy', () => ({
  withButtonBusy: async (_button: unknown, run: () => Promise<void>) => run()
}));
vi.mock('../src/renderer/features/repo-hub', () => hub);

function candidate(overrides: Partial<WorktreeCandidate> = {}): WorktreeCandidate {
  return {
    path: 'D:\\work\\app.worktrees\\login',
    name: 'login',
    branch: 'feature/login',
    verdict: {
      stale: true,
      signals: ['no-pull-request', 'inactive'],
      reasons: ['no pull request was ever opened', 'no commits for 84 days'],
      unknown: []
    },
    facts: {
      name: 'feature/login',
      lastCommit: '2026-05-29T10:00:00Z',
      daysSinceCommit: 84,
      pushed: false,
      upstreamGone: false,
      pullRequest: null,
      pullRequestKnown: true,
      merged: true,
      isCurrent: false,
      pinned: false,
      checkedOutIn: 'D:\\work\\app.worktrees\\login'
    },
    dirty: false,
    uncommittedFiles: 0,
    present: true,
    branchDeletable: true,
    ...overrides
  };
}

function mergedBranch(overrides: Partial<MergedBranchCandidate> = {}): MergedBranchCandidate {
  return {
    name: 'feature/done',
    lastCommit: '2026-06-01T09:00:00Z',
    pullRequest: { number: 41, state: 'MERGED', url: 'https://example/41' },
    checkedOutIn: null,
    deletable: true,
    ...overrides
  };
}

function survey(overrides: Partial<MaintenanceSurvey> = {}): MaintenanceSurvey {
  return {
    rules: { ...DEFAULT_STALE_RULES },
    mergedInto: 'origin/main',
    staleWorktrees: [candidate()],
    keptWorktrees: [{ path: 'D:\\work\\app', name: 'app', reason: 'the repository itself' }],
    mergedBranches: [mergedBranch()],
    pullRequestLookup: 'ok',
    warnings: [],
    ...overrides
  };
}

/** Mounts the real markup and hands back the registered tab renderer. */
async function mount(): Promise<{ render: () => Promise<void>; panel: HTMLElement }> {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  vi.resetModules();
  const feature = await import('../src/renderer/features/maintenance');
  feature.initMaintenance(async () => {});

  const [, owner] = hub.registerHubTab.mock.calls[0] as [string, { render: (p: HTMLElement) => Promise<void> }];
  const panel = document.getElementById('hub-panel-maintenance') as HTMLElement;

  return { render: () => owner.render(panel), panel };
}

const rows = (panel: HTMLElement, selector: string): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>(selector)];

/** The row for a worktree path, matched on the dataset — paths carry backslashes. */
function worktreeRow(panel: HTMLElement, worktreePath: string): HTMLElement {
  const row = rows(panel, '[data-worktree-path]').find(
    (candidateRow) => candidateRow.dataset['worktreePath'] === worktreePath
  );

  if (!row) {
    throw new Error(`No row for ${worktreePath}`);
  }

  return row;
}

function boxIn(row: HTMLElement): HTMLInputElement {
  return row.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement;
}

/** The button whose label contains `text`. */
function button(panel: HTMLElement, text: string): HTMLButtonElement {
  const match = rows(panel, 'button').find((entry) => (entry.textContent ?? '').includes(text));
  if (!match) {
    throw new Error(`No button matching "${text}"`);
  }
  return match as HTMLButtonElement;
}

function check(box: HTMLInputElement, value: boolean): void {
  box.checked = value;
  box.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  for (const mock of Object.values(endpoints)) {
    mock.mockReset();
  }
  hub.registerHubTab.mockReset();
  dialogs.confirmDialog.mockReset();

  endpoints.getMaintenanceSurvey.mockResolvedValue({ success: true, survey: survey() });
  endpoints.purgeStaleWorktrees.mockResolvedValue({
    success: true,
    results: [],
    removed: 1,
    branchesDeleted: 1,
    pruned: []
  });
  endpoints.deleteBranches.mockResolvedValue({ success: true, results: [], deleted: 1 });
  endpoints.saveAppSettings.mockResolvedValue({ success: true });
  dialogs.confirmDialog.mockResolvedValue({ confirmed: true, checked: false });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the stale worktree list', () => {
  it('shows each candidate with the reasons it was listed', async () => {
    const { render, panel } = await mount();
    await render();

    const row = worktreeRow(panel, 'D:\\work\\app.worktrees\\login');

    expect(row.textContent).toContain('login');
    expect(row.textContent).toContain('no pull request was ever opened');
    expect(row.textContent).toContain('no commits for 84 days');
  });

  it('names the worktrees it will never offer, and why', async () => {
    const { render, panel } = await mount();
    await render();

    expect(panel.textContent).toContain('app (the repository itself)');
  });

  it('ticks everything that can go, so the button counts what will happen', async () => {
    const { render, panel } = await mount();
    await render();

    expect(boxIn(worktreeRow(panel, 'D:\\work\\app.worktrees\\login')).checked).toBe(true);
    expect(button(panel, 'Purge 1 worktree(s)').disabled).toBe(false);
  });

  it('will not let a worktree with uncommitted changes be ticked on its own', async () => {
    endpoints.getMaintenanceSurvey.mockResolvedValue({
      success: true,
      survey: survey({ staleWorktrees: [candidate({ dirty: true, uncommittedFiles: 3 })] })
    });

    const { render, panel } = await mount();
    await render();

    const box = boxIn(worktreeRow(panel, 'D:\\work\\app.worktrees\\login'));

    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(button(panel, 'Purge selected').disabled).toBe(true);
  });

  it('makes it selectable once the uncommitted-work option is on', async () => {
    endpoints.getMaintenanceSurvey.mockResolvedValue({
      success: true,
      survey: survey({ staleWorktrees: [candidate({ dirty: true, uncommittedFiles: 3 })] })
    });

    const { render, panel } = await mount();
    await render();

    const option = rows(panel, 'input[type="checkbox"]').find((box) =>
      box.getAttribute('aria-label')?.includes('Include ones with uncommitted changes')
    ) as HTMLInputElement;

    check(option, true);

    expect(boxIn(worktreeRow(panel, 'D:\\work\\app.worktrees\\login')).checked).toBe(true);
    expect(button(panel, 'Purge 1 worktree(s)').disabled).toBe(false);
  });

  it('purges only the rows that are ticked', async () => {
    const second = candidate({
      path: 'D:\\work\\app.worktrees\\perf',
      name: 'perf',
      branch: 'spike/perf'
    });
    endpoints.getMaintenanceSurvey.mockResolvedValue({
      success: true,
      survey: survey({ staleWorktrees: [candidate(), second] })
    });

    const { render, panel } = await mount();
    await render();

    check(boxIn(worktreeRow(panel, 'D:\\work\\app.worktrees\\perf')), false);
    button(panel, 'Purge 1 worktree(s)').click();
    await vi.waitFor(() => expect(endpoints.purgeStaleWorktrees).toHaveBeenCalled());

    expect(endpoints.purgeStaleWorktrees).toHaveBeenCalledWith({
      paths: ['D:\\work\\app.worktrees\\login'],
      deleteBranches: true,
      includeDirty: false,
      forceBranchDelete: false
    });
  });

  it('removes nothing when the confirmation is declined', async () => {
    dialogs.confirmDialog.mockResolvedValue({ confirmed: false, checked: false });

    const { render, panel } = await mount();
    await render();

    button(panel, 'Purge 1 worktree(s)').click();
    await vi.waitFor(() => expect(dialogs.confirmDialog).toHaveBeenCalled());

    expect(endpoints.purgeStaleWorktrees).not.toHaveBeenCalled();
  });

  it('offers force-delete only when a branch is not merged, and passes the answer on', async () => {
    endpoints.getMaintenanceSurvey.mockResolvedValue({
      success: true,
      survey: survey({
        staleWorktrees: [
          candidate({
            facts: { ...(candidate().facts as NonNullable<WorktreeCandidate['facts']>), merged: false }
          })
        ]
      })
    });
    dialogs.confirmDialog.mockResolvedValue({ confirmed: true, checked: true });

    const { render, panel } = await mount();
    await render();

    button(panel, 'Purge 1 worktree(s)').click();
    await vi.waitFor(() => expect(endpoints.purgeStaleWorktrees).toHaveBeenCalled());

    expect(dialogs.confirmDialog.mock.calls[0]?.[1]).toMatchObject({
      checkboxLabel: 'Delete branches that are not merged'
    });
    expect(endpoints.purgeStaleWorktrees.mock.calls[0]?.[0]).toMatchObject({
      forceBranchDelete: true
    });
  });

  it('does not offer force-delete when every branch is already merged', async () => {
    const { render, panel } = await mount();
    await render();

    button(panel, 'Purge 1 worktree(s)').click();
    await vi.waitFor(() => expect(dialogs.confirmDialog).toHaveBeenCalled());

    expect(dialogs.confirmDialog.mock.calls[0]?.[1]).not.toHaveProperty('checkboxLabel');
  });

  it('keeps the branches when that option is turned off', async () => {
    const { render, panel } = await mount();
    await render();

    const option = rows(panel, 'input[type="checkbox"]').find((box) =>
      box.getAttribute('aria-label')?.includes('Delete each worktree')
    ) as HTMLInputElement;
    check(option, false);

    button(panel, 'Purge 1 worktree(s)').click();
    await vi.waitFor(() => expect(endpoints.purgeStaleWorktrees).toHaveBeenCalled());

    expect(endpoints.purgeStaleWorktrees.mock.calls[0]?.[0]).toMatchObject({
      deleteBranches: false
    });
  });
});

describe('the merged branch list', () => {
  it('deletes the ticked branches without forcing', async () => {
    const { render, panel } = await mount();
    await render();

    button(panel, 'Delete 1 branch(es)').click();
    await vi.waitFor(() => expect(endpoints.deleteBranches).toHaveBeenCalled());

    expect(endpoints.deleteBranches).toHaveBeenCalledWith(['feature/done'], false);
  });

  it('never ticks a branch that is checked out somewhere', async () => {
    endpoints.getMaintenanceSurvey.mockResolvedValue({
      success: true,
      survey: survey({
        mergedBranches: [
          mergedBranch({
            name: 'feature/held',
            checkedOutIn: 'D:\\work\\app.worktrees\\held',
            deletable: false,
            blockedReason: 'checked out in held'
          })
        ]
      })
    });

    const { render, panel } = await mount();
    await render();

    const row = rows(panel, '[data-branch]')[0] as HTMLElement;

    expect(boxIn(row).disabled).toBe(true);
    expect(boxIn(row).checked).toBe(false);
    expect(row.textContent).toContain('checked out in held');
  });
});

describe('the rules', () => {
  it('describes the current rule in a sentence', async () => {
    const { render, panel } = await mount();
    await render();

    expect(panel.textContent).toContain(
      'A branch is stale when no pull request was ever opened for it and nothing has landed on it for 60 days.'
    );
  });

  it('joins the rules with "or" when any one of them is enough', async () => {
    endpoints.getMaintenanceSurvey.mockResolvedValue({
      success: true,
      survey: survey({ rules: { ...DEFAULT_STALE_RULES, match: 'any' } })
    });

    const { render, panel } = await mount();
    await render();

    expect(panel.textContent).toContain(
      'no pull request was ever opened for it or nothing has landed on it for 60 days'
    );
  });

  it('saves a changed rule and surveys again', async () => {
    const { render, panel } = await mount();
    await render();

    const unpushed = rows(panel, 'input[type="checkbox"]').find((box) =>
      box.getAttribute('aria-label')?.includes('No remote has a copy of it')
    ) as HTMLInputElement;

    check(unpushed, true);
    await vi.waitFor(() => expect(endpoints.saveAppSettings).toHaveBeenCalled());

    expect(endpoints.saveAppSettings).toHaveBeenCalledWith({
      staleRules: { ...DEFAULT_STALE_RULES, requireUnpushed: true }
    });
    expect(endpoints.getMaintenanceSurvey).toHaveBeenCalledTimes(2);
  });

  it('clamps a day count that would call every branch stale', async () => {
    const { render, panel } = await mount();
    await render();

    const days = panel.querySelector<HTMLInputElement>('.stale-days') as HTMLInputElement;
    days.value = '0';
    days.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(endpoints.saveAppSettings).toHaveBeenCalled());

    expect(endpoints.saveAppSettings.mock.calls[0]?.[0]).toMatchObject({
      staleRules: { ...DEFAULT_STALE_RULES, inactiveDays: 1 }
    });
  });

  it('shows the survey’s warnings rather than an unexplained empty list', async () => {
    endpoints.getMaintenanceSurvey.mockResolvedValue({
      success: true,
      survey: survey({
        staleWorktrees: [],
        pullRequestLookup: 'cli-unavailable',
        warnings: ['GitHub CLI is not available. Nothing can be listed while that rule is ticked.']
      })
    });

    const { render, panel } = await mount();
    await render();

    expect(panel.querySelector('.inline-warning')?.textContent).toContain('GitHub CLI');
    expect(panel.textContent).toContain('No worktree matches these rules');
  });
});
