// Staging Area behaviour: stage, unstage, ignore, discard, and commit.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { asInput, asTextArea } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { fragment, setHidden } from '../../dom/create';
import { getState, shouldWarnBeforeDelete, update } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { applyCommitType, COMMIT_TYPES, chipTitle, shouldShowFormatHint } from '../commit/conventional';
import type { CommitType } from '../commit/conventional';
import { buildDiffPickerRow, buildFileRow, diffEntriesFor, findDiffEntry, renderRows } from './file-list';
import { applyProfileIdentity, getAccountMismatch } from '../accounts/identity';
import { el } from '../../dom/create';

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};
let refreshStatus: () => Promise<void> = async () => {};
let onDiffCleared: () => void = () => {};

export function initStaging(
  elements: Elements,
  hooks: {
    refreshAll: () => Promise<void>;
    refreshStatus: () => Promise<void>;
    clearDiffView: () => void;
  }
): void {
  ui = elements;
  refreshAll = hooks.refreshAll;
  refreshStatus = hooks.refreshStatus;
  onDiffCleared = hooks.clearDiffView;
}

/** Redraws both staging lists and the File Diff picker. */
export function renderStaging(): void {
  const status = getState().status;
  const active = getState().activeDiffFile;

  const conflicts = status?.conflicts ?? [];
  const unstaged = status?.unstaged ?? [];
  const staged = status?.staged ?? [];

  const isActive = (path: string, isStaged: boolean): boolean =>
    active?.path === path && active.staged === isStaged;

  // Conflicts lead the unstaged list: they block everything else.
  const unstagedRows = [
    ...conflicts.map((file) => buildFileRow({ path: file.path, status: 'U', staged: false, active: isActive(file.path, false) })),
    ...unstaged.map((file) =>
      buildFileRow({ path: file.path, status: file.status, staged: false, active: isActive(file.path, false) })
    )
  ];

  renderRows(ui.unstagedFilesList, unstagedRows, 'No modified files');
  renderRows(
    ui.stagedFilesList,
    staged.map((file) =>
      buildFileRow({ path: file.path, status: file.status, staged: true, active: isActive(file.path, true) })
    ),
    'No staged files'
  );

  const entries = diffEntriesFor(status);
  ui.diffFilesList.replaceChildren(
    entries.length === 0
      ? el('li', { className: 'empty-state', text: 'No modified files' })
      : fragment(entries.map((entry) => buildDiffPickerRow(entry, isActive(entry.path, entry.staged))))
  );

  updateCommitAvailability();

  // A file that stopped being modified can no longer be shown in the diff.
  if (active && !findDiffEntry(status, active.path, active.staged)) {
    onDiffCleared();
  }
}

export function updateCommitAvailability(): void {
  const hasStaged = (getState().status?.staged.length ?? 0) > 0;
  const button = ui.btnCommit as HTMLButtonElement;

  button.disabled = !hasStaged;
  button.title = hasStaged ? 'Commit staged changes' : 'Stage changes before committing';
}

export function setFilenameWrapping(enabled: boolean): void {
  for (const list of [ui.unstagedFilesList, ui.stagedFilesList]) {
    list.closest('.file-list-card')?.classList.toggle('wrap-file-names', enabled);
  }
}

// ---------- operations ----------

export async function stageFiles(files: string[]): Promise<void> {
  logToTerminal(`git add ${files.join(' ')}`, 'cmd');

  try {
    await api.stage(files);
    await refreshStatus();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not stage the file.');
      logToTerminal(message, 'error');
      showToast(message, 'error');
    }
  }
}

export async function unstageFiles(files: string[]): Promise<void> {
  logToTerminal(`git reset HEAD ${files.join(' ')}`, 'cmd');

  try {
    await api.unstage(files);
    await refreshStatus();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not unstage the file.');
      logToTerminal(message, 'error');
      showToast(message, 'error');
    }
  }
}

export async function ignoreFile(filePath: string): Promise<void> {
  try {
    const { rule } = await api.ignoreFile(filePath);
    logToTerminal(`Added "${rule}" to .gitignore`, 'success');
    showToast(`Ignoring ${filePath}.`, 'success');
    await refreshStatus();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not ignore the file.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 6000);
    }
  }
}

/** Remembers that this repository should stop asking before discarding. */
async function disableDeleteWarning(): Promise<void> {
  const repo = getState().activeRepo;
  if (!repo) {
    return;
  }

  try {
    // Indexed by the key the server reports, not by the path shown in the
    // header: the two differ whenever a link or a casing difference is
    // involved, and only the key matches what was stored.
    const { repoKey, repoSettings } = await api.saveRepoSettings(repo, false);
    update({ repoSettings: { ...getState().repoSettings, [repoKey]: repoSettings } });
  } catch {
    // Failing to remember the preference is not worth interrupting for.
  }
}

export async function discardChanges(filePath: string, isUntracked: boolean): Promise<void> {
  if (shouldWarnBeforeDelete()) {
    const { confirmed, checked } = await confirmDialog(
      isUntracked
        ? `Permanently DELETE untracked file:\n${filePath}?`
        : `Discard all local changes in:\n${filePath}?`,
      {
        title: isUntracked ? 'Delete untracked file' : 'Discard changes',
        confirmLabel: isUntracked ? 'Delete' : 'Discard',
        danger: true,
        checkboxLabel: 'do not warn me in this repo'
      }
    );

    if (!confirmed) {
      return;
    }
    if (checked) {
      await disableDeleteWarning();
    }
  }

  logToTerminal(isUntracked ? `rm ${filePath}` : `git checkout -- ${filePath}`, 'cmd');

  try {
    await api.discard(filePath, isUntracked);
    logToTerminal('Discarded changes.', 'success');

    if (getState().activeDiffFile?.path === filePath) {
      onDiffCleared();
    }
    await refreshStatus();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not discard changes.');
      logToTerminal(message, 'error');
      showToast(message, 'error');
    }
  }
}

export async function discardAllChanges(): Promise<void> {
  if (!getState().activeRepo) {
    return;
  }

  const { confirmed, checked } = await confirmDialog(
    'Discard ALL unstaged changes in tracked files? This cannot be undone.',
    {
      title: 'Discard all changes',
      confirmLabel: 'Discard All',
      danger: true,
      checkboxLabel: 'Also delete untracked files and folders'
    }
  );
  if (!confirmed) {
    return;
  }

  logToTerminal(`git checkout -- .${checked ? ' && git clean -fd' : ''}`, 'cmd');

  try {
    await api.discardAll(checked);
    logToTerminal('All unstaged changes discarded.', 'success');
    showToast('All unstaged changes discarded.', 'success');
    onDiffCleared();
    await refreshStatus();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Discard all failed.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  }
}

// ---------- commit ----------

export function renderCommitTemplateChips(): void {
  const scope = asInput(ui.commitScopeInput).value;

  ui.commitTemplateChips.replaceChildren(
    fragment(
      COMMIT_TYPES.map((type) =>
        el('button', {
          className: 'template-chip',
          text: type,
          title: chipTitle(type, scope),
          attrs: { type: 'button' },
          data: { commitType: type }
        })
      )
    )
  );
}

export function insertCommitTemplate(type: CommitType): void {
  const input = asTextArea(ui.commitMsgInput);
  const scope = asInput(ui.commitScopeInput).value;

  input.value = applyCommitType(input.value, type, scope);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  updateCommitFormatHint();
}

export function updateCommitFormatHint(): void {
  setHidden(ui.commitFormatHint, !shouldShowFormatHint(asTextArea(ui.commitMsgInput).value));
}

/** Prefills the message when Amend is ticked, and clears it when unticked. */
export async function onAmendToggle(): Promise<void> {
  const amend = asInput(ui.commitAmendCheckbox).checked;
  const input = asTextArea(ui.commitMsgInput);

  ui.btnCommitLabel.textContent = amend ? 'Amend' : 'Commit';

  if (!amend) {
    input.value = '';
    updateCommitFormatHint();
    return;
  }

  try {
    const { message } = await api.getLastCommitMessage();
    input.value = message;
    input.focus();
    updateCommitFormatHint();
  } catch {
    // A repository with no commits has nothing to amend; leave it empty.
  }
}

/**
 * Warns when the repository's author does not match the active account, and
 * offers to fix it. Returns false when the user backs out.
 */
async function confirmIdentityForCommit(): Promise<boolean> {
  const mismatch = getAccountMismatch();
  if (mismatch?.type !== 'identity') {
    return true;
  }

  const { confirmed, checked } = await confirmDialog(
    `This repository commits as ${mismatch.actual.name || '(no name)'} <${mismatch.actual.email}>, but the active account "${mismatch.profile?.label ?? 'System SSH'}" uses ${mismatch.expected.name} <${mismatch.expected.email}>.`,
    {
      title: 'Identity mismatch',
      confirmLabel: 'Commit',
      checkboxLabel: `Switch identity to <${mismatch.expected.email}> before committing`,
      checkboxChecked: true
    }
  );

  if (!confirmed) {
    return false;
  }
  if (checked) {
    return applyProfileIdentity(mismatch.profile);
  }

  return true;
}

export async function commitChanges(): Promise<void> {
  const input = asTextArea(ui.commitMsgInput);
  const message = input.value.trim();
  const amend = asInput(ui.commitAmendCheckbox).checked;
  const status = getState().status;

  if (!status || status.staged.length === 0) {
    showToast('Stage at least one change before committing.', 'warn');
    updateCommitAvailability();
    return;
  }
  if (!message) {
    showToast('Enter a commit message first.', 'warn');
    input.focus();
    return;
  }

  if (amend) {
    // Nothing ahead of the upstream means the commit is probably published,
    // and amending it will need a force push.
    const likelyPushed = Boolean(status.tracking && status.ahead === 0);

    const { confirmed } = await confirmDialog(
      likelyPushed
        ? 'The last commit appears to already be pushed. Amending rewrites history and will require a force push. Continue?'
        : 'Replace the last commit with the staged changes and this message?',
      { title: 'Amend last commit', confirmLabel: 'Amend', danger: likelyPushed }
    );
    if (!confirmed) {
      return;
    }
  }

  if (!(await confirmIdentityForCommit())) {
    return;
  }

  logToTerminal(`git commit ${amend ? '--amend ' : ''}-m "${message}"`, 'cmd');
  (ui.btnCommit as HTMLButtonElement).disabled = true;

  try {
    const data = await api.commit(message, amend);
    logToTerminal(data.stdout || 'Changes committed successfully.', 'success');
    showToast(amend ? 'Last commit amended.' : 'Changes committed.', 'success');

    input.value = '';
    asInput(ui.commitAmendCheckbox).checked = false;
    ui.btnCommitLabel.textContent = 'Commit';
    updateCommitFormatHint();
    onDiffCleared();

    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const text = errorMessage(error, 'Commit failed.');
      logToTerminal(text, 'error');
      showToast(`Commit failed: ${text}`, 'error', 7000);
    }
  } finally {
    updateCommitAvailability();
  }
}

export async function undoLastCommit(): Promise<void> {
  const { confirmed } = await confirmDialog(
    'Undo the last commit? Its changes stay staged so you can recommit them.',
    { title: 'Undo last commit', confirmLabel: 'Undo' }
  );
  if (!confirmed) {
    return;
  }

  logToTerminal('git reset --soft HEAD~1', 'cmd');

  try {
    await api.undoCommit();
    showToast('Last commit undone; its changes are still staged.', 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not undo the last commit.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  }
}
