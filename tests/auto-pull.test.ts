// When a fetch is allowed to pull on its own.
//
// The guarantee under test is that an automatic pull is only ever a
// fast-forward: nothing merged, nothing rebased, no conflict raised by a
// command the user did not press, and nothing uncommitted put at risk. Each
// case below is one way that could stop being true.
import { describe, expect, it } from 'vitest';

import { autoPullBlockedReason, shouldAutoPull } from '../src/renderer/features/sync/auto-pull';
import type { StatusResponse } from '../src/shared/api-types';

/** Behind by two, clean, tracking an upstream: the case that should pull. */
function status(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    success: true,
    branch: 'main',
    tracking: 'origin/main',
    ahead: 0,
    behind: 2,
    detached: false,
    noCommits: false,
    staged: [],
    unstaged: [],
    conflicts: [],
    isMerging: false,
    isRebasing: false,
    ...overrides
  };
}

describe('shouldAutoPull', () => {
  it('pulls a clean branch that is purely behind', () => {
    expect(shouldAutoPull(status())).toBe(true);
    expect(autoPullBlockedReason(status())).toBeNull();
  });

  it('does nothing when the branch is already up to date', () => {
    expect(shouldAutoPull(status({ behind: 0 }))).toBe(false);
  });

  it('does nothing without an upstream to pull from', () => {
    expect(shouldAutoPull(status({ tracking: '', behind: 0 }))).toBe(false);
  });

  it('refuses when the branch has commits of its own', () => {
    // Ahead and behind is a merge or a rebase, and which one is the user's
    // decision, not this one.
    expect(shouldAutoPull(status({ ahead: 1 }))).toBe(false);
    expect(autoPullBlockedReason(status({ ahead: 1 }))).toMatch(/fast-forward/);
  });

  it('refuses on a detached HEAD, which has no branch to move', () => {
    expect(shouldAutoPull(status({ detached: true, branch: '(detached)' }))).toBe(false);
  });

  it('refuses while a merge or rebase is in progress', () => {
    expect(shouldAutoPull(status({ isMerging: true }))).toBe(false);
    expect(shouldAutoPull(status({ isRebasing: true }))).toBe(false);
  });

  it('refuses while anything is conflicted', () => {
    expect(shouldAutoPull(status({ conflicts: [{ path: 'a.txt', status: 'UU' }] }))).toBe(false);
  });

  it('refuses when tracked files have uncommitted edits', () => {
    // An incoming change to the same file would be landing on top of work the
    // user has not committed.
    expect(shouldAutoPull(status({ unstaged: [{ path: 'a.txt', status: 'M' }] }))).toBe(false);
    expect(
      shouldAutoPull(status({ staged: [{ path: 'a.txt', status: 'M', origPath: null }] }))
    ).toBe(false);
    expect(autoPullBlockedReason(status({ unstaged: [{ path: 'a.txt', status: 'M' }] }))).toMatch(
      /uncommitted/
    );
  });

  it('still pulls with untracked files lying around', () => {
    // They are not changes to the branch, and requiring a spotless folder would
    // mean this almost never fires. Git refuses on its own in the one case
    // where an incoming file would land on an untracked one.
    expect(shouldAutoPull(status({ unstaged: [{ path: 'scratch.txt', status: '?' }] }))).toBe(true);
  });

  it('does nothing before a repository is open', () => {
    expect(shouldAutoPull(null)).toBe(false);
    expect(autoPullBlockedReason(null)).toMatch(/No repository/);
  });
});

describe('autoPullBlockedReason', () => {
  it('names the upstream before the count, since that is the more basic gap', () => {
    expect(autoPullBlockedReason(status({ tracking: '' }))).toMatch(/no upstream/);
  });

  it('explains an in-progress operation without guessing which', () => {
    expect(autoPullBlockedReason(status({ isRebasing: true }))).toMatch(/in progress/);
  });
});
