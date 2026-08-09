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

export interface LaunchDependencies {
  runner?: ExecutableRunner;
  launcher?: DetachedLauncher;
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
