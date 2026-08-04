// Pins a repository to one SSH identity via repository-local `core.sshCommand`.
//
// This is what makes the selected profile mean anything outside Multi-Git.
// Passing `GIT_SSH_COMMAND` in a child process environment only reaches
// commands Multi-Git spawns. A PowerShell window, VS Code, Codex or Claude
// running `git push` in the same folder inherits none of it — and on a machine
// with two GitHub accounts, that silently pushes as the wrong one.
//
// Written into `.git/config` of that one repository, so it cannot affect any
// other checkout, and it travels with the folder rather than with this app.
//
// `IdentitiesOnly=yes` is the load-bearing option. Without it ssh offers every
// identity in the agent in turn, and GitHub authenticates as whichever one
// matches first — which is exactly the account-mix-up this feature exists to
// prevent. It does not stop the agent being used: ssh still gets the *key*
// from the agent, it is just told which one to ask for.
import { runGitCommand, tryGitCommand } from '../git/run';
import { normalizeSshPath } from './keys';

/** The git config key this owns. Nothing else in the app writes it. */
export const SSH_COMMAND_KEY = 'core.sshCommand';

/**
 * Builds the command git will run for ssh.
 *
 * The path is quoted and separators normalised because git hands this string
 * to a shell, and `C:\Users\Jane Doe\.ssh\id_ed25519` contains both a space and
 * backslashes that a POSIX-style shell would eat.
 */
export function buildRepoSshCommand(privateKeyPath: string): string {
  const normalized = normalizeSshPath(privateKeyPath).replace(/\\/g, '/');

  return [
    `ssh -i "${normalized}"`,
    '-o IdentitiesOnly=yes',
    '-o StrictHostKeyChecking=accept-new'
  ].join(' ');
}

/** The value currently configured for this repository, or null. */
export async function readRepoSshCommand(repoPath: string): Promise<string | null> {
  // --local so an inherited global value is not mistaken for one we set.
  const result = await tryGitCommand(repoPath, ['config', '--local', '--get', SSH_COMMAND_KEY]);
  const value = result?.stdout.trim();
  return value ? value : null;
}

/**
 * Points this repository at `privateKeyPath`.
 *
 * Idempotent: an unchanged value is not rewritten, so this can be called on
 * every profile check without churning `.git/config` mtime.
 */
export async function setRepoSshCommand(
  repoPath: string,
  privateKeyPath: string
): Promise<{ changed: boolean; value: string }> {
  const value = buildRepoSshCommand(privateKeyPath);

  if ((await readRepoSshCommand(repoPath)) === value) {
    return { changed: false, value };
  }

  await runGitCommand(repoPath, ['config', '--local', SSH_COMMAND_KEY, value]);
  return { changed: true, value };
}

/**
 * Removes the pin, for the System profile.
 *
 * `--unset` exits 5 when the key is not there, which is the ordinary case for
 * a repository that was never pinned, so it is not treated as a failure.
 */
export async function clearRepoSshCommand(repoPath: string): Promise<{ changed: boolean }> {
  if ((await readRepoSshCommand(repoPath)) === null) {
    return { changed: false };
  }

  await tryGitCommand(repoPath, ['config', '--local', '--unset', SSH_COMMAND_KEY]);
  return { changed: true };
}

/**
 * True when a configured value looks like one of ours.
 *
 * Used to avoid clobbering a `core.sshCommand` the user set by hand for their
 * own reasons — a jump host, a custom binary, extra options.
 */
export function isMultiGitSshCommand(value: string | null): boolean {
  return value !== null && value.startsWith('ssh -i "') && value.includes('IdentitiesOnly=yes');
}
