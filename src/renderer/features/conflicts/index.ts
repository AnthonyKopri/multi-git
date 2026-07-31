// The conflict editor.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { asTextArea } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { resolveConflictText, type ConflictChoice } from './resolve-text';

let ui: Elements;
let refreshStatus: () => Promise<void> = async () => {};

export function initConflicts(elements: Elements, onResolved: () => Promise<void>): void {
  ui = elements;
  refreshStatus = onResolved;
}

export async function openConflictResolver(filePath: string): Promise<void> {
  const textarea = asTextArea(ui.conflictTextarea);

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
