// What a repository is currently configured to do, read before changing it.
//
// Everything here is already knowable from `.git/config`; the value is in
// having it in one shape, in one call, so the app can put it in front of the
// user before it overwrites anything. Two states in particular were previously
// invisible:
//
//   * A `core.sshCommand` somebody wrote by hand is left alone — correctly, it
//     may be a jump host — but nothing said so, so the account simply did not
//     change and no one knew why.
//
//   * A repository with no local `user.email` inherits the global one, which on
//     a two-account machine is routinely the other account. The pin was
//     enforced and the authorship was not, and they disagreed silently.
import { tryGitCommand } from '../git/run';
import { ownerFromRemote } from '../git/remote';
import { isMultiGitSshCommand, keyPathFromSshCommand, readRepoSshCommand } from './repo-routing';
import { getOriginRemoteUrl } from './profiles';
import { normalizeSshPath } from './keys';
import { readConfig } from '../config/store';
import { canonicalRepoKey } from '../config/repo-identity';
import type { RepoAccountSetup, RepoPinOrigin } from '../../shared/ssh-agent-types';

async function configValue(
  repoPath: string,
  key: string,
  scope?: '--local'
): Promise<string | null> {
  const args = scope ? ['config', scope, '--get', key] : ['config', '--get', key];
  const value = (await tryGitCommand(repoPath, args))?.stdout.trim();
  return value ? value : null;
}


/**
 * The account the user declared this repository belongs to, if they did.
 *
 * Only consulted because deriving it from the remote is wrong for an
 * organisation repository or a fork, where the owner is not an account anybody
 * authenticates as.
 */
function intendedAccountOverride(repoPath: string): string | null {
  const key = canonicalRepoKey(repoPath);
  const stored = key === '' ? undefined : readConfig().repoSettings[key]?.intendedAccount;
  return stored ? stored : null;
}

/** Everything the confirmation dialog needs, in one round trip. */
export async function readRepoAccountSetup(repoPath: string): Promise<RepoAccountSetup> {
  const [pinValue, localName, localEmail, effectiveName, effectiveEmail, originRemoteUrl] =
    await Promise.all([
      readRepoSshCommand(repoPath),
      configValue(repoPath, 'user.name', '--local'),
      configValue(repoPath, 'user.email', '--local'),
      configValue(repoPath, 'user.name'),
      configValue(repoPath, 'user.email'),
      getOriginRemoteUrl(repoPath).then((url) => (url === '' ? null : url))
    ]);

  const originOwner = ownerFromRemote(originRemoteUrl);
  const override = intendedAccountOverride(repoPath);

  const pinKeyPath = keyPathFromSshCommand(pinValue);
  const pinOrigin: RepoPinOrigin =
    pinValue === null ? 'none' : isMultiGitSshCommand(pinValue) ? 'multi-git' : 'user';

  // Matched on the resolved path: the pin stores forward slashes and the
  // profile may have been saved with the platform's own separators.
  const normalizedPin = pinKeyPath ? normalizeSshPath(pinKeyPath) : null;
  const profile = normalizedPin
    ? (readConfig().sshProfiles.find(
        (entry) => normalizeSshPath(entry.privateKeyPath) === normalizedPin
      ) ?? null)
    : null;

  return {
    pinOrigin,
    pinValue,
    pinKeyPath,
    pinProfileId: profile?.id ?? null,
    pinProfileLabel: profile?.label ?? null,
    localName,
    localEmail,
    effectiveName,
    effectiveEmail,
    originRemoteUrl,
    originOwner,
    intendedAccount: override ?? originOwner,
    intendedIsOverride: override !== null
  };
}

/**
 * Whether applying `profileId` would change anything already configured.
 *
 * "Already configured" is the part that matters: a repository with nothing set
 * is not something the user needs to confirm overwriting, and asking on every
 * fresh repository would train them to click through the dialog that exists to
 * stop the one case that matters.
 */
export function wouldOverwrite(
  setup: RepoAccountSetup,
  profileId: string,
  profileEmail: string | null
): boolean {
  if (setup.pinOrigin === 'user') {
    return true;
  }

  if (setup.pinOrigin === 'multi-git' && setup.pinProfileId !== null) {
    if (setup.pinProfileId !== profileId) {
      return true;
    }
  }

  return (
    setup.localEmail !== null &&
    profileEmail !== null &&
    setup.localEmail.toLowerCase() !== profileEmail.toLowerCase()
  );
}
