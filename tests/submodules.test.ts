// Submodules against real repositories and a real git.
//
// Submodules are the feature where reading git's documentation and reading
// git's behaviour disagree most often, so these are integration tests. The
// cases that matter are the states a submodule can be in — declared but never
// initialized, initialized and clean, initialized and dirty, checked out at
// something other than the commit the superproject pins — because those are
// exactly what the panel has to tell apart.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { clearCheckpoints, listCheckpoints } from '../src/server/safety-net/checkpoints';
import { clearRecoveryCache } from '../src/server/safety-net/recovery';
import { listSubmodules, submoduleRepoPath } from '../src/server/git/submodules';
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
  const headers = (req: request.Test): request.Test =>
    req.set('Host', '127.0.0.1').set('x-repo-path', repo);

  return {
    get: (url: string) => headers(agent.get(url)),
    post: (url: string) => headers(agent.post(url))
  };
}

/*
 * Every fixture here points a submodule at another throwaway directory, and
 * since CVE-2022-39253 git refuses the `file` transport for submodules. The
 * setting that re-allows it has to reach two different places:
 *
 *   * `-c` on the fixture's own commands, because `git submodule add` spawns a
 *     `git clone` whose working directory is the new submodule — it never
 *     reads the superproject's local config, so `git config` alone does
 *     nothing for it. `-c` travels to subprocesses; local config does not.
 *
 *   * A global config file for the git the *product* runs, which is a separate
 *     process tree this file cannot pass flags to.
 *
 * It is deliberately not passed by the product code. The protection is a real
 * one, and an application has no business disabling it on a user's behalf.
 * Real submodules use https or ssh and are unaffected either way.
 */
const ALLOW_FILE_TRANSPORT = ['-c', 'protocol.file.allow=always'];

const testGitConfig = path.join(os.tmpdir(), 'multi-git-submodule-tests.gitconfig');
let previousGlobalConfig: string | undefined;

beforeAll(() => {
  fs.writeFileSync(testGitConfig, '[protocol "file"]\n\tallow = always\n', 'utf8');
  previousGlobalConfig = process.env['GIT_CONFIG_GLOBAL'];
  process.env['GIT_CONFIG_GLOBAL'] = testGitConfig;
});

afterAll(() => {
  if (previousGlobalConfig === undefined) {
    delete process.env['GIT_CONFIG_GLOBAL'];
  } else {
    process.env['GIT_CONFIG_GLOBAL'] = previousGlobalConfig;
  }
});

/** An identity, for the fixtures that commit inside a checked-out submodule. */
function configureIdentity(repo: string): void {
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test User');
  git(repo, 'config', 'commit.gpgsign', 'false');
}

/** A superproject with one submodule, checked out and clean. */
function createSuperproject(): { superproject: string; child: string } {
  const child = createRepoWithHistory();
  const superproject = createRepoWithHistory();

  git(superproject, ...ALLOW_FILE_TRANSPORT, 'submodule', 'add', child, 'libs/child');
  git(superproject, 'commit', '-m', 'Add the child submodule');

  // The checked-out submodule is its own repository with its own config, and
  // it inherits neither the identity nor the signing setting.
  configureIdentity(path.join(superproject, 'libs', 'child'));

  return { superproject, child };
}

/** The same, then cloned, so the clone has a declared but absent submodule. */
function cloneWithUninitializedSubmodule(): string {
  const { superproject } = createSuperproject();
  const parent = createTempDir('multi-git-super-clone-');
  const clone = path.join(parent, 'clone');

  git(parent, 'clone', superproject, clone);
  configureIdentity(clone);

  return clone;
}

beforeEach(() => {
  clearRepoPathCache();
  clearCheckpoints();
  clearRecoveryCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('listing submodules', () => {
  it('reports none for a repository that declares none', async () => {
    expect(await listSubmodules(createRepoWithHistory())).toEqual([]);
  });

  it('reads the declaration, the gitlink and the checked-out commit', async () => {
    const { superproject, child } = createSuperproject();

    const [submodule] = await listSubmodules(superproject);
    const childHead = git(child, 'rev-parse', 'HEAD').trim();

    expect(submodule).toMatchObject({
      path: 'libs/child',
      name: 'libs/child',
      initialized: true,
      dirty: false,
      missingCommit: false
    });
    // Both commits, not one "up to date" flag: they are different facts.
    expect(submodule?.expectedOid).toBe(childHead);
    expect(submodule?.checkedOutOid).toBe(childHead);
  });

  it('reports a declared submodule that has never been checked out', async () => {
    const clone = cloneWithUninitializedSubmodule();

    const [submodule] = await listSubmodules(clone);

    // This is the state that exists only in .gitmodules, which is why the
    // declaration is read from there rather than from .git/config.
    expect(submodule).toMatchObject({
      path: 'libs/child',
      initialized: false,
      dirty: false
    });
    expect(submodule?.checkedOutOid).toBeUndefined();
    // The superproject still knows which commit it wants.
    expect(submodule?.expectedOid).toBeTruthy();
  });

  it('notices uncommitted changes inside the submodule', async () => {
    const { superproject } = createSuperproject();
    writeFile(superproject, path.join('libs', 'child', 'scratch.txt'), 'work in progress');

    const [submodule] = await listSubmodules(superproject);

    expect(submodule?.dirty).toBe(true);
  });

  it('separates the pinned commit from the checked-out one when they differ', async () => {
    const { superproject, child } = createSuperproject();
    const pinned = git(child, 'rev-parse', 'HEAD').trim();

    // Move the submodule's working tree on without updating the superproject.
    const inside = path.join(superproject, 'libs', 'child');
    writeFile(inside, 'later.txt', 'a newer commit');
    git(inside, 'add', '.');
    git(inside, 'commit', '-m', 'A commit the superproject does not know about');
    const moved = git(inside, 'rev-parse', 'HEAD').trim();

    const [submodule] = await listSubmodules(superproject);

    expect(submodule?.expectedOid).toBe(pinned);
    expect(submodule?.checkedOutOid).toBe(moved);
    expect(submodule?.expectedOid).not.toBe(submodule?.checkedOutOid);
  });

  it('reads a submodule name that is not the same as its path', async () => {
    const { superproject } = createSuperproject();

    // A rename in .gitmodules leaves the section name and the path different,
    // which is the case the key parser has to survive.
    git(superproject, 'config', '--file', '.gitmodules', '--rename-section',
      'submodule.libs/child', 'submodule.the.child.lib');

    const [submodule] = await listSubmodules(superproject);

    // The name keeps its dots; taking everything up to the *last* dot is what
    // makes "submodule.the.child.lib.path" resolve to "the.child.lib".
    expect(submodule?.name).toBe('the.child.lib');
    expect(submodule?.path).toBe('libs/child');
  });

  it('reports a submodule declaring a path outside the repository as uninitialized', async () => {
    const repo = createRepoWithHistory();

    // .gitmodules is repository content, so this is what a hostile clone looks
    // like. It must never become a working directory git is run in.
    writeFile(
      repo,
      '.gitmodules',
      '[submodule "escape"]\n\tpath = ../../../escape\n\turl = https://example.com/x.git\n'
    );

    const [submodule] = await listSubmodules(repo);

    expect(submodule?.path).toBe('../../../escape');
    expect(submodule?.initialized).toBe(false);
    expect(submoduleRepoPath(repo, '../../../escape')).toBeNull();
  });

  it('finds a submodule nested inside a directory', async () => {
    const { superproject } = createSuperproject();

    // `ls-tree -r`: without it only the top level is listed and a submodule at
    // libs/child never gets its gitlink.
    const [submodule] = await listSubmodules(superproject);
    expect(submodule?.expectedOid).toBeTruthy();
  });
});

describe('initializing and updating', () => {
  it('checks out a submodule that was only declared', async () => {
    const clone = cloneWithUninitializedSubmodule();

    const response = await api(clone)
      .post('/api/submodules/update')
      .send({ init: true })
      .expect(200);

    expect(response.body.results[0]).toMatchObject({ path: 'libs/child', ok: true });
    expect(response.body.submodules[0]).toMatchObject({ initialized: true, missingCommit: false });
    expect(fs.existsSync(path.join(clone, 'libs', 'child', '.git'))).toBe(true);
  });

  it('moves the working tree back to the commit the superproject pins', async () => {
    const { superproject, child } = createSuperproject();
    const pinned = git(child, 'rev-parse', 'HEAD').trim();

    const inside = path.join(superproject, 'libs', 'child');
    writeFile(inside, 'later.txt', 'newer');
    git(inside, 'add', '.');
    git(inside, 'commit', '-m', 'newer');

    await api(superproject)
      .post('/api/submodules/update')
      .send({ paths: ['libs/child'] })
      .expect(200);

    const [submodule] = await listSubmodules(superproject);
    expect(submodule?.checkedOutOid).toBe(pinned);
    // Updating moves the working tree; it does not change what is pinned.
    expect(submodule?.expectedOid).toBe(pinned);
  });

  it('answers 404 for a path that is not a declared submodule', async () => {
    const { superproject } = createSuperproject();

    await api(superproject)
      .post('/api/submodules/update')
      .send({ paths: ['not/a/submodule'] })
      .expect(404);
  });

  it('reports each target separately when one of several fails', async () => {
    const { superproject } = createSuperproject();

    // A second submodule whose URL is gone, so one target fails and one works.
    git(superproject, 'config', '--file', '.gitmodules', 'submodule.broken.path', 'libs/broken');
    git(
      superproject,
      'config',
      '--file',
      '.gitmodules',
      'submodule.broken.url',
      path.join(createTempDir('multi-git-gone-'), 'missing.git')
    );

    const response = await api(superproject)
      .post('/api/submodules/update')
      .send({ init: true })
      .expect(200);

    const results = response.body.results as { path: string; ok: boolean }[];
    expect(results).toHaveLength(2);
    // A single `git submodule update` would have stopped at the first failure.
    expect(results.find((entry) => entry.path === 'libs/child')?.ok).toBe(true);
    expect(results.find((entry) => entry.path === 'libs/broken')?.ok).toBe(false);
  });
});

describe('syncing URLs', () => {
  it('copies a changed URL from .gitmodules into the clone config', async () => {
    const { superproject } = createSuperproject();
    const moved = createRepoWithHistory();

    // The case this exists for: the remote moved, .gitmodules was committed
    // with the new URL, and the local config still points at the old one.
    git(superproject, 'config', '--file', '.gitmodules', 'submodule.libs/child.url', moved);

    await api(superproject).post('/api/submodules/sync').send({}).expect(200);

    expect(git(superproject, 'config', '--get', 'submodule.libs/child.url').trim()).toBe(moved);
  });
});

describe('the tracked branch', () => {
  it('sets and clears it', async () => {
    const { superproject } = createSuperproject();

    await api(superproject)
      .post('/api/submodules/set-branch')
      .send({ path: 'libs/child', branch: 'main' })
      .expect(200);

    expect((await listSubmodules(superproject))[0]?.branch).toBe('main');

    await api(superproject)
      .post('/api/submodules/set-branch')
      .send({ path: 'libs/child', branch: '' })
      .expect(200);

    expect((await listSubmodules(superproject))[0]?.branch).toBeUndefined();
  });

  it('refuses a branch name git would read as an option', async () => {
    const { superproject } = createSuperproject();

    await api(superproject)
      .post('/api/submodules/set-branch')
      .send({ path: 'libs/child', branch: '--upload-pack=id' })
      .expect(400);
  });
});

describe('removing a working tree', () => {
  it('refuses a dirty submodule unless forced, and says why', async () => {
    const { superproject } = createSuperproject();
    writeFile(superproject, path.join('libs', 'child', 'scratch.txt'), 'unsaved work');

    const response = await api(superproject)
      .post('/api/submodules/deinit')
      .send({ paths: ['libs/child'], force: false })
      .expect(400);

    expect(response.body.error).toMatch(/uncommitted changes/i);
    // The refusal has to be a refusal: the file is still there.
    expect(fs.existsSync(path.join(superproject, 'libs', 'child', 'scratch.txt'))).toBe(true);
  });

  it('removes a clean one and captures a recovery point', async () => {
    const { superproject } = createSuperproject();

    const response = await api(superproject)
      .post('/api/submodules/deinit')
      .send({ paths: ['libs/child'] })
      .expect(200);

    expect(response.body.results[0]).toMatchObject({ path: 'libs/child', ok: true });
    expect(listCheckpoints(superproject)[0]?.label).toMatch(/Deinitialized/);

    // Still declared, so it can be checked out again.
    const [submodule] = await listSubmodules(superproject);
    expect(submodule?.path).toBe('libs/child');
    expect(submodule?.initialized).toBe(false);
  });
});

describe('opening a submodule as a repository', () => {
  it('resolves the absolute path for an initialized one', async () => {
    const { superproject } = createSuperproject();

    const response = await api(superproject)
      .get('/api/submodules/repo-path?path=libs%2Fchild')
      .expect(200);

    expect(response.body.path).toBe(path.join(superproject, 'libs', 'child'));
  });

  it('refuses one that has no working tree yet', async () => {
    const clone = cloneWithUninitializedSubmodule();

    await api(clone).get('/api/submodules/repo-path?path=libs%2Fchild').expect(409);
  });
});
