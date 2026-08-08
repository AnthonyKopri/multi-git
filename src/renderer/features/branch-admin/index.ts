// Branch housekeeping: the "which of these forty branches can go" screen.
//
// Deletion here is bulk, so it is also the most dangerous thing in the app
// that is not a rebase. Two rules follow: pinned and current branches are
// never selectable, and a delete that git refuses is reported per branch
// rather than swallowed by whichever one failed first.
import * as api from '../../api/endpoints';
import type { BranchDetail } from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { asInput } from '../../dom/elements';
import { el, fragment, icon, setHidden } from '../../dom/create';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};

let branches: BranchDetail[] = [];
const selected = new Set<string>();

export function initBranchAdmin(elements: Elements, onChanged: () => Promise<void>): void {
  ui = elements;
  refreshAll = onChanged;
}

/** Pinned first, then current, then everything else by name. */
function sortBranches(list: readonly BranchDetail[]): BranchDetail[] {
  return [...list].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    if (left.isCurrent !== right.isCurrent) {
      return left.isCurrent ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

/** The current branch and pinned branches are never offered for deletion. */
function isDeletable(branch: BranchDetail): boolean {
  return !branch.isCurrent && !branch.pinned;
}

function visibleBranches(): BranchDetail[] {
  const mergedOnly = asInput(ui.branchFilterMerged).checked;
  const staleOnly = asInput(ui.branchFilterStale).checked;
  const goneOnly = asInput(ui.branchFilterGone).checked;

  return sortBranches(branches).filter(
    (branch) =>
      (!mergedOnly || branch.merged) &&
      (!staleOnly || branch.stale) &&
      (!goneOnly || branch.upstreamGone)
  );
}

function branchRow(branch: BranchDetail): HTMLLIElement {
  const tags = [
    branch.isCurrent ? 'current' : '',
    branch.pinned ? 'pinned' : '',
    branch.merged ? 'merged' : '',
    branch.stale ? 'stale' : '',
    branch.upstreamGone ? 'upstream gone' : '',
    branch.upstream === null ? 'no upstream' : `↑${branch.ahead} ↓${branch.behind} ${branch.upstream}`
  ].filter((tag) => tag !== '');

  const checkbox = el('input', { className: 'branch-select' });
  checkbox.setAttribute('type', 'checkbox');
  checkbox.setAttribute('aria-label', `Select ${branch.name}`);
  (checkbox as HTMLInputElement).checked = selected.has(branch.name);
  (checkbox as HTMLInputElement).disabled = !isDeletable(branch);
  checkbox.dataset['branch'] = branch.name;

  const action = (name: string, glyph: string, title: string): HTMLButtonElement =>
    el('button', {
      className: 'btn btn-icon btn-sm',
      title,
      data: { action: name, branch: branch.name },
      children: [icon(glyph, 14)]
    });

  return el('li', {
    className: 'recovery-item',
    data: { branch: branch.name },
    children: [
      checkbox,
      el('div', {
        className: 'recovery-item-main',
        children: [
          el('span', { className: 'recovery-label', text: branch.name }),
          el('span', { className: 'recovery-meta', text: tags.join(' · ') })
        ]
      }),
      el('span', {
        className: 'recovery-actions',
        children: [
          action('pin', branch.pinned ? 'keep_off' : 'keep', branch.pinned ? 'Unpin' : 'Pin to the top'),
          action('rename', 'edit', 'Rename this branch'),
          action('upstream', 'link', 'Set or clear the upstream'),
          action('compare', 'compare_arrows', 'Compare with the current branch')
        ]
      })
    ]
  });
}

function render(): void {
  const rows = visibleBranches();

  ui.branchAdminList.replaceChildren(
    rows.length === 0
      ? el('li', { className: 'empty-state', text: 'No branches match those filters' })
      : fragment(rows.map(branchRow))
  );

  const count = selected.size;
  (ui.btnDeleteSelectedBranches as HTMLButtonElement).disabled = count === 0;
  ui.btnDeleteSelectedBranches.textContent =
    count === 0 ? 'Delete selected' : `Delete ${count} selected`;
}

export async function refreshBranchAdmin(): Promise<void> {
  try {
    const result = await api.getBranchDetails();
    branches = result.branches;

    // A branch that has gone cannot stay selected.
    for (const name of [...selected]) {
      if (!branches.some((branch) => branch.name === name)) {
        selected.delete(name);
      }
    }

    ui.branchAdminSummary.textContent = `${branches.length} local ${branches.length === 1 ? 'branch' : 'branches'}. Pinned branches sort first; stale means nothing has landed for ${result.staleAfterDays} days.`;
    render();
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read branch details: ${errorMessage(error)}`, 'error');
    }
  }
}

export function openBranchAdmin(): void {
  setHidden(ui.branchAdminModal, false);
  void refreshBranchAdmin();
}

export function closeBranchAdmin(): void {
  setHidden(ui.branchAdminModal, true);
}

async function renameBranch(name: string): Promise<void> {
  const next = await promptDialog({
    title: `Rename ${name}`,
    label: 'New branch name',
    type: 'text'
  });
  if (next === null || next.trim() === '' || next.trim() === name) {
    return;
  }

  try {
    await api.renameBranch(name, next.trim());
    showToast(`Renamed ${name} to ${next.trim()}.`, 'success');
    await refreshAll();
    await refreshBranchAdmin();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not rename the branch.'), 'error', 7000);
    }
  }
}

async function setUpstream(name: string): Promise<void> {
  const upstream = await promptDialog({
    title: `Upstream for ${name}`,
    label: 'Remote branch (leave empty to stop tracking)',
    type: 'text'
  });
  if (upstream === null) {
    return;
  }

  try {
    const result = await api.setBranchUpstream(name, upstream.trim() === '' ? null : upstream.trim());
    showToast(
      result.upstream === null ? `${name} no longer tracks anything.` : `${name} tracks ${result.upstream}.`,
      'success'
    );
    await refreshBranchAdmin();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not set the upstream.'), 'error', 7000);
    }
  }
}

async function togglePin(name: string): Promise<void> {
  const branch = branches.find((candidate) => candidate.name === name);
  if (!branch) {
    return;
  }

  try {
    await api.pinBranch(name, !branch.pinned);
    // A newly pinned branch must not stay selected for deletion.
    selected.delete(name);
    await refreshBranchAdmin();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not change the pin.'), 'error');
    }
  }
}

async function pruneRemote(): Promise<void> {
  try {
    const preview = await api.pruneRemote('origin', true);
    if (preview.pruned.length === 0) {
      showToast('Nothing to prune — every remote-tracking branch still exists.', 'info');
      return;
    }

    const { confirmed } = await confirmDialog(
      `Remove ${preview.pruned.length} remote-tracking ${preview.pruned.length === 1 ? 'ref' : 'refs'} whose branches are gone from origin?\n\n${preview.pruned.join('\n')}\n\nLocal branches are not touched.`,
      { title: 'Prune origin', confirmLabel: 'Prune' }
    );
    if (!confirmed) {
      return;
    }

    const result = await api.pruneRemote('origin', false);
    showToast(`Pruned ${result.pruned.length} remote-tracking refs.`, 'success');
    await refreshAll();
    await refreshBranchAdmin();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not prune the remote.'), 'error', 7000);
    }
  }
}

async function deleteSelected(): Promise<void> {
  const names = [...selected];
  if (names.length === 0) {
    return;
  }

  const unmerged = names.filter(
    (name) => branches.find((branch) => branch.name === name)?.merged === false
  );

  const { confirmed } = await confirmDialog(
    `Delete ${names.length} ${names.length === 1 ? 'branch' : 'branches'}?\n\n${names.join('\n')}` +
      (unmerged.length === 0
        ? '\n\nAll of them are merged into the current branch.'
        : `\n\n${unmerged.length} of them ${unmerged.length === 1 ? 'is' : 'are'} not merged. A recovery point is recorded first.`),
    {
      title: 'Delete branches',
      confirmLabel: 'Delete',
      danger: true,
      checkboxLabel: unmerged.length > 0 ? 'Force-delete unmerged branches' : undefined
    }
  );
  if (!confirmed) {
    return;
  }

  try {
    const result = await api.deleteBranches(names, unmerged.length > 0);
    const failed = result.results.filter((entry) => !entry.deleted);

    selected.clear();
    showToast(
      failed.length === 0
        ? `Deleted ${result.deleted} ${result.deleted === 1 ? 'branch' : 'branches'}.`
        : `Deleted ${result.deleted}; ${failed.length} could not be deleted.`,
      failed.length === 0 ? 'success' : 'error',
      failed.length === 0 ? 4000 : 8000
    );

    for (const entry of failed) {
      logToTerminal(`${entry.branch}: ${entry.error ?? 'could not be deleted'}`, 'error');
    }

    await refreshAll();
    await refreshBranchAdmin();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not delete the branches.'), 'error', 7000);
    }
  }
}

export function wireBranchAdmin(hooks: { compareWith: (base: string, head: string) => void }): void {
  ui.btnCloseBranchAdmin.addEventListener('click', () => closeBranchAdmin());
  ui.btnPruneRemote.addEventListener('click', () => void pruneRemote());
  ui.btnDeleteSelectedBranches.addEventListener('click', () => void deleteSelected());

  for (const filter of [ui.branchFilterMerged, ui.branchFilterStale, ui.branchFilterGone]) {
    filter.addEventListener('change', () => render());
  }

  ui.branchAdminList.addEventListener('change', (event) => {
    const box = event.target;
    if (box instanceof HTMLInputElement && box.dataset['branch']) {
      if (box.checked) {
        selected.add(box.dataset['branch']);
      } else {
        selected.delete(box.dataset['branch']);
      }
      render();
    }
  });

  ui.branchAdminList.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    const name = button?.dataset['branch'];
    if (!button || !name) {
      return;
    }

    switch (button.dataset['action']) {
      case 'pin':
        void togglePin(name);
        return;
      case 'rename':
        void renameBranch(name);
        return;
      case 'upstream':
        void setUpstream(name);
        return;
      case 'compare': {
        const current = branches.find((branch) => branch.isCurrent)?.name ?? 'HEAD';
        closeBranchAdmin();
        hooks.compareWith(current, name);
      }
    }
  });
}
