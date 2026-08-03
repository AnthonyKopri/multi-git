// Pure logic extracted from the renderer. No DOM involved.
import { describe, expect, it } from 'vitest';

import {
  COMMIT_TYPES,
  applyCommitType,
  shouldShowFormatHint
} from '../src/renderer/features/commit/conventional';
import {
  hasConflictMarkers,
  resolveConflictText
} from '../src/renderer/features/conflicts/resolve-text';
import { buildTree, indexTree, sortedChildren } from '../src/renderer/features/explorer/file-tree';
import { diffEntriesFor, findDiffEntry } from '../src/renderer/features/staging/file-list';
import { profileColor, repoBaseName, statusLabel } from '../src/renderer/ui/format';
import { PANE_SPECS, clampPaneSize } from '../src/renderer/ui/panes';
import type { StatusResponse } from '../src/shared/api-types';

describe('applyCommitType', () => {
  it('prefixes an empty message', () => {
    expect(applyCommitType('', 'feat', '')).toBe('feat: ');
  });

  it('includes a scope when given one', () => {
    expect(applyCommitType('add login', 'feat', 'auth')).toBe('feat(auth): add login');
  });

  it('replaces an existing prefix instead of stacking', () => {
    // Clicking fix after feat must not produce "fix: feat: ...".
    expect(applyCommitType('feat: add login', 'fix', '')).toBe('fix: add login');
    expect(applyCommitType('feat(auth): add login', 'fix', '')).toBe('fix: add login');
    expect(applyCommitType('feat(auth)!: add login', 'fix', 'ui')).toBe('fix(ui): add login');
  });

  it('leaves a non-conventional message body intact', () => {
    expect(applyCommitType('just some text', 'docs', '')).toBe('docs: just some text');
  });

  it('only treats a lowercase prefix as conventional', () => {
    // The spec's types are lowercase, so "WIP:" is prose, not a prefix to
    // replace. Stripping it would silently discard what the user wrote.
    expect(applyCommitType('WIP: something', 'chore', '')).toBe('chore: WIP: something');
  });

  it('trims a padded scope', () => {
    expect(applyCommitType('x', 'feat', '  auth  ')).toBe('feat(auth): x');
  });

  it('offers the documented set of types', () => {
    expect(COMMIT_TYPES).toEqual(['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'style', 'perf']);
  });
});

describe('shouldShowFormatHint', () => {
  it('stays quiet for short messages', () => {
    expect(shouldShowFormatHint('wip')).toBe(false);
    expect(shouldShowFormatHint('')).toBe(false);
  });

  it('stays quiet for a conventional message of any length', () => {
    expect(shouldShowFormatHint('feat: add a considerably longer message')).toBe(false);
    expect(shouldShowFormatHint('fix(scope)!: breaking change here')).toBe(false);
  });

  it('nudges on a long non-conventional message', () => {
    expect(shouldShowFormatHint('this is a long message with no prefix')).toBe(true);
  });
});

describe('resolveConflictText', () => {
  const conflicted = [
    'before',
    '<<<<<<< HEAD',
    'our line',
    '=======',
    'their line',
    '>>>>>>> feature',
    'after'
  ].join('\n');

  it('keeps our side', () => {
    expect(resolveConflictText(conflicted, 'ours')).toBe('before\nour line\nafter');
  });

  it('keeps their side', () => {
    expect(resolveConflictText(conflicted, 'theirs')).toBe('before\ntheir line\nafter');
  });

  it('resolves every group, not just the first', () => {
    const two = [
      '<<<<<<< HEAD',
      'a1',
      '=======',
      'b1',
      '>>>>>>> x',
      'middle',
      '<<<<<<< HEAD',
      'a2',
      '=======',
      'b2',
      '>>>>>>> x'
    ].join('\n');

    expect(resolveConflictText(two, 'ours')).toBe('a1\nmiddle\na2');
  });

  it('handles CRLF files', () => {
    const crlf = ['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> x'].join('\r\n');
    expect(resolveConflictText(crlf, 'theirs')).toBe('theirs');
  });

  it('handles multi-line sides', () => {
    const multi = ['<<<<<<< HEAD', 'a', 'b', '=======', 'c', '>>>>>>> x'].join('\n');
    expect(resolveConflictText(multi, 'ours')).toBe('a\nb');
  });

  it('leaves a file with no conflicts unchanged', () => {
    expect(resolveConflictText('plain text', 'ours')).toBe('plain text');
  });
});

describe('hasConflictMarkers', () => {
  it('detects unresolved markers', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x')).toBe(true);
  });

  it('accepts resolved text', () => {
    expect(hasConflictMarkers('merged result')).toBe(false);
  });
});

describe('buildTree', () => {
  const files = [
    { path: 'README.md', untracked: false },
    { path: 'src/app.ts', untracked: false },
    { path: 'src/ui/button.ts', untracked: false },
    { path: 'src/ui/input.ts', untracked: true },
    { path: 'docs/guide.md', untracked: false }
  ];

  it('groups paths into directories', () => {
    const root = buildTree(files);
    const names = sortedChildren(root).map((node) => node.name);

    // Directories first, then files, each alphabetical.
    expect(names).toEqual(['docs', 'src', 'README.md']);
  });

  it('nests deeply', () => {
    const index = indexTree(buildTree(files));

    expect(index.get('src/ui')?.type).toBe('directory');
    expect(index.get('src/ui/button.ts')?.type).toBe('file');
    expect(index.get('src/ui/input.ts')?.untracked).toBe(true);
  });

  it('records full paths on every node', () => {
    const index = indexTree(buildTree(files));

    expect([...index.keys()].sort()).toEqual([
      'README.md',
      'docs',
      'docs/guide.md',
      'src',
      'src/app.ts',
      'src/ui',
      'src/ui/button.ts',
      'src/ui/input.ts'
    ]);
  });

  it('handles an empty repository', () => {
    expect(sortedChildren(buildTree([]))).toEqual([]);
  });

  it('does not confuse a file and a directory of the same name at different depths', () => {
    const index = indexTree(
      buildTree([
        { path: 'build', untracked: false },
        { path: 'src/build/out.ts', untracked: false }
      ])
    );

    expect(index.get('build')?.type).toBe('file');
    expect(index.get('src/build')?.type).toBe('directory');
  });
});

describe('diffEntriesFor', () => {
  function status(overrides: Partial<StatusResponse> = {}): StatusResponse {
    return {
      branch: 'main',
      tracking: '',
      ahead: 0,
      behind: 0,
      detached: false,
      noCommits: false,
      staged: [],
      unstaged: [],
      conflicts: [],
      isMerging: false,
      isRebasing: false,
      success: true,
      ...overrides
    };
  }

  it('returns nothing without a status', () => {
    expect(diffEntriesFor(null)).toEqual([]);
  });

  it('orders conflicts, then working tree, then index', () => {
    const entries = diffEntriesFor(
      status({
        conflicts: [{ path: 'c.txt', status: 'UU' }],
        unstaged: [{ path: 'u.txt', status: 'M' }],
        staged: [{ path: 's.txt', status: 'A', origPath: null }]
      })
    );

    expect(entries.map((entry) => entry.scope)).toEqual(['Conflict', 'Unstaged', 'Staged']);
  });

  it('labels untracked files distinctly', () => {
    const entries = diffEntriesFor(status({ unstaged: [{ path: 'new.txt', status: '?' }] }));

    expect(entries[0]?.scope).toBe('Untracked');
  });

  it('lists a conflicted file once, not also as unstaged', () => {
    // git reports a conflicted path in both places.
    const entries = diffEntriesFor(
      status({
        conflicts: [{ path: 'both.txt', status: 'UU' }],
        unstaged: [{ path: 'both.txt', status: 'U' }]
      })
    );

    expect(entries.filter((entry) => entry.path === 'both.txt')).toHaveLength(1);
  });

  it('keeps a file staged and unstaged as two separate entries', () => {
    // A partially staged file is genuinely two things the user can look at.
    const entries = diffEntriesFor(
      status({
        unstaged: [{ path: 'both.txt', status: 'M' }],
        staged: [{ path: 'both.txt', status: 'M', origPath: null }]
      })
    );

    expect(entries).toHaveLength(2);
    expect(findDiffEntry(status({ staged: [{ path: 'x', status: 'M', origPath: null }] }), 'x', true))
      .toMatchObject({ staged: true });
  });
});

describe('format helpers', () => {
  it('labels known status codes', () => {
    expect(statusLabel('M')).toMatchObject({ char: 'M', title: 'Modified' });
    expect(statusLabel('?')).toMatchObject({ title: 'Untracked' });
    expect(statusLabel('U')).toMatchObject({ title: 'Conflict' });
  });

  it('falls back for an unknown code', () => {
    expect(statusLabel('Z')).toMatchObject({ char: 'Z', title: 'Unknown' });
  });

  it('gives each profile a stable colour', () => {
    expect(profileColor('abc')).toBe(profileColor('abc'));
    expect(profileColor('abc')).not.toBe(profileColor('xyz'));
    expect(profileColor('abc')).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
  });

  it('takes the last segment of a repository path', () => {
    expect(repoBaseName('D:/code/my-repo')).toBe('my-repo');
    expect(repoBaseName('D:\\code\\my-repo')).toBe('my-repo');
    expect(repoBaseName('D:/code/my-repo/')).toBe('my-repo');
    expect(repoBaseName(null)).toBe('');
  });
});

describe('clampPaneSize', () => {
  const sidebar = PANE_SPECS.sidebar;

  it('keeps a size that is already in range', () => {
    expect(clampPaneSize(sidebar, 400, 1600)).toBe(400);
  });

  it('holds the panel to its own limits', () => {
    expect(clampPaneSize(sidebar, 10, 1600)).toBe(sidebar.min);
    expect(clampPaneSize(sidebar, 5000, 4000)).toBe(sidebar.max);
  });

  it('gives the pane next to it its reserved space on a narrow window', () => {
    // A size saved on a wide monitor must not push the other panels off a
    // smaller one when it is restored.
    expect(clampPaneSize(sidebar, 600, 700)).toBe(700 - sidebar.reserve);
  });

  it('never inverts the range when the space left is smaller than the reserve', () => {
    expect(clampPaneSize(sidebar, 600, 300)).toBe(sidebar.min);
  });

  it('leaves the centre column usable when both side panels are dragged wide', () => {
    // The two side columns are clamped against each other, so `available`
    // already has the sibling's width taken off it.
    const history = PANE_SPECS.history;
    const window = 1280;

    const sidebarWidth = clampPaneSize(sidebar, 9999, window - history.fallback);
    const historyWidth = clampPaneSize(history, 9999, window - sidebarWidth);

    expect(window - sidebarWidth - historyWidth).toBeGreaterThanOrEqual(history.reserve);
  });

  it('falls back when localStorage holds something that is not a number', () => {
    expect(clampPaneSize(sidebar, Number('not a size'))).toBe(sidebar.fallback);
  });

  it('applies to the vertical panel the same way', () => {
    const commit = PANE_SPECS.commit;
    expect(clampPaneSize(commit, commit.min - 40, 1000)).toBe(commit.min);
    expect(clampPaneSize(commit, 300, 1000)).toBe(300);
  });
});
