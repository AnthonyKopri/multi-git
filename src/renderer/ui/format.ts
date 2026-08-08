// Small presentation helpers shared across features.
import type { StatusCode } from '../../shared/git-types';

export interface StatusLabel {
  char: string;
  title: string;
  className: string;
}

const STATUS_LABELS: Partial<Record<StatusCode, StatusLabel>> = {
  M: { char: 'M', title: 'Modified', className: 'status-m' },
  A: { char: 'A', title: 'Added', className: 'status-a' },
  D: { char: 'D', title: 'Deleted', className: 'status-d' },
  R: { char: 'R', title: 'Renamed', className: 'status-r' },
  U: { char: '⚠', title: 'Conflict', className: 'status-u' },
  '?': { char: '?', title: 'Untracked', className: 'status-q' }
};

export function statusLabel(code: string): StatusLabel {
  return (
    STATUS_LABELS[code as StatusCode] ?? { char: code, title: 'Unknown', className: 'status-q' }
  );
}

/**
 * A stable colour per profile id, so each account keeps the same identity
 * colour across sessions without one being stored.
 */
export function profileColor(id: string): string {
  let hash = 0;
  const text = String(id);

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `hsl(${hash % 360}, 70%, 55%)`;
}

/** The final segment of a repository path, for display. */
export function repoBaseName(repoPath: string | null): string {
  if (!repoPath) {
    return '';
  }

  return (
    String(repoPath)
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? repoPath
  );
}

/** Renders an ahead/behind count, or an empty string for zero. */
export function countBadge(count: number, arrow: string): string {
  return count > 0 ? `${arrow}${count}` : '';
}

const TIME_UNITS: readonly { limitMs: number; ms: number; name: string }[] = [
  { limitMs: 60_000, ms: 1_000, name: 'second' },
  { limitMs: 3_600_000, ms: 60_000, name: 'minute' },
  { limitMs: 86_400_000, ms: 3_600_000, name: 'hour' },
  { limitMs: 2_592_000_000, ms: 86_400_000, name: 'day' },
  { limitMs: 31_536_000_000, ms: 2_592_000_000, name: 'month' },
  { limitMs: Number.POSITIVE_INFINITY, ms: 31_536_000_000, name: 'year' }
];

/**
 * "3 hours ago", "in 12 days".
 *
 * Git's own relative dates are used where git produced the value, so this is
 * for timestamps the app recorded itself — a recovery point's creation and
 * expiry. Returns an empty string for a value that is not a real time, so a
 * corrupt journal entry renders as missing rather than as "NaN years ago".
 */
export function formatRelativeTime(timestampMs: number, now = Date.now()): string {
  if (!Number.isFinite(timestampMs)) {
    return '';
  }

  const delta = timestampMs - now;
  const magnitude = Math.abs(delta);

  if (magnitude < 5_000) {
    return 'just now';
  }

  const unit = TIME_UNITS.find((candidate) => magnitude < candidate.limitMs) ?? TIME_UNITS[5];
  const count = Math.round(magnitude / (unit as { ms: number }).ms);
  const name = `${(unit as { name: string }).name}${count === 1 ? '' : 's'}`;

  return delta < 0 ? `${count} ${name} ago` : `in ${count} ${name}`;
}
