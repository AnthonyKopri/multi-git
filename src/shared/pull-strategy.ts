// What `git pull` will actually do here.
//
// The server runs a bare `git pull origin <branch>` -- no `--ff-only`, no
// `--rebase` -- so whether you get a fast-forward, a merge commit, or your
// commits replayed is decided by `pull.rebase` and `pull.ff` in git config.
// This application never read either, so the button could do any of three
// things and said nothing about which.
//
// The irony is that the careful version of this reasoning already existed:
// `shouldAutoPull` in the renderer refuses to pull automatically unless it
// would be a pure fast-forward, and is pure and tested. The automatic path was
// meticulous and the manual one was a shrug. This is the manual path's brain.
//
// Pure on purpose: the configuration and the counts are read by the caller, so
// the rule itself can be proved without a repository on disk.
import type { PullStrategy } from './integrate-types';

export interface PullSituation {
  /** Commits on the upstream that are not here. */
  behind: number;
  /** Commits here that are not upstream. */
  ahead: number;
  /** `pull.rebase`, as git reports it. Absent when unset. */
  pullRebase?: string | undefined;
  /** `pull.ff`, as git reports it. Absent when unset. */
  pullFf?: string | undefined;
}

/** git's own truthiness for a configuration value. */
function isTrue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * Resolves the strategy, in the order git itself decides it.
 *
 * `up-to-date` and `fast-forward` come first because they do not depend on
 * configuration at all: with nothing to fetch there is nothing to integrate,
 * and with no commits of your own the branch simply moves. Those two are the
 * overwhelmingly common cases and the two worth saying plainly, because they
 * are the ones where nothing can go wrong.
 */
export function resolvePullStrategy(situation: PullSituation): PullStrategy {
  if (situation.behind === 0) {
    return 'up-to-date';
  }

  if (situation.ahead === 0) {
    // Nothing of yours to reconcile. Every configuration produces the same
    // outcome here, including ff-only.
    return 'fast-forward';
  }

  // Diverged: this is where the configuration decides, and where the three
  // outcomes actually differ.
  if (isTrue(situation.pullRebase) || situation.pullRebase?.trim().toLowerCase() === 'merges') {
    return 'rebase';
  }

  if (situation.pullFf?.trim().toLowerCase() === 'only') {
    // git refuses rather than choosing for you, which is a refusal worth
    // predicting instead of discovering.
    return 'ff-only-blocked';
  }

  return 'merge';
}

/** What the strategy means, in words a user should not have to look up. */
export function describePullStrategy(strategy: PullStrategy, behind: number, ahead: number): string {
  switch (strategy) {
    case 'up-to-date':
      return 'Already up to date. There is nothing to pull.';
    case 'fast-forward':
      return `Fast-forward: your branch moves forward by ${count(behind, 'commit')}. Nothing is merged or rewritten.`;
    case 'merge':
      return `Merge: ${count(behind, 'incoming commit')} joins ${count(ahead, 'commit')} of your own, and a merge commit records it.`;
    case 'rebase':
      return `Rebase: ${count(ahead, 'commit')} of yours is replayed on top of ${count(behind, 'incoming commit')}. Your commits get new identities.`;
    case 'ff-only-blocked':
      return `Blocked: pull.ff is set to only, and this branch has diverged — ${count(ahead, 'commit')} of yours against ${count(behind, 'incoming')}. Git will refuse rather than choose.`;
  }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
