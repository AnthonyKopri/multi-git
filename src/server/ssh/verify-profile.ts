// "Which account does this profile really sign in as?", for a repository.
//
// Shared by the Settings verify button and the guided push, so both ask the
// same host, expect the same account, and remember the answer the same way.
import { readConfig, writeConfig } from '../config/store';
import { HttpError } from '../middleware/error-handler';
import { canonicalHost } from './host-alias';
import { deriveOriginHost } from './profiles';
import { readRepoAccountSetup } from './repo-setup';
import { verifySshAccount } from './verify';
import type { SshIdentityCheck } from '../../shared/ssh-agent-types';

export interface ProfileVerification {
  host: string;
  check: SshIdentityCheck;
}

/**
 * Connects once and reports the account the host greeted. An empty profile id
 * is the System profile: whatever the user's own SSH configuration picks.
 */
export async function verifyProfileAccount(
  profileId: string,
  repoPath: string | undefined
): Promise<ProfileVerification> {
  const config = readConfig();

  const profile = config.sshProfiles.find((entry) => entry.id === profileId);
  if (profileId && !profile) {
    throw new HttpError('SSH profile not found.', 404);
  }

  const setup = repoPath ? await readRepoAccountSetup(repoPath) : null;
  const host = canonicalHost(await deriveOriginHost(repoPath), config.sshProfiles) ?? 'github.com';

  const check = await verifySshAccount({
    host,
    ...(profile ? { privateKeyPath: profile.privateKeyPath } : {}),
    // The remote's owner unless the user overrode it, which they need to for
    // an organisation repository or a fork.
    expectedAccount: setup?.intendedAccount ?? null
  });

  // Remembered so the dropdown can warn about a wrong account instantly and
  // offline. A key's account does not change on its own.
  if (check.account && profile && profile.verifiedAccount !== check.account) {
    const stored = readConfig();
    const entry = stored.sshProfiles.find((candidate) => candidate.id === profile.id);
    if (entry) {
      entry.verifiedAccount = check.account;
      writeConfig(stored);
    }
  }

  return { host, check };
}
