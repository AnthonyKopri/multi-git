// Starting an external tool in a worktree.
//
// Three things in this file are load-bearing, and all three exist because the
// values involved — a branch name, a folder name, a prompt someone pasted —
// are not under this application's control.
//
//   * The argument vector is built as an array and stays one. There is no
//     point at which a command line is assembled from strings, so there is
//     nothing for a `;`, a quote or a newline to break out of.
//
//   * The PowerShell mode is the exception that proves it. A visible
//     PowerShell window needs `-Command`, which is a string it will parse — so
//     the string is a compile-time constant and the executable and arguments
//     travel in the environment instead. Same trick as rebase-bridge.ts.
//
//   * The environment is an allowlist rather than a copy of this process's.
//     Multi-Git's own environment holds an askpass bridge, an agent socket and
//     whatever else the session accumulated; a coding agent has no business
//     inheriting it.
import path from 'node:path';
import fs from 'node:fs';

import { describeCommand, detachedLauncher } from '../process/runner';
import type { DetachedLauncher } from '../process/runner';
import { sanitizeEnvOverrides } from '../config/validate';
import type { ExternalAgentDefinition } from '../../shared/config-types';

/**
 * Environment a launched tool inherits.
 *
 * Everything a console program needs to find its own files, its home
 * directory and the user's PATH — and nothing that describes what Multi-Git
 * happens to be doing. `SSH_AUTH_SOCK` is included because on Linux and macOS
 * it is how the agent is reached at all; on Windows the agent is a named pipe
 * and the variable is absent, which is fine.
 */
export const INHERITED_ENV_KEYS: readonly string[] = [
  'PATH',
  'Path',
  'PATHEXT',
  'ComSpec',
  'SystemRoot',
  'SystemDrive',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'USERNAME',
  'USER',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'SSH_AUTH_SOCK',
  'LANG',
  'LC_ALL',
  'TERM',
  'COLORTERM'
];

/** Environment variables that must never reach a launched tool. */
const NEVER_INHERITED = new Set([
  // Multi-Git's own askpass bridge, which answers with a stored passphrase.
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  'DISPLAY',
  'GIT_ASKPASS',
  // The identity belongs to the folder through core.sshCommand, not to a
  // variable a child could inherit and then carry somewhere else.
  'GIT_SSH_COMMAND',
  'GIT_SSH',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_SEQUENCE_EDITOR',
  'GIT_EDITOR'
]);

/** Builds the environment a launched tool runs with. */
export function buildLaunchEnv(
  parentEnv: NodeJS.ProcessEnv,
  overrides: Record<string, string> | undefined
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of INHERITED_ENV_KEYS) {
    const value = parentEnv[key];
    if (value !== undefined && !NEVER_INHERITED.has(key.toUpperCase())) {
      env[key] = value;
    }
  }

  // Run through the same filter the configuration validator uses, so a value
  // that would make a process load code before its own main is dropped here
  // too rather than only at write time.
  for (const [key, value] of Object.entries(sanitizeEnvOverrides(overrides ?? {}))) {
    if (!NEVER_INHERITED.has(key.toUpperCase()) && value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Escapes an argument for Windows Terminal's command line.
 *
 * `wt` re-parses everything after `--` and treats `;` as a separator between
 * commands, so an unescaped semicolon in a branch name or a prompt would start
 * a second tab running the rest of the text. This is not shell quoting — the
 * process is still spawned with an argument array — it is undoing one specific
 * meaning `wt` assigns to one character.
 */
export function escapeForWindowsTerminal(argument: string): string {
  return argument.replace(/;/g, '\\;');
}

/**
 * The fixed script the PowerShell mode runs.
 *
 * Deliberately a constant: it names two environment variables and does nothing
 * else, so no value from a definition, a folder name or a prompt is ever part
 * of a string PowerShell parses. `MG_LAUNCH_ARGS` is JSON, which survives
 * spaces, quotes and newlines that a delimiter-separated list would not.
 */
export const POWERSHELL_BRIDGE_SCRIPT =
  '& $env:MG_LAUNCH_EXE @([string[]](ConvertFrom-Json $env:MG_LAUNCH_ARGS))';

export interface LaunchPlan {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Whether the process should get a visible window. */
  visible: boolean;
  /** The command as it reads in the Terminal Log. Excludes the prompt. */
  preview: string;
}

export interface BuildPlanInput {
  definition: ExternalAgentDefinition;
  worktreePath: string;
  initialPrompt?: string;
  parentEnv?: NodeJS.ProcessEnv;
}

/**
 * Works out exactly what will be spawned, without spawning it.
 *
 * Separated from the launch so a test can assert the executable, the argument
 * vector, the working directory and the environment for every terminal mode
 * without a single process starting.
 */
export function buildLaunchPlan(input: BuildPlanInput): LaunchPlan {
  const { definition, worktreePath } = input;
  const env = buildLaunchEnv(input.parentEnv ?? process.env, definition.env);

  // The prompt is appended only when the definition says it takes one, so a
  // tool that would read it as a file name never receives it.
  const toolArgs = [...definition.args];
  const prompt = input.initialPrompt?.trim();
  if (prompt && definition.promptMode === 'argument') {
    toolArgs.push(prompt);
  }

  // The preview is what goes in the log and the launch history. Built from the
  // arguments without the prompt, because a prompt is the most sensitive part
  // of a launch and is not recorded anywhere.
  const preview = describeCommand(definition.executable, definition.args);

  if (definition.terminal === 'windows-terminal') {
    return {
      executable: 'wt.exe',
      args: [
        '-d',
        worktreePath,
        '--',
        definition.executable,
        ...toolArgs.map(escapeForWindowsTerminal)
      ],
      cwd: worktreePath,
      env,
      visible: true,
      preview: `wt -d "${worktreePath}" -- ${preview}`
    };
  }

  if (definition.terminal === 'powershell') {
    return {
      executable: 'powershell.exe',
      args: ['-NoProfile', '-NoExit', '-Command', POWERSHELL_BRIDGE_SCRIPT],
      cwd: worktreePath,
      env: {
        ...env,
        MG_LAUNCH_EXE: definition.executable,
        MG_LAUNCH_ARGS: JSON.stringify(toolArgs)
      },
      visible: true,
      preview: `powershell -NoProfile -NoExit -Command ${preview}`
    };
  }

  return {
    executable: definition.executable,
    args: toolArgs,
    cwd: worktreePath,
    // An interactive agent with no window is an agent nobody can answer.
    visible: true,
    env,
    preview
  };
}

export class AgentLaunchError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AgentLaunchError';
  }
}

/** Runs the plan. The only place in this file that starts anything. */
export async function runLaunchPlan(
  plan: LaunchPlan,
  launcher: DetachedLauncher = detachedLauncher
): Promise<{ pid?: number }> {
  if (!fs.existsSync(plan.cwd)) {
    throw new AgentLaunchError(`${plan.cwd} no longer exists, so nothing can be started in it.`);
  }

  return launcher.launch(plan.executable, plan.args, {
    cwd: plan.cwd,
    env: plan.env,
    visible: plan.visible
  });
}

// ---------- the companions on every worktree row ----------

/** Opens the platform's terminal with the folder as its working directory. */
export function terminalPlanFor(worktreePath: string, parentEnv = process.env): LaunchPlan {
  const env = buildLaunchEnv(parentEnv, undefined);

  if (process.platform === 'win32') {
    // Windows Terminal when it is installed; the fallback is the shell that
    // has shipped with every version of Windows.
    return {
      executable: 'wt.exe',
      args: ['-d', worktreePath],
      cwd: worktreePath,
      env,
      visible: true,
      preview: `wt -d "${worktreePath}"`
    };
  }

  if (process.platform === 'darwin') {
    return {
      executable: 'open',
      args: ['-a', 'Terminal', worktreePath],
      cwd: worktreePath,
      env,
      visible: true,
      preview: `open -a Terminal "${worktreePath}"`
    };
  }

  return {
    executable: 'x-terminal-emulator',
    args: [],
    cwd: worktreePath,
    env,
    visible: true,
    preview: `x-terminal-emulator (in ${worktreePath})`
  };
}

/** The Windows fallback when Windows Terminal is not installed. */
export function fallbackTerminalPlan(worktreePath: string, parentEnv = process.env): LaunchPlan {
  return {
    executable: 'powershell.exe',
    args: ['-NoProfile', '-NoExit'],
    cwd: worktreePath,
    env: buildLaunchEnv(parentEnv, undefined),
    visible: true,
    preview: `powershell -NoProfile -NoExit (in ${worktreePath})`
  };
}

/**
 * Opens the folder in an editor.
 *
 * `code` is tried first because it is the editor most likely to be installed
 * and the only one that meaningfully opens a *folder*; everything else falls
 * back to whatever the desktop associates with a directory.
 */
export function editorPlanFor(worktreePath: string, parentEnv = process.env): LaunchPlan {
  const env = buildLaunchEnv(parentEnv, undefined);

  return {
    executable: process.platform === 'win32' ? 'code.cmd' : 'code',
    args: [worktreePath],
    cwd: worktreePath,
    env,
    visible: false,
    preview: `code "${worktreePath}"`
  };
}

/** Opens a folder with the desktop's own handler. Used when no editor is found. */
export function revealPlanFor(worktreePath: string, parentEnv = process.env): LaunchPlan {
  const env = buildLaunchEnv(parentEnv, undefined);
  const executable =
    process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';

  return {
    executable,
    args: [worktreePath],
    cwd: path.dirname(worktreePath),
    env,
    visible: false,
    preview: `${executable} "${worktreePath}"`
  };
}
