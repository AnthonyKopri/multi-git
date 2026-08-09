// Worktree routes against real repositories and a real git.
//
// The removal cases are the point of this file. A worktree holds work that
// exists nowhere else, and the only thing standing between a mis-click and
// losing it is the set of refusals and the snapshot asserted below.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { clearWorktreeCaches } from '../src/server/git/worktrees';
import { clearRecoveryCache } from '../src/server/safety-net/recovery';
import { clearCheckpoints } from '../src/server/safety-net/checkpoints';
import {
  cleanupRepos,
  createRepoWithHistory,
  createTempDir,
  git,
  writeFile
} from './helpers/temp-repo';
import type { WorktreeInfo } from '../src/shared/worktree-types';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  const headers = (req: request.Test): request.Test =>
    req.set('Host', '127.0.0.1').set('x-repo-path', repo);

  return {
    get: (url: string) => headers(agent.get(url)),
    post: (url: string) => headers(agent.post(url)),
    delete: (url: string) => headers(agent.delete(url))
  };
}

/** A repository with history plus a scratch folder to put worktrees in. */
function repoWithParent(): { repo: string; parent: string } {
  return { repo: createRepoWithHistory(), parent: createTempDir('multi-git-wt-') };
}

async function listWorktrees(repo: string): Promise<WorktreeInfo[]> {
  const { body } = await api(repo).get('/api/worktrees').expect(200);
  return body.worktrees as WorktreeInfo[];
}

beforeEach(() => {
  clearRepoPathCache();
  clearWorktreeCaches();
  clearRecoveryCache();
  clearCheckpoints();
});

afterAll(() => {
  cleanupRepos();
});

describe('listing worktrees', () => {
  it('reports a plain repository as one main worktree', async () => {
    const repo = createRepoWithHistory();
    const { body } = await api(repo).get('/api/worktrees').expect(200);

    expect(body.worktrees).toHaveLength(1);
    expect(body.worktrees[0]).toMatchObject({
      isMain: true,
      branch: 'refs/heads/main',
      bare: false,
      detached: false,
      locked: false,
      present: true
    });
  });

  it('suggests a sibling folder, never one inside the repository', async () => {
    const repo = createRepoWithHistory();
    const { body } = await api(repo).get('/api/worktrees').expect(200);

    expect(body.suggestedParent).toBe(path.join(path.dirname(repo), `${path.basename(repo)}.worktrees`));
    expect(body.suggestedParent.startsWith(repo + path.sep)).toBe(false);
  });

  it('gives every worktree of one repository the same family key', async () => {
    const { repo, parent } = repoWithParent();
    const linked = path.join(parent, 'feature');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: linked, branchMode: 'new', branch: 'feature' })
      .expect(200);

    const fromMain = await api(repo).get('/api/worktrees').expect(200);
    const fromLinked = await api(linked).get('/api/worktrees').expect(200);

    expect(fromLinked.body.familyKey).toBe(fromMain.body.familyKey);
    expect(fromLinked.body.mainPath).toBe(fromMain.body.mainPath);
    // Asked from the linked worktree, the main one is still reported as main.
    expect(fromLinked.body.worktrees.find((w: WorktreeInfo) => w.isMain).path).toBe(
      fromMain.body.worktrees.find((w: WorktreeInfo) => w.isMain).path
    );
  });

  it('keeps two unrelated repositories in different families', async () => {
    const first = createRepoWithHistory();
    const second = createRepoWithHistory();

    const one = await api(first).get('/api/worktrees').expect(200);
    const two = await api(second).get('/api/worktrees').expect(200);

    expect(one.body.familyKey).not.toBe(two.body.familyKey);
  });
});

describe('creating a worktree', () => {
  it('creates one on a new branch', async () => {
    const { repo, parent } = repoWithParent();
    const target = path.join(parent, 'login');

    const { body } = await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'new', branch: 'feature/login' })
      .expect(200);

    expect(body.path).toBe(target);
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);

    const created = body.worktrees.find((w: WorktreeInfo) => !w.isMain);
    expect(created).toMatchObject({ branch: 'refs/heads/feature/login', detached: false });
  });

  it('creates one on an existing branch', async () => {
    const { repo, parent } = repoWithParent();
    git(repo, 'branch', 'release');

    const target = path.join(parent, 'release');
    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'existing', branch: 'release' })
      .expect(200);

    const worktrees = await listWorktrees(repo);
    expect(worktrees.find((w) => w.path.endsWith('release'))?.branch).toBe('refs/heads/release');
  });

  it('creates a detached one at a given commit', async () => {
    const { repo, parent } = repoWithParent();
    const first = git(repo, 'rev-parse', 'HEAD~1').trim();

    const target = path.join(parent, 'detached');
    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'detached', startPoint: first })
      .expect(200);

    const created = (await listWorktrees(repo)).find((w) => !w.isMain);
    expect(created).toMatchObject({ detached: true, head: first });
    expect(created?.branch).toBeUndefined();
  });

  it('creates one already locked when asked', async () => {
    const { repo, parent } = repoWithParent();

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: path.join(parent, 'held'), branchMode: 'new', branch: 'held', lock: true })
      .expect(200);

    expect((await listWorktrees(repo)).find((w) => !w.isMain)?.locked).toBe(true);
  });

  it('handles a path with spaces and non-Latin-1 characters', async () => {
    const { repo, parent } = repoWithParent();
    const target = path.join(parent, '中文 worktree 🔑');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'new', branch: 'unicode' })
      .expect(200);

    const created = (await listWorktrees(repo)).find((w) => !w.isMain);
    expect(created?.path).toBeDefined();
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
  });

  it('refuses a branch already checked out elsewhere, naming where', async () => {
    const { repo, parent } = repoWithParent();
    git(repo, 'branch', 'shared');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: path.join(parent, 'one'), branchMode: 'existing', branch: 'shared' })
      .expect(200);

    const { body } = await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: path.join(parent, 'two'), branchMode: 'existing', branch: 'shared' })
      .expect(400);

    expect(body.error).toMatch(/already checked out/i);
    expect(body.error).toContain(path.join(parent, 'one'));
  });

  it('refuses a new branch whose name is taken', async () => {
    const { repo, parent } = repoWithParent();
    git(repo, 'branch', 'taken');

    const { body } = await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: path.join(parent, 'taken'), branchMode: 'new', branch: 'taken' })
      .expect(400);

    expect(body.error).toMatch(/already exists/i);
  });

  it('refuses a target inside the repository', async () => {
    const repo = createRepoWithHistory();

    const { body } = await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: path.join(repo, 'nested'), branchMode: 'new', branch: 'nested' })
      .expect(400);

    expect(body.error).toMatch(/nested/i);
  });

  it('refuses a target that is a non-empty folder', async () => {
    const { repo, parent } = repoWithParent();
    const target = path.join(parent, 'occupied');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'do not lose me');

    const { body } = await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'new', branch: 'occupied' })
      .expect(400);

    expect(body.error).toMatch(/not an empty folder/i);
    expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('do not lose me');
  });

  it('refuses a branch name git would read as an option', async () => {
    const { repo, parent } = repoWithParent();

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: path.join(parent, 'x'), branchMode: 'new', branch: '--upload-pack=evil' })
      .expect(400);
  });

  it('refuses a request with no branch mode', async () => {
    const { repo, parent } = repoWithParent();

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: path.join(parent, 'x') })
      .expect(400);
  });
});

describe('worktree status', () => {
  it('counts staged, unstaged and untracked separately', async () => {
    const { repo, parent } = repoWithParent();
    const target = path.join(parent, 'dirty');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'new', branch: 'dirty' })
      .expect(200);

    writeFile(target, 'README.md', '# changed\n');
    writeFile(target, 'staged.txt', 'staged\n');
    writeFile(target, 'brand-new.txt', 'untracked\n');
    git(target, 'add', 'staged.txt');

    const { body } = await api(repo).get('/api/worktrees/status').expect(200);
    const dirty = body.worktrees.find((w: WorktreeInfo) => !w.isMain);

    expect(dirty.status).toMatchObject({ staged: 1, unstaged: 1, untracked: 1, conflicts: 0 });
  });

  it('reports the last commit date so a stale worktree is visible', async () => {
    const repo = createRepoWithHistory();
    const { body } = await api(repo).get('/api/worktrees/status').expect(200);

    expect(body.worktrees[0].status.lastActivity).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('locking, moving and repairing', () => {
  it('locks with a reason and unlocks again', async () => {
    const { repo, parent } = repoWithParent();
    const target = path.join(parent, 'held');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'new', branch: 'held' })
      .expect(200);

    await api(repo)
      .post('/api/worktrees/lock')
      .send({ path: target, reason: 'on a USB drive' })
      .expect(200);

    const locked = (await listWorktrees(repo)).find((w) => !w.isMain);
    expect(locked?.locked).toBe(true);
    expect(locked?.lockReason).toBe('on a USB drive');

    await api(repo).post('/api/worktrees/unlock').send({ path: target }).expect(200);
    expect((await listWorktrees(repo)).find((w) => !w.isMain)?.locked).toBe(false);
  });

  it('moves a worktree and reports it at the new path', async () => {
    const { repo, parent } = repoWithParent();
    const from = path.join(parent, 'before');
    const to = path.join(parent, 'after');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: from, branchMode: 'new', branch: 'moving' })
      .expect(200);

    await api(repo).post('/api/worktrees/move').send({ from, to }).expect(200);

    const moved = (await listWorktrees(repo)).find((w) => !w.isMain);
    expect(path.resolve(moved?.path ?? '')).toBe(to);
    expect(fs.existsSync(from)).toBe(false);
  });

  it('refuses to move the main worktree', async () => {
    const { repo, parent } = repoWithParent();

    const { body } = await api(repo)
      .post('/api/worktrees/move')
      .send({ from: repo, to: path.join(parent, 'nope') })
      .expect(400);

    expect(body.error).toMatch(/main worktree/i);
  });

  it('refuses an action against a path that is not a worktree', async () => {
    const { repo, parent } = repoWithParent();

    await api(repo)
      .post('/api/worktrees/lock')
      .send({ path: path.join(parent, 'never-existed') })
      .expect(404);
  });

  it('previews a prune without performing one', async () => {
    const { repo, parent } = repoWithParent();
    const target = path.join(parent, 'vanishing');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'new', branch: 'vanishing' })
      .expect(200);

    fs.rmSync(target, { recursive: true, force: true });

    const { body } = await api(repo).get('/api/worktrees/prune-preview').expect(200);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].name).toBe('vanishing');
    expect(body.entries[0].reason).toMatch(/non-existent/i);

    // A preview must not have pruned anything.
    expect((await listWorktrees(repo)).some((w) => w.path.endsWith('vanishing'))).toBe(true);
  });

  it('marks a worktree whose folder is gone as not present', async () => {
    const { repo, parent } = repoWithParent();
    const target = path.join(parent, 'deleted-by-hand');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'new', branch: 'deleted-by-hand' })
      .expect(200);

    fs.rmSync(target, { recursive: true, force: true });

    expect((await listWorktrees(repo)).find((w) => !w.isMain)?.present).toBe(false);
  });

  it('repairs the administrative links after the folders move', async () => {
    const { repo, parent } = repoWithParent();
    const target = path.join(parent, 'repairable');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'new', branch: 'repairable' })
      .expect(200);

    // Moved behind git's back, which is what `git worktree repair` is for.
    const moved = path.join(parent, 'repaired');
    fs.renameSync(target, moved);

    await api(repo).post('/api/worktrees/repair').send({ paths: [moved] }).expect(200);

    const repaired = (await listWorktrees(repo)).find((w) => !w.isMain);
    expect(path.resolve(repaired?.path ?? '')).toBe(moved);
    expect(repaired?.present).toBe(true);
  });
});

describe('removing a worktree', () => {
  async function withWorktree(): Promise<{ repo: string; target: string }> {
    const { repo, parent } = repoWithParent();
    const target = path.join(parent, 'removable');

    await api(repo)
      .post('/api/worktrees')
      .send({ targetPath: target, branchMode: 'new', branch: 'removable' })
      .expect(200);

    return { repo, target };
  }

  it('removes a clean worktree without ceremony', async () => {
    const { repo, target } = await withWorktree();

    const { body } = await api(repo).delete('/api/worktrees').send({ path: target }).expect(200);

    expect(body.removedPath).toBeDefined();
    expect(fs.existsSync(target)).toBe(false);
    expect(body.worktrees).toHaveLength(1);
  });

  it('refuses a dirty worktree and leaves it exactly as it was', async () => {
    const { repo, target } = await withWorktree();
    writeFile(target, 'unsaved.txt', 'work nobody has committed');

    const { body } = await api(repo).delete('/api/worktrees').send({ path: target }).expect(409);

    expect(body.error).toMatch(/uncommitted/i);
    expect(fs.readFileSync(path.join(target, 'unsaved.txt'), 'utf8')).toBe(
      'work nobody has committed'
    );
  });

  it('refuses a locked worktree and repeats the reason', async () => {
    const { repo, target } = await withWorktree();
    await api(repo).post('/api/worktrees/lock').send({ path: target, reason: 'in use' }).expect(200);

    const { body } = await api(repo)
      .delete('/api/worktrees')
      .send({ path: target, force: true, confirmName: 'removable' })
      .expect(409);

    expect(body.error).toMatch(/locked/i);
    expect(body.error).toMatch(/in use/);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('refuses to remove the main worktree', async () => {
    const repo = createRepoWithHistory();

    const { body } = await api(repo)
      .delete('/api/worktrees')
      .send({ path: repo, force: true, confirmName: path.basename(repo) })
      .expect(400);

    expect(body.error).toMatch(/main worktree/i);
    expect(fs.existsSync(path.join(repo, 'README.md'))).toBe(true);
  });

  it('refuses a forced removal without the typed folder name', async () => {
    const { repo, target } = await withWorktree();
    writeFile(target, 'unsaved.txt', 'work');

    const { body } = await api(repo)
      .delete('/api/worktrees')
      .send({ path: target, force: true })
      .expect(400);

    expect(body.error).toMatch(/type the worktree's folder name/i);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('refuses a forced removal when the typed name does not match', async () => {
    const { repo, target } = await withWorktree();
    writeFile(target, 'unsaved.txt', 'work');

    await api(repo)
      .delete('/api/worktrees')
      .send({ path: target, force: true, confirmName: 'something-else' })
      .expect(400);

    expect(fs.existsSync(target)).toBe(true);
  });

  it('refuses a path outside the family even when it is a real repository', async () => {
    const { repo } = await withWorktree();
    const stranger = createRepoWithHistory();

    await api(repo)
      .delete('/api/worktrees')
      .send({ path: stranger, force: true, confirmName: path.basename(stranger) })
      .expect(404);

    // The point of the guard: an unrelated repository is untouched.
    expect(fs.existsSync(path.join(stranger, 'README.md'))).toBe(true);
  });

  it('snapshots uncommitted work before a forced removal and records it', async () => {
    const { repo, target } = await withWorktree();
    writeFile(target, 'README.md', '# edited in the worktree\n');
    git(target, 'add', 'README.md');

    const { body } = await api(repo)
      .delete('/api/worktrees')
      .send({ path: target, force: true, confirmName: 'removable' })
      .expect(200);

    expect(fs.existsSync(target)).toBe(false);
    expect(body.snapshotRef).toMatch(/^[0-9a-f]{40}$/);

    // The snapshot lives in the shared object store, so it survives the folder
    // it came from — which is what makes the removal recoverable at all.
    expect(git(repo, 'cat-file', '-t', body.snapshotRef).trim()).toBe('commit');
    expect(git(repo, 'show', `${body.snapshotRef}:README.md`)).toContain('edited in the worktree');

    const recovery = await api(repo).get('/api/git/recovery').expect(200);
    const point = recovery.body.points[0];

    expect(point.operation).toBe('worktree-remove');
    expect(point.label).toMatch(/removable/);
    expect(point.stashRef).toBe(body.snapshotRef);
    // The worktree's branch tip is recorded too, so the branch can be restored
    // even though the folder is gone.
    expect(point.refs['refs/heads/removable']).toMatch(/^[0-9a-f]{40}$/);
  });

  it('records a recovery point even when there was nothing to snapshot', async () => {
    const { repo, target } = await withWorktree();
    writeFile(target, 'only-untracked.txt', 'not staged, not committed');

    const { body } = await api(repo)
      .delete('/api/worktrees')
      .send({ path: target, force: true, confirmName: 'removable' })
      .expect(200);

    expect(fs.existsSync(target)).toBe(false);

    const recovery = await api(repo).get('/api/git/recovery').expect(200);
    expect(recovery.body.points[0].operation).toBe('worktree-remove');
    // `git stash create` ignores untracked files, so there is honestly no
    // snapshot to name here rather than a misleading one.
    expect(body.snapshotRef).toBeUndefined();
  });

  it('removes a worktree whose folder was already deleted by hand', async () => {
    const { repo, target } = await withWorktree();
    fs.rmSync(target, { recursive: true, force: true });

    await api(repo)
      .delete('/api/worktrees')
      .send({ path: target, force: true, confirmName: 'removable' })
      .expect(200);

    expect(await listWorktrees(repo)).toHaveLength(1);
  });
});

describe('a family with many worktrees', () => {
  it('lists and reads status for twenty without falling over', async () => {
    const { repo, parent } = repoWithParent();

    for (let index = 0; index < 20; index += 1) {
      await api(repo)
        .post('/api/worktrees')
        .send({
          targetPath: path.join(parent, `wt-${index}`),
          branchMode: 'new',
          branch: `stress/${index}`
        })
        .expect(200);
    }

    const listedAt = Date.now();
    const listed = await listWorktrees(repo);
    const listMs = Date.now() - listedAt;

    expect(listed).toHaveLength(21);
    // One git call regardless of family size, so this stays flat.
    expect(listMs).toBeLessThan(5000);

    const statusAt = Date.now();
    const { body } = await api(repo).get('/api/worktrees/status').expect(200);
    const statusMs = Date.now() - statusAt;

    expect(body.worktrees).toHaveLength(21);
    expect(body.worktrees.every((w: WorktreeInfo) => w.status !== undefined)).toBe(true);
    // Bounded concurrency, not one process per worktree all at once.
    expect(statusMs).toBeLessThan(60_000);
  }, 180_000);
});
