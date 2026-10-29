// A merge or rebase stopped part-way, in every layout a work tree can have.
//
// Git keeps that state in the work tree's own git directory. In an ordinary
// repository that is `.git`; in a linked worktree or a submodule `.git` is a
// file pointing somewhere else, and the state was looked for in the wrong
// place. The status badge, the recovery journal's freeze and the guards in
// front of undo and restore all went on as though nothing were in progress.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import request, { type Test } from './helpers/request';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { clearLogBuffer, logBuffer } from '../src/server/logs';
import { readOperationState, workTreeGitDir } from '../src/server/git/operation-state';
import {
  cleanupRepos,
  createRepoWithHistory,
  createTempDir,
  git,
  writeFile
} from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  const headers = (req: Test): Test => req.set('Host', '127.0.0.1').set('x-repo-path', repo);

  return {
    get: (url: string) => headers(agent.get(url)),
    post: (url: string) => headers(agent.post(url))
  };
}

/** Runs a git command that is expected to stop on a conflict. */
function gitStopping(cwd: string, ...args: string[]): void {
  try {
    git(cwd, ...args);
  } catch {
    // A conflict exits non-zero, which is the state under test.
  }
}

/**
 * Two commits that conflict on one file, on `theirs` and on the branch the
 * work tree has checked out.
 */
function divergeOnOneFile(workTree: string, base: string): void {
  // Pinned first: once `theirs` is checked out, a symbolic base names it.
  base = git(workTree, 'rev-parse', base).trim();

  git(workTree, 'checkout', '-q', '-b', 'theirs', base);
  writeFile(workTree, 'conflict.txt', 'their version\n');
  git(workTree, 'add', 'conflict.txt');
  git(workTree, 'commit', '-q', '-m', 'their change');

  git(workTree, 'checkout', '-q', '-b', 'ours', base);
  writeFile(workTree, 'conflict.txt', 'our version\n');
  git(workTree, 'add', 'conflict.txt');
  git(workTree, 'commit', '-q', '-m', 'our change');
}

/** A linked worktree of a fresh repository, with conflicting branches ready. */
function linkedWorktree(): { repo: string; worktree: string } {
  const repo = createRepoWithHistory();
  const worktree = path.join(createTempDir('multi-git-linked-'), 'linked');

  git(repo, 'worktree', 'add', '-q', '--detach', worktree);
  divergeOnOneFile(worktree, 'HEAD');

  return { repo, worktree };
}

afterAll(() => {
  cleanupRepos();
});

beforeEach(() => {
  clearRepoPathCache();
});

/** A checked-out submodule, with conflicting branches ready inside it. */
function submoduleCheckout(): string {
  const child = createRepoWithHistory();
  const superproject = createRepoWithHistory();

  // Over the file transport, which git refuses by default. `-c` reaches the
  // clone git starts for it; see tests/submodules.test.ts.
  git(superproject, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', child, 'libs/child');
  const checkout = path.join(superproject, 'libs', 'child');

  git(checkout, 'config', 'user.email', 'test@example.com');
  git(checkout, 'config', 'user.name', 'Test User');
  git(checkout, 'config', 'commit.gpgsign', 'false');
  divergeOnOneFile(checkout, 'HEAD');

  return checkout;
}

describe('finding the work tree’s own git directory', () => {
  const gitsAnswer = (workTree: string): string =>
    path.resolve(git(workTree, 'rev-parse', '--absolute-git-dir').trim());

  it('agrees with git in an ordinary repository', async () => {
    const repo = createRepoWithHistory();
    expect(path.resolve(await workTreeGitDir(repo))).toBe(gitsAnswer(repo));
  });

  it('agrees with git in a linked worktree', async () => {
    const { worktree } = linkedWorktree();
    const found = path.resolve(await workTreeGitDir(worktree));

    expect(found).toBe(gitsAnswer(worktree));
    expect(found).not.toBe(path.join(worktree, '.git'));
  });

  it('agrees with git in a submodule', async () => {
    const checkout = submoduleCheckout();
    expect(path.resolve(await workTreeGitDir(checkout))).toBe(gitsAnswer(checkout));
  });

  it('asks git nothing in an ordinary repository', async () => {
    const repo = createRepoWithHistory();
    clearLogBuffer();

    await api(repo).get('/api/git/status').expect(200);

    const commands = logBuffer()
      .filter((entry) => entry.command?.cwd === repo)
      .map((entry) => entry.command?.argv[1]);
    expect(commands).toEqual(['status']);
  });
});

describe('a merge stopped in a linked worktree', () => {
  function stoppedMerge(): string {
    const { worktree } = linkedWorktree();
    gitStopping(worktree, 'merge', 'theirs');
    return worktree;
  }

  it('is reported by the status', async () => {
    const worktree = stoppedMerge();

    const { body } = await api(worktree).get('/api/git/status').expect(200);

    expect(body.isMerging).toBe(true);
    expect(body.conflicts.map((entry: { path: string }) => entry.path)).toEqual(['conflict.txt']);
  });

  it('freezes the recovery journal', async () => {
    const worktree = stoppedMerge();

    const { body } = await api(worktree).get('/api/git/recovery').expect(200);

    expect(body.operationInProgress).toBe(true);
  });

  it('refuses to undo the last commit', async () => {
    const worktree = stoppedMerge();
    const before = git(worktree, 'rev-parse', 'HEAD').trim();

    await api(worktree).post('/api/git/undo-commit').expect(400);

    expect(git(worktree, 'rev-parse', 'HEAD').trim()).toBe(before);
  });

  it('refuses to undo an operation', async () => {
    const worktree = stoppedMerge();

    const { body } = await api(worktree)
      .post('/api/git/undo-operation')
      .send({ checkpointId: 'any' })
      .expect(400);

    expect(body.error).toMatch(/merge\/rebase/);
  });

  it('refuses to restore a ref', async () => {
    const worktree = stoppedMerge();

    const { body } = await api(worktree)
      .post('/api/git/recovery/restore')
      .send({ pointId: 'any', ref: 'refs/heads/ours' })
      .expect(400);

    expect(body.error).toMatch(/merge or rebase/);
  });

  it('is not reported in the main worktree, which has no merge of its own', async () => {
    const { repo, worktree } = linkedWorktree();
    gitStopping(worktree, 'merge', 'theirs');

    const { body } = await api(repo).get('/api/git/status').expect(200);

    expect(body.isMerging).toBe(false);
  });
});

describe('a rebase stopped in a linked worktree', () => {
  it('is reported by the status', async () => {
    const { worktree } = linkedWorktree();
    gitStopping(worktree, 'rebase', 'theirs');

    const { body } = await api(worktree).get('/api/git/status').expect(200);

    expect(body.isRebasing).toBe(true);
    expect(body.isMerging).toBe(false);
  });
});

describe('a merge stopped in a submodule', () => {
  it('is reported by the status', async () => {
    const checkout = submoduleCheckout();
    gitStopping(checkout, 'merge', 'theirs');

    const { body } = await api(checkout).get('/api/git/status').expect(200);

    expect(body.isMerging).toBe(true);
  });

  it('is what the shared reader sees too', async () => {
    const checkout = submoduleCheckout();
    gitStopping(checkout, 'merge', 'theirs');

    expect(await readOperationState(checkout)).toEqual({ isMerging: true, isRebasing: false });
  });
});
