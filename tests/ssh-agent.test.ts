// The SSH agent lane, driven entirely through a scripted runner.
//
// No agent runs, no key is read, no passphrase is real. That is deliberate:
// these paths have to be verifiable on a CI box with the service disabled,
// which is exactly the machine state this feature exists to fix.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  loadKeyIntoAgent,
  parseAgentKeys,
  parseFingerprint,
  readAgentState,
  readKeyFingerprint,
  resetSessionOwnership,
  sessionOwnedFingerprints,
  unloadKeyFromAgent
} from '../src/server/ssh/agent';
import { parseScField, parseServiceQuery, repairNeedsElevation, AGENT_REPAIR_COMMAND } from '../src/server/ssh/agent-service';
import { buildRepoSshCommand, isMultiGitSshCommand } from '../src/server/ssh/repo-routing';
import { normalizeSshPath } from '../src/server/ssh/keys';
import { FakeRunner, command } from './helpers/fake-runner';

const FINGERPRINT = 'SHA256:VGhpc0lzQVRlc3RGaW5nZXJwcmludFZhbHVlMDE=';
const OTHER_FINGERPRINT = 'SHA256:QW5vdGhlckZpbmdlcnByaW50Rm9yQVRlc3RLZXkwMQ==';

let workspace: string;
let keyPath: string;

beforeEach(() => {
  resetSessionOwnership();
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-agent-')));
  // A path with a space and non-ASCII, because that is where quoting breaks.
  const keyDir = path.join(workspace, 'my keys', 'café');
  fs.mkdirSync(keyDir, { recursive: true });
  keyPath = path.join(keyDir, 'id_ed25519');
  fs.writeFileSync(keyPath, 'PRIVATE KEY BODY');
  fs.writeFileSync(`${keyPath}.pub`, 'ssh-ed25519 AAAA... test@example');
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  resetSessionOwnership();
});

/** A runner whose agent is reachable and holds `keys`. */
function agentWith(keys: string, fingerprint = FINGERPRINT): FakeRunner {
  return new FakeRunner()
    .on(command('ssh-add', '-l'), { stdout: keys, exitCode: keys.trim() === '' ? 1 : 0 })
    .on(command('ssh-keygen', '-l'), { stdout: `256 ${fingerprint} test@example (ED25519)` })
    .on(command('sc.exe', 'query'), { stdout: 'STATE : 4  RUNNING' })
    .on(command('sc.exe', 'qc'), { stdout: 'START_TYPE : 2   AUTO_START' });
}

describe('parsing ssh-add -l', () => {
  it('reads fingerprint and comment from each line', () => {
    const keys = parseAgentKeys(
      `256 ${FINGERPRINT} jane@laptop (ED25519)\n2048 ${OTHER_FINGERPRINT} work key (RSA)`
    );

    expect(keys).toEqual([
      { fingerprint: FINGERPRINT, comment: 'jane@laptop', source: 'pre-existing' },
      { fingerprint: OTHER_FINGERPRINT, comment: 'work key', source: 'pre-existing' }
    ]);
  });

  it('ignores the prose line an empty agent prints', () => {
    expect(parseAgentKeys('The agent has no identities.')).toEqual([]);
    expect(parseAgentKeys('')).toEqual([]);
  });

  it('handles a comment containing spaces and no type suffix', () => {
    const [key] = parseAgentKeys(`256 ${FINGERPRINT} my personal laptop key`);

    expect(key?.comment).toBe('my personal laptop key');
  });

  it('tolerates a key with no comment at all', () => {
    const [key] = parseAgentKeys(`256 ${FINGERPRINT} (ED25519)`);

    expect(key?.fingerprint).toBe(FINGERPRINT);
    expect(key?.comment).toBeUndefined();
  });
});

describe('parseFingerprint', () => {
  it('extracts the SHA256 field', () => {
    expect(parseFingerprint(`256 ${FINGERPRINT} comment (ED25519)`)).toBe(FINGERPRINT);
  });

  it('returns null when there is none', () => {
    expect(parseFingerprint('no fingerprint here')).toBeNull();
  });
});

describe('reading the Windows service', () => {
  it('parses the numeric codes rather than the localised words', () => {
    // A German install prints BEENDET, not STOPPED. Only the number is stable.
    const info = parseServiceQuery('        STATE              : 1  BEENDET', '        START_TYPE         : 4   DEAKTIVIERT');

    expect(info).toEqual({ exists: true, running: false, startType: 'disabled' });
  });

  it('recognises a running automatic service', () => {
    expect(parseServiceQuery('STATE : 4 RUNNING', 'START_TYPE : 2 AUTO_START')).toEqual({
      exists: true,
      running: true,
      startType: 'automatic'
    });
  });

  it('reports a service that does not exist', () => {
    expect(parseServiceQuery('', '')).toEqual({
      exists: false,
      running: false,
      startType: 'unknown'
    });
  });

  it('pulls a numeric field out of sc output', () => {
    expect(parseScField('        START_TYPE         : 4   DISABLED', 'START_TYPE')).toBe(4);
    expect(parseScField('nothing here', 'START_TYPE')).toBeNull();
  });

  it('needs elevation for a disabled or stopped service, but not a running one', () => {
    if (process.platform !== 'win32') {
      // repairNeedsElevation is a Windows-only concept by design.
      expect(repairNeedsElevation({ exists: true, running: false, startType: 'disabled' })).toBe(false);
      return;
    }

    expect(repairNeedsElevation({ exists: true, running: false, startType: 'disabled' })).toBe(true);
    expect(repairNeedsElevation({ exists: true, running: false, startType: 'manual' })).toBe(true);
    expect(repairNeedsElevation({ exists: true, running: true, startType: 'automatic' })).toBe(false);
    expect(repairNeedsElevation({ exists: false, running: false, startType: 'unknown' })).toBe(false);
  });
});

describe('the elevated repair command', () => {
  it('is a constant that only touches the ssh-agent service', () => {
    // This runs as administrator. It must not be parameterisable, and it must
    // not be able to reach anything but this one service.
    const joined = AGENT_REPAIR_COMMAND.join(' ');

    expect(joined).toContain("Set-Service -Name 'ssh-agent'");
    expect(joined).toContain("Start-Service -Name 'ssh-agent'");
    expect(joined).toContain('-NonInteractive');
    expect(joined).not.toMatch(/\$\w+/);
  });
});

describe('readAgentState', () => {
  it('reports ready when ssh-add lists identities', async () => {
    const runner = agentWith(`256 ${FINGERPRINT} jane (ED25519)`);
    const state = await readAgentState({ runner, selectedKeyPath: keyPath });

    expect(state.availability).toBe('ready');
    expect(state.socketPresent).toBe(true);
    expect(state.selectedKeyLoaded).toBe(true);
    expect(state.selectedFingerprint).toBe(FINGERPRINT);
  });

  it('treats exit code 1 as a working agent holding nothing', async () => {
    // The distinction the whole feature turns on: "no identities" is not
    // "no agent".
    const runner = agentWith('The agent has no identities.');
    const state = await readAgentState({ runner, selectedKeyPath: keyPath });

    expect(state.availability).toBe('ready');
    expect(state.keys).toEqual([]);
    expect(state.selectedKeyLoaded).toBe(false);
  });

  it('reports the selected key as not loaded when a different key is present', async () => {
    const runner = agentWith(`256 ${OTHER_FINGERPRINT} someone else (ED25519)`);
    const state = await readAgentState({ runner, selectedKeyPath: keyPath });

    expect(state.selectedKeyLoaded).toBe(false);
    expect(state.keys).toHaveLength(1);
  });

  it('reports disabled when the service is disabled and nothing answers', async () => {
    const runner = new FakeRunner()
      .on(command('ssh-add', '-l'), { exitCode: 2, stderr: 'Error connecting to agent' })
      .on(command('sc.exe', 'query'), { stdout: 'STATE : 1 STOPPED' })
      .on(command('sc.exe', 'qc'), { stdout: 'START_TYPE : 4 DISABLED' });

    const state = await readAgentState({ runner });

    if (process.platform === 'win32') {
      expect(state.availability).toBe('disabled');
      expect(state.repairRequiresElevation).toBe(true);
      expect(state.diagnostic).toContain('disabled');
    } else {
      expect(state.availability).toBe('unreachable');
    }
  });

  it('reports stopped when the service exists, is startable, and is not running', async () => {
    const runner = new FakeRunner()
      .on(command('ssh-add', '-l'), { exitCode: 2 })
      .on(command('sc.exe', 'query'), { stdout: 'STATE : 1 STOPPED' })
      .on(command('sc.exe', 'qc'), { stdout: 'START_TYPE : 3 DEMAND_START' });

    const state = await readAgentState({ runner });

    expect(state.availability).toBe(process.platform === 'win32' ? 'stopped' : 'unreachable');
  });

  it('reports missing when ssh-add is not installed', async () => {
    const runner = new FakeRunner()
      .on(command('ssh-add'), { spawnError: true })
      .on(command('sc.exe'), { stdout: '' });

    const state = await readAgentState({ runner });

    expect(state.availability).toBe('missing');
    expect(state.diagnostic).toBeTruthy();
  });

  it('always carries a diagnostic when it is not ready', async () => {
    const runner = new FakeRunner()
      .on(command('ssh-add'), { exitCode: 2 })
      .on(command('sc.exe'), { stdout: '' });

    const state = await readAgentState({ runner });

    expect(state.availability).not.toBe('ready');
    expect(state.diagnostic).toBeTruthy();
  });
});

describe('readKeyFingerprint', () => {
  it('reads the public half, never prompting for the private key', async () => {
    const runner = agentWith('');
    const fingerprint = await readKeyFingerprint(keyPath, runner);

    expect(fingerprint).toBe(FINGERPRINT);

    const call = runner.callsTo('ssh-keygen')[0];
    // The .pub file, because ssh-keygen -l on a private key asks for the
    // passphrase, and this runs on every status poll.
    expect(call?.args).toContain(`${keyPath}.pub`);
  });

  it('returns null when there is no .pub beside the key', async () => {
    fs.rmSync(`${keyPath}.pub`);

    expect(await readKeyFingerprint(keyPath, agentWith(''))).toBeNull();
  });
});

describe('loadKeyIntoAgent', () => {
  it('adds the key and records it as session-owned', async () => {
    // The verifying probe after the add finds the expected fingerprint.
    const runner = agentWith(`256 ${FINGERPRINT} x (ED25519)`);

    const outcome = await loadKeyIntoAgent({ privateKeyPath: keyPath, runner });

    expect(outcome.loaded).toBe(true);
    expect(outcome.fingerprint).toBe(FINGERPRINT);
    expect(sessionOwnedFingerprints().has(FINGERPRINT)).toBe(true);
  });

  it('passes the key path as one argument, unquoted and unmangled', async () => {
    const runner = agentWith(`256 ${FINGERPRINT} x (ED25519)`);
    await loadKeyIntoAgent({ privateKeyPath: keyPath, runner });

    const add = runner.callsTo('ssh-add').find((call) => !call.args.includes('-l'));
    // The path contains a space and non-ASCII. It must arrive as a single
    // argv entry with no quoting applied.
    expect(add?.args).toEqual([keyPath]);
  });

  it('never puts the passphrase in argv, stdin, or the result', async () => {
    const passphrase = 'correct-horse-battery-staple';
    const runner = agentWith(`256 ${FINGERPRINT} x (ED25519)`);

    await loadKeyIntoAgent({ privateKeyPath: keyPath, passphrase, runner });

    // Everything the runner was asked to do, flattened.
    expect(runner.everythingSeen()).not.toContain(passphrase);

    const add = runner.callsTo('ssh-add').find((call) => !call.args.includes('-l'));
    expect(add?.args.join(' ')).not.toContain(passphrase);
    expect(add?.options.input).toBeUndefined();
    // It reaches ssh only through the askpass script named in the environment.
    expect(add?.options.env?.['SSH_ASKPASS']).toBeTruthy();
    expect(add?.options.redact).toContain(passphrase);
  });

  it('removes the askpass script afterwards', async () => {
    const runner = agentWith(`256 ${FINGERPRINT} x (ED25519)`);
    await loadKeyIntoAgent({ privateKeyPath: keyPath, passphrase: 'secret', runner });

    const add = runner.callsTo('ssh-add').find((call) => !call.args.includes('-l'));
    const script = add?.options.env?.['SSH_ASKPASS'];

    expect(script).toBeTruthy();
    // The file held a plaintext passphrase; it must not survive the call.
    expect(fs.existsSync(script as string)).toBe(false);
  });

  it('fails when the expected fingerprint does not appear in the agent', async () => {
    // ssh-add exits zero, but a stale .pub means a different key arrived.
    const runner = new FakeRunner()
      .on(command('ssh-keygen', '-l'), { stdout: `256 ${FINGERPRINT} x (ED25519)` })
      .on(command('ssh-add', '-l'), { stdout: `256 ${OTHER_FINGERPRINT} other (ED25519)` })
      .on((executable, args) => executable.endsWith('ssh-add') && !args.includes('-l'), {
        exitCode: 0
      })
      .on(command('sc.exe'), { stdout: '' });

    const outcome = await loadKeyIntoAgent({ privateKeyPath: keyPath, runner });

    expect(outcome.loaded).toBe(false);
    expect(outcome.error).toContain('not in the agent');
    expect(sessionOwnedFingerprints().has(FINGERPRINT)).toBe(false);
  });

  it('reports a wrong passphrase without echoing it', async () => {
    const runner = agentWith('').on(
      (executable, args) => executable.endsWith('ssh-add') && !args.includes('-l'),
      { exitCode: 1, stderr: 'Error loading key: incorrect passphrase supplied' }
    );

    const outcome = await loadKeyIntoAgent({
      privateKeyPath: keyPath,
      passphrase: 'wrong-one',
      runner
    });

    expect(outcome.loaded).toBe(false);
    expect(outcome.error).toContain('incorrect passphrase');
    expect(outcome.error).not.toContain('wrong-one');
  });

  it('fails cleanly when the key file is gone', async () => {
    fs.rmSync(keyPath);

    const outcome = await loadKeyIntoAgent({ privateKeyPath: keyPath, runner: agentWith('') });

    expect(outcome.loaded).toBe(false);
    expect(outcome.error).toContain('not found');
  });
});

describe('unloadKeyFromAgent', () => {
  it('refuses a key this session did not load', async () => {
    const runner = agentWith(`256 ${FINGERPRINT} someone else (ED25519)`);

    const outcome = await unloadKeyFromAgent({ privateKeyPath: keyPath, runner });

    expect(outcome.unloaded).toBe(false);
    expect(outcome.error).toContain('not loaded by Multi-Git');
    // Nothing was removed: another application may depend on that identity.
    expect(runner.callsTo('ssh-add').some((call) => call.args.includes('-d'))).toBe(false);
  });

  it('removes a session-owned key with -d and the public key path', async () => {
    const runner = agentWith(`256 ${FINGERPRINT} x (ED25519)`);
    await loadKeyIntoAgent({ privateKeyPath: keyPath, runner });

    const outcome = await unloadKeyFromAgent({ privateKeyPath: keyPath, runner });

    expect(outcome.unloaded).toBe(true);
    const remove = runner.callsTo('ssh-add').find((call) => call.args.includes('-d'));
    expect(remove?.args).toEqual(['-d', `${keyPath}.pub`]);
    expect(sessionOwnedFingerprints().has(FINGERPRINT)).toBe(false);
  });

  it('removes a pre-existing key only when forced', async () => {
    const runner = agentWith(`256 ${FINGERPRINT} x (ED25519)`);

    const outcome = await unloadKeyFromAgent({ privateKeyPath: keyPath, force: true, runner });

    expect(outcome.unloaded).toBe(true);
  });

  it('never issues ssh-add -D', async () => {
    // -D deletes every identity in the agent, including other applications'.
    const runner = agentWith(`256 ${FINGERPRINT} x (ED25519)`);
    await loadKeyIntoAgent({ privateKeyPath: keyPath, runner });
    await unloadKeyFromAgent({ privateKeyPath: keyPath, runner });

    expect(runner.calls.some((call) => call.args.includes('-D'))).toBe(false);
  });
});

describe('normalizeSshPath', () => {
  it('expands a leading tilde', () => {
    expect(normalizeSshPath('~/.ssh/id_ed25519')).toBe(
      path.resolve(path.join(os.homedir(), '.ssh', 'id_ed25519'))
    );
    expect(normalizeSshPath('~')).toBe(path.resolve(os.homedir()));
  });

  it('leaves a tilde inside the path alone', () => {
    // Windows 8.3 short names contain one — C:\Users\RUNNER~1, C:\PROGRA~1 —
    // and rewriting it produced a path that does not exist, reported as "the
    // private key file was not found".
    const shortName = path.join(workspace, 'RUNNER~1', 'keys', 'id_ed25519');

    expect(normalizeSshPath(shortName)).toBe(path.resolve(shortName));
    expect(normalizeSshPath(shortName)).toContain('RUNNER~1');
  });

  it('does not treat ~user as a home directory', () => {
    const literal = path.join(workspace, '~someone', 'key');

    expect(normalizeSshPath(literal)).toContain('~someone');
  });

  it('returns an empty string for nothing usable', () => {
    expect(normalizeSshPath('')).toBe('');
    expect(normalizeSshPath(null)).toBe('');
    expect(normalizeSshPath(undefined)).toBe('');
  });
});

describe('repository routing', () => {
  it('quotes the key path and pins the identity', () => {
    // Built from the platform's own temp root rather than a hardcoded
    // `C:\...`: buildRepoSshCommand resolves the path, and a Windows-shaped
    // string is a *relative* path on Linux, so a literal would only pass on
    // one of the two runners.
    const key = path.join(workspace, 'Jane Doe', '.ssh', 'id_ed25519');

    const value = buildRepoSshCommand(key);

    // Quoted because git hands this to a shell, and separators normalised
    // because a POSIX-style shell would eat backslashes.
    expect(value).toContain(`ssh -i "${key.replace(/\\/g, '/')}"`);
    expect(value).toContain(' ');
    // Without this, ssh offers every agent identity in turn and GitHub
    // authenticates as whichever matches first.
    expect(value).toContain('IdentitiesOnly=yes');
  });

  it('normalises Windows separators when it is given them', () => {
    // The transformation itself, without depending on how the running
    // platform resolves a path.
    expect(buildRepoSshCommand(keyPath)).not.toContain('\\');
  });

  it('recognises its own value and leaves a hand-written one alone', () => {
    expect(isMultiGitSshCommand(buildRepoSshCommand('/k'))).toBe(true);
    expect(isMultiGitSshCommand('ssh -J bastion.example -i /k')).toBe(false);
    expect(isMultiGitSshCommand(null)).toBe(false);
  });
});
