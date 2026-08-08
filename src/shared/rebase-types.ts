// Interactive rebase, as a plan rather than a text file.

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseTodoItem {
  oid: string;
  action: RebaseAction;
  /** The commit's current subject, for display and for the todo comment. */
  subject: string;
  author: string;
  date: string;
  /** Replacement message for a `reword`. Ignored for every other action. */
  message?: string;
  /**
   * Set when autosquash moved this item. Shown in the planner so the reorder
   * is visible rather than mysterious.
   */
  autosquashedInto?: string;
}

export interface RebasePlan {
  /** The commit the rebase replays onto — the parent of the first item. */
  onto: string;
  items: RebaseTodoItem[];
  autosquash: boolean;
}

export interface RebaseValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Where a running rebase has got to. */
export interface RebaseStatus {
  inProgress: boolean;
  /** Present when Multi-Git started this rebase and the session survived. */
  plan: RebasePlan | null;
  /** 1-based, as git counts them. */
  step: number;
  totalSteps: number;
  /** The commit the rebase is stopped at, if it is stopped at one. */
  stoppedAt: string | null;
  stoppedSubject: string | null;
  conflictedFiles: string[];
  /** True at an `edit` stop, where the commit can be split. */
  canSplit: boolean;
  /** Set once a split has started and no replacement commit exists yet. */
  splitInProgress: boolean;
}

export interface PublishedBranchWarning {
  /** The branch about to be rewritten, when it has an upstream. */
  branch: string | null;
  upstream: string | null;
  /** Commits the rewrite would orphan on the remote. */
  publishedCommits: number;
}
