// What merge and rebase would do, said before they do it.
//
// Opening a pull request changes nothing on your machine and gets a twenty-field
// preflight. Merging and rebasing rewrite your history and got a dropdown and a
// button. Discarding a single file asked you to confirm; rewriting the branch
// did not. These assertions are the corrected half of that inversion.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { integrationPreflight, targetExists } from '../src/server/git/integrate-preflight';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

let repo: string;

beforeEach(() => {
  repo = createRepoWithHistory();
});

afterAll(() => cleanupRepos());

/** A branch off the current HEAD carrying `count` commits of its own. */
function branchWith(name: string, count: number, prefix = 'feature'): void {
  git(repo, 'checkout', '-b', name);

  for (let index = 0; index < count; index++) {
    writeFile(repo, `${prefix}-${index}.txt`, `${prefix} ${index}\n`);
    git(repo, 'add', `${prefix}-${index}.txt`);
    git(repo, 'commit', '-m', `feat: ${prefix} ${index}`);
  }

  git(repo, 'checkout', '-');
}

describe('before a merge', () => {
  it('lists the commits that would arrive, and what they touch', async () => {
    branchWith('feature', 3);

    const preflight = await integrationPreflight({ repoPath: repo, kind: 'merge', target: 'feature' });

    expect(preflight.incoming).toHaveLength(3);
    expect(preflight.incoming[0]?.subject).toBe('feat: feature 2');
    expect(preflight.changedFiles).toBe(3);
  });

  it('says when the branch can simply move forward', async () => {
    // The safest outcome there is, and the one worth stating plainly: nothing
    // is merged, nothing is rewritten.
    branchWith('feature', 2);

    const preflight = await integrationPreflight({ repoPath: repo, kind: 'merge', target: 'feature' });

    expect(preflight.fastForward).toBe(true);
    expect(preflight.outgoing).toHaveLength(0);
  });

  it('says when it cannot, because both sides moved', async () => {
    branchWith('feature', 2);

    writeFile(repo, 'mine.txt', 'my work\n');
    git(repo, 'add', 'mine.txt');
    git(repo, 'commit', '-m', 'feat: mine');

    const preflight = await integrationPreflight({ repoPath: repo, kind: 'merge', target: 'feature' });

    expect(preflight.fastForward).toBe(false);
    expect(preflight.outgoing).toHaveLength(1);
    expect(preflight.incoming).toHaveLength(2);
  });

  it('promises the recovery point it has always quietly taken', async () => {
    // captureCheckpoint has run on every merge and rebase since they existed,
    // and nothing ever told the user. A safety net nobody knows about buys no
    // confidence.
    branchWith('feature', 1);

    const merge = await integrationPreflight({ repoPath: repo, kind: 'merge', target: 'feature' });
    const rebase = await integrationPreflight({ repoPath: repo, kind: 'rebase', target: 'feature' });

    expect(merge.recoveryPoint).toBe(true);
    expect(rebase.recoveryPoint).toBe(true);
  });

  it('says plainly when there is nothing to bring in', async () => {
    git(repo, 'branch', 'same');

    const preflight = await integrationPreflight({ repoPath: repo, kind: 'merge', target: 'same' });

    expect(preflight.incoming).toHaveLength(0);
    expect(preflight.warnings.join(' ')).toMatch(/nothing to bring in/i);
  });
});

describe('before a rebase', () => {
  it('warns that your commits get new object names', async () => {
    // The one thing about a rebase a user has to know, and the sidebar button
    // never said it.
    branchWith('feature', 1);

    writeFile(repo, 'mine.txt', 'my work\n');
    git(repo, 'add', 'mine.txt');
    git(repo, 'commit', '-m', 'feat: mine');

    const preflight = await integrationPreflight({ repoPath: repo, kind: 'rebase', target: 'feature' });

    expect(preflight.warnings.join(' ')).toMatch(/new object names/i);
    expect(preflight.warnings.join(' ')).toMatch(/1 of your commit/);
  });
});

describe('the working tree', () => {
  it('warns about uncommitted work that git may refuse over', async () => {
    branchWith('feature', 1);
    // A tracked file, edited after its commit. An untracked one is covered by
    // the case below, and the distinction is the whole point of the check.
    writeFile(repo, 'README.md', '# Title\n\nedited after the commit\n');

    const preflight = await integrationPreflight({ repoPath: repo, kind: 'merge', target: 'feature' });

    expect(preflight.warnings.join(' ')).toMatch(/uncommitted/i);
    expect(preflight.blocked).toBeUndefined();
  });

  it('ignores untracked files, which cannot be in the way', async () => {
    branchWith('feature', 1);
    writeFile(repo, 'scratch.txt', 'not committed anywhere\n');

    const preflight = await integrationPreflight({ repoPath: repo, kind: 'merge', target: 'feature' });

    expect(preflight.warnings.join(' ')).not.toMatch(/uncommitted/i);
  });

  it('blocks outright while a conflict is unresolved', async () => {
    // Not a warning: nothing can integrate until the repository is out of this
    // state, so offering the button would be offering a failure.
    branchWith('left', 0);
    git(repo, 'checkout', '-b', 'conflicting');
    writeFile(repo, 'shared.txt', 'theirs\n');
    git(repo, 'add', 'shared.txt');
    git(repo, 'commit', '-m', 'feat: theirs');

    git(repo, 'checkout', 'main');
    writeFile(repo, 'shared.txt', 'mine\n');
    git(repo, 'add', 'shared.txt');
    git(repo, 'commit', '-m', 'feat: mine');

    try {
      git(repo, 'merge', 'conflicting');
    } catch {
      // The conflict is the point.
    }

    const preflight = await integrationPreflight({ repoPath: repo, kind: 'merge', target: 'conflicting' });
    expect(preflight.blocked).toMatch(/unresolved conflicts/i);
  });
});

describe('the target', () => {
  it('recognises one that exists, and one that does not', async () => {
    git(repo, 'branch', 'real');

    expect(await targetExists(repo, 'real')).toBe(true);
    expect(await targetExists(repo, 'never-created')).toBe(false);
  });
});
