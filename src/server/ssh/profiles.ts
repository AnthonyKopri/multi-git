// Applies an SSH profile to a network Git operation.
import path from 'node:path';

import { GitError, runGitCommand, tryGitCommand } from '../git/run';
import { buildSshCommandLine } from './command';
import { wrongAccountHint } from './verify';
import type { GitResult } from '../git/run';
import { isLikelyHttpRemote, parseRemoteUrl } from '../git/remote';
import { isSshConfigIsolationEnabled, readConfig } from '../config/store';
import { createAskpassBridge } from './askpass';
import { normalizeSshPath } from './keys';
import { getStoredPassphrase, hasStoredPassphrase, isUnlocked } from '../vault/vault';
import { HttpError } from '../middleware/error-handler';
import type { SshProfile } from '../../shared/config-types';

export async function getOriginRemoteUrl(repoPath: string): Promise<string> {
  const result = await tryGitCommand(repoPath, ['remote', 'get-url', 'origin']);
  return result?.stdout.trim() ?? '';
}

/**
 * Host of the repository's origin, or null when there is no usable remote.
 *
 * Callers assigning a key may fall back to github.com; callers *removing* an
 * entry must not guess, because a wrong guess would delete a host entry
 * belonging to a different repository.
 */
export async function deriveOriginHost(repoPath: string | undefined): Promise<string | null> {
  if (!repoPath) {
    return null;
  }

  return parseRemoteUrl(await getOriginRemoteUrl(repoPath))?.host ?? null;
}

export interface SyncOutcome extends GitResult {
  usedAskpass: boolean;
  profileLabel: string | null;
  originRemoteUrl: string;
}

/**
 * Resolves which profile a request means, by id or by key path.
 *
 * An explicit id that does not resolve is an error; a key path that does not
 * match any profile is fine, since a key can be used without registering it.
 */
function selectProfile(
  profiles: readonly SshProfile[],
  profileId: string | undefined,
  requestedKeyPath: string
): SshProfile | null {
  if (profileId) {
    const byId = profiles.find((profile) => profile.id === profileId);
    if (!byId) {
      throw new HttpError('Selected SSH profile was not found.', 400);
    }
    return byId;
  }

  if (requestedKeyPath) {
    return (
      profiles.find(
        (profile) => path.resolve(profile.privateKeyPath) === requestedKeyPath
      ) ?? null
    );
  }

  return null;
}

/**
 * Rethrows a git failure with the wrong-account explanation attached.
 *
 * `ERROR: Repository not found.` is what GitHub returns when the account that
 * authenticated cannot see the repository, which on a machine with two
 * accounts is far more often the wrong key than a missing repo.
 */
function withAccountContext(
  error: unknown,
  profileLabel: string | null,
  originRemoteUrl: string
): never {
  if (error instanceof GitError) {
    const hint = wrongAccountHint(error.stderr, { profileLabel, originRemoteUrl });

    if (hint) {
      throw new GitError(error.message, {
        stdout: error.stdout,
        stderr: `${error.stderr.trim()}\n\n${hint}`,
        exitCode: error.exitCode,
        statusCode: error.statusCode
      });
    }
  }

  throw error;
}

/**
 * Runs a network Git operation under the selected SSH identity, supplying a
 * stored passphrase through a short-lived askpass bridge when one exists.
 */
export async function runSyncOperationWithProfile(
  repoPath: string,
  gitArgs: readonly string[],
  profileId: string | undefined,
  sshKeyPath: string | undefined,
  /**
   * Ends the git process when it fires, which is what makes the Cancel button
   * in the operations bar do something to a push that is already talking to a
   * remote.
   */
  options: { signal?: AbortSignal } = {}
): Promise<SyncOutcome> {
  const config = readConfig();
  const requestedKeyPath = normalizeSshPath(sshKeyPath);
  const selectedProfile = selectProfile(config.sshProfiles, profileId, requestedKeyPath);

  const effectiveKeyPath = selectedProfile ? selectedProfile.privateKeyPath : requestedKeyPath;
  const profileLabel = selectedProfile?.label ?? null;
  const originRemoteUrl = await getOriginRemoteUrl(repoPath);

  if (selectedProfile && isLikelyHttpRemote(originRemoteUrl)) {
    throw new HttpError(
      `Remote "origin" is configured with HTTPS (${originRemoteUrl}). This triggers GitHub account chooser popups. ` +
        'Switch your remote to SSH (for example git@github.com:owner/repo.git) to use SSH Profiles without account popups.',
      400
    );
  }

  if (selectedProfile && hasStoredPassphrase(selectedProfile.id) && !isUnlocked()) {
    throw new HttpError(
      'Vault is locked. Unlock the vault to use the saved passphrase for this SSH profile.',
      400
    );
  }

  const storedPassphrase =
    selectedProfile && isUnlocked() ? getStoredPassphrase(selectedProfile.id) : null;

  if (!storedPassphrase) {
    try {
      const result = await runGitCommand(repoPath, gitArgs, effectiveKeyPath || null, {
        ...(options.signal ? { signal: options.signal } : {})
      });
      return { ...result, usedAskpass: false, profileLabel, originRemoteUrl };
    } catch (error) {
      withAccountContext(error, profileLabel, originRemoteUrl);
    }
  }

  const bridge = createAskpassBridge(storedPassphrase);
  try {
    // No key of its own means there is nothing for `-i` to name, so this
    // branch deliberately gets neither IdentitiesOnly nor a bypassed
    // configuration: both together would tell ssh to offer nothing at all,
    // which is what the string this replaces actually did.
    const customSshCommand = buildSshCommandLine({
      ...(effectiveKeyPath ? { privateKeyPath: effectiveKeyPath } : {}),
      isolateConfig: isSshConfigIsolationEnabled(config),
      singlePasswordPrompt: true
    });

    try {
      const result = await runGitCommand(repoPath, gitArgs, null, {
        envOverrides: bridge.envOverrides,
        customSshCommand,
        ...(options.signal ? { signal: options.signal } : {})
      });

      return { ...result, usedAskpass: true, profileLabel, originRemoteUrl };
    } catch (error) {
      withAccountContext(error, profileLabel, originRemoteUrl);
    }
  } finally {
    // Always, including when the git command threw: the file holds a
    // plaintext passphrase.
    bridge.cleanup();
  }
}
