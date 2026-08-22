// Repository maintenance: finding the worktrees and branches that have been
// abandoned, and clearing them out together.
//
// "Stale" is not something git records. It is a judgement, and whose judgement
// it is matters: a branch nobody has pushed for a fortnight is rubbish on one
// team and a week's unfinished work on another. So the rule set is data the
// user edits rather than a constant in this file, every signal is reported per
// branch instead of collapsed into a badge, and nothing is removed before the
// list of what would go has been shown.
//
// The three signals answer three different questions, which is why they are
// separate rather than one score:
//
//   * no pull request — nobody ever proposed this work to anyone
//   * unpushed        — it exists on this machine and nowhere else
//   * inactive        — nothing has landed on it for a while
//
// A branch can be any one of those and still be alive, which is why `match`
// exists: `all` is the cautious reading, `any` the aggressive one.

/** One reason a branch might be considered abandoned. */
export type StaleSignal = 'no-pull-request' | 'unpushed' | 'inactive';

/** In this order wherever signals are listed, so rows read consistently. */
export const STALE_SIGNALS: readonly StaleSignal[] = ['no-pull-request', 'unpushed', 'inactive'];

export interface StaleRules {
  /** Days with no new commit before a branch counts as inactive. */
  inactiveDays: number;
  /** Count a branch that no pull request was ever opened for. */
  requireNoPullRequest: boolean;
  /** Count a branch that no remote has a copy of. */
  requireUnpushed: boolean;
  /** Count a branch nothing has landed on for `inactiveDays`. */
  requireInactive: boolean;
  /** Whether every enabled signal must hold, or any one of them is enough. */
  match: 'all' | 'any';
}

/**
 * The shipped definition of stale.
 *
 * Sixty days matches what the Branch Maintenance window has always meant by
 * the word, and both now read this same setting so they cannot disagree.
 * `all` rather than `any`, because the cautious reading is the right default
 * for a rule whose output is a list of things to delete.
 */
export const DEFAULT_STALE_RULES: StaleRules = {
  inactiveDays: 60,
  requireNoPullRequest: true,
  requireUnpushed: false,
  requireInactive: true,
  match: 'all'
};

/** Bounds on the day count, so a typo cannot produce a rule nothing survives. */
export const MIN_INACTIVE_DAYS = 1;
export const MAX_INACTIVE_DAYS = 3650;

/** A pull request as `gh` reports it. */
export interface PullRequestRef {
  number: number;
  /** OPEN, CLOSED or MERGED, in gh's own spelling. */
  state: string;
  url: string;
}

/** Whether the pull-request signal could be judged at all. */
export type PullRequestLookup = 'ok' | 'not-github' | 'cli-unavailable' | 'not-asked';

/** Everything the rules are evaluated against, for one branch. */
export interface BranchFacts {
  /** Short name, e.g. `feature/login`. */
  name: string;
  /** Commit date of the branch tip, ISO 8601. Empty when it has none. */
  lastCommit: string;
  /** Whole days since that commit, or null when there is no usable date. */
  daysSinceCommit: number | null;
  /** A remote has a copy of this branch. */
  pushed: boolean;
  /** It was pushed once and the remote branch has since been deleted. */
  upstreamGone: boolean;
  pullRequest: PullRequestRef | null;
  /** False when nothing could ask GitHub, so the PR signal is unjudged. */
  pullRequestKnown: boolean;
  merged: boolean;
  isCurrent: boolean;
  pinned: boolean;
  /** Path of the worktree holding it, when one does. */
  checkedOutIn: string | null;
}

export interface StaleVerdict {
  stale: boolean;
  /** Enabled signals that hold. */
  signals: StaleSignal[];
  /** One phrase per holding signal, for the row's description. */
  reasons: string[];
  /**
   * Enabled signals that could not be judged — no GitHub CLI for the pull
   * request one, no commit date for inactivity. Never treated as holding: an
   * unanswerable question is not evidence that something can be deleted.
   */
  unknown: StaleSignal[];
}

/** A worktree the rules say has been abandoned. */
export interface WorktreeCandidate {
  path: string;
  /** Folder name, which is what the confirmation talks about. */
  name: string;
  /** Short branch name, or null for a detached worktree. */
  branch: string | null;
  verdict: StaleVerdict;
  /** Facts for its branch, absent when it is detached. */
  facts: BranchFacts | null;
  /** Uncommitted work would be lost. Purging one needs the extra opt-in. */
  dirty: boolean;
  /** Staged, modified, untracked and conflicted files, added up. */
  uncommittedFiles: number;
  /** False when the folder is already gone and only git's record remains. */
  present: boolean;
  /** Whether its branch can go with it. */
  branchDeletable: boolean;
  /** Why the branch would stay, when it would. */
  branchBlockedReason?: string;
}

/** A worktree the survey deliberately left out, and why. */
export interface SkippedWorktree {
  path: string;
  name: string;
  reason: string;
}

/** A branch already contained in the base branch, so deleting it loses nothing. */
export interface MergedBranchCandidate {
  name: string;
  lastCommit: string;
  pullRequest: PullRequestRef | null;
  /** Worktree holding it, when one does. Such a branch cannot be deleted. */
  checkedOutIn: string | null;
  deletable: boolean;
  blockedReason?: string;
}

export interface MaintenanceSurvey {
  /** The rules this survey was run with, as stored. */
  rules: StaleRules;
  /** What "merged" was measured against, e.g. `origin/main`. */
  mergedInto: string;
  staleWorktrees: WorktreeCandidate[];
  keptWorktrees: SkippedWorktree[];
  mergedBranches: MergedBranchCandidate[];
  pullRequestLookup: PullRequestLookup;
  /** Anything that would make the lists misleading if read at face value. */
  warnings: string[];
}

export interface MaintenanceSurveyResponse {
  success: true;
  survey: MaintenanceSurvey;
}

export interface PurgeWorktreesInput {
  /** Exactly the worktrees the user was shown and agreed to. */
  paths: string[];
  /** Delete each purged worktree's branch as well. */
  deleteBranches: boolean;
  /** Purge worktrees with uncommitted work, snapshotting it first. */
  includeDirty: boolean;
  /** Delete branches git would refuse to delete for not being merged. */
  forceBranchDelete: boolean;
}

export interface PurgeOutcome {
  path: string;
  name: string;
  removed: boolean;
  error?: string;
  /** Snapshot of uncommitted work, when there was any to take. */
  snapshotRef?: string;
  branch?: string;
  branchDeleted?: boolean;
  branchError?: string;
}

export interface PurgeWorktreesResult {
  success: true;
  results: PurgeOutcome[];
  removed: number;
  branchesDeleted: number;
  /** Administrative records git forgot for folders that were already gone. */
  pruned: string[];
}
