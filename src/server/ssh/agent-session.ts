// Applying an SSH profile: agent state, key loading, repository routing.
//
// The layer between the routes and the primitives in agent.ts. It owns the
// decisions the primitives deliberately do not make — which profile, whether
// the vault can supply a passphrase, whether the repository should be pinned —
// so those primitives stay testable with nothing but a fake runner.
import { readConfig, writeConfig } from '../config/store';
import { canonicalRepoKey } from '../config/repo-identity';
import { getStoredPassphrase, hasStoredPassphrase, isUnlocked } from '../vault/vault';
import {
  loadKeyIntoAgent,
  readAgentState,
  readKeyFingerprint,
  sessionOwnedFingerprints,
  unloadKeyFromAgent
} from './agent';
import { clearRepoSshCommand, isMultiGitSshCommand, readRepoSshCommand, setRepoSshCommand } from './repo-routing';
import type { ExecutableRunner } from '../process/runner';
import type { SshProfile } from '../../shared/config-types';
import type { SshAgentErrorCode, SshAgentState } from '../../shared/ssh-agent-types';

/** The System profile: inherit whatever the environment already provides. */
export const SYSTEM_PROFILE_ID = '';

export function findProfile(profileId: string): SshProfile | null {
  if (profileId === SYSTEM_PROFILE_ID) {
    return null;
  }
  return readConfig().sshProfiles.find((profile) => profile.id === profileId) ?? null;
}

export interface AgentStatusOptions {
  profileId?: string | undefined;
  runner?: ExecutableRunner | undefined;
}

export async function agentStatus(options: AgentStatusOptions = {}): Promise<SshAgentState> {
  const profile = options.profileId ? findProfile(options.profileId) : null;

  return readAgentState({
    ...(options.profileId ? { selectedProfileId: options.profileId } : {}),
    ...(profile ? { selectedKeyPath: profile.privateKeyPath } : {}),
    ...(options.runner ? { runner: options.runner } : {})
  });
}

export interface ApplyProfileResult {
  success: boolean;
  agent: SshAgentState;
  error?: string;
  code?: SshAgentErrorCode;
  /** Whether this repository's core.sshCommand was written or cleared. */
  routingChanged: boolean;
}

export interface ApplyProfileOptions {
  repoPath?: string | undefined;
  profileId: string;
  runner?: ExecutableRunner | undefined;
}

/**
 * Points a repository at a profile and gets its key into the agent.
 *
 * The System profile is a deliberate no-op on the agent: it means "use
 * whatever this machine already does", so starting a service or loading a key
 * on its behalf would be exactly the surprise the setting exists to avoid.
 */
export async function applyProfile(options: ApplyProfileOptions): Promise<ApplyProfileResult> {
  const { repoPath, profileId } = options;
  const runner = options.runner;

  if (profileId === SYSTEM_PROFILE_ID) {
    const routingChanged = repoPath ? await clearRepoRouting(repoPath) : false;
    return {
      success: true,
      agent: await agentStatus({ ...(runner ? { runner } : {}) }),
      routingChanged
    };
  }

  const profile = findProfile(profileId);
  if (!profile) {
    return {
      success: false,
      agent: await agentStatus({ ...(runner ? { runner } : {}) }),
      error: 'Selected SSH profile was not found.',
      code: 'PROFILE_NOT_FOUND',
      routingChanged: false
    };
  }

  // Routing first, and unconditionally. Even if the agent cannot be repaired,
  // a pinned repository still authenticates correctly through the per-command
  // fallback, so the degraded state stays usable rather than becoming wrong.
  const routingChanged = repoPath ? await applyRepoRouting(repoPath, profile) : false;

  const before = await agentStatus({ profileId, ...(runner ? { runner } : {}) });

  if (before.selectedKeyLoaded) {
    return { success: true, agent: before, routingChanged };
  }

  if (before.availability !== 'ready') {
    return {
      success: false,
      agent: before,
      error: before.diagnostic ?? 'No SSH agent is available.',
      code: before.repairRequiresElevation ? 'REPAIR_REQUIRED' : 'AGENT_UNAVAILABLE',
      routingChanged
    };
  }

  if (hasStoredPassphrase(profile.id) && !isUnlocked()) {
    return {
      success: false,
      agent: before,
      error: 'Unlock the vault so the saved passphrase can be used for this key.',
      code: 'VAULT_LOCKED',
      routingChanged
    };
  }

  const passphrase = isUnlocked() ? getStoredPassphrase(profile.id) : null;

  const outcome = await loadKeyIntoAgent({
    privateKeyPath: profile.privateKeyPath,
    ...(passphrase ? { passphrase } : {}),
    ...(runner ? { runner } : {})
  });

  const after = await agentStatus({ profileId, ...(runner ? { runner } : {}) });

  if (!outcome.loaded) {
    return {
      success: false,
      agent: after,
      error: outcome.error ?? 'The key could not be loaded into the agent.',
      // A protected key with nothing in the vault is the common case, and it
      // has an obvious remedy the UI can offer.
      code:
        !passphrase && hasStoredPassphrase(profile.id) === false
          ? 'PASSPHRASE_REQUIRED'
          : 'LOAD_FAILED',
      routingChanged
    };
  }

  return { success: true, agent: after, routingChanged };
}

/** Writes the repository pin, leaving a hand-written value alone. */
async function applyRepoRouting(repoPath: string, profile: SshProfile): Promise<boolean> {
  const existing = await readRepoSshCommand(repoPath);

  if (existing !== null && !isMultiGitSshCommand(existing)) {
    // Someone configured a jump host or a custom ssh binary here. Overwriting
    // it would break their setup to enforce ours.
    return false;
  }

  return (await setRepoSshCommand(repoPath, profile.privateKeyPath)).changed;
}

/** Removes the pin, but only one this app wrote. */
async function clearRepoRouting(repoPath: string): Promise<boolean> {
  const existing = await readRepoSshCommand(repoPath);

  if (!isMultiGitSshCommand(existing)) {
    return false;
  }

  return (await clearRepoSshCommand(repoPath)).changed;
}

export interface UnloadResult {
  success: boolean;
  agent: SshAgentState;
  error?: string;
  code?: SshAgentErrorCode;
}

export async function unloadProfileKey(
  profileId: string,
  options: { force?: boolean; runner?: ExecutableRunner | undefined } = {}
): Promise<UnloadResult> {
  const profile = findProfile(profileId);
  const runner = options.runner;

  if (!profile) {
    return {
      success: false,
      agent: await agentStatus({ ...(runner ? { runner } : {}) }),
      error: 'Selected SSH profile was not found.',
      code: 'PROFILE_NOT_FOUND'
    };
  }

  const outcome = await unloadKeyFromAgent({
    privateKeyPath: profile.privateKeyPath,
    ...(options.force !== undefined ? { force: options.force } : {}),
    ...(runner ? { runner } : {})
  });

  const agent = await agentStatus({ profileId, ...(runner ? { runner } : {}) });

  if (!outcome.unloaded) {
    return {
      success: false,
      agent,
      error: outcome.error ?? 'The key could not be removed from the agent.',
      code: 'NOT_SESSION_OWNED'
    };
  }

  return { success: true, agent };
}

/**
 * Removes the identities this session loaded, one at a time.
 *
 * Called when the vault locks. The passphrases that authorised those keys are
 * no longer available, so leaving the keys usable would outlive the consent
 * that put them there.
 *
 * Everything about this is deliberately narrow: only fingerprints this process
 * recorded, removed individually with `ssh-add -d`. There is no path here to
 * `ssh-add -D`, which would delete every identity in the agent including ones
 * another application loaded and depends on.
 */
export async function unloadSessionKeys(
  options: { runner?: ExecutableRunner | undefined } = {}
): Promise<{ removed: string[]; failed: string[] }> {
  const owned = new Set(sessionOwnedFingerprints());
  const removed: string[] = [];
  const failed: string[] = [];

  if (owned.size === 0) {
    return { removed, failed };
  }

  // Matched back to profiles because `ssh-add -d` takes a public key path
  // rather than a fingerprint.
  for (const profile of readConfig().sshProfiles) {
    const fingerprint = await readKeyFingerprint(profile.privateKeyPath, options.runner);
    if (!fingerprint || !owned.has(fingerprint)) {
      continue;
    }

    const outcome = await unloadKeyFromAgent({
      privateKeyPath: profile.privateKeyPath,
      fingerprint,
      ...(options.runner ? { runner: options.runner } : {})
    });

    (outcome.unloaded ? removed : failed).push(profile.label);
  }

  return { removed, failed };
}

/**
 * Makes sure the repository's profile is in the agent before a network call.
 *
 * Best effort by design. A push must not be blocked because the agent could
 * not be repaired — the per-command `GIT_SSH_COMMAND` fallback still
 * authenticates in-app operations, so a degraded agent degrades external
 * tooling, not this one.
 */
export async function ensureAgentForRepo(
  repoPath: string,
  profileId?: string
): Promise<void> {
  const selected = profileId ?? profileForRepo(repoPath);

  if (!selected || selected === SYSTEM_PROFILE_ID) {
    return;
  }

  try {
    const state = await agentStatus({ profileId: selected });
    if (state.availability === 'ready' && !state.selectedKeyLoaded) {
      await applyProfile({ repoPath, profileId: selected });
    }
  } catch {
    // Nothing here is worth failing a push over.
  }
}

/** Remembers which profile a repository uses, keyed by canonical identity. */
export function rememberProfileForRepo(repoPath: string, profileId: string): boolean {
  const key = canonicalRepoKey(repoPath);
  if (key === '') {
    return false;
  }

  const config = readConfig();
  config.repoSettings[key] = { ...(config.repoSettings[key] ?? {}), sshProfileId: profileId };

  return writeConfig(config);
}

/** The profile a repository was last set to, if any. */
export function profileForRepo(repoPath: string): string | null {
  const key = canonicalRepoKey(repoPath);
  return key === '' ? null : (readConfig().repoSettings[key]?.sshProfileId ?? null);
}
