// External agent definitions: what may be launched, and what is installed.
//
// A definition is the only thing this application will ever spawn as an
// "agent". The renderer names an id and nothing else, so nothing a page can be
// tricked into sending decides which program runs — the worst a compromised
// renderer can do is start a tool the user themselves configured.
//
// Validation is duplicated on purpose: once when a definition is written, and
// again immediately before a launch. The file on disk is an ordinary JSON file
// in the user's home directory that a sync client or a text editor can change
// between those two moments.
import { randomUUID } from 'node:crypto';

import { executableRunner } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';
import { readConfig, writeConfig } from '../config/store';
import { MAX_AGENT_LAUNCHES } from '../config/validate';
import type { AgentLaunchRecord, ExternalAgentDefinition } from '../../shared/config-types';
import type { DetectedAgent } from '../../shared/agent-types';

export class AgentDefinitionError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AgentDefinitionError';
  }
}

/** Tools looked for on PATH, to seed an editable definition from. */
export const KNOWN_AGENTS: readonly { id: string; label: string; executable: string }[] = [
  { id: 'claude', label: 'Claude Code', executable: 'claude' },
  { id: 'codex', label: 'Codex', executable: 'codex' }
];

export function listAgentDefinitions(): ExternalAgentDefinition[] {
  return readConfig().externalAgents ?? [];
}

export function findAgentDefinition(agentId: string): ExternalAgentDefinition | null {
  return listAgentDefinitions().find((agent) => agent.id === agentId) ?? null;
}

/**
 * Checks a definition the way the launcher will read it.
 *
 * Throws rather than repairing. A definition that is "fixed" into something
 * that runs a different program than the user wrote is worse than one that is
 * refused with the reason.
 */
export function assertUsableDefinition(definition: ExternalAgentDefinition): void {
  if (definition.executable.trim() === '') {
    throw new AgentDefinitionError(`"${definition.label}" has no executable configured.`);
  }
  if (/[\0\r\n]/.test(definition.executable)) {
    throw new AgentDefinitionError(
      `"${definition.label}" has an executable containing characters that cannot be part of a program name.`
    );
  }
  if (
    definition.terminal !== 'direct' &&
    definition.terminal !== 'windows-terminal' &&
    definition.terminal !== 'powershell'
  ) {
    throw new AgentDefinitionError(`"${definition.label}" has an unknown terminal mode.`);
  }
  if (definition.args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
    throw new AgentDefinitionError(`"${definition.label}" has an unusable argument.`);
  }
  if (definition.terminal === 'windows-terminal' && process.platform !== 'win32') {
    throw new AgentDefinitionError(
      `"${definition.label}" is set to launch through Windows Terminal, which only exists on Windows.`
    );
  }
  if (definition.terminal === 'powershell' && process.platform !== 'win32') {
    throw new AgentDefinitionError(
      `"${definition.label}" is set to launch through PowerShell, which this build only supports on Windows.`
    );
  }
}

/**
 * Where an executable name resolves to, or null when it is not installed.
 *
 * Run through the shared runner rather than by searching PATH here, so a test
 * scripts the answer instead of depending on what the machine happens to have.
 */
export async function resolveExecutable(
  executable: string,
  runner: ExecutableRunner = executableRunner
): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which';

  try {
    const result = await runner.run(finder, [executable], { timeoutMs: 10_000 });
    // `where` prints one match per line; the first is the one that would run.
    const first = result.stdout.split('\n')[0]?.trim();
    return first ? first : null;
  } catch {
    // A non-zero exit means "not found", which is an answer rather than a
    // failure worth propagating.
    return null;
  }
}

/** The known tools that are installed, and whether they are already configured. */
export async function detectAgents(
  runner: ExecutableRunner = executableRunner
): Promise<DetectedAgent[]> {
  const configured = new Set(listAgentDefinitions().map((agent) => agent.executable.toLowerCase()));
  const detected: DetectedAgent[] = [];

  for (const known of KNOWN_AGENTS) {
    const resolvedPath = await resolveExecutable(known.executable, runner);
    if (resolvedPath === null) {
      continue;
    }

    detected.push({
      ...known,
      resolvedPath,
      configured: configured.has(known.executable.toLowerCase())
    });
  }

  return detected;
}

/** A definition seeded from a detected tool, ready to be edited. */
export function definitionFromDetected(detected: DetectedAgent): ExternalAgentDefinition {
  return {
    id: randomUUID(),
    label: detected.label,
    executable: detected.executable,
    args: [],
    // A coding agent is something the user talks to, so it needs a window.
    // Windows Terminal where it exists, a plain console everywhere else.
    terminal: process.platform === 'win32' ? 'windows-terminal' : 'direct',
    enabled: true,
    promptMode: 'argument'
  };
}

export function saveAgentDefinition(
  input: Omit<ExternalAgentDefinition, 'id'> & { id?: string }
): ExternalAgentDefinition {
  const config = readConfig();
  const agents = [...(config.externalAgents ?? [])];

  const definition: ExternalAgentDefinition = {
    id: input.id && input.id.trim() !== '' ? input.id : randomUUID(),
    label: input.label.trim() === '' ? input.executable : input.label.trim(),
    executable: input.executable.trim(),
    args: input.args.map((value) => String(value)),
    terminal: input.terminal,
    enabled: input.enabled !== false,
    ...(input.promptMode ? { promptMode: input.promptMode } : {}),
    ...(input.env ? { env: input.env } : {})
  };

  assertUsableDefinition(definition);

  const index = agents.findIndex((agent) => agent.id === definition.id);
  if (index === -1) {
    agents.push(definition);
  } else {
    agents[index] = definition;
  }

  config.externalAgents = agents;
  writeConfig(config);

  return definition;
}

export function deleteAgentDefinition(agentId: string): boolean {
  const config = readConfig();
  const agents = config.externalAgents ?? [];
  const remaining = agents.filter((agent) => agent.id !== agentId);

  if (remaining.length === agents.length) {
    return false;
  }

  config.externalAgents = remaining;
  writeConfig(config);
  return true;
}

/**
 * Adds a launch to the history.
 *
 * The prompt is not a parameter here, and that is the whole design: there is
 * no path by which prompt text reaches this function, so it cannot be written
 * by accident when someone adds a field later.
 */
export function recordLaunch(record: AgentLaunchRecord): void {
  const config = readConfig();
  config.agentLaunches = [record, ...(config.agentLaunches ?? [])].slice(0, MAX_AGENT_LAUNCHES);
  writeConfig(config);
}

export function listLaunches(): AgentLaunchRecord[] {
  return readConfig().agentLaunches ?? [];
}
