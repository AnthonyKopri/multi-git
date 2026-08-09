// External tool definitions: diff, merge, editor, terminal and file manager.
//
// The sibling of ../agents/definitions.ts, and held to the same rule: the
// renderer names an id, never a program. What differs is the argument template.
// A tool is handed files, so its arguments contain placeholders that are filled
// in per launch — and a placeholder this build cannot expand is refused rather
// than passed through, because handing a diff tool the literal word "{theirs}"
// where a path belonged opens the wrong thing, or nothing.
import { randomUUID } from 'node:crypto';

import { executableRunner } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';
import { readConfig, writeConfig } from '../config/store';
import { unknownPlaceholders } from '../config/validate';
import { EXTERNAL_TOOL_KINDS } from '../../shared/config-types';
import type { ExternalToolDefinition, ExternalToolKind } from '../../shared/config-types';
import type { DetectedTool } from '../../shared/tool-types';

export class ToolDefinitionError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ToolDefinitionError';
  }
}

/**
 * Tools looked for on PATH, with the argument template each one wants.
 *
 * The templates are the part worth reviewing: they are this build's claim about
 * how each program takes its files, and a wrong one produces a tool that opens
 * with the arguments in the wrong order rather than an error. Every one of them
 * is editable, and confirmed with the user before it is first used.
 */
export const KNOWN_TOOLS: readonly Omit<DetectedTool, 'resolvedPath' | 'configured'>[] = [
  {
    id: 'vscode-diff',
    kind: 'diff',
    label: 'Visual Studio Code',
    executable: 'code',
    args: ['--wait', '--diff', '{local}', '{remote}']
  },
  {
    id: 'vscode-merge',
    kind: 'merge',
    label: 'Visual Studio Code',
    executable: 'code',
    args: ['--wait', '--merge', '{remote}', '{local}', '{base}', '{merged}']
  },
  {
    id: 'vscode-editor',
    kind: 'editor',
    label: 'Visual Studio Code',
    executable: 'code',
    args: ['{path}']
  },
  {
    id: 'winmerge-diff',
    kind: 'diff',
    label: 'WinMerge',
    executable: 'WinMergeU',
    args: ['/e', '/u', '{local}', '{remote}']
  },
  {
    id: 'kdiff3-merge',
    kind: 'merge',
    label: 'KDiff3',
    executable: 'kdiff3',
    args: ['{base}', '{local}', '{remote}', '-o', '{merged}']
  },
  {
    id: 'bcompare-diff',
    kind: 'diff',
    label: 'Beyond Compare',
    executable: 'BCompare',
    args: ['{local}', '{remote}']
  },
  {
    id: 'bcompare-merge',
    kind: 'merge',
    label: 'Beyond Compare',
    executable: 'BCompare',
    args: ['{local}', '{remote}', '{base}', `-mergeoutput={merged}`]
  },
  {
    id: 'windows-terminal',
    kind: 'terminal',
    label: 'Windows Terminal',
    executable: 'wt',
    args: ['-d', '{cwd}']
  }
];

export function listToolDefinitions(): ExternalToolDefinition[] {
  return readConfig().externalTools ?? [];
}

export function findToolDefinition(toolId: string): ExternalToolDefinition | null {
  return listToolDefinitions().find((tool) => tool.id === toolId) ?? null;
}

/** The enabled definition for a kind, if the user has one. */
export function toolForKind(kind: ExternalToolKind): ExternalToolDefinition | null {
  return listToolDefinitions().find((tool) => tool.kind === kind && tool.enabled) ?? null;
}

/**
 * Checks a definition the way the launcher will read it.
 *
 * Duplicated with the config validator on purpose, and for the same reason the
 * agent module duplicates its own: the file on disk is ordinary JSON in the
 * user's home directory, which a sync client or a text editor can change
 * between the write and the launch.
 */
export function assertUsableTool(definition: ExternalToolDefinition): void {
  if (definition.executable.trim() === '') {
    throw new ToolDefinitionError(`"${definition.label}" has no executable configured.`);
  }
  if (/[\0\r\n]/.test(definition.executable)) {
    throw new ToolDefinitionError(
      `"${definition.label}" has an executable containing characters that cannot be part of a program name.`
    );
  }
  if (!EXTERNAL_TOOL_KINDS.includes(definition.kind)) {
    throw new ToolDefinitionError(`"${definition.label}" has an unknown kind.`);
  }

  for (const argument of definition.args) {
    if (typeof argument !== 'string' || argument.includes('\0')) {
      throw new ToolDefinitionError(`"${definition.label}" has an argument that is not usable text.`);
    }

    const unknown = unknownPlaceholders(argument);
    if (unknown.length > 0) {
      throw new ToolDefinitionError(
        `"${definition.label}" uses ${unknown.map((name) => `{${name}}`).join(', ')}, which this version cannot fill in.`
      );
    }
  }
}

/**
 * Where an executable resolves to, or null when it is not installed.
 *
 * Through the shared runner rather than by searching PATH here, so a test
 * scripts the answer instead of depending on what the machine happens to have.
 */
export async function resolveExecutable(
  executable: string,
  runner: ExecutableRunner = executableRunner
): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which';

  try {
    const result = await runner.run(finder, [executable], { timeoutMs: 10_000 });
    const first = result.stdout.split('\n')[0]?.trim();
    return first ? first : null;
  } catch {
    // A non-zero exit means "not found", which is an answer.
    return null;
  }
}

export async function detectTools(
  runner: ExecutableRunner = executableRunner
): Promise<DetectedTool[]> {
  const configured = new Set(
    listToolDefinitions().map((tool) => `${tool.kind}:${tool.executable.toLowerCase()}`)
  );
  const detected: DetectedTool[] = [];
  // One lookup per executable, not per definition: `code` appears three times.
  const resolved = new Map<string, string | null>();

  for (const known of KNOWN_TOOLS) {
    if (!resolved.has(known.executable)) {
      resolved.set(known.executable, await resolveExecutable(known.executable, runner));
    }

    const resolvedPath = resolved.get(known.executable) ?? null;
    if (resolvedPath === null) {
      continue;
    }

    detected.push({
      ...known,
      resolvedPath,
      configured: configured.has(`${known.kind}:${known.executable.toLowerCase()}`)
    });
  }

  return detected;
}

export function definitionFromDetected(detected: DetectedTool): ExternalToolDefinition {
  return {
    id: randomUUID(),
    kind: detected.kind,
    label: detected.label,
    executable: detected.executable,
    args: [...detected.args],
    enabled: true,
    // Recorded so the UI can say a definition was guessed rather than written,
    // which is what the first-use confirmation is about.
    detected: true
  };
}

export function saveToolDefinition(
  input: Partial<ExternalToolDefinition>
): ExternalToolDefinition {
  const config = readConfig();
  const existing = config.externalTools ?? [];

  const definition: ExternalToolDefinition = {
    id: typeof input.id === 'string' && input.id !== '' ? input.id : randomUUID(),
    kind: (input.kind ?? 'diff') as ExternalToolKind,
    label: typeof input.label === 'string' && input.label !== '' ? input.label : 'Tool',
    executable: String(input.executable ?? '').trim(),
    args: Array.isArray(input.args) ? input.args.map((value) => String(value)) : [],
    enabled: input.enabled !== false
  };

  // Checked before it is written, so an unusable definition never reaches the
  // file at all.
  assertUsableTool(definition);

  writeConfig({
    ...config,
    externalTools: [...existing.filter((tool) => tool.id !== definition.id), definition]
  });

  return definition;
}

export function deleteToolDefinition(toolId: string): void {
  const config = readConfig();

  writeConfig({
    ...config,
    externalTools: (config.externalTools ?? []).filter((tool) => tool.id !== toolId)
  });
}

/** Records that the user confirmed the definition used for a kind. */
export function confirmToolKind(kind: ExternalToolKind): void {
  const config = readConfig();

  writeConfig({
    ...config,
    toolsConfirmed: { ...(config.toolsConfirmed ?? {}), [kind]: true }
  });
}

export function isToolKindConfirmed(kind: ExternalToolKind): boolean {
  return (readConfig().toolsConfirmed ?? {})[kind] === true;
}
