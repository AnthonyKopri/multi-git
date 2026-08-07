// Applying a profile: routing, agent loading, and the vault interaction.
//
// Real git repositories, because repository-local config is the point of half
// of this. A scripted runner for ssh, because none of it may need an agent.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resetSessionOwnership } from '../src/server/ssh/agent';
import {
  buildRepoSshCommand,
  clearRepoSshCommand,
  readRepoSshCommand,
  setRepoSshCommand,
  SSH_COMMAND_KEY
} from '../src/server/ssh/repo-routing';
import { FakeRunner, command } from './helpers/fake-runner';
import { cleanupRepos, createRepoWithHistory, git } from './helpers/temp-repo';

const FINGERPRINT = 'SHA256:VGhpc0lzQVRlc3RGaW5nZXJwcmludFZhbHVlMDE=';

let workspace: string;
let keyPath: string;
let repo: string;

/** A reachable agent holding nothing. */
function readyAgent(): FakeRunner {
  return new FakeRunner()
    .on(command('ssh-add', '-l'), { stdout: '', exitCode: 1 })
    .on(command('ssh-keygen', '-l'), { stdout: `256 ${FINGERPRINT} test (ED25519)` })
    .on(command('sc.exe', 'query'), { stdout: 'STATE : 4 RUNNING' })
    .on(command('sc.exe', 'qc'), { stdout: 'START_TYPE : 2 AUTO_START' });
}

/**
 * An agent that starts empty and actually accepts the key.
 *
 * Stateful on purpose: ownership is only recorded when this process performs
 * the add, so a fixture where the key is already present would prove the
 * opposite of what these tests are for.
 */
function agentAcceptingKey(): FakeRunner {
  let holdsKey = false;
  const listing = () =>
    holdsKey
      ? { stdout: `256 ${FINGERPRINT} test (ED25519)`, exitCode: 0 }
      : { stdout: '', exitCode: 1 };

  return new FakeRunner()
    .on(command('ssh-keygen', '-l'), { stdout: `256 ${FINGERPRINT} test (ED25519)` })
    .on(command('sc.exe', 'query'), { stdout: 'STATE : 4 RUNNING' })
    .on(command('sc.exe', 'qc'), { stdout: 'START_TYPE : 2 AUTO_START' })
    .on(command('ssh-add', '-l'), listing)
    .on(
      (executable, args) =>
        executable.endsWith('ssh-add') && !args.includes('-l') && !args.includes('-d'),
      () => {
        holdsKey = true;
        return { exitCode: 0 };
      }
    )
    .on(
      (executable, args) => executable.endsWith('ssh-add') && args.includes('-d'),
      () => {
        holdsKey = false;
        return { exitCode: 0 };
      }
    );
}

/**
 * Loads agent-session against a throwaway home, so the config it reads is the
 * fixture below rather than the developer's own profiles.
 */
async function sessionWithConfig(profiles: unknown[]) {
  const home = fs.mkdtempSync(path.join(workspace, 'home-'));
  fs.writeFileSync(
    path.join(home, '.multi-git-client-config.json'),
    JSON.stringify({ configVersion: 1, recentRepos: [], sshProfiles: profiles, accountRules: [], repoSettings: {} })
  );

  vi.resetModules();
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('HOME', home);

  return import('../src/server/ssh/agent-session');
}

beforeEach(() => {
  resetSessionOwnership();
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-session-')));
  keyPath = path.join(workspace, 'id_ed25519');
  fs.writeFileSync(keyPath, 'PRIVATE');
  fs.writeFileSync(`${keyPath}.pub`, 'ssh-ed25519 AAAA test');
  repo = createRepoWithHistory();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(workspace, { recursive: true, force: true });
  resetSessionOwnership();
});

afterAll(() => {
  cleanupRepos();
});

describe('repository routing', () => {
  it('writes core.sshCommand into that repository only', async () => {
    const other = createRepoWithHistory();

    await setRepoSshCommand(repo, keyPath);

    expect(await readRepoSshCommand(repo)).toBe(buildRepoSshCommand(keyPath));
    // The neighbouring repository must be untouched: this is per-repository
    // configuration, and leaking it would reroute someone else's account.
    expect(await readRepoSshCommand(other)).toBeNull();
  });

  it('is idempotent, so a status poll does not churn .git/config', async () => {
    const first = await setRepoSshCommand(repo, keyPath);
    const second = await setRepoSshCommand(repo, keyPath);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
  });

  it('writes to the repository, not the user global config', async () => {
    await setRepoSshCommand(repo, keyPath);

    const local = git(repo, 'config', '--local', '--get', SSH_COMMAND_KEY).trim();
    expect(local).toBe(buildRepoSshCommand(keyPath));
  });

  it('clears cleanly, and clearing twice is not an error', async () => {
    await setRepoSshCommand(repo, keyPath);

    expect((await clearRepoSshCommand(repo)).changed).toBe(true);
    expect((await clearRepoSshCommand(repo)).changed).toBe(false);
    expect(await readRepoSshCommand(repo)).toBeNull();
  });

  it('handles a key path with spaces and non-ASCII', async () => {
    const awkward = path.join(workspace, 'my keys', 'café', 'id_ed25519');
    fs.mkdirSync(path.dirname(awkward), { recursive: true });
    fs.writeFileSync(awkward, 'PRIVATE');

    await setRepoSshCommand(repo, awkward);

    const value = await readRepoSshCommand(repo);
    expect(value).toContain('café');
    // Quoted, because git hands this string to a shell.
    expect(value).toContain('"');
  });
});

describe('applyProfile', () => {
  it('does nothing to the agent for the System profile', async () => {
    // System means "use whatever this machine already does". Starting a
    // service on its behalf would be exactly the surprise it exists to avoid.
    const session = await sessionWithConfig([]);
    const runner = readyAgent();

    const result = await session.applyProfile({ repoPath: repo, profileId: '', runner });

    expect(result.success).toBe(true);
    expect(runner.calls.some((call) => call.args.includes('-l') === false && call.executable.endsWith('ssh-add'))).toBe(
      false
    );
  });

  it('clears a repository pin when switching to System', async () => {
    await setRepoSshCommand(repo, keyPath);
    const session = await sessionWithConfig([]);

    const result = await session.applyProfile({ repoPath: repo, profileId: '', runner: readyAgent() });

    expect(result.routingChanged).toBe(true);
    expect(await readRepoSshCommand(repo)).toBeNull();
  });

  it('leaves a hand-written core.sshCommand alone', async () => {
    // Someone configured a jump host here. Overwriting it would break their
    // setup to enforce ours.
    const custom = 'ssh -J bastion.example -i /keys/other';
    git(repo, 'config', '--local', SSH_COMMAND_KEY, custom);

    const session = await sessionWithConfig([
      { id: 'p1', label: 'Work', privateKeyPath: keyPath }
    ]);

    await session.applyProfile({ repoPath: repo, profileId: 'p1', runner: readyAgent() });

    expect(await readRepoSshCommand(repo)).toBe(custom);
  });

  it('reports an unknown profile without touching anything', async () => {
    const session = await sessionWithConfig([]);

    const result = await session.applyProfile({ repoPath: repo, profileId: 'missing', runner: readyAgent() });

    expect(result.success).toBe(false);
    expect(result.code).toBe('PROFILE_NOT_FOUND');
    expect(await readRepoSshCommand(repo)).toBeNull();
  });

  it('still pins the repository when the agent cannot be reached', async () => {
    // The degraded path has to stay correct: the per-command fallback uses
    // this pin, so a dead agent must not also mean the wrong identity.
    const session = await sessionWithConfig([
      { id: 'p1', label: 'Work', privateKeyPath: keyPath }
    ]);

    const deadAgent = new FakeRunner()
      .on(command('ssh-add', '-l'), { exitCode: 2 })
      .on(command('ssh-keygen', '-l'), { stdout: `256 ${FINGERPRINT} test (ED25519)` })
      .on(command('sc.exe', 'query'), { stdout: 'STATE : 1 STOPPED' })
      .on(command('sc.exe', 'qc'), { stdout: 'START_TYPE : 4 DISABLED' });

    const result = await session.applyProfile({ repoPath: repo, profileId: 'p1', runner: deadAgent });

    expect(result.success).toBe(false);
    expect(await readRepoSshCommand(repo)).toBe(buildRepoSshCommand(keyPath));
  });

  it('does nothing twice when the key is already in the agent', async () => {
    const session = await sessionWithConfig([
      { id: 'p1', label: 'Work', privateKeyPath: keyPath }
    ]);

    const loaded = readyAgent().on(command('ssh-add', '-l'), {
      stdout: `256 ${FINGERPRINT} test (ED25519)`
    });

    const result = await session.applyProfile({ repoPath: repo, profileId: 'p1', runner: loaded });

    expect(result.success).toBe(true);
    // No add attempted: it is already there.
    expect(loaded.callsTo('ssh-add').every((call) => call.args.includes('-l'))).toBe(true);
  });
});

describe('unloadSessionKeys', () => {
  it('removes nothing when this session loaded nothing', async () => {
    const session = await sessionWithConfig([
      { id: 'p1', label: 'Work', privateKeyPath: keyPath }
    ]);
    const runner = readyAgent().on(command('ssh-add', '-l'), {
      stdout: `256 ${FINGERPRINT} someone else (ED25519)`
    });

    const result = await session.unloadSessionKeys({ runner });

    expect(result.removed).toEqual([]);
    // A key another application loaded is not ours to remove.
    expect(runner.calls.some((call) => call.args.includes('-d'))).toBe(false);
  });

  it('removes the keys this session loaded, individually', async () => {
    const session = await sessionWithConfig([
      { id: 'p1', label: 'Work', privateKeyPath: keyPath }
    ]);
    const runner = agentAcceptingKey();

    await session.applyProfile({ repoPath: repo, profileId: 'p1', runner });
    const result = await session.unloadSessionKeys({ runner });

    expect(result.removed).toEqual(['Work']);

    const removals = runner.calls.filter((call) => call.args.includes('-d'));
    expect(removals).toHaveLength(1);
    expect(removals[0]?.args).toEqual(['-d', `${keyPath}.pub`]);
  });

  it('never issues ssh-add -D', async () => {
    // -D would delete every identity in the agent, including other
    // applications' keys.
    const session = await sessionWithConfig([
      { id: 'p1', label: 'Work', privateKeyPath: keyPath }
    ]);
    const runner = agentAcceptingKey();

    await session.applyProfile({ repoPath: repo, profileId: 'p1', runner });
    await session.unloadSessionKeys({ runner });

    expect(runner.calls.some((call) => call.args.includes('-D'))).toBe(false);
  });
});

describe('repository profile memory', () => {
  it('round-trips the selected profile through repository settings', async () => {
    const session = await sessionWithConfig([
      { id: 'p1', label: 'Work', privateKeyPath: keyPath }
    ]);

    expect(session.rememberProfileForRepo(repo, 'p1')).toBe(true);
    expect(session.profileForRepo(repo)).toBe('p1');
  });

  it('records the System profile as an explicit choice', async () => {
    // '' is a real answer, not "nothing saved": it means the user chose to
    // inherit the machine's own SSH configuration for this repository.
    const session = await sessionWithConfig([]);

    session.rememberProfileForRepo(repo, '');

    expect(session.profileForRepo(repo)).toBe('');
  });

  it('keeps repositories separate', async () => {
    const other = createRepoWithHistory();
    const session = await sessionWithConfig([
      { id: 'p1', label: 'Work', privateKeyPath: keyPath }
    ]);

    session.rememberProfileForRepo(repo, 'p1');

    expect(session.profileForRepo(other)).toBeNull();
  });
});

describe('ensureAgentForRepo', () => {
  it('does nothing for a repository with no remembered profile', async () => {
    const session = await sessionWithConfig([]);
    const runner = readyAgent();

    await session.ensureAgentForRepo(repo);

    expect(runner.calls).toHaveLength(0);
  });

  it('never throws, so a push is not blocked by a broken agent', async () => {
    const session = await sessionWithConfig([
      { id: 'p1', label: 'Work', privateKeyPath: keyPath }
    ]);
    session.rememberProfileForRepo(repo, 'p1');

    await expect(session.ensureAgentForRepo(repo, 'p1')).resolves.toBeUndefined();
  });
});
