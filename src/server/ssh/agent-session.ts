// Applying an SSH profile: agent state, key loading, repository routing.
//
// The layer between the routes and the primitives in agent.ts. It owns the
// decisions the primitives deliberately do not make — which profile, whether
// the vault can supply a passphrase, whether the repository should be pinned —
// so those primitives stay testable with nothing but a fake runner.
import { readConfig, writeConfig } from '../config/store';
import { canonicalRepoKey } from '../config/repo-identity';
import { mainWorktreePathSync } from '../git/worktrees';
import {
  getStoredPassphrase,
  hasStoredPassphrase,
  isUnlocked,
  setStoredPassphrase
} from '../vault/vault';
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
  /**
   * A passphrase the user just typed, used in preference to the vault.
   *
   * The reason this exists: the vault answers "the passphrase I saved earlier",
   * and until now there was no way to answer "the passphrase I know right now".
   * That left a passphrase-protected key with nothing saved for it permanently
   * unloadable from inside the app, which is exactly the state a restored
   * window opens in.
   *
   * It is never stored, never logged and never part of an argument vector: it
   * goes to `loadKeyIntoAgent`, which hands it to ssh through the AskPass
   * bridge and adds it to the runner's redaction list.
   */
  passphrase?: string | undefined;
  /** Saves the supplied passphrase in the vault. Requires an unlocked vault. */
  savePassphrase?: boolean | undefined;
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

  const supplied = options.passphrase !== undefined && options.passphrase !== ''
    ? options.passphrase
    : null;

  // A passphrase the user has just typed answers the question the vault would
  // have answered, so a locked vault is no longer a dead end.
  if (supplied === null && hasStoredPassphrase(profile.id) && !isUnlocked()) {
    return {
      success: false,
      agent: before,
      error: 'Unlock the vault so the saved passphrase can be used for this key.',
      code: 'VAULT_LOCKED',
      routingChanged
    };
  }

  const passphrase = supplied ?? (isUnlocked() ? getStoredPassphrase(profile.id) : null);

  const outcome = await loadKeyIntoAgent({
    privateKeyPath: profile.privateKeyPath,
    ...(passphrase ? { passphrase } : {}),
    ...(runner ? { runner } : {})
  });

  // Only after the key demonstrably loaded: storing a passphrase that turns
  // out to be wrong would leave the user with a saved value that fails
  // silently on every future launch.
  if (outcome.loaded && supplied !== null && options.savePassphrase === true && isUnlocked()) {
    setStoredPassphrase(profile.id, supplied);
  }

  const after = await agentStatus({ profileId, ...(runner ? { runner } : {}) });

  if (!outcome.loaded) {
    return {
      success: false,
      agent: after,
      error: outcome.error ?? 'The key could not be loaded into the agent.',
      // Three different situations, three different things for the UI to do:
      // ask for the passphrase, say the one just given was wrong and ask
      // again, or report a failure that typing will not solve.
      code: supplied !== null
        ? 'PASSPHRASE_REJECTED'
        : !passphrase && hasStoredPassphrase(profile.id) === false
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

/**
 * The folder an account selection is recorded against.
 *
 * A repository and its worktrees share one `.git/config`, so they share one
 * `core.sshCommand` and therefore one identity — git gives no way to have two
 * without turning on a repository-level extension. Recording the choice
 * against the main worktree makes the settings agree with what git will
 * actually do, instead of offering a per-worktree account that silently
 * rewrites the shared value.
 */
function identityOwner(repoPath: string): string {
  return mainWorktreePathSync(repoPath) ?? repoPath;
}

/** Remembers which profile a repository family uses, by canonical identity. */
export function rememberProfileForRepo(repoPath: string, profileId: string): boolean {
  const key = canonicalRepoKey(identityOwner(repoPath));
  if (key === '') {
    return false;
  }

  const config = readConfig();
  config.repoSettings[key] = { ...(config.repoSettings[key] ?? {}), sshProfileId: profileId };

  return writeConfig(config);
}

/**
 * The profile this folder's family was last set to, if any.
 *
 * The folder's own record is preferred, so a choice made before worktrees
 * existed still applies. A worktree created since has no record of its own and
 * inherits the family's — without which opening one in a new window would drop
 * silently to System SSH even though the family is pinned to an account.
 */
export function profileForRepo(repoPath: string): string | null {
  const settings = readConfig().repoSettings;

  const ownKey = canonicalRepoKey(repoPath);
  if (ownKey !== '' && settings[ownKey]?.sshProfileId !== undefined) {
    return settings[ownKey].sshProfileId ?? null;
  }

  const familyKey = canonicalRepoKey(identityOwner(repoPath));
  return familyKey === '' ? null : (settings[familyKey]?.sshProfileId ?? null);
}
