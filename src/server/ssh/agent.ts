// The native SSH agent: read its state, load a key into it, unload one.
//
// Why this exists at all. Today every network Git command carries its own
// `GIT_SSH_COMMAND -i <key>`, which works for commands Multi-Git itself runs
// and for nothing else. Open a terminal in the same repository, or let an
// external coding agent run `git push`, and the identity is gone. Loading the
// key into the machine's own agent is what makes the selected identity real
// for every process, which is the point of the feature.
//
// Three rules hold throughout:
//
//   * Never `ssh-add -D`. It deletes every identity in the agent, including
//     ones other applications loaded and depend on.
//   * Only fingerprints this process loaded are ours to remove.
//   * A passphrase reaches ssh through the AskPass bridge and nowhere else —
//     not argv, not stdin, not a log line, not an error message.
import fs from 'node:fs';

import { executableRunner } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';
import { createAskpassBridge } from './askpass';
import { normalizeSshPath } from './keys';
import { readWindowsAgentService, repairNeedsElevation, WINDOWS_AGENT_SERVICE } from './agent-service';
import type { WindowsServiceInfo } from './agent-service';
import type {
  SshAgentAvailability,
  SshAgentKey,
  SshAgentState
} from '../../shared/ssh-agent-types';

/**
 * `ssh-add -l` exit codes.
 *
 * 1 means the agent answered and holds nothing — a working agent. Reading that
 * as failure is the bug this constant exists to prevent.
 */
const EXIT_NO_IDENTITIES = 1;
const EXIT_CANNOT_CONNECT = 2;

const AGENT_TIMEOUT_MS = 15_000;
/** Loading a key can prompt; the AskPass bridge answers, but not instantly. */
const LOAD_TIMEOUT_MS = 30_000;

/** Fingerprints this process put into the agent. */
const sessionFingerprints = new Set<string>();

/** Test seam. */
export function resetSessionOwnership(): void {
  sessionFingerprints.clear();
}

export function sessionOwnedFingerprints(): ReadonlySet<string> {
  return sessionFingerprints;
}

/**
 * Parses `ssh-add -l` output.
 *
 * Each line is `<bits> <fingerprint> <comment...> (<TYPE>)`. The comment is
 * free text and may contain spaces, so it is whatever sits between the
 * fingerprint and the trailing parenthesised type.
 */
export function parseAgentKeys(output: string): SshAgentKey[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .flatMap((line) => {
      const match = /^(\d+)\s+(\S+)\s*(.*?)\s*(?:\(([^)]*)\))?$/.exec(line);
      const fingerprint = match?.[2];
      if (!fingerprint || !fingerprint.includes(':')) {
        // "The agent has no identities." and similar prose lines.
        return [];
      }

      const comment = match[3]?.trim();
      const key: SshAgentKey = {
        fingerprint,
        source: sessionFingerprints.has(fingerprint) ? 'multi-git-session' : 'pre-existing'
      };
      if (comment) {
        key.comment = comment;
      }
      return [key];
    });
}

/** Pulls the `SHA256:…` field out of `ssh-keygen -l` output. */
export function parseFingerprint(output: string): string | null {
  return /\b(SHA256:[A-Za-z0-9+/=]+)/.exec(output)?.[1] ?? null;
}

/**
 * The fingerprint of a key pair, read from its public half.
 *
 * The `.pub` file is used deliberately: `ssh-keygen -l` against a *private*
 * key prompts for the passphrase, and this runs on every status poll.
 */
export async function readKeyFingerprint(
  privateKeyPath: string,
  runner: ExecutableRunner = executableRunner
): Promise<string | null> {
  const keyPath = normalizeSshPath(privateKeyPath);
  const publicKeyPath = `${keyPath}.pub`;

  if (!fs.existsSync(publicKeyPath)) {
    return null;
  }

  try {
    const result = await runner.run('ssh-keygen', ['-l', '-f', publicKeyPath], {
      timeoutMs: AGENT_TIMEOUT_MS
    });
    return parseFingerprint(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Whether the private key is passphrase-protected.
 *
 * `-P ''` is what makes this safe to call on a schedule: supplying an empty
 * passphrase means ssh-keygen answers immediately either way instead of
 * prompting. An unencrypted key prints its public half; an encrypted one is
 * refused. Nothing waits for a terminal that is not there.
 *
 * This is the difference between "ask the user for a passphrase" and "hang for
 * thirty seconds and then time out", which is what `ssh-add` does on an
 * encrypted key when no AskPass bridge is supplying one.
 */
export async function isKeyEncrypted(
  privateKeyPath: string,
  runner: ExecutableRunner = executableRunner
): Promise<boolean> {
  const keyPath = normalizeSshPath(privateKeyPath);

  try {
    const result = await runner.run('ssh-keygen', ['-y', '-P', '', '-f', keyPath], {
      timeoutMs: AGENT_TIMEOUT_MS,
      allowNonZero: [1, 255]
    });

    return result.exitCode !== 0;
  } catch {
    // Unreadable, missing, or no ssh-keygen. Reported as not-encrypted so the
    // caller proceeds to ssh-add, which produces the real error rather than
    // one guessed at here.
    return false;
  }
}

interface AgentProbe {
  reachable: boolean;
  keys: SshAgentKey[];
  /** True when ssh-add itself could not be run. */
  toolMissing: boolean;
}

async function probeAgent(runner: ExecutableRunner): Promise<AgentProbe> {
  try {
    const result = await runner.run('ssh-add', ['-l'], {
      timeoutMs: AGENT_TIMEOUT_MS,
      // 1 = reachable but empty, 2 = could not connect. Both are answers.
      allowNonZero: [EXIT_NO_IDENTITIES, EXIT_CANNOT_CONNECT]
    });

    if (result.exitCode === EXIT_CANNOT_CONNECT) {
      return { reachable: false, keys: [], toolMissing: false };
    }

    return { reachable: true, keys: parseAgentKeys(result.stdout), toolMissing: false };
  } catch {
    // A spawn failure means no ssh-add on PATH; a timeout means something is
    // listening but wedged. Neither leaves us with a usable agent.
    return { reachable: false, keys: [], toolMissing: true };
  }
}

function classify(
  probe: AgentProbe,
  service: WindowsServiceInfo
): { availability: SshAgentAvailability; diagnostic?: string } {
  if (probe.reachable) {
    return { availability: 'ready' };
  }

  if (process.platform !== 'win32') {
    // Deliberately no service mutation off Windows: the agent may be run by
    // systemd, launchd, a desktop session, or a shell profile, and guessing
    // wrong means fighting whatever actually manages it.
    return {
      availability: probe.toolMissing ? 'missing' : 'unreachable',
      diagnostic: probe.toolMissing
        ? 'ssh-add was not found on PATH. Install the OpenSSH client to use agent-backed profiles.'
        : 'No SSH agent is reachable. Start one (for example `eval $(ssh-agent)`) and make sure SSH_AUTH_SOCK is set for this session.'
    };
  }

  if (!service.exists) {
    return {
      availability: 'missing',
      diagnostic:
        'The Windows OpenSSH Authentication Agent service is not installed. Add the "OpenSSH Client" optional feature in Windows Settings.'
    };
  }

  if (service.startType === 'disabled') {
    return {
      availability: 'disabled',
      diagnostic:
        'The OpenSSH Authentication Agent service is disabled, so it cannot be started until its start type changes. Repair and start SSH agent will do both.'
    };
  }

  if (!service.running) {
    return {
      availability: 'stopped',
      diagnostic:
        'The OpenSSH Authentication Agent service is installed but not running. Repair and start SSH agent will start it.'
    };
  }

  return {
    availability: 'unreachable',
    diagnostic:
      'The OpenSSH Authentication Agent service reports as running, but ssh-add cannot reach it. Restarting the service usually clears this.'
  };
}

export interface AgentStateOptions {
  /** Profile whose key the caller cares about. */
  selectedProfileId?: string | undefined;
  selectedKeyPath?: string | undefined;
  runner?: ExecutableRunner;
}

/** Reads everything the UI needs to describe the agent in one round trip. */
export async function readAgentState(options: AgentStateOptions = {}): Promise<SshAgentState> {
  const runner = options.runner ?? executableRunner;

  const [probe, service] = await Promise.all([
    probeAgent(runner),
    readWindowsAgentService(runner)
  ]);

  const { availability, diagnostic } = classify(probe, service);

  const selectedFingerprint = options.selectedKeyPath
    ? await readKeyFingerprint(options.selectedKeyPath, runner)
    : null;

  const state: SshAgentState = {
    platform: process.platform,
    availability,
    socketPresent: probe.reachable,
    keys: probe.keys,
    selectedKeyLoaded: Boolean(
      selectedFingerprint && probe.keys.some((key) => key.fingerprint === selectedFingerprint)
    ),
    repairRequiresElevation: availability !== 'ready' && repairNeedsElevation(service)
  };

  if (process.platform === 'win32' && service.exists) {
    state.serviceName = WINDOWS_AGENT_SERVICE;
  }
  if (options.selectedProfileId) {
    state.selectedProfileId = options.selectedProfileId;
  }
  if (selectedFingerprint) {
    state.selectedFingerprint = selectedFingerprint;
  }
  if (diagnostic) {
    state.diagnostic = diagnostic;
  }

  return state;
}

export interface LoadKeyOptions {
  privateKeyPath: string;
  /** Omitted for a key with no passphrase. Never logged, never in argv. */
  passphrase?: string | undefined;
  runner?: ExecutableRunner;
}

export interface LoadKeyOutcome {
  loaded: boolean;
  fingerprint: string | null;
  error?: string;
}

/**
 * Loads one key into the agent and verifies it actually arrived.
 *
 * The verification is not ceremony. `ssh-add` can exit zero having added a
 * different key than the caller believes — a stale `.pub` beside a replaced
 * private key is the usual way — and an unverified success would leave the UI
 * claiming an identity that will not authenticate.
 */
export async function loadKeyIntoAgent(options: LoadKeyOptions): Promise<LoadKeyOutcome> {
  const runner = options.runner ?? executableRunner;
  const keyPath = normalizeSshPath(options.privateKeyPath);

  if (!keyPath || !fs.existsSync(keyPath)) {
    return { loaded: false, fingerprint: null, error: 'The private key file was not found.' };
  }

  const expected = await readKeyFingerprint(keyPath, runner);

  // Asked before ssh-add rather than after it fails, because "after it fails"
  // here means thirty seconds of ssh-add waiting on a prompt no one can answer.
  // The caller wants to put a passphrase box in front of the user; it wants to
  // do that now, not once the timeout has expired.
  if (!options.passphrase && (await isKeyEncrypted(keyPath, runner))) {
    return {
      loaded: false,
      fingerprint: expected,
      error: 'This key is protected by a passphrase, and none was supplied.'
    };
  }

  // The passphrase goes to a mode-0600 script in a private temp directory that
  // is removed in the finally below, whatever happens in between.
  const bridge = options.passphrase ? createAskpassBridge(options.passphrase) : null;

  try {
    const result = await runner.run('ssh-add', [keyPath], {
      timeoutMs: LOAD_TIMEOUT_MS,
      env: { ...process.env, ...(bridge?.envOverrides ?? {}) },
      // Belt and braces: if the passphrase ever did reach output, it would be
      // scrubbed before anything could log the result.
      ...(options.passphrase ? { redact: [options.passphrase] } : {}),
      allowNonZero: [1, 2, 255]
    });

    if (result.exitCode !== 0) {
      return {
        loaded: false,
        fingerprint: expected,
        error: result.stderr.trim() || 'ssh-add could not load the key.'
      };
    }
  } catch (error) {
    return {
      loaded: false,
      fingerprint: expected,
      error: error instanceof Error ? error.message : 'ssh-add could not load the key.'
    };
  } finally {
    bridge?.cleanup();
  }

  const probe = await probeAgent(runner);

  if (expected && !probe.keys.some((key) => key.fingerprint === expected)) {
    return {
      loaded: false,
      fingerprint: expected,
      error:
        'ssh-add reported success, but the expected key is not in the agent. The .pub file beside this key may not match it.'
    };
  }

  if (expected) {
    sessionFingerprints.add(expected);
  }

  return { loaded: true, fingerprint: expected };
}

export interface UnloadKeyOptions {
  privateKeyPath: string;
  fingerprint?: string | undefined;
  /** Allows removing a key this process did not load. */
  force?: boolean;
  runner?: ExecutableRunner;
}

/**
 * Removes one identity. Refuses a key this session did not load unless forced.
 *
 * `ssh-add -d` takes the *public* key, and removes exactly that one. There is
 * no code path here that reaches for `-D`.
 */
export async function unloadKeyFromAgent(
  options: UnloadKeyOptions
): Promise<{ unloaded: boolean; error?: string }> {
  const runner = options.runner ?? executableRunner;
  const keyPath = normalizeSshPath(options.privateKeyPath);
  const publicKeyPath = `${keyPath}.pub`;

  const fingerprint = options.fingerprint ?? (await readKeyFingerprint(keyPath, runner));

  if (!options.force && fingerprint && !sessionFingerprints.has(fingerprint)) {
    return {
      unloaded: false,
      error:
        'That identity was not loaded by Multi-Git. Another application may depend on it, so it is left alone unless you confirm.'
    };
  }

  if (!fs.existsSync(publicKeyPath)) {
    return { unloaded: false, error: 'The matching .pub file was not found, so ssh-add cannot remove this identity.' };
  }

  try {
    const result = await runner.run('ssh-add', ['-d', publicKeyPath], {
      timeoutMs: AGENT_TIMEOUT_MS,
      allowNonZero: [1, 2]
    });

    if (result.exitCode !== 0) {
      return { unloaded: false, error: result.stderr.trim() || 'ssh-add could not remove the key.' };
    }
  } catch (error) {
    return {
      unloaded: false,
      error: error instanceof Error ? error.message : 'ssh-add could not remove the key.'
    };
  }

  if (fingerprint) {
    sessionFingerprints.delete(fingerprint);
  }

  return { unloaded: true };
}
