// Staging Area behaviour: stage, unstage, ignore, discard, and commit.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { asInput, asTextArea } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { fragment, icon, setHidden } from '../../dom/create';
import { getState, shouldWarnBeforeDelete, subscribeTo, update } from '../../state/store';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { updateScrollEdges } from '../../ui/wheel-scroll';
import {
  allCommitTypes,
  applyCommitType,
  chipTitle,
  commitTypeStyle,
  shouldShowFormatHint
} from '../commit/conventional';
import type { CommitType } from '../commit/conventional';
import {
  isBuiltInCommitType,
  MAX_CUSTOM_COMMIT_TYPES,
  normalizeCommitType
} from '../../../shared/commit-types';
import { buildDiffPickerRow, buildFileRow, diffEntriesFor, findDiffEntry, renderRows } from './file-list';
import { applyProfileIdentity, getAccountMismatch } from '../accounts/identity';
import * as signing from '../signing';
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

  // The pills include the user's own types, which arrive with the config and
  // change when one is added or removed, here or in another window.
  subscribeTo(['customCommitTypes'], renderCommitTemplateChips);
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
  const amend = asInput(ui.commitAmendCheckbox).checked;
  const button = ui.btnCommit as HTMLButtonElement;

  // Amend is the one commit that needs nothing staged: rewording the last
  // message is the commonest reason to tick the box, and the button used to
  // stay disabled for it until something unrelated was staged.
  button.disabled = !hasStaged && !amend;

  if (hasStaged) {
    button.title = amend
      ? 'Replace the last commit with the staged changes and this message'
      : 'Commit staged changes';
  } else {
    button.title = amend ? 'Change the message of the last commit' : 'Stage changes before committing';
  }
}

export function setFilenameWrapping(enabled: boolean): void {
  for (const list of [ui.unstagedFilesList, ui.stagedFilesList]) {
    list.closest('.file-list-card')?.classList.toggle('wrap-file-names', enabled);
  }
}

// ---------- operations ----------

export async function stageFiles(files: string[]): Promise<void> {

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
    // Not "permanently": /api/git/discard copies the file into Safety Net
    // before it touches it, whether the file is tracked or not.
    const recoverable =
      '\n\nA copy goes to Safety Net first and can be restored there for 24 hours.';

    const { confirmed, checked } = await confirmDialog(
      isUntracked
        ? `Delete untracked file:\n${filePath}?${recoverable}`
        : `Discard all local changes in:\n${filePath}?${recoverable}`,
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

  // What this does is worth stating, because it used to say the opposite.
  // /api/git/discard-all records a recovery point and copies every file it is
  // about to touch into Safety Net first, making this the most recoverable
  // destructive action in the application -- and it was the one telling people
  // their work was gone for good.
  const { confirmed, checked } = await confirmDialog(
    'Discard ALL unstaged changes in tracked files?' +
      '\n\nA copy of each affected file goes to Safety Net first, and a recovery point records where HEAD was.' +
      ' Safety Net holds the 30 most recent files for 24 hours.',
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

/**
 * One type's pill: its symbol, its name, and its own tint.
 *
 * A type the user added also carries a remove control. That makes the pill two
 * buttons, so it is drawn as a span holding both rather than as one button
 * with another nested inside it.
 */
function buildTypeChip(type: CommitType, scope: string): HTMLElement {
  const style = commitTypeStyle(type);
  const main = el('button', {
    className: 'template-chip-main',
    title: chipTitle(type, scope),
    attrs: { type: 'button' },
    data: { commitType: type },
    children: [icon(style.icon, 15), el('span', { text: type })]
  });

  if (isBuiltInCommitType(type)) {
    main.className = 'template-chip';
    main.dataset['tint'] = style.tint;
    return main;
  }

  return el('span', {
    className: 'template-chip template-chip-custom',
    data: { tint: style.tint },
    children: [
      main,
      el('button', {
        className: 'template-chip-remove',
        title: `Remove "${type}" from your commit types`,
        attrs: { type: 'button', 'aria-label': `Remove ${type}` },
        data: { removeType: type },
        children: [icon('close', 14)]
      })
    ]
  });
}

export function renderCommitTemplateChips(): void {
  const scope = asInput(ui.commitScopeInput).value;
  const types = allCommitTypes(getState().customCommitTypes);

  ui.commitTemplateChips.replaceChildren(
    fragment([
      ...types.map((type) => buildTypeChip(type, scope)),
      el('button', {
        className: 'template-chip-add',
        title: 'Add your own commit type',
        attrs: { type: 'button', 'aria-label': 'Add your own commit type' },
        data: { addType: '' },
        children: [icon('add', 17)]
      })
    ])
  );

  // Replacing the chips changes how far the row can scroll, and that is not a
  // scroll event, so the edge fades have to be told.
  updateScrollEdges(ui.commitTemplateChips);
}

/** Stores the user's own types and redraws from what the server kept. */
async function saveCustomTypes(next: string[]): Promise<boolean> {
  try {
    const { config } = await api.saveAppSettings({ customCommitTypes: next });
    update({ customCommitTypes: config.settings.customCommitTypes ?? [] });
    return true;
  } catch (error) {
    showToast(errorMessage(error, 'Could not save your commit types.'), 'error', 6000);
    return false;
  }
}

/** The "+" at the end of the row: asks for a word and adds it as a type. */
export async function addCommitType(): Promise<void> {
  const current = getState().customCommitTypes;

  if (current.length >= MAX_CUSTOM_COMMIT_TYPES) {
    showToast(`That is the limit of ${MAX_CUSTOM_COMMIT_TYPES} types of your own. Remove one first.`, 'warn', 6000);
    return;
  }

  const typed = await promptDialog({
    title: 'Add a commit type',
    label: 'One short word, such as art, build or release',
    type: 'text'
  });
  if (typed === null || typed.trim() === '') {
    return;
  }

  const type = normalizeCommitType(typed);
  if (type === null) {
    showToast('A commit type is one word of 2 to 16 lowercase letters.', 'warn', 6000);
    return;
  }
  if (isBuiltInCommitType(type) || current.includes(type)) {
    showToast(`"${type}" is already one of your commit types.`, 'info');
    return;
  }

  if (await saveCustomTypes([...current, type])) {
    // Scrolled into view, because a new pill lands at the far end of a row
    // that may already be wider than its box.
    ui.commitTemplateChips.scrollLeft = ui.commitTemplateChips.scrollWidth;
    updateScrollEdges(ui.commitTemplateChips);
  }
}

export async function removeCommitType(type: string): Promise<void> {
  await saveCustomTypes(getState().customCommitTypes.filter((entry) => entry !== type));
}

/** An arrow at either end of the type row: moves it most of its own width. */
export function scrollCommitTypes(direction: number): void {
  const row = ui.commitTemplateChips;
  row.scrollBy({ left: direction * Math.max(120, row.clientWidth * 0.7), behavior: 'smooth' });
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

/** The last commit's message as Amend put it in the box, if it did. */
let amendPrefill: string | null = null;

/**
 * Prefills the message when Amend is ticked, and takes it back when unticked.
 *
 * Only ever its own text. Ticking the box with a message already typed keeps
 * that message, and unticking removes the prefill only if it is still exactly
 * what was put there: the box used to be emptied on every untick, which threw
 * away whatever had been written in it.
 */
export async function onAmendToggle(): Promise<void> {
  const amend = asInput(ui.commitAmendCheckbox).checked;
  const input = asTextArea(ui.commitMsgInput);

  ui.btnCommitLabel.textContent = amend ? 'Amend' : 'Commit';
  updateCommitAvailability();

  if (!amend) {
    if (amendPrefill !== null && input.value === amendPrefill) {
      input.value = '';
    }
    amendPrefill = null;
    updateCommitFormatHint();
    return;
  }

  if (input.value.trim() !== '') {
    amendPrefill = null;
    return;
  }

  try {
    const { message } = await api.getLastCommitMessage();
    // The box may have been unticked, or typed into, while this was in flight.
    if (asInput(ui.commitAmendCheckbox).checked && input.value.trim() === '') {
      input.value = message;
      amendPrefill = message;
      input.focus();
      updateCommitFormatHint();
    }
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

  if (!status || (status.staged.length === 0 && !amend)) {
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
        : status.staged.length === 0
          ? 'Change the message of the last commit? Nothing is staged, so its contents stay as they are.'
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

  (ui.btnCommit as HTMLButtonElement).disabled = true;

  try {
    // Only sent when it differs from what the repository would do anyway, so
    // an explicit flag always means the user asked for something different.
    const data = await api.commit(message, amend, signing.commitSignPreference());
    logToTerminal(data.stdout || 'Changes committed successfully.', 'success');
    showToast(amend ? 'Last commit amended.' : 'Changes committed.', 'success');

    input.value = '';
    asInput(ui.commitAmendCheckbox).checked = false;
    amendPrefill = null;
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
