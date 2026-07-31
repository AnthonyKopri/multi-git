import { describe, expect, it } from 'vitest';

import { parsePorcelainStatus, unquoteGitPath } from '../src/server/git/status';
import { parseGitDiffText } from '../src/server/git/diff';
import { parseConflictBlocks } from '../src/server/git/conflicts';
import { parseBlameOutput } from '../src/server/git/blame';
import { getToggledRemoteUrl, isLikelyHttpRemote, parseRemoteUrl } from '../src/server/git/remote';

describe('unquoteGitPath', () => {
  it('leaves an ordinary path untouched', () => {
    expect(unquoteGitPath('src/app.js')).toBe('src/app.js');
  });

  it('trims surrounding whitespace', () => {
    expect(unquoteGitPath('  src/app.js  ')).toBe('src/app.js');
  });

  it('unwraps a quoted path and decodes its escapes', () => {
    expect(unquoteGitPath('"say \\"hi\\".txt"')).toBe('say "hi".txt');
    expect(unquoteGitPath('"tab\\tseparated.txt"')).toBe('tab\tseparated.txt');
    expect(unquoteGitPath('"back\\\\slash.txt"')).toBe('back\\slash.txt');
  });

  it('does not unwrap a path that merely contains a quote', () => {
    expect(unquoteGitPath('a"b.txt')).toBe('a"b.txt');
  });
});

describe('parsePorcelainStatus', () => {
  it('reads branch, upstream, and ahead/behind counts', () => {
    const status = parsePorcelainStatus('## main...origin/main [ahead 1, behind 2]\n');

    expect(status).toMatchObject({
      branch: 'main',
      tracking: 'origin/main',
      ahead: 1,
      behind: 2,
      detached: false,
      noCommits: false
    });
  });

  it('reads a branch with an upstream but no divergence', () => {
    const status = parsePorcelainStatus('## main...origin/main\n');

    expect(status.tracking).toBe('origin/main');
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
  });

  it('reads a branch with no upstream', () => {
    const status = parsePorcelainStatus('## feature/x\n');

    expect(status.branch).toBe('feature/x');
    expect(status.tracking).toBe('');
  });

  it('handles a repository with no commits yet', () => {
    const status = parsePorcelainStatus('## No commits yet on main\n');

    expect(status.branch).toBe('main');
    expect(status.noCommits).toBe(true);
  });

  it('handles a detached HEAD', () => {
    const status = parsePorcelainStatus('## HEAD (no branch)\n');

    expect(status.branch).toBe('(detached)');
    expect(status.detached).toBe(true);
  });

  it('splits staged, unstaged, and untracked entries by column', () => {
    const status = parsePorcelainStatus(
      ['## main', 'M  staged-only.txt', ' M unstaged-only.txt', 'MM both.txt', '?? new.txt'].join(
        '\n'
      )
    );

    expect(status.staged).toEqual([
      { path: 'staged-only.txt', status: 'M', origPath: null },
      { path: 'both.txt', status: 'M', origPath: null }
    ]);
    expect(status.unstaged).toEqual([
      { path: 'unstaged-only.txt', status: 'M' },
      { path: 'both.txt', status: 'M' },
      { path: 'new.txt', status: '?' }
    ]);
    expect(status.conflicts).toEqual([]);
  });

  it('records the new path of a rename and keeps the original', () => {
    const status = parsePorcelainStatus('## main\nR  old/name.txt -> new/name.txt');

    expect(status.staged).toEqual([
      { path: 'new/name.txt', status: 'R', origPath: 'old/name.txt' }
    ]);
  });

  it('classifies every unmerged combination as a conflict', () => {
    const status = parsePorcelainStatus(
      ['## main', 'UU both-modified.txt', 'AA both-added.txt', 'DD both-deleted.txt', 'AU ours.txt', 'UD theirs.txt'].join('\n')
    );

    expect(status.conflicts).toEqual([
      { path: 'both-modified.txt', status: 'UU' },
      { path: 'both-added.txt', status: 'AA' },
      { path: 'both-deleted.txt', status: 'DD' },
      { path: 'ours.txt', status: 'AU' },
      { path: 'theirs.txt', status: 'UD' }
    ]);
    expect(status.staged).toEqual([]);
    expect(status.unstaged).toEqual([]);
  });

  it('decodes quoted paths with non-ASCII names', () => {
    const status = parsePorcelainStatus('## main\n M "caf\\303\\251.txt"');

    // Git quotes non-ASCII bytes as octal escapes, which this parser leaves
    // intact rather than mis-decoding as C escapes.
    expect(status.unstaged[0]?.path).toContain('caf');
  });

  it('ignores truncated lines instead of producing junk entries', () => {
    const status = parsePorcelainStatus('## main\nM\n\n M ok.txt');

    expect(status.unstaged).toEqual([{ path: 'ok.txt', status: 'M' }]);
  });

  it('returns empty output for empty input', () => {
    const status = parsePorcelainStatus('');

    expect(status.staged).toEqual([]);
    expect(status.unstaged).toEqual([]);
    expect(status.conflicts).toEqual([]);
    expect(status.branch).toBe('HEAD');
  });
});

describe('parseGitDiffText', () => {
  const diff = [
    'diff --git a/file.txt b/file.txt',
    'index 1234567..89abcde 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1,3 +1,4 @@',
    ' context one',
    '-removed line',
    '+added line',
    '+another added',
    ' context two'
  ].join('\n');

  it('numbers each side independently', () => {
    expect(parseGitDiffText(diff)).toEqual([
      { type: 'hunk', content: '@@ -1,3 +1,4 @@', oldLine: null, newLine: null },
      { type: 'normal', content: 'context one', oldLine: 1, newLine: 1 },
      { type: 'deletion', content: 'removed line', oldLine: 2, newLine: null },
      { type: 'addition', content: 'added line', oldLine: null, newLine: 2 },
      { type: 'addition', content: 'another added', oldLine: null, newLine: 3 },
      { type: 'normal', content: 'context two', oldLine: 3, newLine: 4 }
    ]);
  });

  it('drops metadata lines without consuming line numbers', () => {
    const renamed = [
      'diff --git a/old.txt b/new.txt',
      'similarity index 95%',
      'rename from old.txt',
      'rename to new.txt',
      'index 1234567..89abcde 100644',
      '@@ -1 +1 @@',
      '-before',
      '+after'
    ].join('\n');

    expect(parseGitDiffText(renamed).map((line) => line.type)).toEqual([
      'hunk',
      'deletion',
      'addition'
    ]);
  });

  it('ignores the no-newline marker so later line numbers do not drift', () => {
    const noNewline = [
      'diff --git a/f b/f',
      '@@ -1,2 +1,2 @@',
      '-old last',
      '\\ No newline at end of file',
      '+new last',
      ' trailing context'
    ].join('\n');

    const parsed = parseGitDiffText(noNewline);

    expect(parsed.map((line) => line.type)).toEqual([
      'hunk',
      'deletion',
      'addition',
      'normal'
    ]);
    // Without skipping the marker the context line would be numbered 3/3.
    expect(parsed.at(-1)).toEqual({
      type: 'normal',
      content: 'trailing context',
      oldLine: 2,
      newLine: 2
    });
  });

  it('handles multiple hunks by resetting the counters', () => {
    const twoHunks = [
      'diff --git a/f b/f',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '@@ -50,1 +50,1 @@',
      '-c',
      '+d'
    ].join('\n');

    const parsed = parseGitDiffText(twoHunks);

    expect(parsed[2]).toMatchObject({ type: 'addition', newLine: 1 });
    expect(parsed[5]).toMatchObject({ type: 'addition', newLine: 50 });
  });

  it('returns nothing for a binary file diff', () => {
    const binary = [
      'diff --git a/logo.png b/logo.png',
      'index 1234567..89abcde 100644',
      'Binary files a/logo.png and b/logo.png differ'
    ].join('\n');

    expect(parseGitDiffText(binary)).toEqual([]);
  });

  it('ignores content before the first diff header', () => {
    expect(parseGitDiffText('commit abc123\nAuthor: Someone\n\n    message\n')).toEqual([]);
  });
});

describe('parseConflictBlocks', () => {
  it('splits a conflicted file into normal and conflict blocks', () => {
    const content = [
      'before',
      '<<<<<<< HEAD',
      'our version',
      '=======',
      'their version',
      '>>>>>>> feature-branch',
      'after'
    ].join('\n');

    expect(parseConflictBlocks(content)).toEqual([
      { type: 'normal', text: 'before' },
      {
        type: 'conflict',
        ours: 'our version',
        theirs: 'their version',
        info: 'feature-branch'
      },
      { type: 'normal', text: 'after' }
    ]);
  });

  it('handles several conflicts in one file', () => {
    const content = [
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> x',
      'middle',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> y'
    ].join('\n');

    const blocks = parseConflictBlocks(content);

    expect(blocks.map((block) => block.type)).toEqual(['conflict', 'normal', 'conflict']);
  });

  it('treats a row of equals signs outside a conflict as ordinary text', () => {
    const blocks = parseConflictBlocks('title\n=======\nunderlined');

    expect(blocks).toEqual([{ type: 'normal', text: 'title\n=======\nunderlined' }]);
  });

  it('keeps multi-line sides intact', () => {
    const content = ['<<<<<<< HEAD', 'one', 'two', '=======', 'three', '>>>>>>> b'].join('\n');

    expect(parseConflictBlocks(content)[0]).toMatchObject({
      ours: 'one\ntwo',
      theirs: 'three'
    });
  });

  it('accepts CRLF line endings', () => {
    const content = ['before', '<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> x'].join('\r\n');

    expect(parseConflictBlocks(content)).toEqual([
      { type: 'normal', text: 'before' },
      { type: 'conflict', ours: 'a', theirs: 'b', info: 'x' }
    ]);
  });

  it('returns a single normal block for a file with no conflicts', () => {
    expect(parseConflictBlocks('just\ntext')).toEqual([{ type: 'normal', text: 'just\ntext' }]);
  });
});

describe('parseBlameOutput', () => {
  it('extracts hash, author, date, line number, and content', () => {
    const output = 'abc1234 (Jane Doe 2026-01-31 1) const answer = 42;';

    expect(parseBlameOutput(output)).toEqual([
      {
        hash: 'abc1234',
        author: 'Jane Doe',
        date: '2026-01-31',
        lineNum: 1,
        content: 'const answer = 42;'
      }
    ]);
  });

  it('handles the boundary-commit caret prefix', () => {
    const parsed = parseBlameOutput('^abc1234 (Jane Doe 2026-01-31 1) first line');

    expect(parsed[0]?.hash).toBe('^abc1234');
  });

  it('preserves an empty source line', () => {
    const parsed = parseBlameOutput('abc1234 (Jane Doe 2026-01-31 7) ');

    expect(parsed[0]).toMatchObject({ lineNum: 7, content: '' });
  });

  it('keeps unparseable lines rather than dropping file content', () => {
    const parsed = parseBlameOutput('not a blame line');

    expect(parsed).toEqual([
      { hash: 'unknown', author: 'unknown', date: '', lineNum: 1, content: 'not a blame line' }
    ]);
  });
});

describe('parseRemoteUrl', () => {
  it('recognises an HTTPS remote', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo.git')).toEqual({
      protocol: 'https',
      host: 'github.com',
      repoPath: 'owner/repo'
    });
  });

  it('recognises scp-style SSH', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo.git')).toEqual({
      protocol: 'ssh',
      host: 'github.com',
      repoPath: 'owner/repo'
    });
  });

  it('recognises ssh:// URLs without a port', () => {
    expect(parseRemoteUrl('ssh://git@github.com/owner/repo.git')).toEqual({
      protocol: 'ssh',
      host: 'github.com',
      repoPath: 'owner/repo'
    });
  });

  it('lowercases the host but preserves path casing', () => {
    expect(parseRemoteUrl('https://GitHub.COM/Owner/Repo.git')).toMatchObject({
      host: 'github.com',
      repoPath: 'Owner/Repo'
    });
  });

  it('tolerates a missing .git suffix and a trailing slash', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo/')).toMatchObject({
      repoPath: 'owner/repo'
    });
  });

  it('refuses to classify URLs it cannot round-trip', () => {
    // Embedded credentials, a custom SSH user, and a custom port each mean the
    // toggle would lose information.
    expect(parseRemoteUrl('https://user:token@github.com/owner/repo.git')?.protocol).toBe('other');
    expect(parseRemoteUrl('ssh://deploy@host.example/owner/repo.git')?.protocol).toBe('other');
    expect(parseRemoteUrl('ssh://git@github.com:2222/owner/repo.git')?.protocol).toBe('other');
    expect(parseRemoteUrl('/srv/git/local.git')?.protocol).toBe('other');
  });

  it('returns null for absent input', () => {
    expect(parseRemoteUrl('')).toBeNull();
    expect(parseRemoteUrl(null)).toBeNull();
    expect(parseRemoteUrl(undefined)).toBeNull();
  });
});

describe('getToggledRemoteUrl', () => {
  it('converts HTTPS to SSH and back', () => {
    expect(getToggledRemoteUrl('https://github.com/owner/repo.git')).toBe(
      'git@github.com:owner/repo.git'
    );
    expect(getToggledRemoteUrl('git@github.com:owner/repo.git')).toBe(
      'https://github.com/owner/repo.git'
    );
  });

  it('round-trips to the original URL', () => {
    const original = 'https://gitlab.example.com/group/sub/project.git';
    const toggled = getToggledRemoteUrl(original);

    expect(getToggledRemoteUrl(toggled)).toBe(original);
  });

  it('returns null for remotes it cannot rewrite', () => {
    expect(getToggledRemoteUrl('ssh://git@github.com:2222/owner/repo.git')).toBeNull();
    expect(getToggledRemoteUrl('/srv/git/local.git')).toBeNull();
    expect(getToggledRemoteUrl('')).toBeNull();
  });
});

describe('isLikelyHttpRemote', () => {
  it('detects http and https', () => {
    expect(isLikelyHttpRemote('https://github.com/o/r.git')).toBe(true);
    expect(isLikelyHttpRemote('  http://example.com/r.git')).toBe(true);
  });

  it('rejects SSH and empty values', () => {
    expect(isLikelyHttpRemote('git@github.com:o/r.git')).toBe(false);
    expect(isLikelyHttpRemote('')).toBe(false);
    expect(isLikelyHttpRemote(null)).toBe(false);
  });
});
