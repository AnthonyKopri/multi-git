// Git LFS, against a scripted `git lfs`.
//
// Scripted rather than integration, and for a reason the other Phase 4 tests do
// not share: LFS is a separate program that may not be installed, and a suite
// that only ran on a machine with it would be a suite that mostly did not run.
// Locking makes it worse — it needs a server implementing the LFS lock API,
// which no local fixture provides.
//
// So the runner is swapped and the assertions are about argv and about how each
// answer is interpreted. The cases worth pinning are the ones where LFS says
// something that is not a failure: not installed, no lock API, an object that
// exists as a pointer but has never been downloaded.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { setLfsRunner } from '../src/server/git/lfs';
import { FakeRunner, command } from './helpers/fake-runner';
import { cleanupRepos, createRepoWithHistory } from './helpers/temp-repo';

const app: Express = createApp();
let repo: string;
let runner: FakeRunner;

function api() {
  const agent = request(app);
  const headers = (req: request.Test): request.Test =>
    req.set('Host', '127.0.0.1').set('x-repo-path', repo);

  return {
    get: (url: string) => headers(agent.get(url)),
    post: (url: string) => headers(agent.post(url))
  };
}

/** A runner where `git lfs` exists and answers plausibly. */
function installedRunner(): FakeRunner {
  return new FakeRunner()
    .on(command('git', 'lfs', 'version'), { stdout: 'git-lfs/3.4.1 (GitHub; windows amd64)\n' })
    .on(command('git', 'lfs', 'track'), {
      stdout: 'Listing tracked patterns\n    *.psd (.gitattributes)\n    assets/** (.gitattributes)\n'
    })
    .on(command('git', 'lfs', 'ls-files'), {
      stdout: JSON.stringify({
        files: [
          { name: 'art/logo.psd', oid: 'aaa', size: 5_242_880, downloaded: true },
          { name: 'art/huge.psd', oid: 'bbb', size: 2_147_483_648, downloaded: false }
        ]
      })
    })
    .on(command('git', 'lfs', 'locks'), { stdout: '[]' })
    .otherwise({ exitCode: 0 });
}

beforeEach(() => {
  clearRepoPathCache();
  repo = createRepoWithHistory();
  runner = installedRunner();
  setLfsRunner(runner);
});

afterEach(() => {
  setLfsRunner();
});

afterAll(() => {
  cleanupRepos();
});

describe('when Git LFS is not installed', () => {
  beforeEach(() => {
    runner = new FakeRunner().otherwise({ spawnError: true });
    setLfsRunner(runner);
  });

  it('reports it as a state rather than an empty list', async () => {
    const response = await api().get('/api/lfs/status').expect(200);

    // An empty object list would read as "this repository has no large files",
    // which is a different and much more misleading answer.
    expect(response.body.status.availability.installed).toBe(false);
  });

  it('refuses to act, with a code and a place to get it', async () => {
    const response = await api()
      .post('/api/lfs/track')
      .send({ pattern: '*.psd' })
      .expect(409);

    expect(response.body.code).toBe('LFS_MISSING');
    expect(response.body.documentation).toContain('git-lfs.com');
  });

  it('never tries to install it', async () => {
    await api().post('/api/lfs/transfer').send({ action: 'fetch' }).expect(409);

    // Asserted on argv, not on `everythingSeen()`. That helper serialises the
    // environment too, which is right for the leak scans that use it and wrong
    // here: it made this test fail on a *branch named* something with "install"
    // in it, by way of GITHUB_HEAD_REF. What is being pinned is that no command
    // was run, and a command is its arguments.
    const commands = runner.calls.map((call) => call.args.join(' '));

    expect(commands.some((entry) => /\binstall\b/.test(entry))).toBe(false);
    // Positively: the only thing a refused transfer should have asked is
    // whether LFS exists at all.
    expect(commands).toEqual(['lfs version']);
  });
});

describe('reading the state', () => {
  it('reports the version and the tracked patterns', async () => {
    const response = await api().get('/api/lfs/status').expect(200);

    expect(response.body.status.availability).toMatchObject({
      installed: true,
      version: '3.4.1',
      configured: true
    });
    // The pattern is the first token; the file it came from is in parentheses
    // and is not part of it.
    expect(response.body.status.trackedPatterns).toEqual(['*.psd', 'assets/**']);
  });

  it('separates an object that is here from one that is only a pointer', async () => {
    const response = await api().get('/api/lfs/status').expect(200);

    const objects = response.body.status.objects as { path: string; present: boolean }[];
    expect(objects.find((object) => object.path === 'art/logo.psd')?.present).toBe(true);
    // The file is in the working tree; its 2GB of content is not.
    expect(objects.find((object) => object.path === 'art/huge.psd')?.present).toBe(false);
  });

  it('keeps the size from the pointer, which is known even when the object is not here', async () => {
    const response = await api().get('/api/lfs/status').expect(200);

    const huge = (response.body.status.objects as { path: string; size: number }[]).find(
      (object) => object.path === 'art/huge.psd'
    );
    expect(huge?.size).toBe(2_147_483_648);
  });

  it('survives a --json shape it does not recognise', async () => {
    runner.on(command('git', 'lfs', 'ls-files'), { stdout: 'not json at all' });

    const response = await api().get('/api/lfs/status').expect(200);

    // An empty list is honest; guessing at the plain text format would not be.
    expect(response.body.status.objects).toEqual([]);
    expect(response.body.status.availability.installed).toBe(true);
  });
});

describe('tracked patterns', () => {
  it('adds one through git lfs track, after a `--`', async () => {
    await api().post('/api/lfs/track').send({ pattern: '*.mp4' }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.includes('track') && entry.args.includes('*.mp4'));
    expect(call?.args).toEqual(['lfs', 'track', '--', '*.mp4']);
  });

  it('refuses a pattern containing a control character', async () => {
    // `git lfs track` writes the pattern into .gitattributes verbatim, and that
    // file is line-oriented, so a value carrying a NUL or a newline is stopped
    // before it can get there.
    await api()
      .post('/api/lfs/track')
      .send({ pattern: 'a\u0000b' })
      .expect(400);
  });

  it('accepts a pattern beginning with a hyphen, because of the `--`', async () => {
    // The separator is what makes this safe, rather than a rule against
    // hyphens: `-x` is a legitimate name for a file, and refusing the pattern
    // would be refusing a valid one for no gain.
    await api().post('/api/lfs/track').send({ pattern: '-weird-name' }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.includes('-weird-name'));
    expect(call?.args).toEqual(['lfs', 'track', '--', '-weird-name']);
  });

  it('removes one through git lfs untrack', async () => {
    await api().post('/api/lfs/untrack').send({ pattern: '*.psd' }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.includes('untrack'));
    expect(call?.args).toEqual(['lfs', 'untrack', '--', '*.psd']);
  });
});

describe('transfers', () => {
  it('previews before moving anything', async () => {
    runner.on(command('git', 'lfs', 'fetch', '--dry-run'), {
      stdout: 'fetch bbb => art/huge.psd\nfetch ccc => art/other.psd\n'
    });

    const response = await api().get('/api/lfs/preview?action=fetch').expect(200);

    expect(response.body.preview.objectCount).toBe(2);
    expect(response.body.preview.samplePaths).toContain('art/huge.psd');
    // The size comes from the objects that are missing, which is what the
    // transfer would actually pull.
    expect(response.body.preview.totalBytes).toBe(2_147_483_648);
  });

  it('runs a fetch and reports it finished', async () => {
    const response = await api().post('/api/lfs/transfer').send({ action: 'fetch' }).expect(200);

    expect(response.body.success).toBe(true);
    const call = runner.callsTo('git').find((entry) => entry.args.join(' ') === 'lfs fetch');
    expect(call).toBeTruthy();
  });

  it('reports a failed transfer with its own code, not as a git failure', async () => {
    runner.on(command('git', 'lfs', 'fetch'), {
      exitCode: 2,
      stderr: 'batch response: Repository or object not found'
    });

    const response = await api().post('/api/lfs/transfer').send({ action: 'fetch' }).expect(502);

    // A push that fails because the LFS server rejected an upload has a
    // different fix from one that fails because the branch moved.
    expect(response.body.code).toBe('LFS_TRANSFER_FAILED');
    expect(response.body.error).toMatch(/not found/i);
  });

  it('refuses an action that is not one of the three', async () => {
    await api().post('/api/lfs/transfer').send({ action: 'push --force' }).expect(400);
  });

  it('never asks for credentials at a prompt nothing is reading', async () => {
    await api().post('/api/lfs/transfer').send({ action: 'prune' }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.includes('prune'));
    expect(call?.options.env?.['GIT_TERMINAL_PROMPT']).toBe('0');
  });
});

describe('locks', () => {
  const lockJson = JSON.stringify([
    { id: '1', path: 'art/logo.psd', owner: { name: 'someone-else' }, locked_at: '2026-08-01T10:00:00Z' },
    { id: '2', path: 'art/mine.psd', owner: { name: 'me' }, locked_at: '2026-08-02T10:00:00Z' }
  ]);

  it('marks which locks are the user’s own', async () => {
    runner
      .on(command('git', 'lfs', 'locks', '--json'), { stdout: lockJson })
      .on(command('git', 'lfs', 'locks', '--verify'), {
        stdout: JSON.stringify({ ours: [{ id: '2' }], theirs: [{ id: '1' }] })
      });

    const response = await api().get('/api/lfs/locks').expect(200);

    const locks = response.body.locks as { path: string; mine: boolean }[];
    expect(locks.find((lock) => lock.path === 'art/mine.psd')?.mine).toBe(true);
    expect(locks.find((lock) => lock.path === 'art/logo.psd')?.mine).toBe(false);
  });

  it('treats every lock as someone else’s when --verify cannot be read', async () => {
    runner
      .on(command('git', 'lfs', 'locks', '--json'), { stdout: lockJson })
      .on(command('git', 'lfs', 'locks', '--verify'), { exitCode: 1, stderr: 'not supported' });

    const response = await api().get('/api/lfs/locks').expect(200);

    // The safe direction: it offers force-release rather than a plain one,
    // which asks the user rather than assuming.
    expect((response.body.locks as { mine: boolean }[]).every((lock) => !lock.mine)).toBe(true);
  });

  it('reports a server without the lock API as a fact, not a failure', async () => {
    runner.on(command('git', 'lfs', 'locks'), {
      exitCode: 1,
      stderr: 'Server does not support locking'
    });

    const response = await api().get('/api/lfs/locks').expect(200);

    // Locking is optional in the LFS spec, so its absence is information.
    expect(response.body.locks).toEqual([]);
    expect(response.body.unavailable).toMatch(/locking/i);
  });

  it('takes a lock', async () => {
    await api().post('/api/lfs/lock').send({ path: 'art/logo.psd' }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.includes('lock'));
    expect(call?.args).toEqual(['lfs', 'lock', '--', 'art/logo.psd']);
  });

  it('releases one without --force by default', async () => {
    await api().post('/api/lfs/unlock').send({ path: 'art/mine.psd' }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.includes('unlock'));
    expect(call?.args).toEqual(['lfs', 'unlock', '--', 'art/mine.psd']);
    expect(call?.args).not.toContain('--force');
  });

  it('passes --force only when it was explicitly asked for', async () => {
    await api().post('/api/lfs/unlock').send({ path: 'art/logo.psd', force: true }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.includes('unlock'));
    expect(call?.args).toEqual(['lfs', 'unlock', '--force', '--', 'art/logo.psd']);
  });

  it('never retries a refused unlock as a forced one', async () => {
    runner.on(command('git', 'lfs', 'unlock'), {
      exitCode: 1,
      stderr: 'Forbidden: lock is owned by someone-else'
    });

    const response = await api()
      .post('/api/lfs/unlock')
      .send({ path: 'art/logo.psd' })
      .expect(403);

    expect(response.body.error).toMatch(/forbidden/i);
    // Taking someone else's lock has to be the user's decision, so exactly one
    // attempt was made and it did not carry --force.
    const attempts = runner.callsTo('git').filter((entry) => entry.args.includes('unlock'));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.args).not.toContain('--force');
  });
});

describe('cancellation', () => {
  it('hands the operation’s signal to the transfer', async () => {
    await api().post('/api/lfs/transfer').send({ action: 'fetch' }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.join(' ') === 'lfs fetch');
    // Without a signal reaching the child, the operations bar could show a
    // Cancel button that does nothing.
    expect(call?.options.signal).toBeDefined();
  });
});

/**
 * Whether LFS is wired into *this repository*.
 *
 * A third question, and the one the other two kept hiding. "Is git-lfs on
 * PATH" and "does this project track large files" can both be answered without
 * noticing that `git lfs install` has written four hooks which run on every
 * pull, merge, checkout and commit regardless. On an SSH remote those hooks ask
 * ssh for an LFS token, so a repository with no large files in it can still sit
 * waiting on a passphrase prompt under a line that says Git LFS.
 *
 * These run against a real repository on disk rather than a scripted runner:
 * the hooks and `.gitattributes` are real files, and reading them correctly is
 * the whole of what is being tested.
 */
describe('repository-level installation', () => {
  const hooksDir = (): string => path.join(repo, '.git', 'hooks');

  /** Writes the hooks `git lfs install` writes. */
  function writeLfsHooks(names: readonly string[] = ['post-checkout', 'post-merge', 'pre-push']): void {
    fs.mkdirSync(hooksDir(), { recursive: true });
    for (const name of names) {
      fs.writeFileSync(
        path.join(hooksDir(), name),
        `#!/bin/sh\ncommand -v git-lfs >/dev/null 2>&1 || exit 2\ngit lfs ${name} "$@"\n`
      );
    }
  }

  it('reports a repository with no hooks as not installed', async () => {
    const response = await api().get('/api/lfs/status').expect(200);

    expect(response.body.status.installation).toMatchObject({
      installed: false,
      redundant: false
    });
  });

  it('finds the hooks git lfs install writes', async () => {
    writeLfsHooks();

    const response = await api().get('/api/lfs/status').expect(200);

    expect(response.body.status.installation.installed).toBe(true);
    expect(response.body.status.installation.hooks).toEqual(
      expect.arrayContaining(['post-checkout', 'post-merge', 'pre-push'])
    );
  });

  it('calls hooks that track nothing redundant', async () => {
    writeLfsHooks();
    // A repository that routes nothing through LFS has no LFS objects either;
    // the shared fixture's two are what a repository that does use it looks
    // like, which is the opposite case.
    runner.on(command('git', 'lfs', 'ls-files'), { stdout: JSON.stringify({ files: [] }) });

    const response = await api().get('/api/lfs/status').expect(200);

    // Nothing is routed through the filter and no objects are present, so the
    // hooks cost something on every pull and return nothing.
    expect(response.body.status.installation.redundant).toBe(true);
  });

  it('does not call them redundant when a file is routed through LFS', async () => {
    writeLfsHooks();
    fs.writeFileSync(path.join(repo, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n');

    const response = await api().get('/api/lfs/status').expect(200);

    expect(response.body.status.installation.redundant).toBe(false);
  });

  it('reads .gitattributes rather than asking git lfs, so a missing binary cannot mislead it', async () => {
    // The repository whose hooks outlived the program. `git lfs track` cannot
    // run here, would answer "no patterns", and would make a repository that
    // genuinely uses LFS look safe to strip.
    setLfsRunner(new FakeRunner().otherwise({ spawnError: true }));
    writeLfsHooks();
    fs.writeFileSync(path.join(repo, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs\n');

    const response = await api().get('/api/lfs/status').expect(200);

    expect(response.body.status.availability.installed).toBe(false);
    expect(response.body.status.installation.installed).toBe(true);
    expect(response.body.status.installation.redundant).toBe(false);
  });

  it('leaves a hand-written hook that merely shares a name alone', async () => {
    fs.mkdirSync(hooksDir(), { recursive: true });
    fs.writeFileSync(path.join(hooksDir(), 'pre-push'), '#!/bin/sh\nnpm test\n');

    const response = await api().get('/api/lfs/status').expect(200);

    // Matched on the body, not the name: deleting someone's own pre-push
    // because LFS uses that name too would be far worse than missing an
    // installation.
    expect(response.body.status.installation.installed).toBe(false);
    expect(response.body.status.installation.hooks).toEqual([]);
  });
});

describe('changing the installation', () => {
  it('always scopes the change to this repository', async () => {
    await api().post('/api/lfs/installation').send({ action: 'uninstall' }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.includes('uninstall'));

    // Without --local these write the user's *global* config, so an uninstall
    // meant to speed one repository up would take LFS out of every other
    // repository on the machine.
    expect(call?.args).toEqual(['lfs', 'uninstall', '--local']);
  });

  it('installs with --local too', async () => {
    await api().post('/api/lfs/installation').send({ action: 'install' }).expect(200);

    const call = runner.callsTo('git').find((entry) => entry.args.includes('install'));
    expect(call?.args).toEqual(['lfs', 'install', '--local']);
  });

  it('rejects anything that is not install or uninstall', async () => {
    await api().post('/api/lfs/installation').send({ action: 'purge' }).expect(400);
  });

  it('will not install what is not there', async () => {
    setLfsRunner(new FakeRunner().otherwise({ spawnError: true }));

    const response = await api().post('/api/lfs/installation').send({ action: 'install' }).expect(409);

    expect(response.body.code).toBe('LFS_MISSING');
  });

  it('still removes hooks when git lfs itself is gone', async () => {
    // The state that hurts most: hooks left by a machine that had LFS, on one
    // that does not. `git lfs uninstall` cannot run, and those hooks are
    // exactly what is slowing every pull down.
    setLfsRunner(new FakeRunner().otherwise({ spawnError: true }));

    const hooks = path.join(repo, '.git', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, 'post-merge'), '#!/bin/sh\ngit lfs post-merge "$@"\n');
    fs.writeFileSync(path.join(hooks, 'pre-push'), '#!/bin/sh\nnpm test\n');

    const response = await api()
      .post('/api/lfs/installation')
      .send({ action: 'uninstall' })
      .expect(200);

    expect(response.body.installation.installed).toBe(false);
    expect(fs.existsSync(path.join(hooks, 'post-merge'))).toBe(false);
    // Not ours, not touched.
    expect(fs.existsSync(path.join(hooks, 'pre-push'))).toBe(true);
  });
});
