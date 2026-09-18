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
//
// The macOS terminal bridge is the third point's twin. Terminal.app cannot be
// handed an argument vector, so the alternative everywhere else is a script
// with the command pasted into it -- which is a command line assembled from
// strings, exactly what the first point rules out. Instead the script is a
// compile-time constant that reads NUL-separated records out of two files
// beside it. A quote, a semicolon or a newline in a branch name or a prompt is
// data in a file that nothing parses, the same way MG_LAUNCH_ARGS is on
// Windows.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

import { describeCommand, detachedLauncher } from '../process/runner';
import type { DetachedLauncher } from '../process/runner';
import { sanitizeEnvOverrides } from '../config/validate';
import type { ExternalAgentDefinition } from '../../shared/config-types';
import type { AgentModelPreset } from '../../shared/agent-catalogue';

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

/**
 * What a graphical program needs to reach the desktop on Linux.
 *
 * Kept apart from INHERITED_ENV_KEYS because a coding agent has no use for
 * them, and DISPLAY in particular is refused there so ssh never looks for an
 * askpass. A terminal window, an editor and a file manager are different: with
 * no DISPLAY or WAYLAND_DISPLAY they have no screen to open on, and exit before
 * showing anything. SSH_ASKPASS stays excluded, so Multi-Git's own bridge is
 * still unreachable from what they start.
 */
const DESKTOP_SESSION_KEYS: readonly string[] = [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE',
  'XDG_CURRENT_DESKTOP',
  'DBUS_SESSION_BUS_ADDRESS'
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

/**
 * What a coding agent needs to reach the model it talks to.
 *
 * Added to the allowlist for an agent launch and for nothing else. A terminal,
 * an editor and a file manager have no model to reach, so they keep the
 * shorter list above — a variable that only some launches need should only be
 * carried by those launches.
 *
 * The line this list draws is deliberate: a key that addresses a *model
 * provider* is here, and a key that addresses a *git host* is not. `GH_TOKEN`
 * and `GITHUB_TOKEN` can push, and which account a push is attributed to is
 * decided by the identity pinned to the folder rather than by a token a child
 * happened to inherit — the same reason `GIT_SSH_COMMAND` is refused above.
 *
 * The proxy variables are here because on a network that requires one, every
 * other variable in this list is useless without them.
 */
export const AGENT_PROVIDER_ENV_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'AZURE_OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'DEEPSEEK_API_KEY',
  'MOONSHOT_API_KEY',
  'DASHSCOPE_API_KEY',
  'ZAI_API_KEY',
  'ZHIPUAI_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'CEREBRAS_API_KEY',
  'OLLAMA_HOST',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy'
];

/**
 * Builds the environment a launched tool runs with.
 *
 * `includeProviderKeys` widens the allowlist by exactly
 * {@link AGENT_PROVIDER_ENV_KEYS}, and nothing else changes: the denied set
 * below still wins, so widening it cannot re-admit the askpass bridge.
 */
export function buildLaunchEnv(
  parentEnv: NodeJS.ProcessEnv,
  overrides: Record<string, string> | undefined,
  includeProviderKeys = false
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = includeProviderKeys
    ? [...INHERITED_ENV_KEYS, ...AGENT_PROVIDER_ENV_KEYS]
    : INHERITED_ENV_KEYS;

  for (const key of allowed) {
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
 * Adds the desktop session to an environment meant for a window.
 *
 * Only off Windows and macOS: Windows has no such variables, and macOS starts
 * Terminal.app through LaunchServices, which does not read them.
 */
export function withDesktopSession(
  env: NodeJS.ProcessEnv,
  parentEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return env;
  }

  const withSession = { ...env };
  for (const key of DESKTOP_SESSION_KEYS) {
    const value = parentEnv[key];
    if (value !== undefined) {
      withSession[key] = value;
    }
  }
  return withSession;
}

/**
 * The terminal emulators tried on Linux, in order.
 *
 * `x-terminal-emulator` is Debian's name for the one the user chose, so it
 * comes first -- but Fedora, openSUSE and Arch have no such command, and there
 * the desktop's own terminal has to be found by name. Each is told the folder
 * explicitly as well as being started in it, because several (gnome-terminal,
 * Ptyxis, Console) hand the window to an already running server that would
 * otherwise open it in the home directory.
 */
const LINUX_TERMINALS: ReadonlyArray<{ executable: string; args: (folder: string) => string[] }> = [
  { executable: 'x-terminal-emulator', args: () => [] },
  { executable: 'gnome-terminal', args: (folder) => [`--working-directory=${folder}`] },
  { executable: 'ptyxis', args: (folder) => ['--new-window', `--working-directory=${folder}`] },
  { executable: 'kgx', args: (folder) => [`--working-directory=${folder}`] },
  { executable: 'konsole', args: (folder) => ['--workdir', folder] },
  { executable: 'xfce4-terminal', args: (folder) => [`--working-directory=${folder}`] },
  { executable: 'mate-terminal', args: (folder) => [`--working-directory=${folder}`] },
  { executable: 'tilix', args: (folder) => [`--working-directory=${folder}`] },
  { executable: 'alacritty', args: (folder) => ['--working-directory', folder] },
  { executable: 'kitty', args: (folder) => ['--directory', folder] },
  { executable: 'foot', args: (folder) => [`--working-directory=${folder}`] },
  { executable: 'xterm', args: () => [] }
];

/**
 * Every way to open a terminal in `folder` on Linux, most preferred first.
 *
 * A `TERMINAL` naming a single program is the user saying which one they want,
 * so it leads. One carrying arguments is skipped rather than split, since
 * splitting it would mean parsing a command line.
 */
export function linuxTerminalPlans(
  folder: string,
  env: NodeJS.ProcessEnv,
  parentEnv: NodeJS.ProcessEnv = process.env
): LaunchPlan[] {
  const windowEnv = withDesktopSession(env, parentEnv);
  const preferred = parentEnv['TERMINAL']?.trim();
  const candidates = [...LINUX_TERMINALS];

  if (preferred && /^[\w./+-]+$/.test(preferred)) {
    const known = candidates.find((terminal) => terminal.executable === path.basename(preferred));
    candidates.unshift({ executable: preferred, args: known?.args ?? (() => []) });
  }

  return candidates.map(({ executable, args }) => {
    const argv = args(folder);
    return {
      executable,
      args: argv,
      cwd: folder,
      env: windowEnv,
      visible: true,
      preview: argv.length > 0 ? describeCommand(executable, argv) : `${executable} (in ${folder})`
    };
  });
}

/**
 * The Linux terminals that can be handed a program to run, in order.
 *
 * Separate from the table above because "open a window here" and "open a
 * window here running this" are different command lines, and each emulator
 * spells the second one its own way. Only the spellings that take the program
 * and its arguments as *separate* argv elements are listed: gnome-terminal's
 * old `-e` and Tilix's `-e` take one string that the terminal then splits
 * itself, which would hand a prompt containing a space to the shell in
 * pieces.
 *
 * `x-terminal-emulator` is last here, the reverse of its position above. As an
 * alias it is the right answer for "the terminal this user chose", but what it
 * points at decides how `-e` is read, so a terminal that is known by name is
 * the safer way to start a program.
 */
const LINUX_TERMINAL_COMMANDS: ReadonlyArray<{
  executable: string;
  args: (folder: string, argv: readonly string[]) => string[];
}> = [
  { executable: 'gnome-terminal', args: (folder, argv) => [`--working-directory=${folder}`, '--', ...argv] },
  {
    executable: 'ptyxis',
    args: (folder, argv) => ['--new-window', `--working-directory=${folder}`, '--', ...argv]
  },
  { executable: 'kgx', args: (folder, argv) => [`--working-directory=${folder}`, '--', ...argv] },
  { executable: 'konsole', args: (folder, argv) => ['--workdir', folder, '-e', ...argv] },
  { executable: 'xfce4-terminal', args: (folder, argv) => [`--working-directory=${folder}`, '-x', ...argv] },
  { executable: 'mate-terminal', args: (folder, argv) => [`--working-directory=${folder}`, '-x', ...argv] },
  { executable: 'alacritty', args: (folder, argv) => ['--working-directory', folder, '-e', ...argv] },
  { executable: 'kitty', args: (folder, argv) => ['--directory', folder, ...argv] },
  { executable: 'foot', args: (folder, argv) => [`--working-directory=${folder}`, ...argv] },
  { executable: 'wezterm', args: (folder, argv) => ['start', '--cwd', folder, '--', ...argv] },
  // Neither takes a working directory, so both rely on being spawned in one.
  { executable: 'xterm', args: (_folder, argv) => ['-e', ...argv] },
  { executable: 'x-terminal-emulator', args: (_folder, argv) => ['-e', ...argv] }
];

/**
 * Every way to run `argv` in a terminal window on Linux, most preferred first.
 *
 * A list rather than one plan, for the same reason {@link linuxTerminalPlans}
 * is one: no terminal emulator ships on every distribution, so the caller has
 * to try them until one is installed.
 */
export function linuxAgentTerminalPlans(
  folder: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  parentEnv: NodeJS.ProcessEnv = process.env
): LaunchPlan[] {
  const windowEnv = withDesktopSession(env, parentEnv);
  const preferred = parentEnv['TERMINAL']?.trim();
  const candidates = [...LINUX_TERMINAL_COMMANDS];

  // Same rule as above: a TERMINAL naming one program leads, one carrying
  // arguments is skipped rather than split.
  if (preferred && /^[\w./+-]+$/.test(preferred)) {
    const known = candidates.find((terminal) => terminal.executable === path.basename(preferred));
    if (known) {
      candidates.unshift({ executable: preferred, args: known.args });
    }
  }

  return candidates.map(({ executable, args }) => {
    const terminalArgs = args(folder, argv);
    return {
      executable,
      args: terminalArgs,
      cwd: folder,
      env: windowEnv,
      visible: true,
      preview: describeCommand(executable, terminalArgs)
    };
  });
}

/**
 * The fixed script the macOS terminal mode runs.
 *
 * A constant, like {@link POWERSHELL_BRIDGE_SCRIPT}, and for the same reason:
 * `open -a Terminal` cannot be handed an argument vector, so the only way to
 * start a program in a Terminal window is to point it at a file — and a file
 * with the command written into it is a command line built from strings.
 *
 * This one names two files and nothing else. Both hold NUL-separated records,
 * which is the one byte an argument cannot contain, so a prompt with quotes,
 * semicolons or newlines in it survives intact and is never parsed. `export`
 * takes each `KEY=value` as a single word for the same reason.
 */
export const MACOS_BRIDGE_SCRIPT = `#!/bin/bash
# Written by Multi-Git. Everything that varies is in the two files beside this
# one, NUL-separated, so nothing here is ever parsed from a path or a prompt.
dir=$(cd -- "$(dirname -- "$0")" && pwd) || exit 1

while IFS= read -r -d '' entry; do
  export "$entry"
done < "$dir/env"

args=()
while IFS= read -r -d '' entry; do
  args+=("$entry")
done < "$dir/argv"

cd -- "\${args[0]}" || exit 1
exec "\${args[@]:1}"
`;

/** NUL-terminated records, which is what the bridge script reads. */
function nulRecords(values: readonly string[]): string {
  return values.map((value) => `${value}\0`).join('');
}

/** Where one launch's bridge will live. Names the files; writes nothing. */
export function macosBridgePath(
  root: string = path.join(os.tmpdir(), 'multi-git-agent-launch')
): string {
  // `.command` is what LaunchServices associates with Terminal.app; the
  // executable bit, set when it is written, is what makes Terminal run the
  // file rather than open it in an editor.
  return path.join(root, randomUUID(), 'launch.command');
}

/**
 * Writes the bridge for one launch.
 *
 * Its own directory per launch, because two launches a second apart must not
 * read each other's arguments. Directories older than a day are swept first:
 * `open` returns as soon as Terminal has the file, long before the tool has
 * finished with it, so deleting on exit would race the thing being started.
 */
export function writeMacosBridge(
  script: string,
  worktreePath: string,
  executable: string,
  args: readonly string[],
  overrides: NodeJS.ProcessEnv
): void {
  const directory = path.dirname(script);
  sweepOldBridges(path.dirname(directory));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  fs.writeFileSync(
    path.join(directory, 'env'),
    nulRecords(
      Object.entries(overrides)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value as string}`)
    ),
    { mode: 0o600 }
  );
  fs.writeFileSync(path.join(directory, 'argv'), nulRecords([worktreePath, executable, ...args]), {
    mode: 0o600
  });
  fs.writeFileSync(script, MACOS_BRIDGE_SCRIPT, { mode: 0o700 });
}

/** Removes bridges from previous sessions. Best effort: a failure is not fatal. */
function sweepOldBridges(root: string, maxAgeMs = 24 * 60 * 60 * 1000): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }

  for (const entry of entries) {
    const directory = path.join(root, entry);
    try {
      if (Date.now() - fs.statSync(directory).mtimeMs > maxAgeMs) {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    } catch {
      // A directory another window is writing, or one already gone.
    }
  }
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
  /**
   * Anything that has to exist on disk before this plan can run.
   *
   * Only the macOS bridge has one. It is a step of its own rather than part of
   * building the plan so that describing a launch stays free of side effects:
   * a candidate list of a dozen Linux terminals must not leave a dozen
   * directories behind, and a test that inspects a plan must not write one.
   */
  prepare?: () => void;
}

export interface BuildPlanInput {
  definition: ExternalAgentDefinition;
  worktreePath: string;
  initialPrompt?: string;
  /** Already looked up from the catalogue by the caller; never a raw id. */
  modelPreset?: AgentModelPreset | null;
  parentEnv?: NodeJS.ProcessEnv;
}

/**
 * The argument vector a definition produces, and the part of it worth logging.
 *
 * `logged` stops one element short of the prompt on purpose: the prompt is the
 * most sensitive part of a launch, it is not recorded anywhere, and building
 * the preview from a separate list is what keeps it that way when someone adds
 * a field here later.
 */
function toolArgvFor(
  definition: ExternalAgentDefinition,
  preset: AgentModelPreset | null | undefined,
  initialPrompt: string | undefined
): { argv: string[]; logged: string[] } {
  // A preset's arguments follow the definition's, so a tool that wants its
  // subcommand first still gets it first, and precede the prompt, so the model
  // flag never swallows the prompt as its value.
  const logged = [...definition.args, ...(preset?.args ?? [])];
  const argv = [...logged];

  const prompt = initialPrompt?.trim();
  if (prompt && definition.promptMode === 'argument') {
    argv.push(prompt);
  }
  if (prompt && definition.promptMode === 'flag') {
    // Only when there is a prompt: `gemini -i` with nothing after it is a
    // command line the tool refuses, so a flag with no value is never sent.
    argv.push(...(definition.promptArgs ?? []), prompt);
  }

  return { argv, logged };
}

/**
 * Works out exactly what will be spawned, without spawning it.
 *
 * Separated from the launch so a test can assert the executable, the argument
 * vector, the working directory and the environment for every terminal mode
 * without a single process starting.
 */
export function buildLaunchPlan(input: BuildPlanInput): LaunchPlan {
  return buildLaunchPlans(input)[0] as LaunchPlan;
}

/**
 * Every plan that would satisfy a definition, most preferred first.
 *
 * More than one only where the platform has no single answer: Linux has no
 * terminal emulator every distribution ships, and Windows Terminal is absent
 * on an unpatched Windows 10. The caller walks the list and runs the first
 * whose program is installed, so the button never simply does nothing.
 */
export function buildLaunchPlans(input: BuildPlanInput): LaunchPlan[] {
  const { definition, worktreePath } = input;
  const parentEnv = input.parentEnv ?? process.env;
  const overrides = { ...(definition.env ?? {}), ...(input.modelPreset?.env ?? {}) };
  const env = buildLaunchEnv(parentEnv, overrides, true);

  const { argv, logged } = toolArgvFor(definition, input.modelPreset, input.initialPrompt);

  // The preview is what goes in the log and the launch history.
  const preview = describeCommand(definition.executable, logged);

  // The two Windows modes name one host each and describe it whatever this
  // platform is. Refusing them off Windows is validation's job, and a plan
  // that quietly became a different launch would hide that refusal.
  if (definition.terminal === 'windows-terminal') {
    return [windowsTerminalPlan(definition, worktreePath, argv, env, preview)];
  }
  if (definition.terminal === 'powershell') {
    return [powershellPlan(definition, worktreePath, argv, env, preview)];
  }

  if (definition.terminal === 'system-terminal') {
    if (process.platform === 'win32') {
      // Windows Terminal is not on every Windows 10; PowerShell is on all of
      // them, and it is the same bridge the explicit mode uses.
      return [
        windowsTerminalPlan(definition, worktreePath, argv, env, preview),
        powershellPlan(definition, worktreePath, argv, env, preview)
      ];
    }
    if (process.platform === 'darwin') {
      return [macosTerminalPlan(worktreePath, definition.executable, argv, overrides, env, preview)];
    }
    return linuxAgentTerminalPlans(worktreePath, [definition.executable, ...argv], env, parentEnv);
  }

  return [
    {
      executable: definition.executable,
      args: argv,
      cwd: worktreePath,
      // An interactive agent with no window is an agent nobody can answer.
      visible: true,
      env,
      preview
    }
  ];
}

function windowsTerminalPlan(
  definition: ExternalAgentDefinition,
  worktreePath: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  preview: string
): LaunchPlan {
  return {
    executable: 'wt.exe',
    args: ['-d', worktreePath, '--', definition.executable, ...argv.map(escapeForWindowsTerminal)],
    cwd: worktreePath,
    env,
    visible: true,
    preview: `wt -d "${worktreePath}" -- ${preview}`
  };
}

function powershellPlan(
  definition: ExternalAgentDefinition,
  worktreePath: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  preview: string
): LaunchPlan {
  return {
    executable: 'powershell.exe',
    args: ['-NoProfile', '-NoExit', '-Command', POWERSHELL_BRIDGE_SCRIPT],
    cwd: worktreePath,
    env: {
      ...env,
      MG_LAUNCH_EXE: definition.executable,
      MG_LAUNCH_ARGS: JSON.stringify([...argv])
    },
    visible: true,
    preview: `powershell -NoProfile -NoExit -Command ${preview}`
  };
}

/**
 * Terminal.app, through the bridge.
 *
 * `open` hands the file to LaunchServices, which starts Terminal with the
 * user's own login environment rather than this one — so the overrides travel
 * in the bridge's `env` file instead. Nothing of Multi-Git's session reaches
 * the tool either way, which is what the allowlist was protecting.
 */
function macosTerminalPlan(
  worktreePath: string,
  executable: string,
  argv: readonly string[],
  overrides: Record<string, string>,
  env: NodeJS.ProcessEnv,
  preview: string
): LaunchPlan {
  const script = macosBridgePath();

  return {
    executable: 'open',
    args: ['-a', 'Terminal', script],
    cwd: worktreePath,
    env,
    visible: true,
    preview: `open -a Terminal -- ${preview}`,
    prepare: () => writeMacosBridge(script, worktreePath, executable, argv, overrides)
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

  plan.prepare?.();

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

  // The first choice only; the service tries the rest when it is not installed.
  return linuxTerminalPlans(worktreePath, env, parentEnv)[0]!;
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
    env: withDesktopSession(env, parentEnv),
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
    env: withDesktopSession(env, parentEnv),
    visible: false,
    preview: `${executable} "${worktreePath}"`
  };
}
