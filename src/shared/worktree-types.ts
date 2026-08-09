// Git worktrees: several working directories sharing one repository.
//
// The distinction that runs through this file is between the *family* and the
// *worktree*. Remotes, config, objects, refs and history belong to the family
// and are the same everywhere. The index, the working tree and whatever is
// half-finished in it belong to one worktree and to nothing else. Treating the
// first as per-worktree duplicates work; treating the second as shared loses
// someone's changes.

/** One working directory, as `git worktree list --porcelain` describes it. */
export interface WorktreeInfo {
  path: string;
  /** Object name of HEAD. Empty for a bare worktree, which has no HEAD. */
  head: string;
  /** Full ref name, e.g. `refs/heads/main`. Absent when detached or bare. */
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  prunableReason?: string;
  /** The original working directory. It cannot be removed or moved. */
  isMain: boolean;
  /** False when the recorded path is no longer on disk. */
  present: boolean;
  /** Filled in by the status pass, which is a separate request. */
  status?: WorktreeStatusSummary;
}

export interface WorktreeStatusSummary {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  ahead: number;
  behind: number;
  /** Upstream ref this worktree's branch tracks, or '' when it tracks nothing. */
  tracking: string;
  /** Commit date of HEAD, ISO 8601. Absent in a repository with no commits. */
  lastActivity?: string;
}

/** The listing, plus what identifies the family the caller asked about. */
export interface WorktreeListResponse {
  success: true;
  /** Canonical identity of the shared git directory. Groups the family. */
  familyKey: string;
  /** Absolute path of the main worktree, which owns the shared git directory. */
  mainPath: string;
  worktrees: WorktreeInfo[];
  /** Where a new worktree would go by default, given the current settings. */
  suggestedParent: string;
}

export interface CreateWorktreeInput {
  repoPath: string;
  targetPath: string;
  branchMode: 'existing' | 'new' | 'detached';
  branch?: string;
  startPoint?: string;
  lock?: boolean;
}

export interface WorktreeActionResult {
  success: true;
  /** The worktree the action applied to, after any move. */
  path: string;
  worktrees: WorktreeInfo[];
  /** Git's own output, for the Terminal Log. */
  stdout: string;
  stderr: string;
}

export interface RemoveWorktreeInput {
  path: string;
  /** Removes a dirty worktree. Requires `confirmName` and records recovery. */
  force?: boolean;
  /** The worktree's folder name, typed by the user, for a forced removal. */
  confirmName?: string;
}

export interface RemoveWorktreeResult {
  success: true;
  removedPath: string;
  worktrees: WorktreeInfo[];
  /**
   * Object name of the snapshot commit taken before a forced removal, when
   * there was uncommitted work to snapshot. `git stash create` writes it into
   * the shared object store, so it outlives the worktree it came from and the
   * recovery point can name it.
   */
  snapshotRef?: string;
}

export interface PrunePreviewEntry {
  /** Worktree administrative name git would forget, e.g. `feature-x`. */
  name: string;
  reason: string;
}

export interface PrunePreviewResponse {
  success: true;
  entries: PrunePreviewEntry[];
}
