// GPG signing, against a real key in a throwaway keyring.
//
// The SSH cases in signing.test.ts cover the paths that need no agent and no
// keyring. GPG is the other half, and it was previously exercised only for
// configuration and diagnostics — so a mistake in how a GPG signature was read
// back, or in what a failed GPG signing attempt reported, would not have been
// caught by anything.
//
// Everything here runs against a GNUPGHOME of its own. Nothing touches, reads
// or writes the developer's own keyring, and the key is generated without a
// passphrase so no agent has to be asked for one.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import type { SignatureInfo } from '../src/shared/signing-types';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

const app: Express = createApp();

const SIGNER_NAME = 'Multi-Git Test';
const SIGNER_EMAIL = 'multi-git-test@example.invalid';

/** The directory as Node sees it, for creating and removing it. */
let gnupgHome: string | null = null;

/**
 * The same directory in the form gpg wants.
 *
 * On Windows the gpg that ships with Git is an MSYS build and reads a POSIX
 * path; handing it `C:\Users\...` makes it treat the whole thing as
 * relative and fail with "No such file or directory". Everywhere else the two
 * are the same string.
 */
let gnupgHomeForGpg: string | null = null;

let keyId: string | null = null;

function asGpgPath(nodePath: string): string {
  if (process.platform !== 'win32') {
    return nodePath;
  }

  try {
    return execFileSync('cygpath', ['-u', nodePath], { encoding: 'utf8' }).trim();
  } catch {
    // A native Windows gpg wants the Windows path, which is what this is.
    return nodePath;
  }
}

/**
 * Builds a keyring with one unprotected key.
 *
 * Returns null when gpg is missing or refuses, which is a normal state on a
 * machine without it — the tests below skip rather than pretend to have run.
 */
function makeKeyring(): { home: string; homeForGpg: string; keyId: string } | null {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-gnupg-'));
  const homeForGpg = asGpgPath(home);

  try {
    // gpg refuses a world-readable home directory on POSIX.
    fs.chmodSync(home, 0o700);

    const script = [
      '%no-protection',
      '%echo generating',
      'Key-Type: eddsa',
      'Key-Curve: ed25519',
      'Key-Usage: sign',
      `Name-Real: ${SIGNER_NAME}`,
      `Name-Email: ${SIGNER_EMAIL}`,
      'Expire-Date: 0',
      '%commit'
    ].join('\n');

    execFileSync('gpg', ['--batch', '--gen-key'], {
      input: script,
      env: { ...process.env, GNUPGHOME: homeForGpg },
      stdio: ['pipe', 'ignore', 'ignore']
    });

    const listed = execFileSync(
      'gpg',
      ['--batch', '--list-secret-keys', '--with-colons', SIGNER_EMAIL],
      { env: { ...process.env, GNUPGHOME: homeForGpg }, encoding: 'utf8' }
    );

    // The fingerprint line following the secret key is the id git wants.
    const fingerprint = listed
      .split('\n')
      .find((line) => line.startsWith('fpr:'))
      ?.split(':')[9];

    return fingerprint ? { home, homeForGpg, keyId: fingerprint } : null;
  } catch {
    fs.rmSync(home, { recursive: true, force: true });
    return null;
  }
}

// At module load, not in beforeAll: the skip decision below is made while the
// suite is being collected, which happens first. A keyring created in a hook
// would not exist yet, and every case would skip.
const keyring = makeKeyring();
if (keyring) {
  gnupgHome = keyring.home;
  gnupgHomeForGpg = keyring.homeForGpg;
  keyId = keyring.keyId;
}

afterAll(() => {
  cleanupRepos();

  if (gnupgHome) {
    try {
      // Ask the agent to let go of the directory before removing it.
      execFileSync('gpgconf', ['--kill', 'all'], {
        env: { ...process.env, GNUPGHOME: gnupgHomeForGpg as string },
        stdio: 'ignore'
      });
    } catch {
      // Best effort; a stray agent is not this suite's problem.
    }
    fs.rmSync(gnupgHome, { recursive: true, force: true, maxRetries: 3 });
  }
});

beforeEach(() => {
  clearRepoPathCache();
});

/**
 * Every request carries the throwaway keyring.
 *
 * The server reads GNUPGHOME from its own environment, which in this process
 * is the test runner's, so it is set for the duration of each case rather than
 * passed through the API.
 */
function api(repo: string) {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Host', '127.0.0.1').set('x-repo-path', repo),
    post: (url: string) => agent.post(url).set('Host', '127.0.0.1').set('x-repo-path', repo)
  };
}

async function withKeyring<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env['GNUPGHOME'];
  process.env['GNUPGHOME'] = gnupgHomeForGpg as string;

  try {
    // Awaited, not just called: restoring the variable while the request was
    // still in flight would leave git looking at the developer's own keyring.
    return await body();
  } finally {
    if (previous === undefined) {
      delete process.env['GNUPGHOME'];
    } else {
      process.env['GNUPGHOME'] = previous;
    }
  }
}

/** A repository configured to sign with the throwaway key. */
function gpgRepo(): string {
  const repo = createRepoWithHistory();
  git(repo, 'config', 'gpg.format', 'openpgp');
  git(repo, 'config', 'user.signingkey', keyId as string);
  git(repo, 'config', 'user.name', SIGNER_NAME);
  git(repo, 'config', 'user.email', SIGNER_EMAIL);
  return repo;
}

async function signatureOf(repo: string, hash: string): Promise<SignatureInfo> {
  const { body } = await api(repo).get('/api/git/signature/commit').query({ hash }).expect(200);
  return body.signature as SignatureInfo;
}

/** Skips everything when gpg could not produce a key on this machine. */
const ifGpg = gnupgHome === null ? it.skip : it;

describe('signing a commit with GPG', () => {
  ifGpg('signs when asked and reads the signature back as good', async () => {
    await withKeyring(async () => {
      const repo = gpgRepo();
      writeFile(repo, 'work.txt', 'work\n');
      git(repo, 'add', 'work.txt');

      await api(repo)
        .post('/api/git/commit')
        .send({ message: 'feat: signed with gpg', sign: true })
        .expect(200);

      const signature = await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim());

      expect(signature.status).toBe('good');
      expect(signature.kind).toBe('gpg');
      expect(signature.signer).toContain(SIGNER_NAME);
      // Trust is git's word, not ours, and an ultimately-trusted own key is
      // exactly what a freshly generated one is.
      expect(signature.trust).not.toBeNull();
    });
  });

  ifGpg('signs every commit once the repository is configured to', async () => {
    await withKeyring(async () => {
      const repo = gpgRepo();
      git(repo, 'config', 'commit.gpgsign', 'true');

      writeFile(repo, 'work.txt', 'work\n');
      git(repo, 'add', 'work.txt');

      // No sign flag: the repository's own setting is in charge.
      await api(repo).post('/api/git/commit').send({ message: 'feat: signed by default' }).expect(200);

      expect((await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim())).status).toBe('good');
    });
  });

  ifGpg('lets one commit opt out of signing by default', async () => {
    await withKeyring(async () => {
      const repo = gpgRepo();
      git(repo, 'config', 'commit.gpgsign', 'true');

      writeFile(repo, 'work.txt', 'work\n');
      git(repo, 'add', 'work.txt');

      await api(repo)
        .post('/api/git/commit')
        .send({ message: 'chore: not signed', sign: false })
        .expect(200);

      expect((await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim())).status).toBe('unsigned');
    });
  });

  ifGpg('signs an amend', async () => {
    await withKeyring(async () => {
      const repo = gpgRepo();

      await api(repo)
        .post('/api/git/commit')
        .send({ message: 'feat: reworded and signed', amend: true, sign: true })
        .expect(200);

      expect((await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim())).status).toBe('good');
    });
  });

  ifGpg('signs a tag', async () => {
    await withKeyring(async () => {
      const repo = gpgRepo();

      await api(repo)
        .post('/api/git/tag')
        .send({ name: 'v1', message: 'signed release', sign: true })
        .expect(200);

      const { body } = await api(repo).get('/api/git/signature/tag').query({ tag: 'v1' }).expect(200);
      expect(body.signature.status).toBe('good');
      expect(body.signature.kind).toBe('gpg');
    });
  });

  ifGpg('reports a tampered commit as a bad signature, not as unsigned', async () => {
    await withKeyring(async () => {
      const repo = gpgRepo();
      writeFile(repo, 'work.txt', 'work\n');
      git(repo, 'add', 'work.txt');
      await api(repo)
        .post('/api/git/commit')
        .send({ message: 'feat: signed', sign: true })
        .expect(200);

      // Rewrite the commit object with a different message, keeping the
      // signature header: the signature no longer covers the content.
      const original = git(repo, 'cat-file', 'commit', 'HEAD');
      const tampered = original.replace('feat: signed', 'feat: tampered');
      const newOid = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
        cwd: repo,
        input: tampered,
        encoding: 'utf8'
      }).trim();

      const signature = await signatureOf(repo, newOid);

      expect(signature.status).toBe('bad');
      expect(signature.reason).toMatch(/does not match/i);
    });
  });
});

describe('reading a GPG signature this repository cannot check', () => {
  ifGpg('reports unknown rather than unsigned when the key is absent', async () => {
    const repo = await withKeyring(async () => {
      const created = gpgRepo();
      writeFile(created, 'work.txt', 'work\n');
      git(created, 'add', 'work.txt');
      await api(created)
        .post('/api/git/commit')
        .send({ message: 'feat: signed elsewhere', sign: true })
        .expect(200);
      return created;
    });

    // A keyring with no keys at all: the commit is still signed, and saying it
    // is unsigned would be a false statement about someone else's work.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-gnupg-empty-'));
    fs.chmodSync(empty, 0o700);
    const previous = process.env['GNUPGHOME'];
    process.env['GNUPGHOME'] = asGpgPath(empty);

    try {
      const signature = await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim());

      expect(signature.status).toBe('unknown');
      expect(signature.status).not.toBe('unsigned');
      expect(signature.reason).not.toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env['GNUPGHOME'];
      } else {
        process.env['GNUPGHOME'] = previous;
      }
      fs.rmSync(empty, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

describe('when GPG signing cannot work', () => {
  it('leaves the changes staged and explains, rather than reporting a commit', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'config', 'gpg.format', 'openpgp');
    // A key id nothing has.
    git(repo, 'config', 'user.signingkey', '0000000000000000000000000000000000000000');

    writeFile(repo, 'work.txt', 'work\n');
    git(repo, 'add', 'work.txt');
    const before = git(repo, 'rev-parse', 'HEAD').trim();

    const { body } = await api(repo)
      .post('/api/git/commit')
      .send({ message: 'feat: will not sign', sign: true })
      .expect(400);

    expect(body.error).toMatch(/sign/i);
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(before);
    expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('work.txt');
  });

  ifGpg('reports the configured GPG key and no blocking diagnostics', async () => {
    await withKeyring(async () => {
      const repo = createRepoWithHistory();

      const { body } = await api(repo)
        .post('/api/git/signing/config')
        .send({ mode: 'gpg', signingKey: keyId, signCommitsByDefault: true })
        .expect(200);

      expect(body.config.mode).toBe('gpg');
      expect(body.gpgAvailable).toBe(true);
      expect(body.diagnostics.filter((entry: { blocksSigning: boolean }) => entry.blocksSigning)).toEqual(
        []
      );
    });
  });
});
