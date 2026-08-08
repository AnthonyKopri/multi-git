// The File Diff tab.
//
// Two renderers live behind this one module. A diff of the working tree or the
// index is structured — every changed line can be picked, and every hunk has
// its own actions — while a diff read out of a commit is history and stays
// read-only, on the older flat renderer.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { el, setHidden } from '../../dom/create';
import { getState, shouldWarnBeforeDelete, update } from '../../state/store';
import { renderPaneMessage } from '../../ui/busy';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { DiffRenderer } from './diff-view';
import { StructuredDiffRenderer } from './structured-view';
import type { HunkActions } from './structured-view';
import type { DiffSource, PatchAction } from '../../../shared/diff-types';

let ui: Elements;
let renderer: DiffRenderer;
let structured: StructuredDiffRenderer;
let refreshAfterApply: () => Promise<void> = async () => {};

/** The diff currently on screen, or null when it is a read-only commit diff. */
let current: { path: string; source: DiffSource; untracked: boolean } | null = null;

export function initDiff(elements: Elements, hooks: { refreshAll: () => Promise<void> }): void {
  ui = elements;
  renderer = new DiffRenderer(elements.diffContent);
  structured = new StructuredDiffRenderer(elements.diffContent, renderSelectionBar);
  refreshAfterApply = hooks.refreshAll;
}

function actionsFor(source: DiffSource, untracked: boolean): HunkActions {
  return {
    stage: source === 'working-tree',
    unstage: source === 'index',
    // Partial discard rewrites the working tree from the index, which an
    // untracked file has no entry in.
    discard: source === 'working-tree' && !untracked
  };
}

/**
 * Stage/unstage and discard apply to a working-tree file, so they are hidden
 * for a conflicted file and for read-only diffs opened from history.
 */
export function renderDiffActions(): void {
  const active = getState().activeDiffFile;

  if (!active || active.statusChar === 'U') {
    setHidden(ui.diffActions, true);
    return;
  }

  setHidden(ui.diffActions, false);
  ui.btnDiffToggleStageLabel.textContent = active.staged ? 'Unstage' : 'Stage';

  const glyph = ui.btnDiffToggleStage.querySelector('.material-symbols-outlined');
  if (glyph) {
    glyph.textContent = active.staged ? 'remove' : 'add';
  }

  // Discarding a staged change is not what the button would do; hide it.
  setHidden(ui.btnDiffDiscard, active.staged);
}

/** Shows what is selected and which of the three actions can act on it. */
function renderSelectionBar(): void {
  const count = current === null ? 0 : structured.selectedCount;

  setHidden(ui.diffSelectionBar, count === 0);
  if (count === 0 || current === null) {
    return;
  }

  const actions = actionsFor(current.source, current.untracked);
  ui.diffSelectionCount.textContent = `${count} ${count === 1 ? 'line' : 'lines'} selected`;

  setHidden(ui.btnDiffStageSelection, !actions.stage);
  setHidden(ui.btnDiffUnstageSelection, !actions.unstage);
  setHidden(ui.btnDiffDiscardSelection, !actions.discard);
}

export function clearDiffView(): void {
  update({ activeDiffFile: null });
  current = null;

  ui.diffFileTitle.textContent = 'No file selected';
  ui.diffFileType.textContent = '';
  ui.diffFileType.className = 'badge';
  setHidden(ui.diffActions, true);
  setHidden(ui.diffSelectionBar, true);

  renderPaneMessage(ui.diffContent, 'Select a modified file to view changes');
}

/** Explains a diff that was skipped for size, and offers to load it anyway. */
function renderTooLarge(sizeBytes: number, limitBytes: number, load: () => void): void {
  const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const button = el('button', {
    className: 'btn btn-secondary btn-sm',
    text: 'Load anyway'
  });
  button.addEventListener('click', load);

  ui.diffContent.replaceChildren(
    el('div', {
      className: 'diff-empty-state',
      children: [
        el('span', { className: 'material-symbols-outlined', text: 'data_alert' }),
        el('p', {
          text: `This diff is ${megabytes(sizeBytes)}, over the ${megabytes(
            limitBytes
          )} limit for line-by-line review.`
        }),
        button
      ]
    })
  );
}

export async function loadDiff(
  filePath: string,
  isStaged: boolean,
  isUntracked: boolean,
  statusChar: string,
  options: { force?: boolean } = {}
): Promise<void> {
  update({ activeDiffFile: { path: filePath, staged: isStaged, statusChar } });

  const source: DiffSource = isStaged ? 'index' : 'working-tree';
  current = null;

  ui.diffFileTitle.textContent = filePath;
  ui.diffFileType.textContent = isStaged ? 'Staged' : isUntracked ? 'Untracked' : 'Unstaged';
  ui.diffFileType.className = `badge ${isStaged ? 'status-a' : 'status-m'}`;

  renderDiffActions();
  setHidden(ui.diffSelectionBar, true);
  renderPaneMessage(ui.diffContent, 'Loading changes...');

  try {
    const result = await api.getStructuredDiff(filePath, source, options.force === true);

    if (result.tooLarge) {
      renderTooLarge(result.sizeBytes, result.limitBytes, () => {
        void loadDiff(filePath, isStaged, isUntracked, statusChar, { force: true });
      });
      return;
    }

    const file = result.file;
    if (!file || file.hunks.length === 0) {
      renderPaneMessage(
        ui.diffContent,
        file?.binary === true
          ? 'This file is binary, so it has no line-by-line diff.'
          : 'No line changes found (the file may be a rename or a mode change)'
      );
      return;
    }

    current = { path: filePath, source, untracked: result.untracked };
    structured.render(file, actionsFor(source, result.untracked));
  } catch (error) {
    if (!isStale(error)) {
      renderPaneMessage(ui.diffContent, `Error loading diff: ${errorMessage(error)}`, true);
    }
  }
}

/** Reloads whatever the diff pane is showing, keeping the pane in step. */
async function reloadCurrentDiff(): Promise<void> {
  const active = getState().activeDiffFile;
  if (active) {
    await loadDiff(active.path, active.staged, active.statusChar === '?', active.statusChar);
  }
}

const ACTION_LABEL: Record<PatchAction, string> = {
  stage: 'Staged',
  unstage: 'Unstaged',
  discard: 'Discarded'
};

async function applySelection(
  action: PatchAction,
  selection: { hunkIds?: string[]; lineIds?: string[] }
): Promise<void> {
  if (current === null) {
    return;
  }

  const filePath = current.path;

  if (action === 'discard' && shouldWarnBeforeDelete()) {
    const lineCount = selection.lineIds?.length;
    const what =
      lineCount === undefined
        ? 'this hunk'
        : `${lineCount} selected ${lineCount === 1 ? 'line' : 'lines'}`;

    const { confirmed } = await confirmDialog(
      `Discard ${what} in:\n${filePath}?\n\nA snapshot of the file goes to Safety Net first.`,
      { title: 'Discard selected changes', confirmLabel: 'Discard', danger: true }
    );

    if (!confirmed) {
      return;
    }
  }

  try {
    const result = await api.applyDiffSelection({ action, filePath, ...selection });
    const lines = result.linesApplied;

    showToast(
      `${ACTION_LABEL[action]} ${lines} ${lines === 1 ? 'line' : 'lines'} in ${filePath}`,
      'success'
    );
    logToTerminal(`${ACTION_LABEL[action]} ${lines} line(s) of ${filePath}`, 'success');

    await refreshAfterApply();
    await reloadCurrentDiff();
  } catch (error) {
    if (isStale(error)) {
      return;
    }

    showToast(errorMessage(error, 'Could not apply the selection'), 'error');
    logToTerminal(`Failed to ${action} part of ${filePath}: ${errorMessage(error)}`, 'error');

    // A rejected selection is usually a stale one, and the fresh diff is what
    // the user needs in order to choose again.
    await reloadCurrentDiff();
  }
}

/** Stage, unstage, or discard one hunk, whatever else is selected. */
export function applyHunk(action: PatchAction, hunkId: string): void {
  void applySelection(action, { hunkIds: [hunkId] });
}

/** Stage, unstage, or discard exactly the lines the user picked. */
export function applySelectedLines(action: PatchAction): void {
  const lineIds = structured.selectedLineIds;
  if (lineIds.length === 0) {
    return;
  }

  void applySelection(action, { lineIds });
}

export function toggleLineSelection(lineId: string): void {
  structured.toggleLine(lineId);
}

export function toggleHunkSelection(hunkId: string): void {
  structured.toggleHunk(hunkId);
}

export function clearLineSelection(): void {
  structured.clearSelection();
}

/** A read-only diff for one file within a commit. */
export async function loadCommitFileDiff(hash: string, filePath: string): Promise<void> {
  update({ activeDiffFile: null });
  current = null;

  ui.diffFileTitle.textContent = filePath;
  ui.diffFileType.textContent = hash.substring(0, 8);
  ui.diffFileType.className = 'badge';
  setHidden(ui.diffActions, true);
  setHidden(ui.diffSelectionBar, true);

  renderPaneMessage(ui.diffContent, 'Loading changes...');

  try {
    const { diff } = await api.getCommitDiff(hash, filePath);

    if (diff.length === 0) {
      renderPaneMessage(ui.diffContent, 'No line changes in this file for that commit');
      return;
    }

    renderer.render(diff);
  } catch (error) {
    if (!isStale(error)) {
      renderPaneMessage(ui.diffContent, `Error loading diff: ${errorMessage(error)}`, true);
    }
  }
}
