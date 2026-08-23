// Handing the repository to a real shell.
//
// The Terminal Log shows what this application ran; sooner or later you want to
// run something yourself, and the honest answer to that is not a half-shell
// embedded in an Electron window. It is the shell you already have, opened
// where you are already working.
//
// What makes it worth a button rather than a bookmark is the identity. This
// application's reason to exist is per-repository SSH keys, and a shell opened
// by hand gets none of that:
//
//   * `core.sshCommand` is written into the repository, so git in any shell
//     picks up the right key -- but it names a bare `ssh`, and in Git Bash a
//     bare `ssh` is the MSYS build shipped inside Git for Windows. That build
//     speaks the Unix-socket protocol and cannot see the named-pipe agent this
//     application loads keys into. The key is unlocked, sitting in the agent,
//     and Git Bash asks for its passphrase anyway.
//   * So the shell is handed a GIT_SSH_COMMAND naming the agent-capable
//     System32 build, carrying the same key. GIT_SSH_COMMAND wins over
//     core.sshCommand, so this corrects the binary without contradicting what
//     the repository says.
//
// The result is a shell where `git push` works with the right identity and no
// passphrase prompt, which is the thing you cannot get by opening a terminal
// yourself.
import fs from 'node:fs';
import path from 'node:path';

import { buildLaunchEnv } from '../agents/launch';
import type { LaunchPlan } from '../agents/launch';
import { readRepoSshCommand } from '../ssh/repo-routing';
import { sshCommandPrefix } from '../ssh/openssh-path';

/**
 * `terminal` is the platform's own -- Windows Terminal, Terminal.app. It is
 * where `gh` is reached, since `gh` is a command rather than a shell and wants
 * somewhere to be typed.
 */
export type ShellKind = 'git-bash' | 'terminal';

/**
 * Where Git for Windows puts the shell, in the order worth trying.
 *
 * `git-bash.exe` rather than `bin/bash.exe`: the former opens its own window,
 * which is what a button called "Git Bash" is expected to do. The latter needs
 * a console attached and, launched detached, would flash and vanish.
 */
function gitBashCandidates(): string[] {
  const localPrograms = process.env['LOCALAPPDATA'];

  const roots = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env['ProgramW6432'],
    localPrograms === undefined ? undefined : path.join(localPrograms, 'Programs')
  ].filter((root): root is string => typeof root === 'string' && root !== '');

  return roots.map((root) => path.join(root, 'Git', 'git-bash.exe'));
}

/** The Git Bash executable, or null when Git for Windows is not installed. */
export function findGitBash(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  return gitBashCandidates().find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * The GIT_SSH_COMMAND a shell opened here should carry.
 *
 * Built from what the repository already says rather than from the application's
 * current selection, so the shell agrees with what git would do on its own --
 * only with an ssh that can reach the agent. Null when the repository pins no
 * key, in which case the shell inherits the machine's defaults and this has no
 * opinion to add.
 */
export async function sshCommandForShell(repoPath: string): Promise<string | null> {
  const pinned = await readRepoSshCommand(repoPath);
  if (pinned === null) {
    return null;
  }

  const prefix = sshCommandPrefix();
  if (prefix === 'ssh') {
    // No better binary to name than the one already there.
    return pinned;
  }

  // Replaces only the leading program, leaving `-i <key>` and the options that
  // make per-repository identity work exactly as the repository wrote them.
  return pinned.replace(/^\s*(?:"[^"]*"|\S+)/, prefix);
}

/** The environment a shell for this repository should carry. */
export async function shellEnvFor(repoPath: string): Promise<NodeJS.ProcessEnv> {
  const sshCommand = await sshCommandForShell(repoPath);

  return buildLaunchEnv(
    process.env,
    sshCommand === null ? undefined : { GIT_SSH_COMMAND: sshCommand }
  );
}

/** What to spawn to put a shell in this repository. */
export async function shellPlanFor(kind: ShellKind, repoPath: string): Promise<LaunchPlan> {
  const env = await shellEnvFor(repoPath);

  if (kind === 'git-bash') {
    const gitBash = findGitBash();
    if (gitBash === null) {
      throw new Error(
        'Git Bash was not found. It comes with Git for Windows, from https://git-scm.com/download/win.'
      );
    }

    return {
      executable: gitBash,
      // git-bash.exe takes its working directory as an option rather than
      // inheriting it, and ignores `cwd` when launched detached.
      args: [`--cd=${repoPath}`],
      cwd: repoPath,
      env,
      visible: true,
      preview: `git-bash --cd="${repoPath}"`
    };
  }

  return terminalPlan(repoPath, env);
}

function terminalPlan(repoPath: string, env: NodeJS.ProcessEnv): LaunchPlan {
  if (process.platform === 'win32') {
    return {
      executable: 'wt.exe',
      args: ['-d', repoPath],
      cwd: repoPath,
      env,
      visible: true,
      preview: `wt -d "${repoPath}"`
    };
  }

  if (process.platform === 'darwin') {
    return {
      executable: 'open',
      args: ['-a', 'Terminal', repoPath],
      cwd: repoPath,
      env,
      visible: true,
      preview: `open -a Terminal "${repoPath}"`
    };
  }

  return {
    executable: 'x-terminal-emulator',
    args: [],
    cwd: repoPath,
    env,
    visible: true,
    preview: `x-terminal-emulator (in ${repoPath})`
  };
}

/**
 * The Windows fallback when Windows Terminal is not installed.
 *
 * Carries the same environment, so the identity holds wherever the shell came
 * from.
 */
export function fallbackShellPlan(repoPath: string, env: NodeJS.ProcessEnv): LaunchPlan {
  return {
    executable: 'powershell.exe',
    args: ['-NoProfile', '-NoExit'],
    cwd: repoPath,
    env,
    visible: true,
    preview: `powershell -NoProfile -NoExit (in ${repoPath})`
  };
}
