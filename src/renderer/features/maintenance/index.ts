// The Maintenance tab: clearing out worktrees and branches nobody came back to.
//
// Two bulk deletions live here, which makes this the most destructive panel in
// the application after the rebase planner. Three things follow from that, and
// they are the shape of the whole file:
//
//   * Nothing is ever purged from a rule. The rules produce a list, the list is
//     shown with the reason beside every row, and the purge acts on ticked
//     rows only — so what happens is what was read, not what was inferred.
//   * The definition of stale is the user's. It is a form at the top of the
//     panel, saved as a setting, and the Branch Maintenance window reads the
//     same one.
//   * The two escalations — losing uncommitted work, deleting a branch git
//     would refuse to delete — are separate opt-ins, and both leave something
//     behind in the Safety Net.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { el, icon } from '../../dom/create';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import { registerHubTab } from '../repo-hub';
import { buildMatchSelect, buildStaleRulesForm } from './rules-form';
import { DEFAULT_STALE_RULES } from '../../../shared/maintenance-types';
import type {
  MaintenanceSurvey,
  MergedBranchCandidate,
  PurgeOutcome,
  StaleRules,
  WorktreeCandidate
} from '../../../shared/maintenance-types';

const PANEL_ID = 'hub-panel-maintenance';

let refreshAll: () => Promise<void> = async () => {};

let survey: MaintenanceSurvey | null = null;
let rules: StaleRules = { ...DEFAULT_STALE_RULES };
let loadError = '';

/** Ticked rows, by worktree path and by branch name. */
const selectedWorktrees = new Set<string>();
const selectedBranches = new Set<string>();

/** Panel options, which decide how far a purge goes. */
let deleteBranches = true;
let includeDirty = false;

export function initMaintenance(onChanged: () => Promise<void>): void {
  refreshAll = onChanged;
  registerHubTab('maintenance', { render: renderPanel });
}

// ---------- loading and drawing ----------

async function load(): Promise<void> {
  try {
    const result = await api.getMaintenanceSurvey();
    survey = result.survey;
    rules = result.survey.rules;
    loadError = '';

    // Everything that can go is ticked to begin with — the tab exists to clear
    // things out — but a row that cannot be acted on is never ticked, so the
    // number on the button is the number of things that will happen.
    selectedWorktrees.clear();
    for (const candidate of result.survey.staleWorktrees) {
      if (!candidate.dirty || includeDirty) {
        selectedWorktrees.add(candidate.path);
      }
    }

    selectedBranches.clear();
    for (const branch of result.survey.mergedBranches) {
      if (branch.deletable) {
        selectedBranches.add(branch.name);
      }
    }
  } catch (error) {
    if (isStale(error)) {
      return;
    }
    survey = null;
    loadError = errorMessage(error, 'Could not survey this repository.');
  }
}

async function renderPanel(panel: HTMLElement): Promise<void> {
  await load();
  panel.replaceChildren(...build());
}

/** Re-reads the repository and redraws. */
async function refreshPanel(): Promise<void> {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    await renderPanel(panel);
  }
}

/** Redraws from what is already loaded, for a tick that changes no data. */
function redraw(): void {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.replaceChildren(...build());
  }
}

// ---------- small builders ----------

function checkbox(
  checked: boolean,
  enabled: boolean,
  label: string,
  onChange: (value: boolean) => void
): HTMLInputElement {
  const box = el('input', { className: 'branch-select' }) as HTMLInputElement;
  box.type = 'checkbox';
  box.checked = checked;
  box.disabled = !enabled;
  box.setAttribute('aria-label', label);
  box.addEventListener('change', () => onChange(box.checked));
  return box;
}

function checkboxRow(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
  extra: (Node | null)[] = []
): HTMLLabelElement {
  return el('label', {
    className: 'checkbox-row',
    children: [checkbox(checked, true, label, onChange), el('span', { text: label }), ...extra]
  });
}

function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', { className: 'btn btn-secondary btn-sm', text: label });
  button.addEventListener('click', onClick);
  return button;
}

// ---------- the rules form ----------

/**
 * Saves the rules and surveys again.
 *
 * Saved rather than held in the panel because the definition of stale is one
 * setting for the whole application: the Branch Maintenance window marks
 * branches stale by the same number, and two windows disagreeing about the
 * word would be worse than a round trip.
 */
async function applyRules(next: StaleRules): Promise<void> {
  rules = next;

  try {
    await api.saveAppSettings({ staleRules: next });
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not save the rule.'), 'error', 6000);
    }
  }

  await refreshPanel();
}

function buildRules(): HTMLElement {
  // The same control the Settings window shows, so the two cannot disagree
  // about what the one setting says.
  const form = { rules, onChange: (next: StaleRules) => void applyRules(next) };

  return el('section', {
    children: [
      el('div', {
        className: 'section-header',
        children: [
          el('h4', { text: 'What counts as stale' }),
          el('div', {
            className: 'checkbox-row',
            children: [el('span', { text: 'The ticked rules' }), buildMatchSelect(form)]
          })
        ]
      }),
      buildStaleRulesForm(form)
    ]
  });
}

// ---------- the stale worktree list ----------

/** The one-line description under a candidate's name. */
function candidateMeta(candidate: WorktreeCandidate): string {
  const parts: string[] = [candidate.branch ?? 'detached', ...candidate.verdict.reasons];

  if (!candidate.present) {
    parts.push('folder already gone');
  }
  if (candidate.dirty) {
    parts.push(`${candidate.uncommittedFiles} uncommitted file(s)`);
  }
  if (candidate.facts?.pullRequest) {
    const pullRequest = candidate.facts.pullRequest;
    parts.push(`PR #${pullRequest.number} ${pullRequest.state.toLowerCase()}`);
  }
  if (candidate.branchBlockedReason !== undefined) {
    parts.push(`branch kept: ${candidate.branchBlockedReason}`);
  }

  return parts.join(' · ');
}

function worktreeRow(candidate: WorktreeCandidate): HTMLLIElement {
  // A worktree with uncommitted work can only be ticked once the extra opt-in
  // is on, so it cannot quietly become part of a purge that loses that work.
  const selectable = !candidate.dirty || includeDirty;

  return el('li', {
    className: `worktree-item${candidate.dirty ? ' maintenance-dirty' : ''}`,
    data: { worktreePath: candidate.path },
    children: [
      checkbox(
        selectable && selectedWorktrees.has(candidate.path),
        selectable,
        `Purge ${candidate.name}`,
        (value) => {
          if (value) {
            selectedWorktrees.add(candidate.path);
          } else {
            selectedWorktrees.delete(candidate.path);
          }
          redraw();
        }
      ),
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', { className: 'worktree-name', text: candidate.name, title: candidate.path }),
          el('span', { className: 'worktree-meta', text: candidateMeta(candidate) })
        ]
      })
    ]
  }) as HTMLLIElement;
}

/** Candidates that may be ticked at all, given the uncommitted-work option. */
function selectableWorktrees(): WorktreeCandidate[] {
  return (survey?.staleWorktrees ?? []).filter(
    (candidate) => !candidate.dirty || includeDirty
  );
}

function onIncludeDirtyChanged(value: boolean): void {
  includeDirty = value;

  for (const candidate of survey?.staleWorktrees ?? []) {
    if (!candidate.dirty) {
      continue;
    }
    // Turning it on ticks the rows it just made available, which is the whole
    // point of the option; turning it off unticks them, so nothing dirty can be
    // left selected by a state the panel no longer shows.
    if (value) {
      selectedWorktrees.add(candidate.path);
    } else {
      selectedWorktrees.delete(candidate.path);
    }
  }

  redraw();
}

function buildWorktrees(): HTMLElement {
  const candidates = survey?.staleWorktrees ?? [];
  const selectable = selectableWorktrees();
  const selected = candidates.filter((candidate) => selectedWorktrees.has(candidate.path));
  const allSelected =
    selectable.length > 0 && selectable.every((candidate) => selectedWorktrees.has(candidate.path));

  const purge = el('button', {
    className: 'btn btn-danger btn-sm',
    children: [
      icon('delete_sweep', 16),
      el('span', {
        text: selected.length === 0 ? 'Purge selected' : `Purge ${selected.length} worktree(s)`
      })
    ]
  }) as HTMLButtonElement;

  purge.disabled = selected.length === 0;
  purge.addEventListener('click', () => {
    void withButtonBusy(purge, () => purgeSelected(selected));
  });

  return el('section', {
    children: [
      el('div', {
        className: 'section-header',
        children: [
          el('h4', { text: `Stale worktrees (${candidates.length})` }),
          selectable.length === 0
            ? null
            : textButton(allSelected ? 'Select none' : 'Select all', () => {
                selectedWorktrees.clear();
                if (!allSelected) {
                  for (const candidate of selectable) {
                    selectedWorktrees.add(candidate.path);
                  }
                }
                redraw();
              })
        ]
      }),
      el('p', {
        className: 'modal-desc',
        text: 'Purging a worktree removes its folder. A recovery point is saved before anything goes, and the main worktree, this window’s own folder, and anything locked or pinned are never offered.'
      }),
      el('ul', {
        className: 'worktree-list',
        children:
          candidates.length === 0
            ? [el('li', { className: 'empty-state', text: 'No worktree matches these rules' })]
            : candidates.map(worktreeRow)
      }),
      el('div', {
        className: 'search-filters',
        children: [
          checkboxRow('Delete each worktree’s branch too', deleteBranches, (value) => {
            deleteBranches = value;
            redraw();
          }),
          candidates.some((candidate) => candidate.dirty)
            ? checkboxRow(
                'Include ones with uncommitted changes',
                includeDirty,
                onIncludeDirtyChanged
              )
            : null,
          purge
        ]
      })
    ]
  });
}

// ---------- the merged branch list ----------

function branchRow(branch: MergedBranchCandidate): HTMLLIElement {
  const parts: string[] = [];

  if (branch.pullRequest) {
    parts.push(`PR #${branch.pullRequest.number} ${branch.pullRequest.state.toLowerCase()}`);
  }
  if (branch.lastCommit !== '') {
    parts.push(`last commit ${branch.lastCommit.slice(0, 10)}`);
  }
  if (branch.blockedReason !== undefined) {
    parts.push(branch.blockedReason);
  }

  return el('li', {
    className: 'worktree-item',
    data: { branch: branch.name },
    children: [
      checkbox(
        selectedBranches.has(branch.name),
        branch.deletable,
        `Delete ${branch.name}`,
        (value) => {
          if (value) {
            selectedBranches.add(branch.name);
          } else {
            selectedBranches.delete(branch.name);
          }
          redraw();
        }
      ),
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', { className: 'worktree-name', text: branch.name }),
          el('span', { className: 'worktree-meta', text: parts.join(' · ') })
        ]
      })
    ]
  }) as HTMLLIElement;
}

function buildMergedBranches(): HTMLElement {
  const branches = survey?.mergedBranches ?? [];
  const deletable = branches.filter((branch) => branch.deletable);
  const selected = branches.filter((branch) => selectedBranches.has(branch.name));
  const allSelected =
    deletable.length > 0 && deletable.every((branch) => selectedBranches.has(branch.name));

  const remove = el('button', {
    className: 'btn btn-danger btn-sm',
    children: [
      icon('delete', 16),
      el('span', {
        text: selected.length === 0 ? 'Delete selected' : `Delete ${selected.length} branch(es)`
      })
    ]
  }) as HTMLButtonElement;

  remove.disabled = selected.length === 0;
  remove.addEventListener('click', () => {
    void withButtonBusy(remove, () => deleteSelectedBranches(selected));
  });

  return el('section', {
    children: [
      el('div', {
        className: 'section-header',
        children: [
          el('h4', { text: `Merged branches (${branches.length})` }),
          deletable.length === 0
            ? null
            : textButton(allSelected ? 'Select none' : 'Select all', () => {
                selectedBranches.clear();
                if (!allSelected) {
                  for (const branch of deletable) {
                    selectedBranches.add(branch.name);
                  }
                }
                redraw();
              })
        ]
      }),
      el('p', {
        className: 'modal-desc',
        text: `Every commit on these is already in ${survey?.mergedInto ?? 'the default branch'}, so deleting them loses nothing. The current branch, pinned branches, and anything checked out in a worktree are left alone.`
      }),
      el('ul', {
        className: 'worktree-list',
        children:
          branches.length === 0
            ? [el('li', { className: 'empty-state', text: 'Nothing is merged and unused' })]
            : branches.map(branchRow)
      }),
      el('div', { className: 'btn-group', children: [remove] })
    ]
  });
}

// ---------- assembling the panel ----------

function buildKeptNote(): HTMLElement | null {
  const kept = survey?.keptWorktrees ?? [];
  if (kept.length === 0) {
    return null;
  }

  return el('p', {
    className: 'modal-desc',
    text: `Never offered: ${kept.map((entry) => `${entry.name} (${entry.reason})`).join(', ')}.`
  });
}

function build(): Node[] {
  if (loadError !== '') {
    return [el('div', { className: 'inline-warning', text: loadError })];
  }

  const nodes: (Node | null)[] = [
    el('p', {
      className: 'modal-desc',
      text: 'Worktrees and branches that were started and never came back. Nothing here acts on a rule directly: the rules produce these lists, and only the rows you tick are removed.'
    }),
    buildRules(),
    ...(survey?.warnings ?? []).map((warning) =>
      el('div', { className: 'inline-warning', text: warning })
    ),
    buildWorktrees(),
    buildKeptNote(),
    buildMergedBranches()
  ];

  return nodes.filter((node): node is Node => node !== null);
}

// ---------- the two destructive actions ----------

/** Reports what a bulk purge actually did, row by row, in the Terminal Log. */
function logOutcomes(results: readonly PurgeOutcome[]): void {
  for (const outcome of results) {
    if (!outcome.removed) {
      logToTerminal(`${outcome.name}: ${outcome.error ?? 'not removed'}`, 'error');
      continue;
    }

    logToTerminal(`git worktree remove ${outcome.path}`, 'cmd');

    if (outcome.snapshotRef) {
      logToTerminal(
        `${outcome.name}: uncommitted work snapshotted as ${outcome.snapshotRef.slice(0, 8)}`,
        'info'
      );
    }
    if (outcome.branchError !== undefined) {
      logToTerminal(`${outcome.branch ?? outcome.name}: ${outcome.branchError}`, 'error');
    }
  }
}

async function purgeSelected(selected: readonly WorktreeCandidate[]): Promise<void> {
  if (selected.length === 0) {
    return;
  }

  const dirty = selected.filter((candidate) => candidate.dirty);
  const unmerged = deleteBranches
    ? selected.filter((candidate) => candidate.branchDeletable && candidate.facts?.merged === false)
    : [];

  const detail = [
    `Purge ${selected.length} worktree(s)?`,
    '',
    selected
      .map(
        (candidate) =>
          `${candidate.name}${candidate.branch === null ? '' : ` — ${candidate.branch}`}`
      )
      .join('\n'),
    '',
    deleteBranches
      ? 'Each folder is removed and its branch deleted with it.'
      : 'Each folder is removed. The branches stay.',
    dirty.length > 0
      ? `${dirty.length} of them ${dirty.length === 1 ? 'has' : 'have'} uncommitted changes. Tracked work is snapshotted into the Safety Net first; untracked files cannot be recovered afterwards.`
      : '',
    unmerged.length > 0
      ? `${unmerged.length} of the branches are not merged anywhere, so they are kept unless you say otherwise below.`
      : '',
    'A recovery point is saved before anything is removed.'
  ]
    .filter((line) => line !== '')
    .join('\n');

  const { confirmed, checked } = await confirmDialog(detail, {
    title: 'Purge stale worktrees',
    confirmLabel: 'Purge',
    danger: true,
    ...(unmerged.length > 0 ? { checkboxLabel: 'Delete branches that are not merged' } : {})
  });

  if (!confirmed) {
    return;
  }

  try {
    const result = await api.purgeStaleWorktrees({
      paths: selected.map((candidate) => candidate.path),
      deleteBranches,
      includeDirty,
      forceBranchDelete: checked
    });

    logOutcomes(result.results);

    const failed = result.results.filter((outcome) => !outcome.removed);
    const summary = [
      `Removed ${result.removed} worktree(s)`,
      result.branchesDeleted > 0 ? `${result.branchesDeleted} branch(es) deleted` : '',
      result.pruned.length > 0 ? `${result.pruned.length} stale record(s) pruned` : '',
      failed.length > 0 ? `${failed.length} left in place` : ''
    ]
      .filter((part) => part !== '')
      .join(', ');

    showToast(
      `${summary}.`,
      failed.length === 0 ? 'success' : 'warn',
      failed.length === 0 ? 5000 : 9000
    );

    await refreshAll();
    await refreshPanel();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not purge the worktrees.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 8000);
    }
  }
}

async function deleteSelectedBranches(selected: readonly MergedBranchCandidate[]): Promise<void> {
  if (selected.length === 0) {
    return;
  }

  const names = selected.map((branch) => branch.name);

  const { confirmed } = await confirmDialog(
    `Delete ${names.length} merged branch(es)?\n\n${names.join('\n')}\n\nEvery commit on them is already in ${survey?.mergedInto ?? 'the default branch'}. A recovery point is saved first.`,
    { title: 'Delete merged branches', confirmLabel: 'Delete', danger: true }
  );

  if (!confirmed) {
    return;
  }

  try {
    // The same endpoint the Branch Maintenance window uses: it records a
    // recovery point and reports each branch separately. Never forced — a
    // branch listed here is merged, so the safe delete is enough, and one git
    // refuses is one whose state changed since the survey was taken.
    const result = await api.deleteBranches(names, false);
    const failed = result.results.filter((entry) => !entry.deleted);

    for (const entry of failed) {
      logToTerminal(`${entry.branch}: ${entry.error ?? 'could not be deleted'}`, 'error');
    }

    showToast(
      failed.length === 0
        ? `Deleted ${result.deleted} branch(es).`
        : `Deleted ${result.deleted}; ${failed.length} could not be deleted.`,
      failed.length === 0 ? 'success' : 'error',
      failed.length === 0 ? 4000 : 8000
    );

    await refreshAll();
    await refreshPanel();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not delete the branches.'), 'error', 7000);
    }
  }
}
