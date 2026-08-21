// When a fetch is allowed to pull on its own.
//
// The whole feature rests on one guarantee: an automatic pull is only ever a
// fast-forward. Nothing is merged, nothing is rebased, no conflict can be
// raised by a command the user did not press, and nothing uncommitted is put
// at risk. Every condition below exists to keep that true, so this is a
// deliberately narrow yes.
//
// Pure, because "would this have pulled?" is the question worth testing, and
// the answer must not depend on a repository being on disk.
import type { StatusResponse } from '../../../shared/api-types';

/**
 * Untracked files are not changes to the branch.
 *
 * Requiring a folder with no stray files at all would mean the feature almost
 * never fires, and an untracked file cannot turn a fast-forward into a merge.
 * In the one case where an incoming file would land on top of one, git refuses
 * on its own rather than overwriting it.
 */
function hasLocalEdits(status: StatusResponse): boolean {
  const tracked = (entry: { status: string }): boolean => entry.status !== '?';
  return status.staged.some(tracked) || status.unstaged.some(tracked);
}

/**
 * True when a fetch has just found commits that can be taken with no decision
 * to make.
 */
export function shouldAutoPull(status: StatusResponse | null): boolean {
  if (!status) {
    return false;
  }

  // Nothing to take, or nowhere to take it from.
  if (status.behind <= 0 || status.tracking === '') {
    return false;
  }

  // A detached HEAD has no branch to fast-forward.
  if (status.detached) {
    return false;
  }

  // Local commits mean the pull would merge or rebase rather than fast-forward,
  // and which of those to do is the user's decision, not this one.
  if (status.ahead > 0) {
    return false;
  }

  // Mid-merge, mid-rebase, or already conflicted: the repository is in a state
  // the user is in the middle of resolving. Do not touch it.
  if (status.isMerging || status.isRebasing || status.conflicts.length > 0) {
    return false;
  }

  // Uncommitted work could be overwritten by an incoming change to the same
  // file, so a clean tree is required before anything moves on its own.
  return !hasLocalEdits(status);
}

/** Why the button is off, for the tooltip. Null when it would pull. */
export function autoPullBlockedReason(status: StatusResponse | null): string | null {
  if (!status) {
    return 'No repository is open.';
  }
  if (status.tracking === '') {
    return 'This branch has no upstream to pull from.';
  }
  if (status.behind <= 0) {
    return 'This branch is not behind its upstream.';
  }
  if (status.detached) {
    return 'HEAD is detached, so there is no branch to fast-forward.';
  }
  if (status.ahead > 0) {
    return 'This branch has commits of its own, so a pull would not be a fast-forward.';
  }
  if (status.isMerging || status.isRebasing || status.conflicts.length > 0) {
    return 'An operation is in progress in this repository.';
  }
  if (hasLocalEdits(status)) {
    return 'There are uncommitted changes.';
  }
  return null;
}
