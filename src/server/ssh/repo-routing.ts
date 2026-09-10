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
// Two things the value has to get right, both of which are now the business of
// ./command.ts:
//
//   * The binary is named rather than left to PATH. `buildSshCommand` in
//     git/run.ts already did this through ./openssh-path.ts; this one did not,
//     so the identity Multi-Git used for its own commands worked and the one it
//     wrote into the repository for everybody else did not.
//
//   * The user configuration is bypassed. `IdentitiesOnly=yes` admits the
//     identities named in ~/.ssh/config alongside `-i`, so the managed block's
//     own entry for the same host is offered too and the agent's ordering picks
//     the account. See ./command.ts.
import { runGitCommand, tryGitCommand } from '../git/run';
import { buildSshCommandLine, isMultiGitSshCommand } from './command';
import { isSshConfigIsolationEnabled, readConfig } from '../config/store';

/** The git config key this owns. Nothing else in the app writes it. */
export const SSH_COMMAND_KEY = 'core.sshCommand';

export { isMultiGitSshCommand };

export interface RepoSshCommandOptions {
  /** Defaults to the app setting. See isSshConfigIsolationEnabled. */
  isolateConfig?: boolean | undefined;
}

/**
 * Builds the command git will run for ssh.
 *
 * The path is quoted and separators normalised because git hands this string
 * to a shell, and `C:\Users\Jane Doe\.ssh\id_ed25519` contains both a space and
 * backslashes that a POSIX-style shell would eat.
 */
export function buildRepoSshCommand(
  privateKeyPath: string,
  options: RepoSshCommandOptions = {}
): string {
  return buildSshCommandLine({
    privateKeyPath,
    isolateConfig: options.isolateConfig ?? true
  });
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
 * every profile check without churning `.git/config` mtime. That is also what
 * migrates a pin written by an older build — the value simply no longer
 * matches, so it is rewritten once and then left alone.
 */
export async function setRepoSshCommand(
  repoPath: string,
  privateKeyPath: string,
  options: RepoSshCommandOptions = {}
): Promise<{ changed: boolean; value: string }> {
  const value = buildRepoSshCommand(privateKeyPath, {
    isolateConfig: options.isolateConfig ?? isSshConfigIsolationEnabled(readConfig())
  });

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

/** The key path a pin names, when it names one. */
export function keyPathFromSshCommand(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return /-i\s+"([^"]+)"/.exec(value)?.[1] ?? /(?:^|\s)-i\s+(\S+)/.exec(value)?.[1] ?? null;
}
