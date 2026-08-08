// Stashes, tags, and Safety Net — the left column's short-term shelves.
//
// They share a row shape (glyph, label, actions), so they share a builder.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { el, fragment, icon } from '../../dom/create';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import { activeProfile } from '../accounts';

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};

export function initShelf(elements: Elements, onChanged: () => Promise<void>): void {
  ui = elements;
  refreshAll = onChanged;
}

interface ShelfAction {
  action: string;
  glyph: string;
  title: string;
  danger?: boolean;
}

function buildShelfRow(
  glyph: string,
  label: string,
  rowTitle: string,
  data: Record<string, string>,
  actions: readonly ShelfAction[]
): HTMLLIElement {
  return el('li', {
    className: 'stash-item',
    title: rowTitle,
    data,
    children: [
      icon(glyph),
      el('span', { className: 'stash-msg', text: label }),
      el('span', {
        className: 'stash-actions',
        children: actions.map((spec) =>
          el('button', {
            className: `btn btn-icon btn-sm${spec.danger ? ' file-action-destructive' : ''}`,
            title: spec.title,
            data: { action: spec.action },
            children: [icon(spec.glyph, 14)]
          })
        )
      })
    ]
  });
}

function renderList(list: Element, rows: HTMLElement[], emptyMessage: string): void {
  list.replaceChildren(
    rows.length === 0 ? el('li', { className: 'empty-state', text: emptyMessage }) : fragment(rows)
  );
}

// ---------- stashes ----------

export async function refreshStashList(): Promise<void> {
  try {
    const { stashes } = await api.getStashes();

    renderList(
      ui.stashList,
      stashes.map((stash) =>
        buildShelfRow(
          'inventory_2',
          stash.message,
          `${stash.ref} — ${stash.date}`,
          { ref: stash.ref },
          [
            { action: 'inspect', glyph: 'visibility', title: 'See what this stash holds' },
            { action: 'apply', glyph: 'download', title: 'Apply and keep the stash' },
            { action: 'apply-index', glyph: 'playlist_add_check', title: 'Apply, restoring what was staged' },
            { action: 'branch', glyph: 'alt_route', title: 'Start a branch from this stash' },
            { action: 'pop', glyph: 'unarchive', title: 'Apply and remove the stash' },
            { action: 'drop', glyph: 'delete', title: 'Delete this stash', danger: true }
          ]
        )
      ),
      'No stashes'
    );
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Failed to load stashes: ${errorMessage(error)}`, 'error');
    }
  }
}

/** Shows what a stash contains without applying it. */
export async function inspectStash(ref: string): Promise<void> {
  try {
    const { files, diff } = await api.showStash(ref);

    const changed = files.map((file) => `${file.status}  ${file.path}`).join('\n');
    const totals = diff.reduce(
      (running, file) => ({
        additions: running.additions + file.additions,
        deletions: running.deletions + file.deletions
      }),
      { additions: 0, deletions: 0 }
    );

    logToTerminal(`git stash show -p ${ref}`, 'cmd');

    await confirmDialog(
      `${ref} holds ${files.length} ${files.length === 1 ? 'file' : 'files'}, +${totals.additions} -${totals.deletions}:

${changed}`,
      { title: 'Stash contents', confirmLabel: 'Close' }
    );
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not read the stash.'), 'error');
    }
  }
}

/** Checks the stash out onto a new branch, where it always applies. */
export async function branchFromStash(ref: string): Promise<void> {
  const name = await promptDialog({
    title: `Branch from ${ref}`,
    label: 'New branch name',
    type: 'text'
  });
  if (name === null || name.trim() === '') {
    return;
  }

  try {
    await api.branchFromStash(ref, name.trim());
    logToTerminal(`git stash branch ${name.trim()} ${ref}`, 'cmd');
    showToast(`Checked out ${name.trim()} with the stash applied.`, 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const text = errorMessage(error, 'Could not branch from the stash.');
      logToTerminal(text, 'error');
      showToast(text, 'error', 7000);
    }
  }
}

export async function stashChanges(): Promise<void> {
  const message = await promptDialog({
    title: 'Stash changes',
    label: 'Description (optional)',
    type: 'text'
  });
  // null means cancelled; an empty string is a deliberate "no description".
  if (message === null) {
    return;
  }

  logToTerminal('git stash push -u', 'cmd');

  await withButtonBusy(ui.btnStashSave, async () => {
    try {
      await api.pushStash({ message, includeUntracked: true });
      showToast('Changes stashed.', 'success');
      await refreshAll();
    } catch (error) {
      if (!isStale(error)) {
        const text = errorMessage(error, 'Could not stash changes.');
        logToTerminal(text, 'error');
        showToast(text, 'error', 7000);
      }
    }
  });
}

export async function applyStash(ref: string, pop: boolean, restoreIndex = false): Promise<void> {
  logToTerminal(`git stash ${pop ? 'pop' : 'apply'}${restoreIndex ? ' --index' : ''} ${ref}`, 'cmd');

  try {
    await api.applyStash(ref, pop, restoreIndex);
    showToast(pop ? 'Stash popped.' : 'Stash applied.', 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const text = errorMessage(error, 'Could not apply the stash.');
      logToTerminal(text, 'error');
      // Conflicts while applying are common and worth reading in full.
      showToast(text, 'error', 8000);
    }
  }
}

export async function dropStash(ref: string): Promise<void> {
  const { confirmed } = await confirmDialog(
    `Permanently delete ${ref}? Stashed changes cannot be recovered afterwards.`,
    { title: 'Drop stash', confirmLabel: 'Drop', danger: true }
  );
  if (!confirmed) {
    return;
  }

  try {
    await api.dropStash(ref);
    showToast('Stash dropped.', 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not drop the stash.'), 'error');
    }
  }
}

// ---------- tags ----------

export async function refreshTagList(): Promise<void> {
  try {
    const { tags } = await api.getTags();

    renderList(
      ui.tagList,
      tags.map((tag) =>
        buildShelfRow('sell', tag.name, `${tag.hash} — ${tag.date}`, { tag: tag.name }, [
          { action: 'show', glyph: 'visibility', title: 'Show the tagged commit' },
          { action: 'push', glyph: 'cloud_upload', title: 'Push this tag to origin' },
          { action: 'delete', glyph: 'delete', title: 'Delete this local tag', danger: true }
        ])
      ),
      'No tags'
    );
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Failed to load tags: ${errorMessage(error)}`, 'error');
    }
  }
}

export async function pushTag(name: string): Promise<void> {
  const profile = activeProfile();
  logToTerminal(`git push origin refs/tags/${name}`, 'cmd');

  try {
    const result = await api.pushTag(name, profile?.id, profile?.privateKeyPath);
    showToast(
      `Tag ${name} pushed${result.profileLabel ? ` with key "${result.profileLabel}"` : ''}.`,
      'success'
    );
  } catch (error) {
    if (!isStale(error)) {
      const text = errorMessage(error, 'Could not push the tag.');
      logToTerminal(text, 'error');
      showToast(text, 'error', 8000);
    }
  }
}

export async function deleteTag(name: string): Promise<void> {
  const { confirmed } = await confirmDialog(
    `Delete the local tag "${name}"? A tag already pushed to origin stays there.`,
    { title: 'Delete tag', confirmLabel: 'Delete', danger: true }
  );
  if (!confirmed) {
    return;
  }

  try {
    await api.deleteTag(name);
    showToast(`Deleted tag ${name}.`, 'success');
    await refreshTagList();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not delete the tag.'), 'error');
    }
  }
}

// ---------- safety net ----------

export async function refreshSafetyNet(): Promise<void> {
  try {
    const [checkpoints, trash] = await Promise.all([api.getCheckpoints(), api.getTrash()]);

    renderList(
      ui.checkpointList,
      checkpoints.checkpoints.map((checkpoint) =>
        buildShelfRow(
          'history',
          checkpoint.label,
          `Undo "${checkpoint.label}" — resets the branch back to ${checkpoint.head}`,
          { checkpointId: checkpoint.id, label: checkpoint.label },
          [
            {
              action: 'undo',
              glyph: 'undo',
              title: 'Undo this operation (hard reset to the checkpoint)'
            }
          ]
        )
      ),
      'No recent operations'
    );

    renderList(
      ui.trashList,
      trash.entries.map((entry) =>
        buildShelfRow(
          'restore_from_trash',
          entry.path,
          `Restore ${entry.path} as it was when discarded`,
          { trashId: entry.id, path: entry.path },
          [{ action: 'restore', glyph: 'settings_backup_restore', title: 'Restore this file' }]
        )
      ),
      'Nothing discarded recently'
    );
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Failed to load Safety Net: ${errorMessage(error)}`, 'error');
    }
  }
}

export async function undoOperation(checkpointId: string, label: string): Promise<void> {
  // This is a hard reset. Anything committed after the checkpoint goes with
  // it, so the wording says so rather than calling it a simple undo.
  const { confirmed } = await confirmDialog(
    `Undo "${label}"? This hard-resets the branch to the checkpoint, discarding anything committed since.`,
    { title: 'Undo operation', confirmLabel: 'Undo', danger: true }
  );
  if (!confirmed) {
    return;
  }

  try {
    const result = await api.undoOperation(checkpointId);
    logToTerminal(`git reset --hard ${result.restoredHead}`, 'cmd');
    showToast(`Undid "${label}".`, 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const text = errorMessage(error, 'Could not undo the operation.');
      logToTerminal(text, 'error');
      showToast(text, 'error', 8000);
    }
  }
}

export async function restoreTrashEntry(id: string, path: string): Promise<void> {
  try {
    await api.restoreFromTrash(id);
    logToTerminal(`Restored ${path} from Safety Net.`, 'success');
    showToast(`Restored ${path}.`, 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const text = errorMessage(error, 'Could not restore the file.');
      logToTerminal(text, 'error');
      showToast(text, 'error', 7000);
    }
  }
}
