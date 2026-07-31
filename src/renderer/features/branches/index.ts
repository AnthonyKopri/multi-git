// Branch list, switching, creation, deletion, and merge/rebase.
import * as api from '../../api/endpoints';
import { ApiError, errorMessage, isStale } from '../../api/client';
import { asInput, asSelect } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { el, fragment, icon } from '../../dom/create';
import { getState, update } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};

export function initBranches(elements: Elements, onChanged: () => Promise<void>): void {
  ui = elements;
  refreshAll = onChanged;
}

function currentBranchName(): string {
  return getState().status?.branch ?? '';
}

/** A row in the Branches panel. */
function buildBranchRow(branch: string, isRemote: boolean, isCurrent: boolean): HTMLLIElement {
  const children: HTMLElement[] = [
    el('div', {
      className: 'branch-name',
      children: [icon(isRemote ? 'cloud' : 'call_split'), el('span', { text: branch, title: branch })]
    })
  ];

  // The checked-out branch cannot be deleted.
  if (!isRemote && !isCurrent) {
    children.push(
      el('button', {
        className: 'btn btn-icon btn-sm branch-delete-btn',
        title: `Delete branch ${branch}`,
        data: { action: 'delete' },
        children: [icon('delete', 14)]
      })
    );
  }

  return el('li', {
    className: `branch-item${isCurrent ? ' active' : ''}`,
    data: { branch, remote: String(isRemote) },
    children
  });
}

export function renderBranches(): void {
  const { branches } = getState();
  const current = currentBranchName();

  ui.localBranchesList.replaceChildren(
    fragment(branches.local.map((branch) => buildBranchRow(branch, false, branch === current)))
  );
  ui.remoteBranchesList.replaceChildren(
    fragment(branches.remote.map((branch) => buildBranchRow(branch, true, false)))
  );

  renderIntegrationSelect();
  renderBranchDropdown();
}

function renderIntegrationSelect(): void {
  const { branches } = getState();
  const current = currentBranchName();
  const select = asSelect(ui.integrateBranchSelect);

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Select a target branch...';

  const option = (value: string, label: string): HTMLOptionElement => {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  };

  select.replaceChildren(
    placeholder,
    // Merging a branch into itself is not a thing.
    ...branches.local.filter((branch) => branch !== current).map((branch) => option(branch, branch)),
    ...branches.remote.map((branch) => option(branch, `remote: ${branch}`))
  );
}

export function renderBranchDropdown(): void {
  const { branches } = getState();
  const current = currentBranchName();
  const filter = asInput(ui.branchFilterInput).value.toLowerCase();

  const matches = (branch: string): boolean => branch.toLowerCase().includes(filter);
  const localMatches = branches.local.filter(matches);
  const remoteMatches = branches.remote.filter(matches);

  if (localMatches.length === 0 && remoteMatches.length === 0) {
    ui.branchDropdownList.replaceChildren(
      el('li', {
        className: 'dropdown-empty',
        text: filter ? 'No branches match your filter' : 'No branches'
      })
    );
    return;
  }

  const buildItem = (branch: string, isRemote: boolean): HTMLLIElement => {
    const isCurrent = !isRemote && branch === current;
    const glyph = icon(isCurrent ? 'check' : isRemote ? 'cloud' : 'call_split');
    if (isCurrent) {
      glyph.classList.add('item-check');
    }

    return el('li', {
      className: `dropdown-item${isCurrent ? ' active' : ''}`,
      data: { branch, remote: String(isRemote), current: String(isCurrent) },
      children: [
        glyph,
        el('span', {
          className: 'dropdown-item-text',
          children: [el('span', { className: 'dropdown-item-main', text: branch, title: branch })]
        })
      ]
    });
  };

  ui.branchDropdownList.replaceChildren(
    fragment([
      ...localMatches.map((branch) => buildItem(branch, false)),
      ...remoteMatches.map((branch) => buildItem(branch, true))
    ])
  );
}

export async function refreshBranchList(): Promise<void> {
  try {
    const data = await api.getBranches();
    update({ branches: { local: data.local, remote: data.remote } });
    renderBranches();
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Failed to load branches: ${errorMessage(error)}`, 'error');
    }
  }
}

export async function switchBranch(branch: string, isRemote: boolean): Promise<void> {
  logToTerminal(`git checkout ${branch}`, 'cmd');

  try {
    await api.checkout(branch, isRemote);
    showToast(`Switched to ${isRemote ? branch.split('/').slice(1).join('/') : branch}.`, 'success');
    await refreshAll();
  } catch (error) {
    if (isStale(error)) {
      return;
    }
    const message = errorMessage(error, 'Could not switch branch.');
    logToTerminal(message, 'error');
    // Uncommitted changes blocking a checkout is the usual cause, and git
    // says so far better than a generic message would.
    showToast(message, 'error', 8000);
  }
}

export async function createBranchFromInput(input: HTMLInputElement): Promise<void> {
  const branchName = input.value.trim();
  if (!branchName) {
    showToast('Enter a branch name first.', 'warn');
    return;
  }

  logToTerminal(`git checkout -b ${branchName}`, 'cmd');

  try {
    await api.createBranch(branchName);
    input.value = '';
    showToast(`Created and switched to ${branchName}.`, 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not create branch.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  }
}

export async function deleteBranch(branch: string): Promise<void> {
  const { confirmed } = await confirmDialog(`Delete the local branch "${branch}"?`, {
    title: 'Delete branch',
    confirmLabel: 'Delete',
    danger: true
  });
  if (!confirmed) {
    return;
  }

  try {
    await api.deleteBranch(branch, false);
    showToast(`Deleted ${branch}.`, 'success');
    await refreshAll();
    return;
  } catch (error) {
    if (isStale(error)) {
      return;
    }

    // git refuses to delete a branch whose work is not merged anywhere. That
    // is a safety check worth surfacing as its own decision, not a failure.
    const notFullyMerged =
      error instanceof ApiError && error.details['notFullyMerged'] === true;

    if (!notFullyMerged) {
      const message = errorMessage(error, 'Could not delete branch.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
      return;
    }

    const forced = await confirmDialog(
      `"${branch}" has commits that are not merged anywhere else. Deleting it discards them.`,
      { title: 'Force delete branch?', confirmLabel: 'Force Delete', danger: true }
    );
    if (!forced.confirmed) {
      return;
    }

    try {
      await api.deleteBranch(branch, true);
      showToast(`Force-deleted ${branch}.`, 'success');
      await refreshAll();
    } catch (forceError) {
      const message = errorMessage(forceError, 'Could not force delete branch.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  }
}

// ---------- merge and rebase ----------

export async function runIntegration(type: 'merge' | 'rebase'): Promise<void> {
  const branch = asSelect(ui.integrateBranchSelect).value;
  if (!branch) {
    showToast('Select a branch to merge or rebase first.', 'warn');
    return;
  }

  const button = type === 'merge' ? ui.btnMerge : ui.btnRebase;
  logToTerminal(`git ${type} ${branch}`, 'cmd');

  await withButtonBusy(button, async () => {
    try {
      const result = type === 'merge' ? await api.merge(branch) : await api.rebase(branch);

      if (result.success) {
        logToTerminal(result.stdout ?? '', 'success');
        showToast(`${type === 'merge' ? 'Merged' : 'Rebased onto'} ${branch}.`, 'success');
      } else {
        // Conflicts are a workflow state, not a failure: the conflict banner
        // and editor take over from here.
        logToTerminal(result.error ?? `${type} reported conflicts`, 'error');
        showToast(`Conflicts from ${type}. Resolve them to continue.`, 'warn', 8000);
      }

      await refreshAll();
    } catch (error) {
      if (!isStale(error)) {
        const message = errorMessage(error, `Could not ${type}.`);
        logToTerminal(message, 'error');
        showToast(message, 'error', 7000);
      }
    }
  });
}

export async function abortIntegration(): Promise<void> {
  const state = getState().status;
  const type = state?.isRebasing ? 'rebase' : 'merge';

  const { confirmed } = await confirmDialog(
    `Abort the in-progress ${type} and return the repository to how it was before?`,
    { title: `Abort ${type}`, confirmLabel: 'Abort', danger: true }
  );
  if (!confirmed) {
    return;
  }

  logToTerminal(`git ${type} --abort`, 'cmd');

  try {
    await api.abortIntegration(type);
    showToast(`${type === 'merge' ? 'Merge' : 'Rebase'} aborted.`, 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, `Could not abort the ${type}.`);
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  }
}

export async function continueIntegration(): Promise<void> {
  const state = getState().status;
  const type = state?.isRebasing ? 'rebase' : 'merge';

  if ((state?.conflicts.length ?? 0) > 0) {
    showToast('Resolve every conflicted file before continuing.', 'warn');
    return;
  }

  logToTerminal(type === 'rebase' ? 'git rebase --continue' : 'git commit --no-edit', 'cmd');

  try {
    await api.continueIntegration(type);
    showToast(`${type === 'merge' ? 'Merge' : 'Rebase'} completed.`, 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, `Could not continue the ${type}.`);
      logToTerminal(message, 'error');
      showToast(message, 'error', 8000);
    }
  }
}
