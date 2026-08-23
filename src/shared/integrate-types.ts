// What an integration would do, before it does it.
//
// Opening a pull request changes nothing on your machine and gets a twenty-field
// preflight. Merging and rebasing rewrite your history and got a dropdown and a
// button -- no preview, no confirmation, no indication of what was coming or
// what it would do. Discarding one file asked you to confirm; rewriting the
// branch did not. This is the shape that corrects that inversion.

export type IntegrationKind = 'merge' | 'rebase' | 'pull' | 'push';

/**
 * How a pull will actually integrate what it fetches.
 *
 * Git decides this from `pull.rebase` and `pull.ff`, which this application
 * never read and never showed -- so pressing Pull could fast-forward, write a
 * merge commit, or replay your commits, and there was no way to know which
 * before it happened.
 */
export type PullStrategy = 'fast-forward' | 'merge' | 'rebase' | 'ff-only-blocked' | 'up-to-date';

export interface IntegrationCommit {
  hash: string;
  subject: string;
  author: string;
}

export interface IntegrationPreflight {
  kind: IntegrationKind;
  /** The branch or ref being integrated, or pushed to. */
  target: string;
  /** Commits that would arrive, newest first. Empty when there is nothing. */
  incoming: IntegrationCommit[];
  /** Commits of your own that the operation would move or replay. */
  outgoing: IntegrationCommit[];
  /** Files the integration would touch. */
  changedFiles: number;
  /**
   * True when the branch can simply move forward -- no merge commit, no replay,
   * nothing rewritten. The safest possible outcome, and worth saying so.
   */
  fastForward: boolean;
  /** Set for pull, where the strategy is git configuration rather than a flag. */
  strategy?: PullStrategy;
  /**
   * Whether a recovery point will be recorded first.
   *
   * Merge and rebase have always captured one and never mentioned it, which is
   * a safety net that buys the user no confidence.
   */
  recoveryPoint: boolean;
  /** The SSH profile the operation would authenticate with, when it needs one. */
  identity?: { label: string; keyPath: string } | null;
  /** Things worth reading before pressing the button. Never blocking. */
  warnings: string[];
  /** Set when the operation cannot proceed at all, with the reason. */
  blocked?: string;
}
