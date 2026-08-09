// Remote management against real repositories and a real git.
//
// Integration rather than mocked, because almost every claim this code makes is
// a claim about git's behaviour: that `--get-regexp -z` round-trips a URL with
// a space in it, that `remote rename` carries the refspecs with it, that
// `prune --dry-run` names the refs it would delete. A scripted runner would
// only assert that this file's own idea of git is self-consistent.
//
// Connectivity is tested against a local bare repository over a file path, so
// "reachable" and "not reachable" are both real answers from real git with no
// network and no credentials anywhere.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { clearCheckpoints, listCheckpoints } from '../src/server/safety-net/checkpoints';
import { clearRecoveryCache } from '../src/server/safety-net/recovery';
import { listRemotes } from '../src/server/git/remotes';
import { cleanupRepos, createRepoWithHistory, createTempDir, git } from './helpers/temp-repo';
import type { RemoteInfo } from '../src/shared/remote-types';

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

/** A bare repository that a remote can genuinely be fetched from. */
function createBareRepo(): string {
  const bare = path.join(createTempDir('multi-git-bare-'), 'origin.git');
  git(path.dirname(bare), 'init', '--bare', '--initial-branch=main', bare);
  return bare;
}

beforeEach(() => {
  clearRepoPathCache();
  clearCheckpoints();
  clearRecoveryCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('listing remotes', () => {
  it('reports a remote with no remotes at all', async () => {
    const repo = createRepoWithHistory();

    const response = await api(repo).get('/api/remotes').expect(200);

    expect(response.body.remotes).toEqual([]);
  });

  it('reads the URL, refspecs and prune preference together', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'git@github.com:owner/repo.git');
    git(repo, 'config', 'remote.origin.prune', 'true');

    const [origin] = await listRemotes(repo);

    expect(origin).toMatchObject({
      name: 'origin',
      fetchUrl: 'git@github.com:owner/repo.git',
      // No pushurl set, so pushes go where fetches go.
      pushUrl: 'git@github.com:owner/repo.git',
      prune: true,
      pruneInherited: false
    });
    expect(origin?.fetchRefspecs).toEqual(['+refs/heads/*:refs/remotes/origin/*']);
  });

  it('separates the push URL from the fetch URL, which is the fork workflow', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'https://github.com/upstream/repo.git');
    git(repo, 'remote', 'set-url', '--push', 'origin', 'git@github.com:me/repo.git');

    const [origin] = await listRemotes(repo);

    expect(origin?.fetchUrl).toBe('https://github.com/upstream/repo.git');
    expect(origin?.pushUrl).toBe('git@github.com:me/repo.git');
  });

  it('distinguishes prune set on the remote from prune inherited from fetch.prune', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'https://example.com/repo.git');
    git(repo, 'config', 'fetch.prune', 'true');

    const [inherited] = await listRemotes(repo);
    expect(inherited).toMatchObject({ prune: true, pruneInherited: true });

    // Setting it explicitly to false has to beat the inherited true, or the UI
    // would show a checkbox that does not reflect what fetch will do.
    git(repo, 'config', 'remote.origin.prune', 'false');
    const [explicit] = await listRemotes(repo);
    expect(explicit).toMatchObject({ prune: false, pruneInherited: false });
  });

  it('keeps several remotes and several fetch refspecs apart', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'https://example.com/a.git');
    git(repo, 'remote', 'add', 'upstream', 'https://example.com/b.git');
    git(repo, 'config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*');

    const remotes = await listRemotes(repo);
    const origin = remotes.find((remote) => remote.name === 'origin');

    expect(remotes.map((remote) => remote.name).sort()).toEqual(['origin', 'upstream']);
    expect(origin?.fetchRefspecs).toHaveLength(2);
  });
});

describe('adding and editing a remote', () => {
  it('adds a remote with everything set in one call', async () => {
    const repo = createRepoWithHistory();

    const response = await api(repo)
      .post('/api/remotes')
      .send({
        name: 'upstream',
        fetchUrl: 'https://example.com/upstream.git',
        pushUrl: 'git@example.com:me/fork.git',
        prune: true
      })
      .expect(200);

    expect(response.body.remote).toMatchObject({
      name: 'upstream',
      fetchUrl: 'https://example.com/upstream.git',
      pushUrl: 'git@example.com:me/fork.git',
      prune: true
    });
  });

  it('refuses a name git would read as an option', async () => {
    const repo = createRepoWithHistory();

    const response = await api(repo)
      .post('/api/remotes')
      .send({ name: '--upload-pack=touch /tmp/pwned', fetchUrl: 'https://example.com/a.git' })
      .expect(400);

    expect(response.body.error).toMatch(/may not start with/i);
    expect(await listRemotes(repo)).toEqual([]);
  });

  it('refuses a URL git would read as an option', async () => {
    const repo = createRepoWithHistory();

    await api(repo)
      .post('/api/remotes')
      .send({ name: 'origin', fetchUrl: '--config=core.pager=id' })
      .expect(400);

    expect(await listRemotes(repo)).toEqual([]);
  });

  it('refuses an ext:: URL, which would run a program on every fetch', async () => {
    const repo = createRepoWithHistory();

    const response = await api(repo)
      .post('/api/remotes')
      .send({ name: 'evil', fetchUrl: 'ext::sh -c "id >/tmp/pwned"' })
      .expect(400);

    expect(response.body.error).toMatch(/ext::/i);
    expect(await listRemotes(repo)).toEqual([]);
  });

  it('refuses a second remote with a name already taken', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'https://example.com/a.git');

    const response = await api(repo)
      .post('/api/remotes')
      .send({ name: 'origin', fetchUrl: 'https://example.com/b.git' })
      .expect(400);

    expect(response.body.error).toMatch(/already has a remote/i);
    // The original URL is untouched.
    expect((await listRemotes(repo))[0]?.fetchUrl).toBe('https://example.com/a.git');
  });

  it('renames a remote and carries its refspecs with it', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'https://example.com/a.git');

    const response = await api(repo)
      .post('/api/remotes/update')
      .send({ name: 'origin', newName: 'upstream' })
      .expect(200);

    expect(response.body.remote.name).toBe('upstream');
    // git rewrites the refspec on rename; if it did not, fetches would write to
    // refs/remotes/origin/* under a remote called upstream.
    expect(response.body.remote.fetchRefspecs).toEqual([
      '+refs/heads/*:refs/remotes/upstream/*'
    ]);
  });

  it('replaces refspecs rather than appending to them', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'https://example.com/a.git');

    await api(repo)
      .post('/api/remotes/update')
      .send({ name: 'origin', fetchRefspecs: ['+refs/heads/main:refs/remotes/origin/main'] })
      .expect(200);

    // An editor that only ever adds cannot remove a refspec, which is the whole
    // reason the key is unset first.
    const [origin] = await listRemotes(repo);
    expect(origin?.fetchRefspecs).toEqual(['+refs/heads/main:refs/remotes/origin/main']);
  });

  it('clears the push URL when it is emptied', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'https://example.com/a.git');
    git(repo, 'remote', 'set-url', '--push', 'origin', 'git@example.com:me/a.git');

    await api(repo).post('/api/remotes/update').send({ name: 'origin', pushUrl: '' }).expect(200);

    // "Push where you fetch" is the absence of the key, not an empty one.
    const [origin] = await listRemotes(repo);
    expect(origin?.pushUrl).toBe('https://example.com/a.git');
  });

  it('answers 404 for a remote that is not there', async () => {
    const repo = createRepoWithHistory();

    await api(repo)
      .post('/api/remotes/update')
      .send({ name: 'nope', fetchUrl: 'https://example.com/a.git' })
      .expect(404);
  });
});

describe('removing a remote', () => {
  it('removes it and captures a recovery point first', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'https://example.com/a.git');

    await api(repo).delete('/api/remotes').send({ name: 'origin' }).expect(200);

    expect(await listRemotes(repo)).toEqual([]);
    // The tracking refs go with the remote, so the checkpoint is the only
    // record left that they existed.
    expect(listCheckpoints(repo)[0]?.label).toMatch(/Removed remote origin/);
  });

  it('refuses to remove one that does not exist', async () => {
    const repo = createRepoWithHistory();

    await api(repo).delete('/api/remotes').send({ name: 'nope' }).expect(404);
  });
});

describe('pruning', () => {
  /** A clone whose origin has since lost a branch. */
  function repoWithStaleTrackingRef(): { clone: string; bare: string } {
    const bare = createBareRepo();
    const seed = createRepoWithHistory();

    git(seed, 'remote', 'add', 'origin', bare);
    git(seed, 'push', 'origin', 'main');
    git(seed, 'branch', 'doomed');
    git(seed, 'push', 'origin', 'doomed');

    const parent = createTempDir('multi-git-clone-');
    git(parent, 'clone', bare, path.join(parent, 'clone'));
    const clone = path.join(parent, 'clone');
    git(clone, 'config', 'user.email', 'test@example.com');
    git(clone, 'config', 'user.name', 'Test User');

    // The branch goes from the remote; the clone's tracking ref stays behind.
    git(seed, 'push', 'origin', '--delete', 'doomed');

    return { clone, bare };
  }

  it('names the refs a prune would delete, before deleting anything', async () => {
    const { clone } = repoWithStaleTrackingRef();

    const response = await api(clone)
      .get('/api/remotes/prune-preview?name=origin')
      .expect(200);

    expect(response.body.preview.staleRefs).toContain('origin/doomed');
    // Preview only: the ref is still there.
    expect(git(clone, 'branch', '-r')).toContain('origin/doomed');
  });

  it('prunes, and records what it removed', async () => {
    const { clone } = repoWithStaleTrackingRef();

    const response = await api(clone).post('/api/remotes/prune').send({ name: 'origin' }).expect(200);

    expect(response.body.pruned).toContain('origin/doomed');
    expect(git(clone, 'branch', '-r')).not.toContain('origin/doomed');
    expect(listCheckpoints(clone)[0]?.label).toMatch(/Pruned 1 stale ref/);
  });

  it('reports an empty preview when nothing is stale', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', createBareRepo());

    const response = await api(repo).get('/api/remotes/prune-preview?name=origin').expect(200);

    expect(response.body.preview.staleRefs).toEqual([]);
  });
});

describe('connectivity', () => {
  it('reaches a remote that is really there', async () => {
    const repo = createRepoWithHistory();
    const bare = createBareRepo();
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', 'origin', 'main');

    const response = await api(repo).post('/api/remotes/test').send({ name: 'origin' }).expect(200);

    expect(response.body.result.reachable).toBe(true);
    expect(response.body.result.refCount).toBeGreaterThan(0);
  });

  it('reports a remote that is not there as unreachable rather than throwing', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', path.join(createTempDir('multi-git-gone-'), 'missing.git'));

    const response = await api(repo).post('/api/remotes/test').send({ name: 'origin' }).expect(200);

    expect(response.body.result.reachable).toBe(false);
    expect(response.body.result.message).toBeTruthy();
  });
});

describe('fetching every remote', () => {
  it('reports each remote separately so one failure does not hide the rest', async () => {
    const repo = createRepoWithHistory();
    const good = createBareRepo();

    git(repo, 'remote', 'add', 'good', good);
    git(repo, 'push', 'good', 'main');
    git(repo, 'remote', 'add', 'bad', path.join(createTempDir('multi-git-gone-'), 'missing.git'));

    const response = await api(repo).post('/api/remotes/fetch-all').send({}).expect(200);

    const results = response.body.results as { remote: string; ok: boolean }[];
    expect(results.find((entry) => entry.remote === 'good')?.ok).toBe(true);
    expect(results.find((entry) => entry.remote === 'bad')?.ok).toBe(false);
    // Both are reported; a single `git fetch --all` would have stopped at the
    // first failure and said nothing about the other.
    expect(results).toHaveLength(2);
  });
});

describe('the SSH/HTTPS pill', () => {
  it('goes through the remote editor, so both agree what a valid URL is', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git');

    const response = await api(repo)
      .post('/api/git/remote/origin/toggle-protocol')
      .send({})
      .expect(200);

    expect(response.body.remoteUrl).toBe('git@github.com:owner/repo.git');

    // Read back through the listing rather than the response, to prove the
    // config was actually written and not just echoed.
    const [origin] = (await listRemotes(repo)) as RemoteInfo[];
    expect(origin?.fetchUrl).toBe('git@github.com:owner/repo.git');
  });
});
