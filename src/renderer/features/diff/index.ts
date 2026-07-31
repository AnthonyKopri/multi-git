// The File Diff tab.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { getState, update } from '../../state/store';
import { renderPaneMessage } from '../../ui/busy';
import { DiffRenderer } from './diff-view';

let ui: Elements;
let renderer: DiffRenderer;

export function initDiff(elements: Elements): void {
  ui = elements;
  renderer = new DiffRenderer(elements.diffContent);
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

export function clearDiffView(): void {
  update({ activeDiffFile: null });

  ui.diffFileTitle.textContent = 'No file selected';
  ui.diffFileType.textContent = '';
  ui.diffFileType.className = 'badge';
  setHidden(ui.diffActions, true);

  renderPaneMessage(ui.diffContent, 'Select a modified file to view changes');
}

export async function loadDiff(
  filePath: string,
  isStaged: boolean,
  isUntracked: boolean,
  statusChar: string
): Promise<void> {
  update({ activeDiffFile: { path: filePath, staged: isStaged, statusChar } });

  ui.diffFileTitle.textContent = filePath;
  ui.diffFileType.textContent = isStaged ? 'Staged' : isUntracked ? 'Untracked' : 'Unstaged';
  ui.diffFileType.className = `badge ${isStaged ? 'status-a' : 'status-m'}`;

  renderDiffActions();
  renderPaneMessage(ui.diffContent, 'Loading changes...');

  try {
    const { diff } = await api.getDiff(filePath, isStaged, isUntracked);

    if (diff.length === 0) {
      renderPaneMessage(
        ui.diffContent,
        'No line changes found (file might be binary or renamed)'
      );
      return;
    }

    renderer.render(diff);
  } catch (error) {
    if (!isStale(error)) {
      renderPaneMessage(ui.diffContent, `Error loading diff: ${errorMessage(error)}`, true);
    }
  }
}

/** A read-only diff for one file within a commit. */
export async function loadCommitFileDiff(hash: string, filePath: string): Promise<void> {
  update({ activeDiffFile: null });

  ui.diffFileTitle.textContent = filePath;
  ui.diffFileType.textContent = hash.substring(0, 8);
  ui.diffFileType.className = 'badge';
  setHidden(ui.diffActions, true);

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
