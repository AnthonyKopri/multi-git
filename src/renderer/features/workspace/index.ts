// The workspace shell: branch header, view tabs, conflict banner, and the
// per-repository identity dialog.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { asInput } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { getState, isConflicted } from '../../state/store';
import { countBadge, repoBaseName } from '../../ui/format';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { refreshIdentity } from '../accounts/identity';
import { renderIdentityRow } from '../accounts/profile-ui';
import { loadWorkspaceTree } from '../explorer';

export type ViewTab = 'staging' | 'diff' | 'explorer';

let ui: Elements;
let refreshStatus: () => Promise<void> = async () => {};

export function initWorkspace(elements: Elements, hooks: { refreshStatus: () => Promise<void> }): void {
  ui = elements;
  refreshStatus = hooks.refreshStatus;
}

function setCountBadge(element: HTMLElement, count: number, arrow: string): void {
  const text = countBadge(count, arrow);
  element.textContent = text;
  setHidden(element, text === '');
}

export function renderBranchHeader(): void {
  const status = getState().status;

  if (!status) {
    ui.branchSegmentName.textContent = '—';
    setCountBadge(ui.branchAheadBadge, 0, '↑');
    setCountBadge(ui.branchBehindBadge, 0, '↓');
    setCountBadge(ui.pushCountBadge, 0, '↑');
    setCountBadge(ui.pullCountBadge, 0, '↓');
    setHidden(ui.branchStateBadge, true);
    return;
  }

  ui.branchSegmentName.textContent = status.branch || '—';
  ui.branchSegmentName.title = status.branch;

  setCountBadge(ui.branchAheadBadge, status.ahead, '↑');
  setCountBadge(ui.branchBehindBadge, status.behind, '↓');
  // The same counts drive the Push and Pull buttons.
  setCountBadge(ui.pushCountBadge, status.ahead, '↑');
  setCountBadge(ui.pullCountBadge, status.behind, '↓');

  // An in-progress operation matters more than a detached HEAD, which matters
  // more than an empty repository.
  const state = status.isRebasing
    ? 'REBASE'
    : status.isMerging
      ? 'MERGE'
      : status.detached
        ? 'DETACHED'
        : status.noCommits
          ? 'NO COMMITS'
          : null;

  if (state) {
    ui.branchStateBadge.textContent = state;
    setHidden(ui.branchStateBadge, false);
  } else {
    setHidden(ui.branchStateBadge, true);
  }
}

export function renderConflictBanner(): void {
  const conflicted = isConflicted();
  const wasHidden = ui.conflictBanner.classList.contains('hidden');

  if (conflicted && wasHidden) {
    const status = getState().status;
    logToTerminal(
      `Active conflict status detected! Merging: ${status?.isMerging}, Rebasing: ${status?.isRebasing}. Conflicted files: ${status?.conflicts.length ?? 0}`,
      'error'
    );
  }

  setHidden(ui.conflictBanner, !conflicted);
}

export function switchViewTab(tab: ViewTab): void {
  const panes: Record<ViewTab, { button: HTMLElement; pane: HTMLElement }> = {
    staging: { button: ui.tabStaging, pane: ui.stagingView },
    diff: { button: ui.tabDiff, pane: ui.diffView },
    explorer: { button: ui.tabExplorer, pane: ui.explorerView }
  };

  for (const [name, { button, pane }] of Object.entries(panes) as [ViewTab, typeof panes.staging][]) {
    const isActive = name === tab;
    button.classList.toggle('active', isActive);
    setHidden(pane, !isActive);
  }

  // The Explorer is built lazily, so it loads when it is first shown.
  if (tab === 'explorer') {
    void loadWorkspaceTree();
  } else if (tab === 'diff' && getState().activeRepo && !getState().status) {
    void refreshStatus();
  }
}

// ---------- identity dialog ----------

export function openIdentityModal(): void {
  const { activeRepo, identity } = getState();

  ui.identityRepoName.textContent = repoBaseName(activeRepo);
  asInput(ui.identityNameInput).value = identity?.name ?? '';
  asInput(ui.identityEmailInput).value = identity?.email ?? '';

  setHidden(ui.identityModal, false);
  setTimeout(() => asInput(ui.identityNameInput).focus(), 30);
}

export async function saveIdentity(): Promise<void> {
  const name = asInput(ui.identityNameInput).value.trim();
  const email = asInput(ui.identityEmailInput).value.trim();

  if (!name || !email) {
    showToast('Both a name and an email address are required.', 'warn');
    return;
  }

  try {
    await api.setIdentity(name, email);
    logToTerminal(`git config user.name "${name}" && git config user.email "${email}"`, 'cmd');
    showToast('Commit identity updated for this repository.', 'success');

    setHidden(ui.identityModal, true);
    await refreshIdentity();
    renderIdentityRow(ui, getState());
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not save the identity.'), 'error', 7000);
    }
  }
}
