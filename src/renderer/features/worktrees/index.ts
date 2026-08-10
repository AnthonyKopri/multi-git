// Worktrees: the sidebar summary and the manager.
//
// The sidebar answers "what else is checked out, and is any of it dirty" at a
// glance. The manager is where anything is created, moved or removed, and it
// is deliberately the only place a removal can happen — a destructive action
// two clicks from a list row is a destructive action that happens by accident.
//
// Structure and status arrive separately. The list is one git call whatever the
// family size; the dirty counts are one or two per worktree, so they are asked
// for afterwards and the rows fill in. A family of twenty should not make the
// panel feel broken while it opens.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { asInput, asSelect } from '../../dom/elements';
import { el, fragment, icon, setHidden } from '../../dom/create';
import { getState } from '../../state/store';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import { openRepoInNewWindow } from '../windows';
import { launchAgentFor } from '../agents';
import { openRepository } from '../repo';
import type { WorktreeInfo } from '../../../shared/worktree-types';

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};

let worktrees: WorktreeInfo[] = [];
let suggestedParent = '';

export function initWorktrees(elements: Elements, onChanged: () => Promise<void>): void {
  ui = elements;
  refreshAll = onChanged;
}

/** `refs/heads/feature/login` reads better as `feature/login`. */
function shortBranch(ref: string | undefined): string {
  return ref === undefined ? '' : ref.replace(/^refs\/heads\//, '');
}

function folderName(worktreePath: string): string {
  const parts = worktreePath.split(/[\\/]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? worktreePath;
}

/** The one-line description under a worktree's name. */
function describe(worktree: WorktreeInfo): string {
  const parts: string[] = [];

  if (worktree.bare) {
    parts.push('bare');
  } else if (worktree.detached) {
    parts.push(`detached at ${worktree.head.slice(0, 8)}`);
  } else {
    parts.push(shortBranch(worktree.branch) || 'no branch');
  }

  if (!worktree.present) {
    parts.push('folder missing');
  }
  if (worktree.locked) {
    parts.push(worktree.lockReason ? `locked — ${worktree.lockReason}` : 'locked');
  }
  if (worktree.prunable) {
    parts.push('prunable');
  }

  const status = worktree.status;
  if (status) {
    const dirty: string[] = [];
    if (status.staged > 0) {
      dirty.push(`${status.staged} staged`);
    }
    if (status.unstaged > 0) {
      dirty.push(`${status.unstaged} modified`);
    }
    if (status.untracked > 0) {
      dirty.push(`${status.untracked} untracked`);
    }
    if (status.conflicts > 0) {
      dirty.push(`${status.conflicts} conflicted`);
    }
    parts.push(dirty.length === 0 ? 'clean' : dirty.join(', '));

    if (status.ahead > 0 || status.behind > 0) {
      parts.push(`${status.ahead}↑ ${status.behind}↓`);
    }
  }

  return parts.join(' · ');
}

function actionButton(
  action: string,
  glyph: string,
  title: string,
  options: { disabled?: boolean; danger?: boolean } = {}
): HTMLButtonElement {
  const button = el('button', {
    className: `btn btn-icon btn-sm${options.danger ? ' btn-text-danger' : ''}`,
    title,
    data: { action },
    children: [icon(glyph, 14)]
  }) as HTMLButtonElement;

  if (options.disabled) {
    button.disabled = true;
  }

  return button;
}

function buildRow(worktree: WorktreeInfo): HTMLLIElement {
  const isActive = getState().activeRepo === worktree.path;

  return el('li', {
    className: `worktree-item${isActive ? ' worktree-active' : ''}`,
    data: { worktreePath: worktree.path },
    children: [
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', {
            className: 'worktree-name',
            text: folderName(worktree.path),
            title: worktree.path
          }),
          el('span', { className: 'worktree-meta', text: describe(worktree) })
        ]
      }),
      el('span', {
        className: 'worktree-actions',
        children: [
          actionButton('open', 'folder_open', 'Open in this window', {
            disabled: !worktree.present || isActive
          }),
          actionButton('new-window', 'open_in_new', 'Open in a new window', {
            disabled: !worktree.present
          }),
          actionButton('terminal', 'terminal', 'Open a terminal here', {
            disabled: !worktree.present
          }),
          actionButton('agent', 'smart_toy', 'Launch a coding agent here', {
            disabled: !worktree.present
          }),
          actionButton('copy-path', 'content_copy', 'Copy this path')
        ]
      })
    ]
  }) as HTMLLIElement;
}

/** The compact sidebar list. */
function renderSidebar(): void {
  const rows = worktrees.map(buildRow);

  ui.worktreeList.replaceChildren(
    rows.length === 0
      ? el('li', { className: 'empty-state', text: 'No worktrees' })
      : fragment(rows)
  );

  const linked = worktrees.filter((worktree) => !worktree.isMain).length;
  ui.worktreeCount.textContent = linked === 0 ? '' : String(linked);
  setHidden(ui.worktreeCount, linked === 0);
}

/** The full list inside the manager, with the destructive actions. */
function renderManager(): void {
  const rows = worktrees.map((worktree) => {
    const row = buildRow(worktree);

    row.querySelector('.worktree-actions')?.append(
      actionButton(
        worktree.locked ? 'unlock' : 'lock',
        worktree.locked ? 'lock_open' : 'lock',
        worktree.locked ? 'Unlock this worktree' : 'Lock this worktree'
      ),
      actionButton('move', 'drive_file_move', 'Move this worktree', {
        disabled: worktree.isMain
      }),
      actionButton('remove', 'delete', 'Remove this worktree', {
        disabled: worktree.isMain,
        danger: true
      })
    );

    return row;
  });

  ui.worktreeManagerList.replaceChildren(
    rows.length === 0
      ? el('li', { className: 'empty-state', text: 'No worktrees' })
      : fragment(rows)
  );
}

export async function refreshWorktrees(): Promise<void> {
  if (!getState().activeRepo) {
    worktrees = [];
    renderSidebar();
    return;
  }

  try {
    const result = await api.getWorktrees();
    worktrees = result.worktrees;
    suggestedParent = result.suggestedParent;

    renderSidebar();
    renderManager();
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read worktrees: ${errorMessage(error)}`, 'error');
    }
    return;
  }

  // The counts are a second pass on purpose: they cost git calls proportional
  // to the family size, and the list is useful before they arrive.
  try {
    const withStatus = await api.getWorktreeStatus();
    worktrees = withStatus.worktrees;
    renderSidebar();
    renderManager();
  } catch (error) {
    if (!isStale(error)) {
      // The structure is already on screen; missing counts are not an error
      // worth interrupting anyone about.
      logToTerminal(`Could not read worktree status: ${errorMessage(error)}`, 'info');
    }
  }
}

// ---------- the manager ----------

export function openWorktreeManager(): void {
  setHidden(ui.worktreeModal, false);
  resetCreateForm();
  void refreshWorktrees();
  void refreshPrunePreview();
}

export function closeWorktreeManager(): void {
  setHidden(ui.worktreeModal, true);
}

function resetCreateForm(): void {
  asSelect(ui.worktreeBranchMode).value = 'new';
  asInput(ui.worktreeBranchInput).value = '';
  asInput(ui.worktreeStartPoint).value = '';
  asInput(ui.worktreeLockNew).checked = false;
  asInput(ui.worktreePathInput).value = '';
  onCreateFormChanged();
}

/**
 * Keeps the previewed path and the enabled fields in step with the mode.
 *
 * The absolute path is always shown before the button can be pressed. A
 * worktree is a folder that appears on disk, and "somewhere sensible" is not
 * something anyone should have to trust.
 */
export function onCreateFormChanged(): void {
  const mode = asSelect(ui.worktreeBranchMode).value;
  const branch = asInput(ui.worktreeBranchInput).value.trim();

  setHidden(ui.worktreeBranchRow, mode === 'detached');
  setHidden(ui.worktreeStartPointRow, mode === 'existing');

  const target = asInput(ui.worktreePathInput);
  if (target.dataset['touched'] !== 'true') {
    const slug = slugFor(branch || (mode === 'detached' ? 'detached' : ''));
    target.value = slug === '' ? '' : joinPath(suggestedParent, slug);
  }

  ui.worktreePathPreview.textContent = target.value || suggestedParent;
}

/** Mirrors the server's folder-name rule, so the preview is not a lie. */
function slugFor(branch: string): string {
  const cleaned = branch
    .replace(/^refs\/heads\//, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[<>:"|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');

  return cleaned;
}

function joinPath(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/';
  return parent.endsWith(separator) ? `${parent}${child}` : `${parent}${separator}${child}`;
}

export function markPathTouched(): void {
  asInput(ui.worktreePathInput).dataset['touched'] = 'true';
  ui.worktreePathPreview.textContent = asInput(ui.worktreePathInput).value;
}

export async function browseWorktreeParent(): Promise<void> {
  const { pickFolderPath } = await import('../repo');
  const chosen = await pickFolderPath();

  if (chosen) {
    const branch = asInput(ui.worktreeBranchInput).value.trim();
    const slug = slugFor(branch);
    asInput(ui.worktreePathInput).value = slug === '' ? chosen : joinPath(chosen, slug);
    markPathTouched();
  }
}

export async function submitCreateWorktree(): Promise<void> {
  const mode = asSelect(ui.worktreeBranchMode).value as 'new' | 'existing' | 'detached';
  const branch = asInput(ui.worktreeBranchInput).value.trim();
  const startPoint = asInput(ui.worktreeStartPoint).value.trim();
  const targetPath = asInput(ui.worktreePathInput).value.trim();

  if (targetPath === '') {
    showToast('Choose where the worktree folder should go.', 'warn');
    return;
  }
  if (mode !== 'detached' && branch === '') {
    showToast('Enter a branch name.', 'warn');
    return;
  }

  await withButtonBusy(ui.btnCreateWorktree, async () => {
    try {
      const result = await api.createWorktree({
        targetPath,
        branchMode: mode,
        ...(mode === 'detached' ? {} : { branch }),
        ...(startPoint && mode !== 'existing' ? { startPoint } : {}),
        ...(asInput(ui.worktreeLockNew).checked ? { lock: true } : {})
      });

      worktrees = result.worktrees;
      renderSidebar();
      renderManager();
      resetCreateForm();

      logToTerminal(`git worktree add ${result.path}`, 'cmd');
      showToast(`Worktree created at ${result.path}.`, 'success');
    } catch (error) {
      if (!isStale(error)) {
        const message = errorMessage(error, 'Could not create the worktree.');
        logToTerminal(message, 'error');
        showToast(message, 'error', 8000);
      }
    }
  });
}

/**
 * Re-links worktrees whose folders moved outside Multi-Git.
 *
 * `git worktree repair` is the answer to a folder that was dragged somewhere
 * else in Explorer, which otherwise leaves both halves of the link pointing at
 * a path that is gone.
 */
export async function repairWorktreeLinks(): Promise<void> {
  try {
    const result = await api.repairWorktrees();
    worktrees = result.worktrees;

    renderSidebar();
    renderManager();
    await refreshPrunePreview();

    logToTerminal('git worktree repair', 'cmd');
    showToast(
      result.stdout.trim() || result.stderr.trim() || 'Worktree links checked.',
      'success',
      6000
    );
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not repair the worktree links.'), 'error', 6000);
    }
  }
}

async function refreshPrunePreview(): Promise<void> {
  try {
    const { entries } = await api.previewWorktreePrune();

    ui.worktreePruneList.replaceChildren(
      entries.length === 0
        ? el('li', { className: 'empty-state', text: 'Nothing to prune' })
        : fragment(
            entries.map((entry) =>
              el('li', {
                className: 'worktree-prune-item',
                children: [
                  el('span', { className: 'worktree-name', text: entry.name }),
                  el('span', { className: 'worktree-meta', text: entry.reason })
                ]
              })
            )
          )
    );
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read the prune preview: ${errorMessage(error)}`, 'info');
    }
  }
}

// ---------- row actions ----------

function find(worktreePath: string): WorktreeInfo | null {
  return worktrees.find((worktree) => worktree.path === worktreePath) ?? null;
}

async function toggleLock(worktree: WorktreeInfo): Promise<void> {
  try {
    if (worktree.locked) {
      const result = await api.unlockWorktree(worktree.path);
      worktrees = result.worktrees;
      showToast('Worktree unlocked.', 'success');
    } else {
      const reason = await promptDialog({
        title: `Lock ${folderName(worktree.path)}`,
        label: 'Why? (optional — shown whenever this worktree is in the way)',
        type: 'text'
      });
      if (reason === null) {
        return;
      }

      const result = await api.lockWorktree(worktree.path, reason.trim());
      worktrees = result.worktrees;
      showToast('Worktree locked. Git will refuse to prune or remove it.', 'success');
    }

    renderSidebar();
    renderManager();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not change the lock.'), 'error', 6000);
    }
  }
}

async function moveWorktree(worktree: WorktreeInfo): Promise<void> {
  const destination = await promptDialog({
    title: `Move ${folderName(worktree.path)}`,
    label: 'New folder path',
    type: 'text'
  });

  if (destination === null || destination.trim() === '') {
    return;
  }

  try {
    const result = await api.moveWorktree(worktree.path, destination.trim());
    worktrees = result.worktrees;
    renderSidebar();
    renderManager();

    logToTerminal(`git worktree move ${worktree.path} ${destination.trim()}`, 'cmd');
    showToast('Worktree moved.', 'success');

    // The window showing it is now pointed at a folder that no longer exists.
    if (getState().activeRepo === worktree.path) {
      await openRepository(result.path);
    }
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not move the worktree.'), 'error', 7000);
    }
  }
}

/**
 * Removal, with the guard rails.
 *
 * The plain case asks once. The case that would destroy work asks for the
 * folder's name to be typed — not because typing is magic, but because it makes
 * the answer to "which folder is this about" impossible to get wrong while
 * clicking quickly.
 */
async function removeWorktree(worktree: WorktreeInfo): Promise<void> {
  const name = folderName(worktree.path);
  const status = worktree.status;
  const dirty =
    status !== undefined &&
    (status.staged > 0 || status.unstaged > 0 || status.untracked > 0 || status.conflicts > 0);

  if (!dirty) {
    const { confirmed } = await confirmDialog(
      `Remove the worktree at ${worktree.path}?\n\nThe branch and its commits stay in the repository; only this working folder goes.`,
      { title: 'Remove worktree', confirmLabel: 'Remove', danger: true }
    );
    if (!confirmed) {
      return;
    }

    await performRemoval({ path: worktree.path });
    return;
  }

  const typed = await promptDialog({
    title: `Remove ${name}`,
    label: `This worktree has uncommitted changes. Safety Net snapshots tracked staged and unstaged work first, but untracked files cannot be recovered after the folder is removed. Type "${name}" to confirm.`,
    type: 'text'
  });

  if (typed === null) {
    return;
  }
  if (typed.trim() !== name) {
    showToast('That name did not match, so nothing was removed.', 'warn', 6000);
    return;
  }

  await performRemoval({ path: worktree.path, force: true, confirmName: typed.trim() });
}

async function performRemoval(input: {
  path: string;
  force?: boolean;
  confirmName?: string;
}): Promise<void> {
  try {
    const result = await api.removeWorktree(input);
    worktrees = result.worktrees;
    renderSidebar();
    renderManager();

    logToTerminal(`git worktree remove ${input.force ? '--force ' : ''}${input.path}`, 'cmd');
    showToast(
      result.snapshotRef
        ? `Worktree removed. Its uncommitted work is in the Safety Net as ${result.snapshotRef.slice(0, 8)}.`
        : 'Worktree removed.',
      'success',
      result.snapshotRef ? 9000 : 4000
    );

    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not remove the worktree.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 8000);
    }
  }
}

async function copyPath(worktreePath: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(worktreePath);
    showToast('Path copied.', 'success');
  } catch {
    logToTerminal(worktreePath, 'cmd');
    showToast('Clipboard unavailable — the path is in the Terminal Log.', 'info', 6000);
  }
}

async function openTerminal(worktreePath: string): Promise<void> {
  if (!window.desktopApi?.openTerminalHere) {
    showToast('Opening a terminal needs the desktop app.', 'warn', 6000);
    return;
  }

  try {
    await window.desktopApi.openTerminalHere(worktreePath);
  } catch (error) {
    showToast(errorMessage(error, 'Could not open a terminal.'), 'error', 6000);
  }
}

/** One handler for both lists; the row carries which worktree it is. */
export function handleWorktreeAction(target: HTMLElement): void {
  const row = target.closest<HTMLElement>('[data-worktree-path]');
  const worktreePath = row?.dataset['worktreePath'];
  if (!worktreePath) {
    return;
  }

  const worktree = find(worktreePath);
  if (!worktree) {
    return;
  }

  switch (target.closest<HTMLElement>('[data-action]')?.dataset['action']) {
    case 'open':
      closeWorktreeManager();
      void openRepository(worktreePath);
      return;
    case 'new-window':
      void openRepoInNewWindow(worktreePath);
      return;
    case 'terminal':
      void openTerminal(worktreePath);
      return;
    case 'agent':
      void launchAgentFor(worktreePath);
      return;
    case 'copy-path':
      void copyPath(worktreePath);
      return;
    case 'lock':
    case 'unlock':
      void toggleLock(worktree);
      return;
    case 'move':
      void moveWorktree(worktree);
      return;
    case 'remove':
      void removeWorktree(worktree);
  }
}
