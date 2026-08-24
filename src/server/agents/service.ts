// The launch itself: check the identity, start the tool, record that it started.
//
// This module is reachable only from the Electron main process. The HTTP
// server exposes agent definitions and detection, both of which are read-only
// with respect to what runs, but never this — a loopback port is reachable by
// anything on the machine, and "start this program" is not a capability worth
// putting behind one.
import fs from 'node:fs';
import path from 'node:path';

import {
  assertUsableDefinition,
  findAgentDefinition,
  recordLaunch,
  resolveExecutable
} from './definitions';
import {
  AgentLaunchError,
  buildLaunchPlan,
  editorPlanFor,
  fallbackTerminalPlan,
  revealPlanFor,
  runLaunchPlan,
  terminalPlanFor
} from './launch';
import type { DetachedLauncher, ExecutableRunner } from '../process/runner';
import { detachedLauncher, executableRunner } from '../process/runner';
import { ensureAgentForRepo, findProfile, profileForRepo } from '../ssh/agent-session';
import { isMultiGitSshCommand, readRepoSshCommand } from '../ssh/repo-routing';
import type { AgentLaunchInput, AgentLaunchResult, AgentSshReadiness } from '../../shared/agent-types';
import { fallbackShellPlan, findGitBash, shellPlanFor } from '../tools/shells';
import type { ShellKind } from '../tools/shells';
import { buildLaunchEnv } from './launch';
import type { InstallOutcome } from '../../shared/prerequisite-types';

export interface LaunchDependencies {
  runner?: ExecutableRunner;
  launcher?: DetachedLauncher;
  /** Test seam for platform-specific terminal planning. */
  platform?: NodeJS.Platform;
}

/**
 * Whether the folder about to be handed over can push as the intended account.
 *
 * Read rather than enforced. A degraded identity is worth saying out loud
 * before someone spends an hour in an agent that cannot push, but it is not a
 * reason to refuse to start the tool — and rewriting the remote to HTTPS to
 * "fix" it would silently change which account the work is attributed to.
 */
export async function readSshReadiness(worktreePath: string): Promise<AgentSshReadiness> {
  const profileId = profileForRepo(worktreePath) ?? '';
  const profile = profileId ? findProfile(profileId) : null;

  if (!profileId || !profile) {
    return {
      profileId: '',
      profileLabel: 'System SSH',
      // The System profile means "whatever this machine already does", so
      // there is nothing to pin and nothing to warn about.
      pinned: true,
      keyLoaded: true
    };
  }

  // One identity per repository family: the pin lives in the shared
  // .git/config, so reading it from the worktree reads the family's.
  const configured = await readRepoSshCommand(worktreePath);
  const pinned = isMultiGitSshCommand(configured) || configured !== null;

  // Best effort, and never blocking: this is the same call every network
  // operation makes before it runs.
  await ensureAgentForRepo(worktreePath, profileId);

  const readiness: AgentSshReadiness = {
    profileId,
    profileLabel: profile.label,
    pinned,
    keyLoaded: true
  };

  if (!pinned) {
    readiness.keyLoaded = false;
    readiness.warning =
      `This repository is not pinned to "${profile.label}", so a tool started here will authenticate ` +
      'as whichever key SSH offers first. Select the account again in Multi-Git to pin it.';
  }

  return readiness;
}

/** Starts a configured agent in a worktree. */
export async function launchAgent(
  input: AgentLaunchInput,
  dependencies: LaunchDependencies = {}
): Promise<AgentLaunchResult> {
  const definition = findAgentDefinition(input.agentId);

  if (!definition) {
    return { launched: false, commandPreview: '', error: 'That agent is no longer configured.' };
  }
  if (!definition.enabled) {
    return {
      launched: false,
      commandPreview: '',
      error: `"${definition.label}" is turned off in the agent settings.`
    };
  }

  // Re-validated here, not only at write time: the configuration is a plain
  // file that a sync client could have replaced since.
  assertUsableDefinition(definition);

  const worktreePath = path.resolve(input.worktreePath);
  if (!fs.existsSync(worktreePath) || !fs.statSync(worktreePath).isDirectory()) {
    return {
      launched: false,
      commandPreview: '',
      error: `${worktreePath} is not a folder that exists.`
    };
  }

  const runner = dependencies.runner ?? executableRunner;
  const resolved = await resolveExecutable(definition.executable, runner);
  if (resolved === null) {
    return {
      launched: false,
      commandPreview: definition.executable,
      error: `"${definition.executable}" was not found on your PATH. Check the agent's configuration or install the tool.`
    };
  }

  const readiness = await readSshReadiness(worktreePath);

  const plan = buildLaunchPlan({
    definition,
    worktreePath,
    ...(dependencies.platform ? { platform: dependencies.platform } : {}),
    ...(input.initialPrompt !== undefined ? { initialPrompt: input.initialPrompt } : {})
  });

  try {
    const { pid } = await runLaunchPlan(plan, dependencies.launcher ?? detachedLauncher);

    recordLaunch({
      at: new Date().toISOString(),
      agentId: definition.id,
      agentLabel: definition.label,
      worktreePath,
      ok: true,
      commandPreview: plan.preview,
      ...(pid !== undefined ? { pid } : {})
    });

    return {
      launched: true,
      commandPreview: plan.preview,
      ...(pid !== undefined ? { processId: pid } : {}),
      ...(readiness.warning ? { sshWarning: readiness.warning } : {})
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    recordLaunch({
      at: new Date().toISOString(),
      agentId: definition.id,
      agentLabel: definition.label,
      worktreePath,
      ok: false,
      commandPreview: plan.preview,
      error: message
    });

    return { launched: false, commandPreview: plan.preview, error: message };
  }
}

/**
 * Opens a terminal in a folder.
 *
 * On Windows this prefers Windows Terminal and falls back to PowerShell, which
 * has shipped with every supported version — so the action never simply does
 * nothing on a machine without `wt`.
 */
export async function openTerminalAt(
  worktreePath: string,
  dependencies: LaunchDependencies = {}
): Promise<boolean> {
  const runner = dependencies.runner ?? executableRunner;
  const launcher = dependencies.launcher ?? detachedLauncher;

  const target = path.resolve(worktreePath);
  if (!fs.existsSync(target)) {
    throw new AgentLaunchError(`${target} no longer exists.`);
  }

  const preferred = terminalPlanFor(target);

  if (process.platform === 'win32' && (await resolveExecutable('wt.exe', runner)) === null) {
    await runLaunchPlan(fallbackTerminalPlan(target), launcher);
    return true;
  }

  await runLaunchPlan(preferred, launcher);
  return true;
}

/** Opens a folder in VS Code, or in the desktop's own handler when it is absent. */
export async function openEditorAt(
  worktreePath: string,
  dependencies: LaunchDependencies = {}
): Promise<boolean> {
  const runner = dependencies.runner ?? executableRunner;
  const launcher = dependencies.launcher ?? detachedLauncher;

  const target = path.resolve(worktreePath);
  if (!fs.existsSync(target)) {
    throw new AgentLaunchError(`${target} no longer exists.`);
  }

  const editor = editorPlanFor(target);

  if ((await resolveExecutable(editor.executable, runner)) === null) {
    await runLaunchPlan(revealPlanFor(target), launcher);
    return true;
  }

  await runLaunchPlan(editor, launcher);
  return true;
}

/**
 * Opens a shell in a repository, carrying that repository's identity.
 *
 * Distinct from `openTerminalAt`, which is the plain "show me this folder"
 * companion on a worktree row. This one exists because the shell is going to be
 * used for git: it inherits the key the repository is pinned to, through an ssh
 * that can actually reach the agent. See tools/shells.ts for why that second
 * half is not automatic.
 */
export async function openShellAt(
  repoPath: string,
  kind: ShellKind,
  dependencies: LaunchDependencies = {}
): Promise<boolean> {
  const runner = dependencies.runner ?? executableRunner;
  const launcher = dependencies.launcher ?? detachedLauncher;

  const target = path.resolve(repoPath);
  if (!fs.existsSync(target)) {
    throw new AgentLaunchError(`${target} no longer exists.`);
  }

  let plan;
  try {
    plan = await shellPlanFor(kind, target);
  } catch (error) {
    // Git for Windows missing is a thing the user can fix, and the message says
    // where to get it.
    throw new AgentLaunchError((error as Error).message);
  }

  // Same fallback as openTerminalAt: PowerShell has shipped with every
  // supported version of Windows, so the button never simply does nothing.
  if (
    kind === 'terminal' &&
    process.platform === 'win32' &&
    (await resolveExecutable('wt.exe', runner)) === null
  ) {
    await runLaunchPlan(fallbackShellPlan(target, plan.env), launcher);
    return true;
  }

  await runLaunchPlan(plan, launcher);
  return true;
}

/** Whether each shell can be offered here, so the UI need not guess. */
export function availableShells(): { gitBash: boolean } {
  return { gitBash: findGitBash() !== null };
}

/**
 * What each installable prerequisite is, to winget and to a browser.
 *
 * A fixed table, and the only thing that ever reaches the winget command line.
 * Nothing the user types goes anywhere near it: the renderer sends an id from
 * this set or the request is refused, so the `-Command` string below cannot be
 * made to carry anything else.
 */
const PACKAGES: Readonly<Record<string, { id: string; label: string; page: string }>> = {
  git: {
    id: 'Git.Git',
    label: 'Git for Windows',
    page: 'https://git-scm.com/download/win'
  },
  // Git Bash is not separately installable; it arrives with Git for Windows, so
  // it maps to the same package rather than pretending to be its own download.
  'git-bash': {
    id: 'Git.Git',
    label: 'Git for Windows',
    page: 'https://git-scm.com/download/win'
  },
  gh: {
    id: 'GitHub.cli',
    label: 'GitHub CLI',
    page: 'https://cli.github.com'
  }
};

/** Resolves the fixed download record appropriate for the host platform. */
export function prerequisitePackage(
  id: string,
  platform: NodeJS.Platform = process.platform
): { id: string; label: string; page: string } | null {
  if (id === 'git') {
    if (platform === 'darwin') {
      return { id: 'Git.Git', label: 'Git for macOS', page: 'https://git-scm.com/download/mac' };
    }
    if (platform !== 'win32') {
      return { id: 'Git.Git', label: 'Git', page: 'https://git-scm.com/download/linux' };
    }
  }
  if (id === 'git-bash' && platform !== 'win32') {
    return null;
  }
  return PACKAGES[id] ?? null;
}

/**
 * Starts an installation, or opens the download page where it cannot.
 *
 * Visibly, in a terminal, rather than silently in the background. winget can
 * ask for elevation, and a UAC prompt appearing with no window to explain it is
 * alarming; a failure with no output is worse. The window stays open on
 * `-NoExit` so whatever winget said is still there to read.
 *
 * Falls back to the download page when winget is absent -- older Windows 10, or
 * an install with the App Installer removed -- which works everywhere.
 */
export async function installPrerequisite(
  id: string,
  dependencies: LaunchDependencies = {}
): Promise<InstallOutcome> {
  const platform = dependencies.platform ?? process.platform;
  const pkg = prerequisitePackage(id, platform);
  if (!pkg) {
    throw new AgentLaunchError(`${id} is not something this application can install.`);
  }

  const runner = dependencies.runner ?? executableRunner;
  const launcher = dependencies.launcher ?? detachedLauncher;

  if (platform !== 'win32' || (await resolveExecutable('winget.exe', runner)) === null) {
    await openUrlExternally(pkg.page, launcher, platform);
    return { started: false, via: 'browser', url: pkg.page };
  }

  // `--id ... -e` pins the exact package rather than matching a search, and
  // `--source winget` keeps it off any other configured feed. The id is from
  // the table above and never from the caller.
  const command = `winget install --id ${pkg.id} -e --source winget`;

  await runLaunchPlan(
    {
      executable: 'powershell.exe',
      args: ['-NoProfile', '-NoExit', '-Command', command],
      cwd: process.env['USERPROFILE'] ?? process.cwd(),
      env: buildLaunchEnv(process.env, undefined),
      visible: true,
      preview: `powershell -NoExit -Command ${command}`
    },
    launcher
  );

  return { started: true, via: 'winget' };
}

/** Opens a download page in the user's browser. */
async function openUrlExternally(
  url: string,
  launcher: DetachedLauncher,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform === 'win32') {
    // `start` needs a shell, so cmd is the launcher; the empty string is the
    // window title `start` would otherwise take the URL for.
    await runLaunchPlan(
      {
        executable: 'cmd.exe',
        args: ['/c', 'start', '', url],
        cwd: process.env['USERPROFILE'] ?? process.cwd(),
        env: buildLaunchEnv(process.env, undefined),
        visible: false,
        preview: `start ${url}`
      },
      launcher
    );
    return;
  }

  await runLaunchPlan(
    {
      executable: platform === 'darwin' ? 'open' : 'xdg-open',
      args: [url],
      cwd: process.cwd(),
      env: buildLaunchEnv(process.env, undefined),
      visible: false,
      preview: `open ${url}`
    },
    launcher
  );
}
