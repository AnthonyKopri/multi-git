// Recovery points and reflog entries.
//
// Two different things the recovery browser shows side by side. A reflog entry
// is git's own record of where a ref used to point; a recovery point is
// Multi-Git's record of what it was about to do and which refs that would
// move. The reflog is more complete and the recovery point is more legible,
// so neither replaces the other.

/** Operations that record a recovery point before they run. */
export type RecoveryOperation =
  | 'reset'
  | 'rebase'
  | 'merge'
  | 'cherry-pick'
  | 'revert'
  | 'amend'
  | 'undo-commit'
  | 'branch-delete'
  | 'branch-move'
  | 'stash-drop'
  | 'discard-all'
  | 'restore';

export interface RecoveryPoint {
  id: string;
  operation: RecoveryOperation;
  /** What the user was doing, in their words rather than git's. */
  label: string;
  /**
   * Ref name to the object it pointed at beforehand. `HEAD` is always present
   * in a repository that has one; a branch appears under its full ref name.
   */
  refs: Record<string, string>;
  /** Branch HEAD was on, or null when it was detached. */
  headRef: string | null;
  /** Object name of a stash commit this operation would otherwise lose. */
  stashRef?: string;
  createdAt: string;
  /** Null when retention is disabled. */
  expiresAt: string | null;
}

export interface ReflogEntry {
  /** The ref walked, e.g. `HEAD` or `refs/heads/main`. */
  ref: string;
  /** How to name this entry to git, e.g. `HEAD@{3}`. */
  selector: string;
  oid: string;
  /** Where the ref pointed before this entry. Null for the oldest one. */
  previousOid: string | null;
  /** The verb git recorded: `commit`, `reset`, `rebase (finish)`. */
  action: string;
  /** The rest of the reflog message. */
  subject: string;
  timestamp: string;
}

export interface RecoveryResponse {
  success: true;
  points: RecoveryPoint[];
  reflog: ReflogEntry[];
  retentionDays: number;
  /** True when a merge, rebase or similar is unfinished, so nothing expired. */
  operationInProgress: boolean;
}
