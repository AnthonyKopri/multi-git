// Patches against real repositories and a real git.
//
// The traversal cases are the point of this file. A patch arrives from a file,
// a clipboard or an email — it is untrusted input — and `git apply` will follow
// `../../..` out of the repository if a patch asks it to. Those are asserted by
// checking the file was not written, not only that the request was refused.
//
// The encoding case matters as much and is easier to get wrong silently: a
// patch is bytes, and decoding it as UTF-8 anywhere in the pipeline corrupts
// every file that is not UTF-8.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { clearCheckpoints, listCheckpoints } from '../src/server/safety-net/checkpoints';
import { clearRecoveryCache } from '../src/server/safety-net/recovery';
import { pathsInPatch } from '../src/server/git/patches';
import { cleanupRepos, createRepoWithHistory, createTempDir, git, writeFile } from './helpers/temp-repo';

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

beforeEach(() => {
  clearRepoPathCache();
  clearCheckpoints();
  clearRecoveryCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('reading a patch', () => {
  it('finds the paths in a git-style header', () => {
    const patch = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 111..222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new'
    ].join('\n');

    expect(pathsInPatch(patch)).toContain('src/app.ts');
  });

  it('finds them in a plain diff with no git header', () => {
    const patch = ['--- a/notes.txt', '+++ b/notes.txt', '@@ -1 +1 @@', '-a', '+b'].join('\n');

    expect(pathsInPatch(patch)).toEqual(['notes.txt']);
  });

  it('ignores /dev/null, which is a deletion rather than a path', () => {
    const patch = ['--- a/gone.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-a'].join('\n');

    expect(pathsInPatch(patch)).not.toContain('/dev/null');
  });
});

describe('creating a patch', () => {
  it('builds a mailbox patch that keeps the commit message', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'feature.txt', 'a feature');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'feat: add the feature');

    const response = await api(repo)
      .post('/api/patches/create')
      .send({ format: 'mailbox', from: 'HEAD', source: 'commits' })
      .expect(200);

    // The reason to choose mailbox over a plain diff.
    expect(response.body.preview.text).toContain('feat: add the feature');
    expect(response.body.preview.paths).toContain('feature.txt');
  });

  it('builds a plain diff of uncommitted work', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', 'changed content');

    const response = await api(repo)
      .post('/api/patches/create')
      .send({ format: 'diff', from: 'HEAD', source: 'working' })
      .expect(200);

    expect(response.body.preview.paths).toContain('README.md');
  });

  it('refuses to produce an empty patch rather than writing a blank file', async () => {
    const repo = createRepoWithHistory();

    await api(repo)
      .post('/api/patches/create')
      .send({ format: 'diff', from: 'HEAD', source: 'working' })
      .expect(400);
  });

  it('notices a binary patch, which git am cannot always take', async () => {
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'logo.bin'), Buffer.from([0, 1, 2, 3, 255, 254]));
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'add a binary file');

    const response = await api(repo)
      .post('/api/patches/create')
      .send({ format: 'mailbox', from: 'HEAD', source: 'commits' })
      .expect(200);

    expect(response.body.preview.hasBinary).toBe(true);
  });
});

describe('refusing a patch that writes outside the repository', () => {
  const traversal = [
    'diff --git a/../../escaped.txt b/../../escaped.txt',
    '--- a/../../escaped.txt',
    '+++ b/../../escaped.txt',
    '@@ -0,0 +1 @@',
    '+owned'
  ].join('\n');

  it('refuses a relative path that climbs out', async () => {
    const repo = createRepoWithHistory();

    const response = await api(repo)
      .post('/api/patches/apply')
      .send({ patch: traversal, mode: 'working' })
      .expect(400);

    expect(response.body.error).toMatch(/outside the repository/i);

    // The refusal has to be a refusal: nothing was written above the repo.
    expect(fs.existsSync(path.resolve(repo, '..', '..', 'escaped.txt'))).toBe(false);
  });

  it('refuses an absolute path', async () => {
    const repo = createRepoWithHistory();
    const target = path.join(createTempDir('multi-git-target-'), 'absolute.txt');
    const absolute = [
      `diff --git a/${target} b/${target}`,
      `--- a/${target}`,
      `+++ b/${target}`,
      '@@ -0,0 +1 @@',
      '+owned'
    ].join('\n');

    const response = await api(repo)
      .post('/api/patches/apply')
      .send({ patch: absolute, mode: 'working' })
      .expect(400);

    expect(response.body.error).toMatch(/absolute path/i);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses something that is not a patch at all', async () => {
    const repo = createRepoWithHistory();

    await api(repo)
      .post('/api/patches/apply')
      .send({ patch: 'just some text', mode: 'working' })
      .expect(400);
  });

  it('takes no recovery point for a refusal', async () => {
    const repo = createRepoWithHistory();

    await api(repo).post('/api/patches/apply').send({ patch: traversal, mode: 'working' }).expect(400);

    // The journal should record what happened, not what was attempted and
    // stopped at the door.
    expect(listCheckpoints(repo)).toEqual([]);
  });
});

describe('applying a patch', () => {
  /** A patch that turns README.md's content into something known. */
  function readmePatch(repo: string): string {
    writeFile(repo, 'README.md', 'patched content\n');
    const patch = git(repo, 'diff');
    git(repo, 'checkout', '--', 'README.md');
    return patch;
  }

  it('checks without writing when asked for a dry run', async () => {
    const repo = createRepoWithHistory();
    const patch = readmePatch(repo);
    const before = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');

    const response = await api(repo)
      .post('/api/patches/apply')
      .send({ patch, mode: 'working', dryRun: true })
      .expect(200);

    expect(response.body.outcome.dryRun).toBe(true);
    expect(response.body.outcome.applied).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe(before);
    // A check writes nothing, so it takes no recovery point either.
    expect(listCheckpoints(repo)).toEqual([]);
  });

  it('applies for real, and captures a recovery point first', async () => {
    const repo = createRepoWithHistory();
    const patch = readmePatch(repo);

    const response = await api(repo)
      .post('/api/patches/apply')
      .send({ patch, mode: 'working' })
      .expect(200);

    expect(response.body.outcome.applied).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe('patched content\n');
    expect(listCheckpoints(repo)[0]?.label).toMatch(/Applied a patch/);
  });

  it('reports a patch that does not apply as a conflict rather than a crash', async () => {
    const repo = createRepoWithHistory();
    const patch = readmePatch(repo);

    // Move the file out from under the patch so its context no longer matches.
    writeFile(repo, 'README.md', 'something else entirely\n');

    const response = await api(repo)
      .post('/api/patches/apply')
      .send({ patch, mode: 'working' })
      .expect(409);

    expect(response.body.error).toBeTruthy();
  });

  it('round-trips a patch whose content is UTF-8 but not ASCII', async () => {
    const repo = createRepoWithHistory();

    // Multi-byte UTF-8 throughout: an em dash, an accented letter and an emoji.
    const original = Buffer.from('Café — built with ❤\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'unicode.txt'), original);
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'add a unicode file');

    const changed = Buffer.from('Café — rebuilt with ❤❤\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'unicode.txt'), changed);
    const patch = git(repo, 'diff');
    git(repo, 'checkout', '--', 'unicode.txt');

    await api(repo).post('/api/patches/apply').send({ patch, mode: 'working' }).expect(200);

    // Encoding the patch back as latin1 — the transport ./encoding.ts uses for
    // git's own bytes — would mangle every character above U+00FF here, because
    // this string arrived as text and was already decoded.
    expect([...fs.readFileSync(path.join(repo, 'unicode.txt'))]).toEqual([...changed]);
  });

  it('marks a binary patch, which is the case that cannot round-trip as text', async () => {
    const repo = createRepoWithHistory();

    // A patch is bytes, and a patch field in a JSON body is text. Anything
    // whose bytes are not valid UTF-8 has already been decoded by the time it
    // reaches the server, so the preview flags it rather than pretending.
    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 0xe9, 0xff]));
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'add binary');

    const response = await api(repo)
      .post('/api/patches/create')
      .send({ format: 'diff', from: 'HEAD', source: 'commits' })
      .expect(200);

    expect(response.body.preview.hasBinary).toBe(true);
  });

  it('replays a mailbox series as commits, keeping the message', async () => {
    const source = createRepoWithHistory();
    writeFile(source, 'from-series.txt', 'series content');
    git(source, 'add', '.');
    git(source, 'commit', '-m', 'feat: from the series');

    const built = await api(source)
      .post('/api/patches/create')
      .send({ format: 'mailbox', from: 'HEAD', source: 'commits' })
      .expect(200);

    // A second repository with the same history minus that commit.
    const target = createRepoWithHistory();
    const response = await api(target)
      .post('/api/patches/apply')
      .send({ patch: built.body.preview.text, mode: 'commits' })
      .expect(200);

    expect(response.body.outcome.applied).toBe(true);
    expect(git(target, 'log', '-1', '--format=%s').trim()).toBe('feat: from the series');
  });
});

describe('a stopped patch series', () => {
  it('reports no series in progress for a clean repository', async () => {
    const repo = createRepoWithHistory();

    const response = await api(repo).get('/api/patches/am-state').expect(200);

    expect(response.body.state.inProgress).toBe(false);
  });

  it('refuses continue, skip and abort when nothing is in progress', async () => {
    const repo = createRepoWithHistory();

    for (const action of ['continue', 'skip', 'abort']) {
      await api(repo).post('/api/patches/am').send({ action }).expect(409);
    }
  });

  it('refuses an action that is not one of the three', async () => {
    const repo = createRepoWithHistory();

    await api(repo).post('/api/patches/am').send({ action: 'rm -rf' }).expect(400);
  });
});
