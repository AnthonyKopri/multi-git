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
import { AGENT_TERMINAL_MODES } from '../../shared/config-types';
import type { AgentLaunchRecord, ExternalAgentDefinition } from '../../shared/config-types';
import { AGENT_CATALOGUE } from '../../shared/agent-catalogue';
import type { AgentCatalogueEntry } from '../../shared/agent-catalogue';
import type { DetectedAgent } from '../../shared/agent-types';

export class AgentDefinitionError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AgentDefinitionError';
  }
}

/**
 * Tools looked for on PATH, to seed an editable definition from.
 *
 * The catalogue itself, re-exported under the name the rest of the server
 * already used for it. It is a list of things that *may* be offered, never a
 * list of things that may run: a launch reads a saved definition, and every
 * entry here has to become one before it can start anything.
 */
export const KNOWN_AGENTS: readonly AgentCatalogueEntry[] = AGENT_CATALOGUE;

/** The launch mode a freshly seeded definition gets on this platform. */
export function defaultTerminalMode(): ExternalAgentDefinition['terminal'] {
  // Windows Terminal where it exists; everywhere else the platform's own
  // terminal, because a detached spawn on macOS or Linux has no console and an
  // interactive agent started that way has nowhere to print.
  return process.platform === 'win32' ? 'windows-terminal' : 'system-terminal';
}

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
  if (!AGENT_TERMINAL_MODES.includes(definition.terminal)) {
    throw new AgentDefinitionError(`"${definition.label}" has an unknown terminal mode.`);
  }
  if (definition.args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
    throw new AgentDefinitionError(`"${definition.label}" has an unusable argument.`);
  }
  if ((definition.promptArgs ?? []).some((value) => typeof value !== 'string' || value.includes('\0'))) {
    throw new AgentDefinitionError(`"${definition.label}" has an unusable prompt argument.`);
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

/**
 * The whole catalogue, each entry marked with what this machine has.
 *
 * Every entry is returned rather than only the installed ones. An uninstalled
 * tool is worth showing: "Gemini CLI, not installed, here is where it lives"
 * answers a question, where leaving the row out only raises one. The lookups
 * run together because each is a `which` that spends most of its time waiting.
 */
export async function detectAgents(
  runner: ExecutableRunner = executableRunner
): Promise<DetectedAgent[]> {
  const agents = listAgentDefinitions();
  const configuredExecutables = new Set(agents.map((agent) => agent.executable.toLowerCase()));
  const configuredEntries = new Set(
    agents.map((agent) => agent.catalogueId ?? '').filter((id) => id !== '')
  );

  const resolved = await Promise.all(
    KNOWN_AGENTS.map((known) => resolveExecutable(known.executable, runner))
  );

  return KNOWN_AGENTS.map((known, index) => {
    const resolvedPath = resolved[index] ?? null;

    return {
      id: known.id,
      label: known.label,
      vendor: known.vendor,
      summary: known.summary,
      homepage: known.homepage,
      executable: known.executable,
      resolvedPath: resolvedPath ?? '',
      installed: resolvedPath !== null,
      configured:
        configuredEntries.has(known.id) ||
        configuredExecutables.has(known.executable.toLowerCase()),
      hasModels: (known.models ?? []).length > 0
    };
  });
}

/**
 * A definition seeded from a catalogue entry, ready to be edited.
 *
 * The prompt mode comes from the catalogue rather than being assumed: the old
 * default said every tool takes its prompt as a bare first argument, which is
 * true of Claude Code and Codex and wrong for the rest — Gemini and Qwen want
 * `-i` in front of it, and several take no interactive prompt at all.
 */
export function definitionFromDetected(detected: DetectedAgent): ExternalAgentDefinition {
  const entry = KNOWN_AGENTS.find((known) => known.id === detected.id);

  return {
    id: randomUUID(),
    label: detected.label,
    executable: detected.executable,
    args: [...(entry?.args ?? [])],
    terminal: defaultTerminalMode(),
    enabled: true,
    promptMode: entry?.promptMode ?? 'none',
    ...(entry?.promptArgs ? { promptArgs: [...entry.promptArgs] } : {}),
    catalogueId: detected.id
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
    ...(input.promptArgs ? { promptArgs: input.promptArgs.map((value) => String(value)) } : {}),
    ...(input.catalogueId ? { catalogueId: input.catalogueId } : {}),
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

/** Empties the launch history. Nothing outside it depends on what it held. */
export function clearLaunches(): void {
  const config = readConfig();
  config.agentLaunches = [];
  writeConfig(config);
}
