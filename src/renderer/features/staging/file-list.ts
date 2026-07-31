// The Staging Area file lists and the File Diff tab's file picker.
import { el, fragment, icon } from '../../dom/create';
import { statusLabel } from '../../ui/format';
import type { StatusResponse } from '../../../shared/api-types';

/** One row in either list, with enough context to act on it. */
export interface DiffEntry {
  path: string;
  status: string;
  staged: boolean;
  /** Grouping label shown in the File Diff list. */
  scope: 'Conflict' | 'Untracked' | 'Unstaged' | 'Staged';
}

/**
 * Flattens a status into the single ordered list the diff picker shows:
 * conflicts first, then working-tree changes, then the index.
 */
export function diffEntriesFor(status: StatusResponse | null): DiffEntry[] {
  if (!status) {
    return [];
  }

  const conflictPaths = new Set(status.conflicts.map((file) => file.path));
  const entries: DiffEntry[] = [];

  for (const file of status.conflicts) {
    entries.push({ path: file.path, status: 'U', staged: false, scope: 'Conflict' });
  }

  for (const file of status.unstaged) {
    // A conflicted file also appears as unstaged; it is already listed above.
    if (!conflictPaths.has(file.path)) {
      entries.push({
        path: file.path,
        status: file.status,
        staged: false,
        scope: file.status === '?' ? 'Untracked' : 'Unstaged'
      });
    }
  }

  for (const file of status.staged) {
    entries.push({ path: file.path, status: file.status, staged: true, scope: 'Staged' });
  }

  return entries;
}

export function findDiffEntry(
  status: StatusResponse | null,
  path: string,
  staged: boolean
): DiffEntry | null {
  return (
    diffEntriesFor(status).find((entry) => entry.path === path && entry.staged === staged) ?? null
  );
}

function statusIndicator(status: string): HTMLSpanElement {
  const label = statusLabel(status);
  return el('span', {
    className: `status-indicator ${label.className}`,
    text: label.char,
    title: label.title
  });
}

/**
 * Builds an action button.
 *
 * No click handler is attached: the list container carries one delegated
 * listener that reads `data-action` and `data-path`. Rows are rebuilt on every
 * refresh, and attaching a closure per button meant allocating one per row per
 * render.
 */
function actionButton(
  action: string,
  glyph: string,
  title: string,
  ariaLabel: string,
  extraClass = ''
): HTMLButtonElement {
  const button = el('button', {
    className: `btn btn-icon btn-sm ${extraClass}`.trim(),
    title,
    data: { action },
    attrs: { 'aria-label': ariaLabel },
    children: [icon(glyph, 14)]
  });

  button.style.width = '24px';
  button.style.height = '24px';
  return button;
}

export interface FileRowOptions {
  path: string;
  status: string;
  staged: boolean;
  active: boolean;
}

/**
 * A row in the Staging Area.
 *
 * Clicking the row toggles staged state; the action buttons do something
 * else, so they carry their own data-action and stop propagation via the
 * delegated handler's target check.
 */
export function buildFileRow(options: FileRowOptions): HTMLLIElement {
  const { path, status, staged, active } = options;
  const isConflict = status === 'U';
  const isUntracked = status === '?';

  const actions: HTMLElement[] = [];

  if (isConflict) {
    const resolve = el('button', {
      className: 'btn btn-secondary btn-sm',
      data: { action: 'resolve' },
      attrs: { 'aria-label': `Resolve conflict in ${path}` },
      children: [icon('dynamic_form', 16), el('span', { text: ' Resolve' })]
    });
    resolve.style.padding = '2px 6px';
    actions.push(resolve);
  } else {
    // Ignore comes before Diff so the destructive action stays last.
    if (!staged && isUntracked) {
      actions.push(actionButton('ignore', 'block', 'Ignore File', `Ignore ${path}`));
    }

    actions.push(actionButton('diff', 'difference', 'View Diff', `View diff for ${path}`));

    if (!staged) {
      actions.push(
        actionButton(
          'discard',
          'delete',
          isUntracked ? 'Delete File' : 'Discard Changes',
          isUntracked ? `Delete ${path}` : `Discard changes in ${path}`,
          'file-action-destructive'
        )
      );
    }
  }

  const row = el('li', {
    className: `file-item${active ? ' active' : ''}`,
    title: isConflict
      ? 'Click to resolve conflict'
      : staged
        ? 'Click to unstage this file'
        : 'Click to stage this file',
    data: { path, staged: String(staged), status },
    children: [
      el('div', {
        className: 'file-info',
        children: [statusIndicator(status), el('span', { className: 'file-name', text: path, title: path })]
      }),
      el('div', { className: 'file-actions', children: actions })
    ]
  });

  return row;
}

/** A row in the File Diff tab's picker, which selects rather than stages. */
export function buildDiffPickerRow(entry: DiffEntry, active: boolean): HTMLLIElement {
  return el('li', {
    className: `file-item diff-file-item${active ? ' active' : ''}`,
    title: `${entry.scope}: ${entry.path}`,
    data: { path: entry.path, staged: String(entry.staged), status: entry.status },
    children: [
      el('div', {
        className: 'file-info',
        children: [
          statusIndicator(entry.status),
          el('span', { className: 'file-name', text: entry.path, title: entry.path })
        ]
      }),
      el('span', { className: 'diff-file-scope', text: entry.scope })
    ]
  });
}

export function emptyState(message: string): HTMLLIElement {
  return el('li', { className: 'empty-state', text: message });
}

/** Replaces a list's contents in one operation. */
export function renderRows(list: Element, rows: HTMLElement[], emptyMessage: string): void {
  list.replaceChildren(rows.length === 0 ? emptyState(emptyMessage) : fragment(rows));
}
