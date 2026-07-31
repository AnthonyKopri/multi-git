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
