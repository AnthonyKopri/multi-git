// The conflict editor.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { asTextArea } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { resolveConflictText, type ConflictChoice } from './resolve-text';
import * as tools from '../tools';

let ui: Elements;
let refreshStatus: () => Promise<void> = async () => {};

/** The file the editor is currently showing, for the external merge tool. */
let openFilePath = '';

export function initConflicts(elements: Elements, onResolved: () => Promise<void>): void {
  ui = elements;
  refreshStatus = onResolved;

  ui.btnExternalMerge.addEventListener('click', () => void openInMergeTool());
}

/**
 * Hands the conflicted file to the configured merge tool.
 *
 * What it deliberately does *not* do is mark the file resolved afterwards. The
 * launcher resolves as soon as the process exists and learns nothing else, and
 * even a tool that exits cleanly may have been closed without saving. So the
 * app re-reads git state and leaves the file in whatever state git says it is
 * in — which is usually still conflicted, and that is honest.
 */
async function openInMergeTool(): Promise<void> {
  if (openFilePath === '') {
    return;
  }

  const started = await tools.launchToolForKind('merge', {
    // The desktop launcher fills these protected sibling files from Git's
    // unmerged index stages, then removes them when the tool exits.
    local: `${openFilePath}.LOCAL`,
    remote: `${openFilePath}.REMOTE`,
    base: `${openFilePath}.BASE`,
    merged: openFilePath,
    path: openFilePath
  });

  if (!started) {
    return;
  }

  showToast(
    'The merge tool is open. When you have finished there, reload this file — Multi-Git does not assume the conflict was resolved.',
    'info',
    9000
  );

  await refreshStatus();
}

export async function openConflictResolver(filePath: string): Promise<void> {
  const textarea = asTextArea(ui.conflictTextarea);

  openFilePath = filePath;
  ui.conflictFilePathBadge.textContent = filePath;
  textarea.value = 'Loading file content...';
  setHidden(ui.conflictModal, false);

  try {
    const { rawContent } = await api.getConflictFile(filePath);
    textarea.value = rawContent;
  } catch (error) {
    if (!isStale(error)) {
      textarea.value = `Failed to load file contents: ${errorMessage(error)}`;
    }
  }
}

/**
 * Applies one side to every conflict group in the editor.
 *
 * In Git's terms "ours" and "theirs" depend on the operation — during a rebase
 * they are reversed from what most people expect — so the result is shown for
 * review rather than written straight to disk.
 */
export function applyConflictChoice(choice: ConflictChoice): void {
  const textarea = asTextArea(ui.conflictTextarea);
  textarea.value = resolveConflictText(textarea.value, choice);
}

export async function saveConflictResolution(): Promise<void> {
  const filePath = ui.conflictFilePathBadge.textContent ?? '';
  const resolvedContent = asTextArea(ui.conflictTextarea).value;

  if (!filePath) {
    return;
  }

  logToTerminal(`Saving conflict resolution for: ${filePath}...`);

  try {
    await api.resolveConflict(filePath, resolvedContent);
    logToTerminal(`Conflict in ${filePath} resolved and staged.`, 'success');
    showToast('Conflict resolved and staged.', 'success');

    setHidden(ui.conflictModal, true);
    await refreshStatus();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Failed to save resolution.');
      logToTerminal(message, 'error');
      showToast(`Failed to save resolution: ${message}`, 'error', 7000);
    }
  }
}
