// Workstream B against real repositories: selective stash, commit search,
// ref comparison, and branch housekeeping.
//
// The stash cases are the ones that matter most. A partial stash that loses
// the rest of the working tree, or quietly restages something, is worse than
// no partial stash at all — so every one of them asserts on the whole status
// afterwards, not just on the thing that was stashed.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { clearRecoveryCache } from '../src/server/safety-net/recovery';
import type { DiffFile } from '../src/shared/diff-types';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Host', '127.0.0.1').set('x-repo-path', repo),
    post: (url: string) => agent.post(url).set('Host', '127.0.0.1').set('x-repo-path', repo)
  };
}

/** `git status --porcelain`, which is the whole truth about a working tree. */
function status(repo: string): string[] {
  return git(repo, 'status', '--porcelain')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .sort();
}

function read(repo: string, file: string): string {
  return fs.readFileSync(path.join(repo, file), 'utf8');
}

async function structuredDiff(repo: string, filePath: string): Promise<DiffFile> {
  const { body } = await api(repo)
    .get('/api/git/diff/structured')
    .query({ path: filePath, source: 'working-tree' })
    .expect(200);
  return body.file as DiffFile;
}

/** Two well-separated edits in one file, plus a staged change elsewhere. */
function repoForStashing(): string {
  const repo = createRepoWithHistory();

  writeFile(repo, 'lines.txt', `${Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')}\n`);
  writeFile(repo, 'other.txt', 'untouched\n');
  git(repo, 'add', 'lines.txt', 'other.txt');
  git(repo, 'commit', '-m', 'feat: add files');

  // A staged change that must survive everything below.
  writeFile(repo, 'other.txt', 'untouched\nSTAGED\n');
  git(repo, 'add', 'other.txt');

  const edited = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
    .map((line) => (line === 'line 3' ? 'line 3 CHANGED' : line === 'line 17' ? 'line 17 CHANGED' : line))
    .join('\n');
  writeFile(repo, 'lines.txt', `${edited}\n`);

  return repo;
}

beforeEach(() => {
  clearRepoPathCache();
  clearRecoveryCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('stashing part of the working tree', () => {
  it('stashes only the chosen hunk and leaves everything else alone', async () => {
    const repo = repoForStashing();
    const diff = await structuredDiff(repo, 'lines.txt');
    expect(diff.hunks).toHaveLength(2);

    const { body } = await api(repo)
      .post('/api/git/stash')
      .send({
        message: 'first hunk only',
        selections: [{ filePath: 'lines.txt', hunkIds: [diff.hunks[0]?.id] }]
      })
      .expect(200);

    expect(body.partial).toBe(true);

    // The chosen hunk is gone from the working tree; the other one stayed.
    const working = read(repo, 'lines.txt');
    expect(working).not.toContain('line 3 CHANGED');
    expect(working).toContain('line 17 CHANGED');

    // The unrelated staged change is untouched, still staged.
    expect(status(repo)).toEqual([' M lines.txt', 'M  other.txt']);
    expect(git(repo, 'show', ':other.txt')).toBe('untouched\nSTAGED\n');
  });

  it('produces a stash that holds exactly what was selected', async () => {
    const repo = repoForStashing();
    const diff = await structuredDiff(repo, 'lines.txt');

    await api(repo)
      .post('/api/git/stash')
      .send({ selections: [{ filePath: 'lines.txt', hunkIds: [diff.hunks[0]?.id] }] })
      .expect(200);

    const patch = git(repo, 'stash', 'show', '-p', 'stash@{0}');
    expect(patch).toContain('line 3 CHANGED');
    expect(patch).not.toContain('line 17 CHANGED');
  });

  it('applies a partial stash back onto a clean file', async () => {
    const repo = repoForStashing();
    const diff = await structuredDiff(repo, 'lines.txt');

    await api(repo)
      .post('/api/git/stash')
      .send({ selections: [{ filePath: 'lines.txt', hunkIds: [diff.hunks[0]?.id] }] })
      .expect(200);

    // Put the file back to HEAD so the stash has somewhere to land.
    git(repo, 'checkout', '--', 'lines.txt');

    await api(repo).post('/api/git/stash/apply').send({ ref: 'stash@{0}' }).expect(200);

    expect(read(repo, 'lines.txt')).toContain('line 3 CHANGED');
    expect(read(repo, 'lines.txt')).not.toContain('line 17 CHANGED');
  });

  it('stashes chosen lines rather than a whole hunk', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'notes.txt', 'keep\n');
    git(repo, 'add', 'notes.txt');
    git(repo, 'commit', '-m', 'feat: notes');
    writeFile(repo, 'notes.txt', 'keep\nfirst\nsecond\nthird\n');

    const diff = await structuredDiff(repo, 'notes.txt');
    const additions = diff.hunks[0]?.lines.filter((line) => line.kind === 'addition') ?? [];

    await api(repo)
      .post('/api/git/stash')
      .send({ selections: [{ filePath: 'notes.txt', lineIds: [additions[1]?.id] }] })
      .expect(200);

    expect(read(repo, 'notes.txt')).toBe('keep\nfirst\nthird\n');
    expect(git(repo, 'stash', 'show', '-p', 'stash@{0}')).toContain('+second');
  });

  it('leaves the repository untouched when a selection has gone stale', async () => {
    const repo = repoForStashing();
    const before = status(repo);

    const { body } = await api(repo)
      .post('/api/git/stash')
      .send({ selections: [{ filePath: 'lines.txt', hunkIds: ['not-a-real-hunk'] }] })
      .expect(409);

    expect(body.error).toMatch(/changed since/i);
    expect(status(repo)).toEqual(before);
    expect(git(repo, 'stash', 'list').trim()).toBe('');
  });

  it('refuses a partial stash of a file git does not track yet', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'fresh.txt', 'a\nb\n');
    const diff = await structuredDiff(repo, 'fresh.txt');

    const { body } = await api(repo)
      .post('/api/git/stash')
      .send({ selections: [{ filePath: 'fresh.txt', hunkIds: [diff.hunks[0]?.id] }] })
      .expect(400);

    expect(body.error).toMatch(/not tracked/i);
    expect(fs.existsSync(path.join(repo, 'fresh.txt'))).toBe(true);
  });
});

describe('stashing whole paths', () => {
  it('stashes one file and leaves the other modified', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', '# Changed\n');
    writeFile(repo, 'src/app.txt', 'alpha\nbravo\ndelta\n');

    await api(repo)
      .post('/api/git/stash')
      .send({ message: 'just the readme', files: ['README.md'] })
      .expect(200);

    expect(status(repo)).toEqual([' M src/app.txt']);
    expect(git(repo, 'stash', 'list')).toContain('just the readme');
  });

  it('includes untracked files only when asked', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'fresh.txt', 'new\n');

    // Without the flag there is nothing to stash, which git reports as a
    // success with nothing done rather than as a failure.
    await api(repo).post('/api/git/stash').send({ message: 'tracked only' }).expect(200);
    expect(fs.existsSync(path.join(repo, 'fresh.txt'))).toBe(true);
    expect(git(repo, 'stash', 'list').trim()).toBe('');

    await api(repo)
      .post('/api/git/stash')
      .send({ message: 'with untracked', includeUntracked: true })
      .expect(200);

    expect(fs.existsSync(path.join(repo, 'fresh.txt'))).toBe(false);
    expect(git(repo, 'stash', 'list')).toContain('with untracked');
  });

  it('keeps the index when asked, so a prepared commit survives', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', '# Staged\n');
    git(repo, 'add', 'README.md');
    writeFile(repo, 'src/app.txt', 'alpha\nbravo\nunstaged\n');

    await api(repo)
      .post('/api/git/stash')
      .send({ message: 'keep index', keepIndex: true })
      .expect(200);

    expect(git(repo, 'show', ':README.md')).toBe('# Staged\n');
    expect(status(repo)).toEqual(['M  README.md']);
  });

  it('restores the staged/unstaged split when applied with the index', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', '# Staged\n');
    git(repo, 'add', 'README.md');
    writeFile(repo, 'src/app.txt', 'alpha\nbravo\nunstaged\n');

    await api(repo).post('/api/git/stash').send({ message: 'both' }).expect(200);
    expect(status(repo)).toEqual([]);

    await api(repo)
      .post('/api/git/stash/apply')
      .send({ ref: 'stash@{0}', restoreIndex: true })
      .expect(200);

    // Exactly the split that went in: one staged, one not.
    expect(status(repo)).toEqual([' M src/app.txt', 'M  README.md']);
  });
});

describe('browsing stashes', () => {
  it('lists a stash with the object name and a machine-readable date', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', '# Changed\n');
    await api(repo).post('/api/git/stash').send({ message: 'wip' }).expect(200);

    const { body } = await api(repo).get('/api/git/stash').expect(200);
    expect(body.stashes).toHaveLength(1);
    expect(body.stashes[0].ref).toBe('stash@{0}');
    expect(body.stashes[0].message).toContain('wip');
    expect(body.stashes[0].oid).toMatch(/^[0-9a-f]{40}$/);
    expect(body.stashes[0].isoDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('shows what a stash holds without applying it', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', '# Changed\n');
    await api(repo).post('/api/git/stash').send({ message: 'wip' }).expect(200);

    const { body } = await api(repo)
      .get('/api/git/stash/show')
      .query({ ref: 'stash@{0}' })
      .expect(200);

    expect(body.files).toEqual([{ status: 'M', path: 'README.md' }]);
    expect(body.diff[0].hunks[0].lines.some((line: { content: string }) => line.content === '# Changed')).toBe(
      true
    );
    // Inspecting must not have applied anything.
    expect(status(repo)).toEqual([]);
  });

  it('starts a branch from a stash', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', '# Changed\n');
    await api(repo).post('/api/git/stash').send({ message: 'wip' }).expect(200);

    await api(repo)
      .post('/api/git/stash/branch')
      .send({ ref: 'stash@{0}', branchName: 'from-stash' })
      .expect(200);

    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('from-stash');
    expect(read(repo, 'README.md')).toBe('# Changed\n');
    // git stash branch drops the stash once it has applied it.
    expect(git(repo, 'stash', 'list').trim()).toBe('');
  });

  it('rejects a reference that is not a stash', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/stash/apply').send({ ref: 'refs/heads/main' }).expect(400);
  });
});

describe('searching commits', () => {
  function repoWithSearchableHistory(): string {
    const repo = createRepoWithHistory();

    writeFile(repo, 'alpha.txt', 'one\n');
    git(repo, 'add', 'alpha.txt');
    git(repo, 'commit', '-m', 'feat(alpha): add the alpha module');

    writeFile(repo, 'beta.txt', 'two\n');
    git(repo, 'add', 'beta.txt');
    git(repo, '-c', 'user.name=Other Person', '-c', 'user.email=other@example.com', 'commit', '-m', 'fix(beta): correct a rounding error');

    return repo;
  }

  it('matches a term in the subject, case-insensitively', async () => {
    const repo = repoWithSearchableHistory();
    const { body } = await api(repo)
      .get('/api/git/search/commits')
      .query({ query: 'ROUNDING' })
      .expect(200);

    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].message).toContain('rounding error');
  });

  it('matches by author', async () => {
    const repo = repoWithSearchableHistory();
    const { body } = await api(repo)
      .get('/api/git/search/commits')
      .query({ author: 'Other Person' })
      .expect(200);

    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].author).toBe('Other Person');
  });

  it('matches by path, which is "what touched this file"', async () => {
    const repo = repoWithSearchableHistory();
    const { body } = await api(repo)
      .get('/api/git/search/commits')
      .query({ paths: 'alpha.txt' })
      .expect(200);

    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].message).toContain('alpha module');
  });

  it('finds a commit by its object name even though nothing mentions it', async () => {
    const repo = repoWithSearchableHistory();
    const hash = git(repo, 'rev-parse', 'HEAD').trim();

    const { body } = await api(repo)
      .get('/api/git/search/commits')
      .query({ query: hash.slice(0, 10) })
      .expect(200);

    expect(body.commits[0].hash).toBe(hash);
  });

  it('paginates without a second query to find out whether there is more', async () => {
    const repo = repoWithSearchableHistory();

    const first = await api(repo).get('/api/git/search/commits').query({ limit: 2 }).expect(200);
    expect(first.body.commits).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);

    const second = await api(repo)
      .get('/api/git/search/commits')
      .query({ limit: 2, skip: 2 })
      .expect(200);
    expect(second.body.hasMore).toBe(false);
    expect(second.body.commits[0].hash).not.toBe(first.body.commits[0].hash);
  });

  it('limits to the refs it was given', async () => {
    const repo = repoWithSearchableHistory();
    git(repo, 'branch', 'side', 'HEAD~2');

    const { body } = await api(repo)
      .get('/api/git/search/commits')
      .query({ refs: 'side' })
      .expect(200);

    expect(body.commits.every((commit: { message: string }) => !commit.message.includes('beta'))).toBe(
      true
    );
  });

  it('refuses a date it cannot tell from an option', async () => {
    const repo = repoWithSearchableHistory();
    await api(repo).get('/api/git/search/commits').query({ since: '--output=/tmp/x' }).expect(400);
  });
});

describe('comparing refs', () => {
  it('counts both directions from the merge base', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'checkout', '-q', '-b', 'side');
    writeFile(repo, 'side.txt', 'side\n');
    git(repo, 'add', 'side.txt');
    git(repo, 'commit', '-m', 'feat: side work');

    git(repo, 'checkout', '-q', 'main');
    writeFile(repo, 'main.txt', 'main\n');
    git(repo, 'add', 'main.txt');
    git(repo, 'commit', '-m', 'feat: main work');
    git(repo, 'commit', '--allow-empty', '-m', 'chore: another');

    const { body } = await api(repo)
      .get('/api/git/compare')
      .query({ base: 'main', head: 'side' })
      .expect(200);

    expect(body.ahead).toBe(1);
    expect(body.behind).toBe(2);
    expect(body.aheadCommits[0].message).toBe('feat: side work');
    expect(body.behindCommits.map((commit: { message: string }) => commit.message)).toEqual([
      'chore: another',
      'feat: main work'
    ]);
    expect(body.files).toEqual([{ status: 'A', path: 'side.txt' }]);
    expect(body.mergeBase).toMatch(/^[0-9a-f]{40}$/);
  });

  it('says so when a ref does not exist', async () => {
    const repo = createRepoWithHistory();
    await api(repo).get('/api/git/compare').query({ base: 'main', head: 'nope' }).expect(404);
  });

  it('serves the patch for one file in the comparison', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'checkout', '-q', '-b', 'side');
    writeFile(repo, 'README.md', '# Side\n');
    git(repo, 'add', 'README.md');
    git(repo, 'commit', '-m', 'docs: side readme');

    const { body } = await api(repo)
      .get('/api/git/compare/diff')
      .query({ base: 'main', head: 'side', path: 'README.md' })
      .expect(200);

    expect(body.patch).toContain('+# Side');
  });
});

describe('branch housekeeping', () => {
  it('reports what you need in order to decide a branch can go', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'branch', 'merged-already');
    git(repo, 'checkout', '-q', '-b', 'unmerged');
    writeFile(repo, 'x.txt', 'x\n');
    git(repo, 'add', 'x.txt');
    git(repo, 'commit', '-m', 'feat: unmerged work');
    git(repo, 'checkout', '-q', 'main');

    const { body } = await api(repo).get('/api/git/branches/details').expect(200);
    const byName = new Map(body.branches.map((branch: { name: string }) => [branch.name, branch]));

    expect(byName.get('merged-already')).toMatchObject({ merged: true, isCurrent: false });
    expect(byName.get('unmerged')).toMatchObject({ merged: false });
    expect(byName.get('main')).toMatchObject({ isCurrent: true });
    expect(byName.get('main')).toHaveProperty('stale', false);
  });

  it('renames a branch and carries its pin across', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'branch', 'old-name');

    await api(repo).post('/api/git/branch/pin').send({ branch: 'old-name' }).expect(200);
    await api(repo)
      .post('/api/git/branch/rename')
      .send({ from: 'old-name', to: 'new-name' })
      .expect(200);

    const { body } = await api(repo).get('/api/git/branches/details').expect(200);
    const renamed = body.branches.find((branch: { name: string }) => branch.name === 'new-name');

    expect(renamed).toBeDefined();
    expect(renamed.pinned).toBe(true);
    expect(body.branches.some((branch: { name: string }) => branch.name === 'old-name')).toBe(false);
  });

  it('refuses to rename over an existing branch', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'branch', 'one');
    git(repo, 'branch', 'two');

    await api(repo).post('/api/git/branch/rename').send({ from: 'one', to: 'two' }).expect(500);
    expect(git(repo, 'rev-parse', '--verify', 'one').trim()).not.toBe('');
  });

  it('unpins a branch again', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/branch/pin').send({ branch: 'main' }).expect(200);

    const { body } = await api(repo)
      .post('/api/git/branch/pin')
      .send({ branch: 'main', pinned: false })
      .expect(200);

    expect(body.pinnedBranches).toEqual([]);
  });

  it('deletes several branches and reports each outcome', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'branch', 'gone-one');
    git(repo, 'branch', 'gone-two');

    const { body } = await api(repo)
      .post('/api/git/branches/delete-many')
      .send({ branches: ['gone-one', 'gone-two', 'never-existed'] })
      .expect(200);

    expect(body.deleted).toBe(2);
    expect(body.results.find((entry: { branch: string }) => entry.branch === 'never-existed')).toMatchObject(
      { deleted: false }
    );
    // One branch that will not go must not stop the others.
    expect(git(repo, 'branch', '--format=%(refname:short)').trim()).toBe('main');
  });

  it('records a recovery point before a bulk delete', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'branch', 'doomed');
    const tip = git(repo, 'rev-parse', 'doomed').trim();

    await api(repo).post('/api/git/branches/delete-many').send({ branches: ['doomed'] }).expect(200);

    const { body } = await api(repo).get('/api/git/recovery').expect(200);
    const point = body.points.find(
      (entry: { operation: string }) => entry.operation === 'branch-delete'
    );
    expect(point.refs['refs/heads/doomed']).toBe(tip);
  });

  it('sets and clears an upstream', async () => {
    const repo = createRepoWithHistory();
    // A remote-tracking branch without a network. Both halves are needed:
    // git will not track a ref whose remote it has no configuration for.
    git(repo, 'remote', 'add', 'origin', 'https://example.invalid/repo.git');
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

    await api(repo)
      .post('/api/git/branch/upstream')
      .send({ branch: 'main', upstream: 'origin/main' })
      .expect(200);

    let details = await api(repo).get('/api/git/branches/details').expect(200);
    expect(details.body.branches[0].upstream).toBe('origin/main');

    await api(repo)
      .post('/api/git/branch/upstream')
      .send({ branch: 'main', upstream: '' })
      .expect(200);

    details = await api(repo).get('/api/git/branches/details').expect(200);
    expect(details.body.branches[0].upstream).toBeNull();
  });
});
