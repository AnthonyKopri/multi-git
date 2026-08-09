// Expanding an external tool's argument template, and starting it.
//
// Expansion happens *within* each argument, never across them. `--diff={local}`
// becomes one argument with the path substituted; it is never split on the
// space a path might contain. That is the whole reason the template is an array
// rather than a command line, and why a path with spaces needs no quoting
// anywhere in this file.
import path from 'node:path';

import { detachedLauncher } from '../process/runner';
import type { DetachedLauncher } from '../process/runner';
import { resolveInsideRepo } from '../fs/paths';
import { assertUsableTool, findToolDefinition, toolForKind } from './definitions';
import { ToolDefinitionError } from './definitions';
import type { ExternalToolDefinition, ExternalToolKind } from '../../shared/config-types';

/** The values a template may refer to. Absent ones make their placeholder fail. */
export interface ToolPlaceholders {
  /** Our side of a merge, or the left side of a diff. */
  local?: string;
  /** Their side. */
  remote?: string;
  /** The common ancestor, for a three-way merge. */
  base?: string;
  /** Where a merge tool should write its result. */
  merged?: string;
  /** A single file, for an editor. */
  path?: string;
  line?: number;
  /** Working directory, for a terminal or file manager. */
  cwd?: string;
}

const PLACEHOLDER = /\{([^}]*)\}/g;

/**
 * Fills a template in.
 *
 * A placeholder with no value is an error rather than an empty string: an
 * empty argument in the middle of a diff tool's command line makes it open
 * something unintended, which is worse than refusing to start.
 */
export function expandTemplate(
  args: readonly string[],
  values: ToolPlaceholders
): string[] {
  return args.map((argument) =>
    argument.replace(PLACEHOLDER, (_match, name: string) => {
      const value = values[name as keyof ToolPlaceholders];

      if (value === undefined || value === null || value === '') {
        throw new ToolDefinitionError(
          `This tool's arguments use {${name}}, which is not available for this action.`
        );
      }

      return String(value);
    })
  );
}

/** The command as it would read in the log, for the confirmation dialog. */
export function commandPreview(
  definition: ExternalToolDefinition,
  values: ToolPlaceholders
): string {
  return [definition.executable, ...expandTemplate(definition.args, values)].join(' ');
}

export interface LaunchToolInput {
  repoPath: string;
  kind: ExternalToolKind;
  /** A specific definition; otherwise the enabled one for the kind. */
  toolId?: string;
  placeholders: ToolPlaceholders;
}

export interface LaunchToolResult {
  launched: boolean;
  commandPreview: string;
  toolLabel: string;
}

/**
 * Resolves a placeholder that names a file to an absolute path inside the
 * repository.
 *
 * The paths come from the conflict workflow, which reads them from git — but
 * they describe files in a repository whose contents are not trusted, and this
 * is the last point before they become arguments to a program.
 */
function resolveFileValues(repoPath: string, values: ToolPlaceholders): ToolPlaceholders {
  const resolved: ToolPlaceholders = { ...values };

  for (const key of ['local', 'remote', 'base', 'merged', 'path'] as const) {
    const value = values[key];
    if (value === undefined || value === '') {
      continue;
    }

    const inside = resolveInsideRepo(repoPath, value, { allowMissing: true });
    if (inside === null) {
      throw new ToolDefinitionError(
        `${value} is outside this repository, so it will not be handed to an external tool.`
      );
    }

    resolved[key] = inside;
  }

  if (resolved.cwd === undefined) {
    resolved.cwd = path.resolve(repoPath);
  }

  return resolved;
}

/**
 * Starts an external tool.
 *
 * `launchDetached`, not `run`: a merge tool is open for as long as the person
 * using it needs, and `run` would kill it at its timeout. It resolves once the
 * process exists and learns nothing else — which is also why the caller must
 * re-read git state afterwards rather than assuming the tool resolved anything.
 */
export async function launchTool(
  input: LaunchToolInput,
  launcher: DetachedLauncher = detachedLauncher
): Promise<LaunchToolResult> {
  const definition = input.toolId
    ? findToolDefinition(input.toolId)
    : toolForKind(input.kind);

  if (!definition) {
    throw new ToolDefinitionError(
      `No ${input.kind} tool is configured. Add one in the Repository hub, under Tools.`
    );
  }

  // Re-checked here, not only when it was saved: the configuration file is
  // ordinary JSON in the user's home directory.
  assertUsableTool(definition);

  const values = resolveFileValues(input.repoPath, input.placeholders);
  const args = expandTemplate(definition.args, values);

  await launcher.launch(definition.executable, args, {
    cwd: values.cwd ?? path.resolve(input.repoPath),
    // A tool the user is about to interact with needs a window.
    visible: true
  });

  return {
    launched: true,
    commandPreview: [definition.executable, ...args].join(' '),
    toolLabel: definition.label
  };
}
