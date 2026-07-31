// Applies an SSH profile to a network Git operation.
import path from 'node:path';

import { GitResult, buildSshCommand, runGitCommand, tryGitCommand } from '../git/run';
import { isLikelyHttpRemote, parseRemoteUrl } from '../git/remote';
import { readConfig } from '../config/store';
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
 * Runs a network Git operation under the selected SSH identity, supplying a
 * stored passphrase through a short-lived askpass bridge when one exists.
 */
export async function runSyncOperationWithProfile(
  repoPath: string,
  gitArgs: readonly string[],
  profileId: string | undefined,
  sshKeyPath: string | undefined
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
    const result = await runGitCommand(repoPath, gitArgs, effectiveKeyPath || null);
    return { ...result, usedAskpass: false, profileLabel, originRemoteUrl };
  }

  const bridge = createAskpassBridge(storedPassphrase);
  try {
    const customSshCommand = effectiveKeyPath
      ? buildSshCommand(effectiveKeyPath, true)
      : 'ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o NumberOfPasswordPrompts=1';

    const result = await runGitCommand(repoPath, gitArgs, null, {
      envOverrides: bridge.envOverrides,
      customSshCommand
    });

    return { ...result, usedAskpass: true, profileLabel, originRemoteUrl };
  } finally {
    // Always, including when the git command threw: the file holds a
    // plaintext passphrase.
    bridge.cleanup();
  }
}
