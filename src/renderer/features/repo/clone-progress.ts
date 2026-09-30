// The progress bar in the clone dialog.
//
// It draws what the server publishes for the clone's operation and decides
// nothing itself: the bar's fill is the whole-operation fraction, the counts and
// speed are git's own, and the time left is the server's guess. When there is no
// figure yet the bar says so by moving, rather than sitting at zero and looking
// stuck.
import type { OperationProgress } from '../../../shared/operation-types';
import { setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { formatByteCount, formatRemainingTime } from '../../ui/format';

/** A fresh id for a clone, so its operation can be picked out of the stream. */
export function newCloneOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Only reached where randomUUID is missing, such as an insecure context. The
  // id is a label for matching, not a secret, so this is enough.
  return `clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Shows the bar. With no operation yet it is the starting state; with one it is
 * drawn from that operation's latest progress.
 */
export function renderCloneProgress(ui: Elements, operation: OperationProgress | null): void {
  setHidden(ui.cloneProgress, false);

  const transfer = operation?.transfer;
  const track = ui.cloneProgressTrack;

  if (transfer === undefined) {
    // Nothing to measure yet: connecting, or the server has not started
    // counting. An indeterminate bar rather than an empty one.
    track.classList.add('is-indeterminate');
    track.removeAttribute('aria-valuenow');
    ui.cloneProgressBar.style.width = '';
    ui.cloneProgressStage.textContent = operation?.message ?? 'Starting clone…';
    ui.cloneProgressPercent.textContent = '';
    ui.cloneProgressDetail.textContent = '';
    ui.cloneProgressRemaining.textContent = '';
    return;
  }

  // Floored, so the bar never reads 100% while work remains. The nudge keeps a
  // fraction like 0.29 from reading 28% because 0.29 * 100 is 28.999999999999996.
  // Once the clone has succeeded there is no work left, whatever phase git last
  // wrote about: a checkout that finishes quickly prints nothing at all.
  const percent =
    operation?.state === 'succeeded'
      ? 100
      : Math.min(100, Math.max(0, Math.floor(transfer.fraction * 100 + 1e-9)));

  track.classList.remove('is-indeterminate');
  track.setAttribute('aria-valuenow', String(percent));
  ui.cloneProgressBar.style.width = `${percent}%`;
  ui.cloneProgressStage.textContent = operation?.message ?? 'Cloning…';
  ui.cloneProgressPercent.textContent = `${percent}%`;

  const detail: string[] = [];
  if (operation?.total !== undefined && operation.total > 0) {
    detail.push(`${(operation.completed ?? 0).toLocaleString()} / ${operation.total.toLocaleString()}`);
  }
  if (transfer.bytes !== undefined) {
    // "of ~" because the total is GitHub's figure for the repository, which is
    // close to what a clone downloads and not exactly it.
    detail.push(
      transfer.expectedBytes === undefined
        ? formatByteCount(transfer.bytes)
        : `${formatByteCount(transfer.bytes)} of ~${formatByteCount(transfer.expectedBytes)}`
    );
  }
  if (transfer.bytesPerSecond !== undefined) {
    detail.push(`${formatByteCount(transfer.bytesPerSecond)}/s`);
  }
  ui.cloneProgressDetail.textContent = detail.join(' · ');

  ui.cloneProgressRemaining.textContent =
    transfer.remainingMs === undefined ? '' : formatRemainingTime(transfer.remainingMs);
}

export function hideCloneProgress(ui: Elements): void {
  setHidden(ui.cloneProgress, true);
  ui.cloneProgressBar.style.width = '';
}
