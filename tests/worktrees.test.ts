// Worktree parsing and placement rules. No git process involved.
//
// The porcelain fixtures below are real `git worktree list` output, captured
// from git 2.55 on Windows, in both the newline and the NUL form. The two
// differ in more than the separator — the newline form quotes a lock reason
// and the NUL form does not — which is the whole reason both are parsed.
import { describe, expect, it } from 'vitest';
import path from 'node:path';

import {
  findPlacementConflict,
  isDirty,
  parseWorktreePorcelain,
  suggestWorktreeParent,
  suggestWorktreePath,
  worktreeFolderName
} from '../src/server/git/worktrees';

const OID = 'aa696a17eadd68fd8d98001239dac9feb2075842';

const isWindows = process.platform === 'win32';

/**
 * An absolute path on either platform.
 *
 * `path.join('D:', 'work')` is a drive-relative path on Windows and an
 * ordinary *relative* one on POSIX, where `D:` is just a folder name. The
 * placement rules resolve both sides so they do not care, but anything
 * comparing against a resolved result does — which is how the suggested-parent
 * test passed on Windows and failed on Linux.
 */
function abs(...segments: string[]): string {
  return path.join(isWindows ? 'D:\\' : '/', ...segments);
}

/** Newline form: records separated by a blank line, lock reason quoted. */
const NEWLINE_FIXTURE = [
  'worktree C:/tmp/mgwt/main',
  `HEAD ${OID}`,
  'branch refs/heads/main',
  '',
  'worktree C:/tmp/mgwt/wt one',
  `HEAD ${OID}`,
  'branch refs/heads/feature/login',
  '',
  'worktree C:/tmp/mgwt/wt-detached',
  `HEAD ${OID}`,
  'detached',
  'prunable gitdir file points to non-existent location',
  '',
  'worktree C:/tmp/mgwt/wt-locked',
  `HEAD ${OID}`,
  'branch refs/heads/locked-br',
  'locked "busy\\nline two"',
  ''
].join('\n');

/** NUL form: the same family, lock reason raw, so a newline survives in it. */
const NUL_FIXTURE = [
  'worktree C:/tmp/mgwt/main',
  `HEAD ${OID}`,
  'branch refs/heads/main',
  '',
  'worktree C:/tmp/mgwt/wt one',
  `HEAD ${OID}`,
  'branch refs/heads/feature/login',
  '',
  'worktree C:/tmp/mgwt/wt-detached',
  `HEAD ${OID}`,
  'detached',
  'prunable gitdir file points to non-existent location',
  '',
  'worktree C:/tmp/mgwt/wt-locked',
  `HEAD ${OID}`,
  'branch refs/heads/locked-br',
  'locked busy\nline two',
  ''
].join('\0');

describe('parseWorktreePorcelain', () => {
  it('reads the newline form git 2.35 and older produce', () => {
    const worktrees = parseWorktreePorcelain(NEWLINE_FIXTURE, { nulSeparated: false });

    expect(worktrees).toHaveLength(4);
    expect(worktrees[0]).toMatchObject({
      path: 'C:/tmp/mgwt/main',
      head: OID,
      branch: 'refs/heads/main',
      isMain: true,
      detached: false,
      locked: false,
      prunable: false
    });
  });

  it('reads the NUL form, which is the only one safe for odd paths', () => {
    const worktrees = parseWorktreePorcelain(NUL_FIXTURE, { nulSeparated: true });
    expect(worktrees.map((worktree) => worktree.path)).toEqual([
      'C:/tmp/mgwt/main',
      'C:/tmp/mgwt/wt one',
      'C:/tmp/mgwt/wt-detached',
      'C:/tmp/mgwt/wt-locked'
    ]);
  });

  it('marks only the first record as the main worktree', () => {
    const worktrees = parseWorktreePorcelain(NUL_FIXTURE, { nulSeparated: true });
    expect(worktrees.filter((worktree) => worktree.isMain)).toHaveLength(1);
    expect(worktrees[0]?.isMain).toBe(true);
  });

  it('keeps a path containing a space intact', () => {
    const worktrees = parseWorktreePorcelain(NUL_FIXTURE, { nulSeparated: true });
    expect(worktrees[1]?.path).toBe('C:/tmp/mgwt/wt one');
  });

  it('reads a detached worktree as having no branch', () => {
    const detached = parseWorktreePorcelain(NUL_FIXTURE, { nulSeparated: true })[2];
    expect(detached?.detached).toBe(true);
    expect(detached?.branch).toBeUndefined();
  });

  it('carries the prunable reason, not just the flag', () => {
    const prunable = parseWorktreePorcelain(NUL_FIXTURE, { nulSeparated: true })[2];
    expect(prunable?.prunable).toBe(true);
    expect(prunable?.prunableReason).toBe('gitdir file points to non-existent location');
  });

  it('unquotes a multi-line lock reason in the newline form', () => {
    const locked = parseWorktreePorcelain(NEWLINE_FIXTURE, { nulSeparated: false })[3];
    expect(locked?.locked).toBe(true);
    expect(locked?.lockReason).toBe('busy\nline two');
  });

  it('takes the lock reason verbatim in the NUL form', () => {
    // Git does not quote in -z mode, so unquoting here would corrupt a reason
    // that legitimately contains a backslash.
    const locked = parseWorktreePorcelain(NUL_FIXTURE, { nulSeparated: true })[3];
    expect(locked?.lockReason).toBe('busy\nline two');
  });

  it('reads a lock with no reason as locked all the same', () => {
    const output = ['worktree /tmp/a', `HEAD ${OID}`, 'branch refs/heads/a', 'locked', ''].join('\0');
    const [worktree] = parseWorktreePorcelain(output, { nulSeparated: true });

    expect(worktree?.locked).toBe(true);
    expect(worktree?.lockReason).toBeUndefined();
  });

  it('reads a bare repository, which has no HEAD', () => {
    const output = ['worktree /tmp/bare-source', 'bare', ''].join('\0');
    const [worktree] = parseWorktreePorcelain(output, { nulSeparated: true });

    expect(worktree).toMatchObject({ path: '/tmp/bare-source', bare: true, head: '' });
  });

  it('survives a path containing a newline, which is why -z exists', () => {
    const output = ['worktree /tmp/two\nlines', `HEAD ${OID}`, 'detached', ''].join('\0');
    const [worktree] = parseWorktreePorcelain(output, { nulSeparated: true });

    expect(worktree?.path).toBe('/tmp/two\nlines');
  });

  it('strips the carriage returns a Windows pipe adds in newline mode', () => {
    const output = `worktree C:/tmp/a\r\nHEAD ${OID}\r\nbranch refs/heads/a\r\n\r\n`;
    const [worktree] = parseWorktreePorcelain(output, { nulSeparated: false });

    expect(worktree?.path).toBe('C:/tmp/a');
    expect(worktree?.branch).toBe('refs/heads/a');
  });

  it('ignores an attribute a newer git might add', () => {
    // A git upgrade must not be able to break the listing.
    const output = ['worktree /tmp/a', `HEAD ${OID}`, 'something-new value', ''].join('\0');
    expect(parseWorktreePorcelain(output, { nulSeparated: true })).toHaveLength(1);
  });

  it('returns nothing for empty output rather than a blank record', () => {
    expect(parseWorktreePorcelain('', { nulSeparated: true })).toEqual([]);
    expect(parseWorktreePorcelain('\0\0', { nulSeparated: true })).toEqual([]);
  });
});

describe('findPlacementConflict', () => {
  const existing = [abs('work', 'app'), abs('work', 'app.worktrees', 'login')];

  it('accepts a path that overlaps nothing', () => {
    expect(findPlacementConflict(abs('work', 'app.worktrees', 'billing'), existing)).toBeNull();
  });

  it('rejects a path that is already a worktree', () => {
    expect(findPlacementConflict(abs('work', 'app'), existing)).toMatch(/already a worktree/);
  });

  it('rejects a path inside the repository itself', () => {
    // The case a user reaches for first, and the one git handles worst.
    const conflict = findPlacementConflict(abs('work', 'app', 'wt', 'login'), existing);
    expect(conflict).toMatch(/nested/i);
    expect(conflict).toContain(abs('work', 'app'));
  });

  it('rejects a path that would contain an existing worktree', () => {
    expect(findPlacementConflict(abs('work', 'app.worktrees'), existing)).toMatch(/nested/i);
  });

  it('does not mistake a sibling with a shared prefix for a child', () => {
    // `app.worktrees` starts with `app` but is not inside it.
    expect(findPlacementConflict(abs('work', 'app-two'), [abs('work', 'app')])).toBeNull();
  });

  it('sees through a difference in case on Windows', () => {
    const conflict = findPlacementConflict(path.join('d:', 'WORK', 'app'), existing);
    expect(process.platform === 'win32' ? conflict : 'skipped').toBeTruthy();
  });

  it('rejects a path that is not a path at all', () => {
    expect(findPlacementConflict('   ', existing)).toMatch(/not a usable folder/i);
  });
});

describe('worktreeFolderName', () => {
  it('flattens a branch with slashes into one folder name', () => {
    expect(worktreeFolderName('feature/login')).toBe('feature-login');
    expect(worktreeFolderName('refs/heads/feature/login')).toBe('feature-login');
  });

  it('removes characters Windows refuses in a folder name', () => {
    expect(worktreeFolderName('fix:crash?now')).toBe('fix-crash-now');
  });

  it('collapses spaces rather than producing a quoted path', () => {
    expect(worktreeFolderName('my branch name')).toBe('my-branch-name');
  });

  it('never produces a name starting or ending with a dot', () => {
    // A trailing dot is silently dropped by Windows, which would create a
    // folder with a different name than the one reported.
    expect(worktreeFolderName('.hidden.')).toBe('hidden');
  });

  it('falls back to a usable name when nothing survives', () => {
    expect(worktreeFolderName('///')).toBe('worktree');
  });
});

describe('suggesting where a worktree goes', () => {
  it('defaults to a sibling folder named after the repository', () => {
    const main = abs('work', 'app');
    expect(suggestWorktreeParent(main)).toBe(abs('work', 'app.worktrees'));
    expect(suggestWorktreePath(main, 'feature/login')).toBe(
      abs('work', 'app.worktrees', 'feature-login')
    );
  });

  it('never suggests a location inside the repository', () => {
    const main = abs('work', 'app');
    const suggestion = suggestWorktreePath(main, 'x');

    expect(findPlacementConflict(suggestion, [main])).toBeNull();
  });

  it('uses a configured parent when the user set one', () => {
    const suggestion = suggestWorktreePath(
      abs('work', 'app'),
      'feature/login',
      abs('trees')
    );
    expect(suggestion).toBe(abs('trees', 'feature-login'));
  });
});

describe('isDirty', () => {
  const clean = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    ahead: 0,
    behind: 0,
    tracking: ''
  };

  it('treats a worktree with nothing in it as clean', () => {
    expect(isDirty(clean)).toBe(false);
  });

  it('treats unknown status as clean, so a missing folder is not blocked', () => {
    expect(isDirty(null)).toBe(false);
  });

  it('counts untracked files as work worth protecting', () => {
    // A new file nobody has staged is the easiest thing to lose.
    expect(isDirty({ ...clean, untracked: 1 })).toBe(true);
  });

  it('counts staged, unstaged and conflicted entries', () => {
    expect(isDirty({ ...clean, staged: 1 })).toBe(true);
    expect(isDirty({ ...clean, unstaged: 1 })).toBe(true);
    expect(isDirty({ ...clean, conflicts: 1 })).toBe(true);
  });

  it('does not treat being ahead of the remote as dirty', () => {
    // Committed work is in the shared object store already; removing the
    // worktree does not lose it.
    expect(isDirty({ ...clean, ahead: 3, behind: 2 })).toBe(false);
  });
});
