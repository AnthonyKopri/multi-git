// The recovery browser.
//
// Two lists that answer different questions. Recovery points answer "what was
// I about to do, and where was everything", in the app's own words. The reflog
// answers "where has HEAD actually been", including operations that happened
// outside Multi-Git entirely.
//
// Every action here is additive by default: creating a branch from an object
// is offered first, because it recovers work without moving anything the user
// is currently standing on. Restoring a ref is the destructive one and says so.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { el, fragment, icon, setHidden } from '../../dom/create';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { formatRelativeTime } from '../../ui/format';
import type { RecoveryPoint, ReflogEntry } from '../../../shared/recovery-types';

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};

/** The last payload, so a row action can look up what it refers to. */
let points: RecoveryPoint[] = [];
let reflog: ReflogEntry[] = [];

export function initRecovery(elements: Elements, onChanged: () => Promise<void>): void {
  ui = elements;
  refreshAll = onChanged;
}

function shortOid(oid: string): string {
  return oid.substring(0, 8);
}

/** `refs/heads/main` reads better as `main` in a list. */
function shortRef(ref: string): string {
  return ref.replace(/^refs\/(heads|remotes|tags)\//, '');
}

function actionButton(action: string, glyph: string, title: string, data: Record<string, string>) {
  return el('button', {
    className: 'btn btn-icon btn-sm',
    title,
    data: { ...data, action },
    children: [icon(glyph, 14)]
  });
}

function buildPointRow(point: RecoveryPoint): HTMLLIElement {
  const refNames = Object.keys(point.refs).filter((ref) => ref !== 'HEAD');
  const head = point.refs['HEAD'] ?? '';

  return el('li', {
    className: 'recovery-item',
    data: { pointId: point.id },
    children: [
      el('div', {
        className: 'recovery-item-main',
        children: [
          el('span', { className: 'recovery-label', text: point.label }),
          el('span', {
            className: 'recovery-meta',
            text: [
              formatRelativeTime(Date.parse(point.createdAt)),
              head === '' ? '' : `HEAD ${shortOid(head)}`,
              point.headRef === null ? 'detached' : shortRef(point.headRef),
              refNames.length > 0 ? `also ${refNames.map(shortRef).join(', ')}` : '',
              point.stashRef === undefined ? '' : `stash ${shortOid(point.stashRef)}`,
              point.expiresAt === null ? 'kept' : `expires ${formatRelativeTime(Date.parse(point.expiresAt))}`
            ]
              .filter((part) => part !== '')
              .join(' · ')
          })
        ]
      }),
      el('span', {
        className: 'recovery-actions',
        children: [
          actionButton('branch', 'alt_route', 'Create a branch at this position', {
            oid: head
          }),
          actionButton('restore', 'restore', 'Reset this ref back to where it was', {}),
          actionButton('copy', 'content_copy', 'Copy the equivalent git command', {
            oid: head
          }),
          actionButton('forget', 'delete', 'Remove this point from the journal', {})
        ]
      })
    ]
  });
}

function buildReflogRow(entry: ReflogEntry): HTMLLIElement {
  return el('li', {
    className: 'recovery-item',
    data: { selector: entry.selector, oid: entry.oid },
    children: [
      el('div', {
        className: 'recovery-item-main',
        children: [
          el('span', {
            className: 'recovery-label',
            text: entry.subject === '' ? entry.action : `${entry.action}: ${entry.subject}`
          }),
          el('span', {
            className: 'recovery-meta',
            text: [entry.selector, shortOid(entry.oid), entry.timestamp.slice(0, 10)]
              .filter((part) => part !== '')
              .join(' · ')
          })
        ]
      }),
      el('span', {
        className: 'recovery-actions',
        children: [
          actionButton('reflog-branch', 'alt_route', 'Create a branch at this commit', {
            oid: entry.oid
          }),
          actionButton('reflog-copy', 'content_copy', 'Copy the equivalent git command', {
            oid: entry.oid
          })
        ]
      })
    ]
  });
}

function renderList(list: Element, rows: HTMLElement[], emptyMessage: string): void {
  list.replaceChildren(
    rows.length === 0 ? el('li', { className: 'empty-state', text: emptyMessage }) : fragment(rows)
  );
}

/** The compact list in the sidebar: the three most recent points. */
function renderSidebar(): void {
  renderList(
    ui.recoveryList,
    points.slice(0, 3).map((point) =>
      el('li', {
        className: 'stash-item',
        title: `${point.label} — ${formatRelativeTime(Date.parse(point.createdAt))}`,
        children: [icon('restore'), el('span', { className: 'stash-msg', text: point.label })]
      })
    ),
    'No recovery points'
  );
}

export async function refreshRecovery(): Promise<void> {
  try {
    const result = await api.getRecovery();
    points = result.points;
    reflog = result.reflog;

    renderSidebar();

    ui.recoveryRetentionNote.textContent =
      result.retentionDays === 0
        ? 'Recovery points record where every ref stood before a risky operation. They are kept until you remove them.'
        : `Recovery points record where every ref stood before a risky operation. They expire after ${result.retentionDays} days.`;

    setHidden(ui.recoveryOperationWarning, !result.operationInProgress);

    renderList(
      ui.recoveryPointsList,
      points.map(buildPointRow),
      'No recovery points recorded yet'
    );
    renderList(ui.recoveryReflogList, reflog.map(buildReflogRow), 'No reflog entries');
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read recovery points: ${errorMessage(error)}`, 'error');
    }
  }
}

export function openRecoveryBrowser(): void {
  setHidden(ui.recoveryModal, false);
  void refreshRecovery();
}

export function closeRecoveryBrowser(): void {
  setHidden(ui.recoveryModal, true);
}

async function branchFrom(oid: string): Promise<void> {
  if (oid === '') {
    return;
  }

  const name = await promptDialog({
    title: `Branch from ${shortOid(oid)}`,
    label: 'New branch name',
    type: 'text'
  });
  if (name === null || name.trim() === '') {
    return;
  }

  try {
    await api.recoveryBranch(oid, name.trim());
    logToTerminal(`git branch ${name.trim()} ${shortOid(oid)}`, 'cmd');
    showToast(`Created ${name.trim()} at ${shortOid(oid)}.`, 'success');
    await refreshAll();
    await refreshRecovery();
  } catch (error) {
    if (!isStale(error)) {
      const text = errorMessage(error, 'Could not create the branch.');
      logToTerminal(text, 'error');
      showToast(text, 'error', 7000);
    }
  }
}

async function restorePoint(point: RecoveryPoint): Promise<void> {
  const target = point.headRef ?? 'HEAD';
  const oid = point.refs[target] ?? point.refs['HEAD'] ?? '';

  const { confirmed } = await confirmDialog(
    `Reset ${shortRef(target)} back to ${shortOid(oid)}?\n\nThis is a hard reset: anything committed since "${point.label}" goes with it. A new recovery point is recorded first.`,
    { title: 'Restore ref', confirmLabel: 'Restore', danger: true }
  );
  if (!confirmed) {
    return;
  }

  try {
    const result = await api.recoveryRestore(point.id, target);
    logToTerminal(`git reset --hard ${result.shortOid}`, 'cmd');
    showToast(`Restored ${shortRef(target)} to ${result.shortOid}.`, 'success');
    await refreshAll();
    await refreshRecovery();
  } catch (error) {
    if (!isStale(error)) {
      const text = errorMessage(error, 'Could not restore the ref.');
      logToTerminal(text, 'error');
      showToast(text, 'error', 8000);
    }
  }
}

/**
 * Puts the command on the clipboard.
 *
 * The command is the escape hatch: whatever this UI cannot do, a terminal can,
 * and the object name is the only hard part to retype.
 */
async function copyCommand(oid: string): Promise<void> {
  if (oid === '') {
    return;
  }

  const command = `git branch recovered-${shortOid(oid)} ${oid}`;
  try {
    await navigator.clipboard.writeText(command);
    showToast('Command copied.', 'success');
    logToTerminal(command, 'cmd');
  } catch {
    // A clipboard a browser refused is not worth an error dialog; showing the
    // command is the point, and the log has it.
    logToTerminal(command, 'cmd');
    showToast('Clipboard unavailable — the command is in the Terminal Log.', 'info', 6000);
  }
}

async function forgetPoint(point: RecoveryPoint): Promise<void> {
  const { confirmed } = await confirmDialog(
    `Remove "${point.label}" from the recovery journal?\n\nThe commits it names stay in the repository; only this entry goes.`,
    { title: 'Forget recovery point', confirmLabel: 'Forget' }
  );
  if (!confirmed) {
    return;
  }

  try {
    await api.forgetRecoveryPoint(point.id);
    await refreshRecovery();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not remove the point.'), 'error');
    }
  }
}

/** Dispatches a click inside either list. */
export function handleRecoveryAction(target: HTMLElement): void {
  const action = target.dataset['action'];
  const oid = target.dataset['oid'] ?? '';
  const pointId = target.closest<HTMLElement>('[data-point-id]')?.dataset['pointId'];
  const point = points.find((candidate) => candidate.id === pointId);

  switch (action) {
    case 'branch':
    case 'reflog-branch':
      void branchFrom(oid);
      return;
    case 'copy':
    case 'reflog-copy':
      void copyCommand(oid);
      return;
    case 'restore':
      if (point) {
        void restorePoint(point);
      }
      return;
    case 'forget':
      if (point) {
        void forgetPoint(point);
      }
  }
}
