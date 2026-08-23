// What Pull will actually do.
//
// The server runs a bare `git pull origin <branch>`, so whether you get a
// fast-forward, a merge commit, or your commits replayed is decided by
// `pull.rebase` and `pull.ff` -- configuration this application never read and
// never showed. Pressing Pull could do any of three things to your history and
// said nothing about which.
//
// Pure, so every combination can be checked without a repository, which is the
// only way the rarer ones get covered at all.
import { describe, expect, it } from 'vitest';

import { describePullStrategy, resolvePullStrategy } from '../src/shared/pull-strategy';

describe('resolving what a pull will do', () => {
  it('says up to date when there is nothing to fetch', () => {
    // No configuration can change this, so it is decided before any is read.
    expect(resolvePullStrategy({ behind: 0, ahead: 0 })).toBe('up-to-date');
    expect(resolvePullStrategy({ behind: 0, ahead: 3, pullRebase: 'true' })).toBe('up-to-date');
  });

  it('fast-forwards when you have no commits of your own', () => {
    // The common case, and the one where nothing can go wrong -- worth saying
    // plainly rather than leaving the user to hope.
    for (const config of [
      {},
      { pullRebase: 'true' },
      { pullRebase: 'false' },
      { pullFf: 'only' }
    ]) {
      expect(resolvePullStrategy({ behind: 4, ahead: 0, ...config })).toBe('fast-forward');
    }
  });

  describe('once the branch has diverged, the configuration decides', () => {
    const diverged = { behind: 2, ahead: 3 };

    it('merges by default', () => {
      expect(resolvePullStrategy(diverged)).toBe('merge');
      expect(resolvePullStrategy({ ...diverged, pullRebase: 'false' })).toBe('merge');
    });

    it('rebases when pull.rebase says so, in any of git truthy spellings', () => {
      for (const value of ['true', '1', 'yes', 'on', 'TRUE', ' true ']) {
        expect(resolvePullStrategy({ ...diverged, pullRebase: value }), value).toBe('rebase');
      }
    });

    it('treats pull.rebase=merges as a rebase, because it is one', () => {
      expect(resolvePullStrategy({ ...diverged, pullRebase: 'merges' })).toBe('rebase');
    });

    it('predicts the refusal when pull.ff is only', () => {
      // git declines rather than choosing. Better to say so before the button
      // is pressed than to report it afterwards as a failure.
      expect(resolvePullStrategy({ ...diverged, pullFf: 'only' })).toBe('ff-only-blocked');
    });

    it('lets pull.rebase win over pull.ff, as git does', () => {
      expect(resolvePullStrategy({ ...diverged, pullRebase: 'true', pullFf: 'only' })).toBe(
        'rebase'
      );
    });
  });
});

describe('saying it in words', () => {
  it('names the number of commits, and pluralises them', () => {
    expect(describePullStrategy('fast-forward', 1, 0)).toContain('1 commit.');
    expect(describePullStrategy('fast-forward', 3, 0)).toContain('3 commits');
  });

  it('warns that a rebase gives your commits new identities', () => {
    // The thing a user most needs to know, and the thing a bare "Pull" button
    // never told them.
    expect(describePullStrategy('rebase', 2, 3)).toMatch(/new identities/i);
  });

  it('explains the refusal rather than only naming it', () => {
    const text = describePullStrategy('ff-only-blocked', 2, 3);
    expect(text).toMatch(/pull\.ff/);
    expect(text).toMatch(/refuse/i);
  });

  it('says plainly when nothing will happen', () => {
    expect(describePullStrategy('up-to-date', 0, 0)).toMatch(/nothing to pull/i);
  });
});
