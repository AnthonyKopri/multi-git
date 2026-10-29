// Signing, against real repositories and a real SSH key.
//
// SSH signing is what makes this testable without a GPG keyring: ssh-keygen
// signs from a key file with no agent and no passphrase, so every case below
// exercises the same code a user's signed commit would.
//
// The case that matters most is the one git itself gets wrong for our
// purposes: `%G?` reports `N` — no signature — for a signed commit that this
// repository has no allowed-signers file to verify. Reporting that as
// "unsigned" would be a false statement about someone else's work.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from './helpers/request';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { explainSigningFailure } from '../src/server/git/signing';
import { clearLogBuffer, logBuffer } from '../src/server/logs';
import type { SignatureInfo, SigningConfig } from '../src/shared/signing-types';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Host', '127.0.0.1').set('x-repo-path', repo),
    post: (url: string) => agent.post(url).set('Host', '127.0.0.1').set('x-repo-path', repo)
  };
}

const keyDirs: string[] = [];

/** An ed25519 key with no passphrase, which is all SSH signing needs. */
function makeSigningKey(): { privateKey: string; publicKey: string } | null {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-signkey-'));
  keyDirs.push(directory);
  const privateKey = path.join(directory, 'id_ed25519');

  try {
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'signing@example.com', '-f', privateKey], {
      stdio: 'ignore'
    });
  } catch {
    return null;
  }

  return { privateKey, publicKey: `${privateKey}.pub` };
}

const key = makeSigningKey();

/** Skips the signing cases where ssh-keygen is unavailable or too old. */
const ifSshSigning = key === null ? it.skip : it;

function configureSshSigning(repo: string, options: { allowedSigners?: boolean } = {}): void {
  git(repo, 'config', 'gpg.format', 'ssh');
  git(repo, 'config', 'user.signingkey', (key as { privateKey: string }).privateKey);

  if (options.allowedSigners) {
    const allowed = path.join(repo, '.allowed_signers');
    fs.writeFileSync(
      allowed,
      `test@example.com ${fs.readFileSync((key as { publicKey: string }).publicKey, 'utf8')}`
    );
    git(repo, 'config', 'gpg.ssh.allowedsignersfile', allowed);
  }
}

async function signatureOf(repo: string, hash: string): Promise<SignatureInfo> {
  const { body } = await api(repo)
    .get('/api/git/signature/commit')
    .query({ hash })
    .expect(200);
  return body.signature as SignatureInfo;
}

async function signingConfig(repo: string): Promise<SigningConfig> {
  const { body } = await api(repo).get('/api/git/signing/status').expect(200);
  return body.config as SigningConfig;
}

beforeEach(() => {
  clearRepoPathCache();
});

afterAll(() => {
  cleanupRepos();
  for (const directory of keyDirs) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('reading a commit signature', () => {
  it('reports an ordinary commit as unsigned', async () => {
    const repo = createRepoWithHistory();
    const signature = await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim());

    expect(signature.status).toBe('unsigned');
    expect(signature.reason).toBeNull();
  });

  ifSshSigning('reports a verifiable signature as good, with the signer', async () => {
    const repo = createRepoWithHistory();
    configureSshSigning(repo, { allowedSigners: true });

    writeFile(repo, 'signed.txt', 'signed\n');
    git(repo, 'add', 'signed.txt');
    git(repo, 'commit', '-S', '-m', 'feat: signed');

    const signature = await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim());

    expect(signature.status).toBe('good');
    expect(signature.kind).toBe('ssh');
    expect(signature.signer).toBe('test@example.com');
    expect(signature.fingerprint).toMatch(/^SHA256:/);
  });

  ifSshSigning('never calls a signed commit unsigned just because it cannot check it', async () => {
    const repo = createRepoWithHistory();
    // Signing configured, verification not — which is the default state for
    // anyone who has only just turned SSH signing on.
    configureSshSigning(repo);

    writeFile(repo, 'signed.txt', 'signed\n');
    git(repo, 'add', 'signed.txt');
    git(repo, 'commit', '-S', '-m', 'feat: signed but unverifiable');

    const hash = git(repo, 'rev-parse', 'HEAD').trim();

    // Git itself says there is no signature here.
    expect(git(repo, 'log', '-1', '--pretty=%G?', hash).trim()).toBe('N');

    const signature = await signatureOf(repo, hash);
    expect(signature.status).toBe('unknown');
    expect(signature.kind).toBe('ssh');
    expect(signature.reason).toMatch(/allowedSignersFile/i);
  });

  ifSshSigning('tells a tampered signature apart from a good one', async () => {
    const repo = createRepoWithHistory();
    configureSshSigning(repo, { allowedSigners: true });

    writeFile(repo, 'signed.txt', 'signed\n');
    git(repo, 'add', 'signed.txt');
    git(repo, 'commit', '-S', '-m', 'feat: signed');

    // Replace the trusted key with a different one: the signature no longer
    // belongs to anyone this repository accepts.
    const other = makeSigningKey();
    if (other === null) {
      return;
    }
    fs.writeFileSync(
      path.join(repo, '.allowed_signers'),
      `test@example.com ${fs.readFileSync(other.publicKey, 'utf8')}`
    );

    const signature = await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim());

    // Not good, and not silently reported as unsigned either.
    expect(signature.status).not.toBe('good');
    expect(signature.status).not.toBe('unsigned');
    expect(signature.reason).not.toBeNull();
  });

  it('reports an unsigned tag as unsigned', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'tag', '-a', 'v1', '-m', 'release');

    const { body } = await api(repo).get('/api/git/signature/tag').query({ tag: 'v1' }).expect(200);
    expect(body.signature.status).toBe('unsigned');
  });

  ifSshSigning('reads a signed tag', async () => {
    const repo = createRepoWithHistory();
    configureSshSigning(repo, { allowedSigners: true });

    await api(repo)
      .post('/api/git/tag')
      .send({ name: 'v1', message: 'signed release', sign: true })
      .expect(200);

    const { body } = await api(repo).get('/api/git/signature/tag').query({ tag: 'v1' }).expect(200);
    expect(body.signature.status).not.toBe('unsigned');
  });

  ifSshSigning('signs a tag created with no message, which is the shape the UI sends', async () => {
    // The tag drawer asks for a name and nothing else. Signing implies -a, and
    // git refuses to sign an annotated tag with no message, so the route fills
    // one in. Without the flag the tag is lightweight -- and tag.gpgsign, which
    // the Signing window writes, only applies to annotated tags, so ticking
    // "Sign tags by default" could never have taken effect through this path.
    const repo = createRepoWithHistory();
    configureSshSigning(repo, { allowedSigners: true });

    await api(repo).post('/api/git/tag').send({ name: 'v2', sign: true }).expect(200);

    const { body } = await api(repo).get('/api/git/signature/tag').query({ tag: 'v2' }).expect(200);
    expect(body.signature.status).not.toBe('unsigned');
  });

  it('leaves a tag lightweight when signing was not asked for', async () => {
    const repo = createRepoWithHistory();

    await api(repo).post('/api/git/tag').send({ name: 'v3' }).expect(200);

    const { body } = await api(repo).get('/api/git/signature/tag').query({ tag: 'v3' }).expect(200);
    expect(body.signature.status).toBe('unsigned');
  });
});

describe('signing configuration', () => {
  it('reports System when the repository has no opinion', async () => {
    const repo = createRepoWithHistory();
    // The fixture disables signing to keep the developer's own config out of
    // the tests, which is itself an opinion; clear it to get the blank state.
    git(repo, 'config', '--unset', 'commit.gpgsign');

    const config = await signingConfig(repo);

    expect(config.mode).toBe('system');
    expect(config.isRepoLevel).toBe(false);
    expect(config.signCommitsByDefault).toBe(false);
  });

  it('tells a repository that switched signing off apart from one that never set it', async () => {
    const repo = createRepoWithHistory();
    // The fixture leaves commit.gpgsign=false, which is a deliberate "no".
    const config = await signingConfig(repo);

    expect(config.mode).toBe('off');
    expect(config.isRepoLevel).toBe(true);
  });

  it('configures SSH signing and reports it back', async () => {
    const repo = createRepoWithHistory();

    const { body } = await api(repo)
      .post('/api/git/signing/config')
      .send({
        mode: 'ssh',
        signingKey: '/keys/id_ed25519.pub',
        signCommitsByDefault: true,
        signTagsByDefault: true
      })
      .expect(200);

    expect(body.config.mode).toBe('ssh');
    expect(body.config.signingKey).toBe('/keys/id_ed25519.pub');
    expect(body.config.signCommitsByDefault).toBe(true);
    expect(body.config.signTagsByDefault).toBe(true);
    expect(body.config.isRepoLevel).toBe(true);

    // And it went into git's own config, not somewhere only this app reads.
    expect(git(repo, 'config', '--local', 'gpg.format').trim()).toBe('ssh');
    expect(git(repo, 'config', '--local', 'commit.gpgsign').trim()).toBe('true');
  });

  it('configures GPG signing', async () => {
    const repo = createRepoWithHistory();

    const { body } = await api(repo)
      .post('/api/git/signing/config')
      .send({ mode: 'gpg', signingKey: 'DEADBEEF', signCommitsByDefault: true })
      .expect(200);

    expect(body.config.mode).toBe('gpg');
    expect(git(repo, 'config', '--local', 'gpg.format').trim()).toBe('openpgp');
  });

  it('removes the repository-level settings when set back to System', async () => {
    const repo = createRepoWithHistory();

    await api(repo)
      .post('/api/git/signing/config')
      .send({ mode: 'ssh', signingKey: '/keys/id.pub', signCommitsByDefault: true })
      .expect(200);

    const { body } = await api(repo).post('/api/git/signing/config').send({ mode: 'system' }).expect(200);

    expect(body.config.isRepoLevel).toBe(false);
    expect(() => git(repo, 'config', '--local', '--get', 'gpg.format')).toThrow();
  });

  it('turns signing off for this repository whatever the global config says', async () => {
    const repo = createRepoWithHistory();

    const { body } = await api(repo).post('/api/git/signing/config').send({ mode: 'off' }).expect(200);

    expect(body.config.signCommitsByDefault).toBe(false);
    expect(git(repo, 'config', '--local', 'commit.gpgsign').trim()).toBe('false');
  });

  it('rejects a mode it does not implement', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/signing/config').send({ mode: 'magic' }).expect(400);
  });

  it('warns that signatures cannot be verified without an allowed-signers file', async () => {
    const repo = createRepoWithHistory();

    const { body } = await api(repo)
      .post('/api/git/signing/config')
      .send({ mode: 'ssh', signingKey: '/keys/id.pub' })
      .expect(200);

    const warning = body.diagnostics.find(
      (entry: { code: string }) => entry.code === 'no-allowed-signers'
    );
    expect(warning).toBeDefined();
    // It stops verification, not signing, and says which.
    expect(warning.blocksSigning).toBe(false);
  });

  it('reports a signing key that is not there', async () => {
    const repo = createRepoWithHistory();

    const { body } = await api(repo)
      .post('/api/git/signing/config')
      .send({ mode: 'ssh', signingKey: '/definitely/not/here.pub' })
      .expect(200);

    const problem = body.diagnostics.find(
      (entry: { code: string }) => entry.code === 'signing-key-missing'
    );
    expect(problem?.blocksSigning).toBe(true);
  });

  it('reports a missing signing key as blocking', async () => {
    const repo = createRepoWithHistory();

    const { body } = await api(repo)
      .post('/api/git/signing/config')
      .send({ mode: 'gpg', signCommitsByDefault: true })
      .expect(200);

    expect(
      body.diagnostics.some((entry: { code: string }) => entry.code === 'no-signing-key')
    ).toBe(true);
  });
});

describe('reading the signing configuration', () => {
  // The values are read with one `git config --get-regexp` per scope rather
  // than one `git config --get` per key. A text value comes back exactly as
  // `--get` prints it; a boolean is read the way git reads it, which `--get`
  // alone cannot tell for a key written with no value.
  const getValue = (repo: string, ...args: string[]): string | null => {
    try {
      return git(repo, 'config', '--get', ...args).trim() || null;
    } catch {
      return null;
    }
  };

  it('takes the last of several values, as git config --get does', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'config', 'user.signingkey', '/keys/first.pub');
    git(repo, 'config', '--add', 'user.signingkey', '/keys/second.pub');

    const config = await signingConfig(repo);

    expect(config.signingKey).toBe('/keys/second.pub');
    expect(config.signingKey).toBe(getValue(repo, 'user.signingkey'));
  });

  it('keeps a value with spaces, an equals sign and a newline whole', async () => {
    const repo = createRepoWithHistory();
    const awkward = '/keys/a folder/key=1.pub';
    git(repo, 'config', 'user.signingkey', awkward);
    git(repo, 'config', 'gpg.ssh.allowedsignersfile', '/signers/line one\nline two');

    const config = await signingConfig(repo);

    expect(config.signingKey).toBe(awkward);
    expect(config.allowedSignersFile).toBe('/signers/line one\nline two');
    expect(config.allowedSignersFile).toBe(getValue(repo, 'gpg.ssh.allowedsignersfile'));
  });

  it('matches the key whatever case it was written in', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'config', 'user.signingKey', '/keys/camel.pub');
    git(repo, 'config', 'gpg.ssh.allowedSignersFile', '/signers/camel');

    const config = await signingConfig(repo);

    expect(config.signingKey).toBe('/keys/camel.pub');
    expect(config.allowedSignersFile).toBe('/signers/camel');
  });

  it('reads a boolean written with no value as true, as git does', async () => {
    const repo = createRepoWithHistory();
    fs.appendFileSync(path.join(repo, '.git', 'config'), '[tag]\n\tgpgsign\n');

    const config = await signingConfig(repo);

    // `--get` prints an empty line for it, the same as for an empty value,
    // which is how this came to be read as unset. Git reads it as true.
    expect(getValue(repo, 'tag.gpgsign')).toBeNull();
    expect(git(repo, 'config', '--type=bool', '--get', 'tag.gpgsign').trim()).toBe('true');
    expect(config.signTagsByDefault).toBe(true);
  });

  it('reports commits as signed for `[commit] gpgsign` with no value', async () => {
    const repo = createRepoWithHistory();
    // Last wins: this follows the fixture's own commit.gpgsign=false.
    fs.appendFileSync(path.join(repo, '.git', 'config'), '[commit]\n\tgpgsign\n');

    const config = await signingConfig(repo);

    expect(config.signCommitsByDefault).toBe(true);
    expect(config.mode).not.toBe('off');
    expect(config.isRepoLevel).toBe(true);
  });

  it('reads an empty value as false, and as this repository switching signing off', async () => {
    const repo = createRepoWithHistory();
    fs.appendFileSync(path.join(repo, '.git', 'config'), '[commit]\n\tgpgsign =\n');

    const config = await signingConfig(repo);

    expect(git(repo, 'config', '--type=bool', '--get', 'commit.gpgsign').trim()).toBe('false');
    expect(config.signCommitsByDefault).toBe(false);
    expect(config.mode).toBe('off');
  });

  it('agrees with git about every spelling of a boolean', async () => {
    const repo = createRepoWithHistory();

    for (const value of ['true', 'YES', 'On', '1', '2', '1k', 'false', 'No', 'OFF', '0', '0m']) {
      git(repo, 'config', 'tag.gpgsign', value);
      const gitSays = git(repo, 'config', '--type=bool', '--get', 'tag.gpgsign').trim();

      const config = await signingConfig(repo);

      expect(config.signTagsByDefault, value).toBe(gitSays === 'true');
    }
  });

  it('ignores keys that only share a prefix with the ones it reads', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'config', 'gpg.formatting', 'ssh');
    git(repo, 'config', 'user.signingkeyfile', '/keys/not-this.pub');

    const config = await signingConfig(repo);

    expect(config.signingKey).toBeNull();
  });

  it('asks git twice however many keys it reads', async () => {
    const repo = createRepoWithHistory();
    clearLogBuffer();

    await signingConfig(repo);

    const reads = logBuffer().filter(
      (entry) => entry.command?.cwd === repo && entry.command.argv[1] === 'config'
    );
    expect(reads).toHaveLength(2);
  });
});

describe('signing a commit', () => {
  ifSshSigning('signs when asked, and the signature reads back as good', async () => {
    const repo = createRepoWithHistory();
    configureSshSigning(repo, { allowedSigners: true });

    writeFile(repo, 'work.txt', 'work\n');
    git(repo, 'add', 'work.txt');

    await api(repo)
      .post('/api/git/commit')
      .send({ message: 'feat: signed through the API', sign: true })
      .expect(200);

    const signature = await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim());
    expect(signature.status).toBe('good');
  });

  ifSshSigning('signs every commit once the repository is set to', async () => {
    const repo = createRepoWithHistory();
    configureSshSigning(repo, { allowedSigners: true });
    git(repo, 'config', 'commit.gpgsign', 'true');

    writeFile(repo, 'work.txt', 'work\n');
    git(repo, 'add', 'work.txt');

    // No sign flag at all: the repository's setting is in charge.
    await api(repo).post('/api/git/commit').send({ message: 'feat: signed by default' }).expect(200);

    expect((await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim())).status).toBe('good');
  });

  ifSshSigning('lets one commit opt out of signing by default', async () => {
    const repo = createRepoWithHistory();
    configureSshSigning(repo, { allowedSigners: true });
    git(repo, 'config', 'commit.gpgsign', 'true');

    writeFile(repo, 'work.txt', 'work\n');
    git(repo, 'add', 'work.txt');

    await api(repo)
      .post('/api/git/commit')
      .send({ message: 'chore: not signed', sign: false })
      .expect(200);

    expect((await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim())).status).toBe('unsigned');
  });

  ifSshSigning('signs an amend', async () => {
    const repo = createRepoWithHistory();
    configureSshSigning(repo, { allowedSigners: true });

    await api(repo)
      .post('/api/git/commit')
      .send({ message: 'feat: reworded and signed', amend: true, sign: true })
      .expect(200);

    expect((await signatureOf(repo, git(repo, 'rev-parse', 'HEAD').trim())).status).toBe('good');
  });

  it('leaves the changes staged when signing fails, and says why', async () => {
    const repo = createRepoWithHistory();
    // A key that does not exist: git will refuse rather than commit.
    git(repo, 'config', 'gpg.format', 'ssh');
    git(repo, 'config', 'user.signingkey', path.join(repo, 'no-such-key'));

    writeFile(repo, 'work.txt', 'work\n');
    git(repo, 'add', 'work.txt');
    const before = git(repo, 'rev-parse', 'HEAD').trim();

    const { body } = await api(repo)
      .post('/api/git/commit')
      .send({ message: 'feat: will not sign', sign: true })
      .expect(400);

    expect(body.error).toMatch(/sign/i);
    // Nothing was committed and the work is still staged, ready to retry.
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(before);
    expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('work.txt');
  });
});

describe('explaining a failure', () => {
  it('turns git\'s one-line gpg error into something actionable', () => {
    const explained = explainSigningFailure('error: gpg failed to sign the data\nfatal: failed to write commit object');

    expect(explained).toMatch(/still staged/);
    expect(explained).toMatch(/agent/);
  });

  it('names the missing configuration when there is no key', () => {
    expect(explainSigningFailure('error: no signing key found')).toMatch(/signing key/i);
  });

  it('leaves an unrelated error alone', () => {
    expect(explainSigningFailure('fatal: not a git repository')).toBeNull();
  });
});
