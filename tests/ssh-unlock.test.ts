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

/**
 * Finding out a key needs a passphrase without waiting to find out.
 *
 * `ssh-add` given an encrypted key and no AskPass bridge does not fail — it
 * waits for a prompt that a server process has no way to answer, and keeps
 * waiting until the thirty-second timeout. That delay is indistinguishable,
 * from the outside, from the application having hung, and it lands in exactly
 * the moment someone has just pressed Push.
 */
describe('detecting an encrypted key before ssh-add blocks on it', () => {
  /** A runner whose `ssh-keygen -y -P ''` refuses, as it does for a locked key. */
  function agentWithEncryptedKey(): FakeRunner {
    return agentAcceptingKey().on(command('ssh-keygen', '-y'), {
      exitCode: 1,
      stderr: 'Load key: incorrect passphrase supplied to decrypt private key'
    });
  }

  /** Every `ssh-add` that was an attempt to load, rather than a list or a delete. */
  function loadAttempts(runner: FakeRunner) {
    return runner
      .callsTo('ssh-add')
      .filter((call) => !call.args.includes('-l') && !call.args.includes('-d'));
  }

  it('never runs ssh-add for an encrypted key with no passphrase to give it', async () => {
    const { session } = await sessionWithProfile();
    const runner = agentWithEncryptedKey();

    const result = await session.applyProfile({ profileId: 'work', runner });

    expect(result.success).toBe(false);
    // The UI's cue to put a passphrase box in front of the user, now rather
    // than after a timeout.
    expect(result.code).toBe('PASSPHRASE_REQUIRED');
    expect(loadAttempts(runner)).toHaveLength(0);
  });

  it('still runs ssh-add when a passphrase is supplied', async () => {
    const { session } = await sessionWithProfile();
    const runner = agentWithEncryptedKey();

    const result = await session.applyProfile({
      profileId: 'work',
      passphrase: PASSPHRASE,
      runner
    });

    expect(result.success).toBe(true);
    expect(loadAttempts(runner)).toHaveLength(1);
  });

  it('asks ssh-keygen in a form that cannot prompt', async () => {
    const { session } = await sessionWithProfile();
    const runner = agentWithEncryptedKey();

    await session.applyProfile({ profileId: 'work', runner });

    const probe = runner.callsTo('ssh-keygen').find((call) => call.args.includes('-y'));

    // `-P ''` is the whole point: it supplies a passphrase, so ssh-keygen
    // answers either way instead of reaching for a terminal.
    expect(probe?.args).toContain('-P');
    expect(probe?.args).toContain('');
  });
});

/**
 * Loading every profile's key at once.
 *
 * The per-repository flow loads one key: the one for the repository in front of
 * you. That leaves a terminal opened somewhere else, or an external agent
 * running `git push`, with no identity at all — which is the thing loading keys
 * into the machine's own agent was supposed to fix.
 */
describe('loading every profile key', () => {
  /** A throwaway home holding two profiles. */
  async function sessionWithTwoProfiles() {
    const home = fs.mkdtempSync(path.join(workspace, 'home-multi-'));
    const secondKey = path.join(workspace, 'id_ed25519_second');
    fs.writeFileSync(secondKey, 'PRIVATE KEY BYTES');
    fs.writeFileSync(`${secondKey}.pub`, 'ssh-ed25519 AAAAC3Nz second\n');

    fs.writeFileSync(
      path.join(home, '.multi-git-client-config.json'),
      JSON.stringify({
        configVersion: 2,
        recentRepos: [],
        sshProfiles: [
          { id: 'work', label: 'Work', privateKeyPath: keyPath },
          { id: 'personal', label: 'Personal', privateKeyPath: secondKey }
        ],
        accountRules: [],
        repoSettings: {}
      })
    );

    vi.resetModules();
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('HOME', home);

    return {
      session: await import('../src/server/ssh/agent-session'),
      vault: await import('../src/server/vault/vault')
    };
  }

  /** An agent that accepts keys but whose keys all report as encrypted. */
  function agentWithLockedKeys(): FakeRunner {
    return agentAcceptingKey().on(command('ssh-keygen', '-y'), { exitCode: 1 });
  }

  it('loads the keys that need no passphrase', async () => {
    const { session } = await sessionWithTwoProfiles();

    const result = await session.loadAllProfileKeys({ runner: agentAcceptingKey() });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2);
    expect(
      result.entries.every(
        (entry) => entry.outcome === 'loaded' || entry.outcome === 'already-loaded'
      )
    ).toBe(true);
  });

  it('reports a locked key as needing a passphrase instead of attempting it', async () => {
    const { session } = await sessionWithTwoProfiles();
    const runner = agentWithLockedKeys();

    const result = await session.loadAllProfileKeys({ runner });

    // Partial, and said to be partial: that is what lets the UI ask for the
    // ones it could not supply rather than claiming they are all in.
    expect(result.success).toBe(false);
    expect(result.entries.every((entry) => entry.outcome === 'passphrase-required')).toBe(true);

    const loads = runner
      .callsTo('ssh-add')
      .filter((call) => !call.args.includes('-l') && !call.args.includes('-d'));
    expect(loads).toHaveLength(0);
  });

  it('distinguishes a shut vault from a passphrase that was never saved', async () => {
    const { session, vault } = await sessionWithTwoProfiles();
    vault.unlockVault('master key');
    vault.setStoredPassphrase('work', PASSPHRASE);
    vault.lockVault();

    const result = await session.loadAllProfileKeys({ runner: agentWithLockedKeys() });

    const byId = new Map(result.entries.map((entry) => [entry.profileId, entry.outcome]));
    // One is answerable by unlocking the vault; the other needs typing. They
    // are different problems with different fixes.
    expect(byId.get('work')).toBe('vault-locked');
    expect(byId.get('personal')).toBe('passphrase-required');
  });

  it('uses a saved passphrase once the vault is open', async () => {
    const { session, vault } = await sessionWithTwoProfiles();
    vault.unlockVault('master key');
    vault.setStoredPassphrase('work', PASSPHRASE);

    const result = await session.loadAllProfileKeys({ runner: agentWithLockedKeys() });

    const byId = new Map(result.entries.map((entry) => [entry.profileId, entry.outcome]));
    expect(byId.get('work')).toBe('loaded');
  });

  it('refuses as a whole when no agent is reachable', async () => {
    const { session } = await sessionWithTwoProfiles();

    const unreachable = new FakeRunner()
      .on(command('ssh-add', '-l'), { stdout: '', exitCode: 2 })
      .on(command('sc.exe', 'query'), { stdout: 'STATE : 1 STOPPED' })
      .on(command('sc.exe', 'qc'), { stdout: 'START_TYPE : 2 AUTO_START' });

    const result = await session.loadAllProfileKeys({ runner: unreachable });

    expect(result.success).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.code).toBeDefined();
  });

  it('does not touch any repository routing', async () => {
    // Loading keys is a machine-level act. Which identity a repository uses is
    // that repository's own setting, and a bulk load must not rewrite it.
    const repo = createRepoWithHistory();
    const { session } = await sessionWithTwoProfiles();

    await session.loadAllProfileKeys({ runner: agentAcceptingKey() });

    expect(() => git(repo, 'config', '--local', '--get', 'core.sshCommand')).toThrow();
  });
});
