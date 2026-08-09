// Supplying a passphrase for a key that is locked.
//
// Two things are being proved here. The first is behavioural: the three states
// a locked key can be in produce three different typed codes, so the UI can ask
// the right question instead of guessing from prose. The second is the one that
// matters more — a passphrase typed into this application reaches ssh through
// the AskPass bridge and appears in no argument vector, no environment
// variable, and no response body.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resetSessionOwnership } from '../src/server/ssh/agent';
import { FakeRunner, command } from './helpers/fake-runner';
import { cleanupRepos, createRepoWithHistory, git } from './helpers/temp-repo';

const FINGERPRINT = 'SHA256:VGhpc0lzQVRlc3RGaW5nZXJwcmludFZhbHVlMDE=';
const PASSPHRASE = 'correct horse battery staple';

let workspace: string;
let keyPath: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-unlock-'));
  keyPath = path.join(workspace, 'id_ed25519');
  fs.writeFileSync(keyPath, 'PRIVATE KEY BYTES');
  // The .pub file matters: fingerprints are read from it, never from the
  // private key, because `ssh-keygen -l` against a protected private key would
  // prompt for the passphrase on every status poll.
  fs.writeFileSync(`${keyPath}.pub`, 'ssh-ed25519 AAAAC3Nz test\n');
  resetSessionOwnership();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(workspace, { recursive: true, force: true });
});

afterAll(() => {
  cleanupRepos();
});

/**
 * Loads the session module against a throwaway home directory holding one
 * profile, so nothing touches the developer's real configuration.
 */
async function sessionWithProfile(options: { savedPassphrase?: boolean } = {}) {
  const home = fs.mkdtempSync(path.join(workspace, 'home-'));

  fs.writeFileSync(
    path.join(home, '.multi-git-client-config.json'),
    JSON.stringify({
      configVersion: 2,
      recentRepos: [],
      sshProfiles: [{ id: 'work', label: 'Work', privateKeyPath: keyPath }],
      accountRules: [],
      repoSettings: {}
    })
  );

  vi.resetModules();
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('HOME', home);

  const vault = await import('../src/server/vault/vault');
  const session = await import('../src/server/ssh/agent-session');

  if (options.savedPassphrase) {
    vault.unlockVault('master key');
    vault.setStoredPassphrase('work', PASSPHRASE);
  }

  return { session, vault, home };
}

/** An agent that is reachable and holds nothing. */
function emptyAgent(): FakeRunner {
  return new FakeRunner()
    .on(command('ssh-add', '-l'), { stdout: '', exitCode: 1 })
    .on(command('ssh-keygen', '-l'), { stdout: `256 ${FINGERPRINT} test (ED25519)` })
    .on(command('sc.exe', 'query'), { stdout: 'STATE : 4 RUNNING' })
    .on(command('sc.exe', 'qc'), { stdout: 'START_TYPE : 2 AUTO_START' });
}

/** An agent that accepts `ssh-add` and then reports holding the key. */
function agentAcceptingKey(): FakeRunner {
  let holds = false;

  const runner = new FakeRunner()
    .on(command('ssh-add', '-l'), () => ({
      stdout: holds ? `256 ${FINGERPRINT} test (ED25519)\n` : '',
      exitCode: holds ? 0 : 1
    }))
    .on(command('ssh-keygen', '-l'), { stdout: `256 ${FINGERPRINT} test (ED25519)` })
    .on(command('sc.exe', 'query'), { stdout: 'STATE : 4 RUNNING' })
    .on(command('sc.exe', 'qc'), { stdout: 'START_TYPE : 2 AUTO_START' });

  runner.on(
    (executable, args) => executable.endsWith('ssh-add') && !args.includes('-l') && !args.includes('-d'),
    () => {
      holds = true;
      return { exitCode: 0 };
    }
  );

  return runner;
}

/** An agent whose `ssh-add` rejects whatever it is given. */
function agentRejectingKey(): FakeRunner {
  return emptyAgent().on(
    (executable, args) => executable.endsWith('ssh-add') && !args.includes('-l'),
    { exitCode: 1, stderr: 'Error loading key: incorrect passphrase supplied to decrypt private key' }
  );
}

describe('the three states a locked key can be in', () => {
  it('asks for the vault master key when the passphrase is saved but the vault is shut', async () => {
    const { session } = await sessionWithProfile({ savedPassphrase: true });
    const vault = await import('../src/server/vault/vault');
    vault.lockVault();

    const result = await session.applyProfile({ profileId: 'work', runner: emptyAgent() });

    expect(result.success).toBe(false);
    expect(result.code).toBe('VAULT_LOCKED');
  });

  it('asks for the key passphrase when nothing is saved for it', async () => {
    const { session } = await sessionWithProfile();

    const result = await session.applyProfile({ profileId: 'work', runner: agentRejectingKey() });

    expect(result.success).toBe(false);
    expect(result.code).toBe('PASSPHRASE_REQUIRED');
  });

  it('says the supplied passphrase was rejected, so the UI can ask again', async () => {
    const { session } = await sessionWithProfile();

    const result = await session.applyProfile({
      profileId: 'work',
      passphrase: 'wrong',
      runner: agentRejectingKey()
    });

    expect(result.success).toBe(false);
    // Distinct from PASSPHRASE_REQUIRED: one means "ask", the other means
    // "that was not it, ask again".
    expect(result.code).toBe('PASSPHRASE_REJECTED');
  });
});

describe('supplying a passphrase', () => {
  it('loads the key with it', async () => {
    const { session } = await sessionWithProfile();
    const runner = agentAcceptingKey();

    const result = await session.applyProfile({
      profileId: 'work',
      passphrase: PASSPHRASE,
      runner
    });

    expect(result.success).toBe(true);
    expect(result.agent.selectedKeyLoaded).toBe(true);
  });

  it('is used in preference to a locked vault, so a locked vault is no dead end', async () => {
    const { session, vault } = await sessionWithProfile({ savedPassphrase: true });
    vault.lockVault();

    const result = await session.applyProfile({
      profileId: 'work',
      passphrase: PASSPHRASE,
      runner: agentAcceptingKey()
    });

    expect(result.success).toBe(true);
  });

  it('never appears in an argument vector, an environment, or stdin', async () => {
    const { session } = await sessionWithProfile();
    const runner = agentAcceptingKey();

    await session.applyProfile({ profileId: 'work', passphrase: PASSPHRASE, runner });

    // everythingSeen deliberately excludes the redaction list itself, so this
    // is a real check rather than one that passes by construction.
    expect(runner.everythingSeen()).not.toContain(PASSPHRASE);
  });

  it('reaches ssh only through the askpass bridge', async () => {
    const { session } = await sessionWithProfile();
    const runner = agentAcceptingKey();

    await session.applyProfile({ profileId: 'work', passphrase: PASSPHRASE, runner });

    const add = runner
      .callsTo('ssh-add')
      .find((call) => !call.args.includes('-l') && !call.args.includes('-d'));

    // A script path, not the secret: the bridge is a mode-0600 file that is
    // removed as soon as the load finishes.
    expect(add?.options.env?.['SSH_ASKPASS']).toMatch(/askpass/i);
    expect(add?.options.env?.['SSH_ASKPASS']).not.toContain(PASSPHRASE);
    // And it is on the redaction list, so it cannot survive into a log line.
    expect(add?.options.redact).toContain(PASSPHRASE);
  });

  it('is not returned to the caller in any form', async () => {
    const { session } = await sessionWithProfile();

    const result = await session.applyProfile({
      profileId: 'work',
      passphrase: PASSPHRASE,
      runner: agentAcceptingKey()
    });

    expect(JSON.stringify(result)).not.toContain(PASSPHRASE);
  });
});

describe('remembering a passphrase', () => {
  it('stores it only when asked and the vault is open', async () => {
    const { session, vault } = await sessionWithProfile();
    vault.unlockVault('master key');

    await session.applyProfile({
      profileId: 'work',
      passphrase: PASSPHRASE,
      savePassphrase: true,
      runner: agentAcceptingKey()
    });

    expect(vault.hasStoredPassphrase('work')).toBe(true);
    expect(vault.getStoredPassphrase('work')).toBe(PASSPHRASE);
  });

  it('does not store it when the user did not ask', async () => {
    const { session, vault } = await sessionWithProfile();
    vault.unlockVault('master key');

    await session.applyProfile({
      profileId: 'work',
      passphrase: PASSPHRASE,
      runner: agentAcceptingKey()
    });

    expect(vault.hasStoredPassphrase('work')).toBe(false);
  });

  it('does not store a passphrase that did not work', async () => {
    // A saved wrong value would fail silently on every future launch, which is
    // worse than saving nothing.
    const { session, vault } = await sessionWithProfile();
    vault.unlockVault('master key');

    await session.applyProfile({
      profileId: 'work',
      passphrase: 'wrong',
      savePassphrase: true,
      runner: agentRejectingKey()
    });

    expect(vault.hasStoredPassphrase('work')).toBe(false);
  });

  it('quietly skips storing when the vault is locked', async () => {
    const { session, vault } = await sessionWithProfile();

    const result = await session.applyProfile({
      profileId: 'work',
      passphrase: PASSPHRASE,
      savePassphrase: true,
      runner: agentAcceptingKey()
    });

    // The key still loads; only the saving is impossible.
    expect(result.success).toBe(true);
    expect(vault.hasStoredPassphrase('work')).toBe(false);
  });
});

describe('which profile a folder uses', () => {
  it('falls back to the family when a worktree has no record of its own', async () => {
    // A worktree created since the account was chosen has no settings entry.
    // Without the family fallback it would silently drop to System SSH, even
    // though git will use the family's pinned key.
    const repo = createRepoWithHistory();
    const worktreeParent = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-fam-'));
    const worktree = path.join(worktreeParent, 'feature');

    git(repo, 'worktree', 'add', worktree, '-b', 'feature');

    try {
      const { session } = await sessionWithProfile();

      session.rememberProfileForRepo(repo, 'work');

      expect(session.profileForRepo(repo)).toBe('work');
      expect(session.profileForRepo(worktree)).toBe('work');
    } finally {
      fs.rmSync(worktreeParent, { recursive: true, force: true });
    }
  });

  it('records a choice made in a worktree against the whole family', async () => {
    // The repository and its worktrees share one .git/config, so they share
    // one core.sshCommand. Recording per worktree would promise an account
    // that git has no way to honour.
    const repo = createRepoWithHistory();
    const worktreeParent = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-fam2-'));
    const worktree = path.join(worktreeParent, 'feature');

    git(repo, 'worktree', 'add', worktree, '-b', 'feature');

    try {
      const { session } = await sessionWithProfile();

      session.rememberProfileForRepo(worktree, 'work');

      expect(session.profileForRepo(repo)).toBe('work');
    } finally {
      fs.rmSync(worktreeParent, { recursive: true, force: true });
    }
  });

  it('leaves an unrelated repository alone', async () => {
    const repo = createRepoWithHistory();
    const stranger = createRepoWithHistory();

    const { session } = await sessionWithProfile();
    session.rememberProfileForRepo(repo, 'work');

    expect(session.profileForRepo(stranger)).toBeNull();
  });
});
