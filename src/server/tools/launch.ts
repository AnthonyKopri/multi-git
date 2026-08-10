// Expanding an external tool's argument template, and starting it.
//
// Expansion happens *within* each argument, never across them. `--diff={local}`
// becomes one argument with the path substituted; it is never split on the
// space a path might contain. That is the whole reason the template is an array
// rather than a command line, and why a path with spaces needs no quoting
// anywhere in this file.
import fs from 'node:fs';
import path from 'node:path';

import { detachedLauncher } from '../process/runner';
import type { DetachedLauncher } from '../process/runner';
import { DEFAULT_MAX_OUTPUT_BYTES } from '../process/run';
import { resolveInsideRepo } from '../fs/paths';
import { pathArgs } from '../git/args';
import { runGitCommand } from '../git/run';
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

type MergeInputKey = 'base' | 'local' | 'remote';

const MERGE_INPUTS: readonly {
  key: MergeInputKey;
  stage: 1 | 2 | 3;
  suffix: 'BASE' | 'LOCAL' | 'REMOTE';
}[] = [
  { key: 'base', stage: 1, suffix: 'BASE' },
  { key: 'local', stage: 2, suffix: 'LOCAL' },
  { key: 'remote', stage: 3, suffix: 'REMOTE' }
];

interface CreatedMergeInput {
  filePath: string;
  device: bigint;
  inode: bigint;
}

function usesPlaceholder(args: readonly string[], name: string): boolean {
  return args.some((argument) => argument.includes(`{${name}}`));
}

/** Best-effort cleanup of entries that still have the identity we created. */
function cleanupMergeInputs(created: readonly CreatedMergeInput[]): void {
  for (const entry of [...created].reverse()) {
    try {
      const current = fs.lstatSync(entry.filePath, { bigint: true });

      // A tool may replace a side file atomically. In that case the name no
      // longer belongs to us, so leaving it is safer than deleting it.
      if (current.dev === entry.device && current.ino === entry.inode) {
        fs.unlinkSync(entry.filePath);
      }
    } catch {
      // Already removed, or temporarily unavailable. Side files are cleanup,
      // never a reason to crash the desktop after the tool has closed.
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : undefined;
}

/**
 * Builds the three ordinary files merge tools expect from Git's unmerged
 * index stages: base=1, local/ours=2, remote/theirs=3.
 *
 * The renderer supplies conventional sibling names so its first-use command
 * preview is exact. Those names are checked here and created exclusively: a
 * repository containing (for example) `file.txt.LOCAL` is never overwritten.
 */
async function materializeMergeInputs(
  repoPath: string,
  values: ToolPlaceholders,
  definitionArgs: readonly string[]
): Promise<CreatedMergeInput[]> {
  const needed = MERGE_INPUTS.filter(({ key }) => usesPlaceholder(definitionArgs, key));
  if (needed.length === 0) {
    return [];
  }

  const merged = values.merged;
  if (!merged) {
    throw new ToolDefinitionError('A merge tool needs the conflicted file as {merged}.');
  }

  for (const { key, suffix } of needed) {
    const supplied = values[key];
    const expected = `${merged}.${suffix}`;
    if (!supplied || path.resolve(supplied) !== path.resolve(expected)) {
      throw new ToolDefinitionError(
        `The {${key}} merge input must be the protected side file ${expected}.`
      );
    }
  }

  const relativePath = path
    .relative(path.resolve(repoPath), merged)
    .split(path.sep)
    .join('/');
  const listing = await runGitCommand(repoPath, [
    'ls-files',
    '--unmerged',
    '-z',
    ...pathArgs(relativePath)
  ]);
  const objectByStage = new Map<number, string>();

  for (const record of listing.stdout.split('\0')) {
    const match = /^\d+ ([0-9a-fA-F]{4,64}) ([123])\t/.exec(record);
    if (match?.[1] && match[2]) {
      objectByStage.set(Number(match[2]), match[1]);
    }
  }

  if (objectByStage.size === 0) {
    throw new ToolDefinitionError(
      `${relativePath} no longer has unmerged Git index stages, so there is nothing to hand to a merge tool.`
    );
  }

  const contentByStage = new Map<number, Buffer>();
  await Promise.all(
    needed.map(async ({ stage }) => {
      const objectName = objectByStage.get(stage);
      if (!objectName) {
        // Add/add and modify/delete conflicts legitimately omit one stage.
        contentByStage.set(stage, Buffer.alloc(0));
        return;
      }

      // Prevent the process output cap from silently turning a large blob into
      // a truncated merge input. A streaming handoff can lift this limitation
      // later without ever handing a tool corrupted bytes today.
      const sizeResult = await runGitCommand(repoPath, ['cat-file', '-s', objectName]);
      const size = Number.parseInt(sizeResult.stdout.trim(), 10);
      if (!Number.isFinite(size) || size > DEFAULT_MAX_OUTPUT_BYTES) {
        throw new ToolDefinitionError(
          `${relativePath} has a merge input larger than ${DEFAULT_MAX_OUTPUT_BYTES} bytes, which this version cannot hand off safely.`
        );
      }

      const result = await runGitCommand(repoPath, ['cat-file', 'blob', objectName], null, {
        binaryStdout: true
      });
      contentByStage.set(stage, result.stdoutBuffer ?? Buffer.alloc(0));
    })
  );

  const created: CreatedMergeInput[] = [];
  try {
    for (const { key, stage } of needed) {
      const filePath = values[key] as string;
      try {
        await fs.promises.writeFile(filePath, contentByStage.get(stage) ?? Buffer.alloc(0), {
          flag: 'wx',
          mode: 0o600
        });
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          throw new ToolDefinitionError(
            `${filePath} already exists. It was left untouched; move or remove it before opening the merge tool.`
          );
        }
        throw error;
      }

      const createdStat = fs.lstatSync(filePath, { bigint: true });
      created.push({
        filePath,
        device: createdStat.dev,
        inode: createdStat.ino
      });
    }

    return created;
  } catch (error) {
    cleanupMergeInputs(created);
    throw error;
  }
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
  const mergeInputs =
    input.kind === 'merge'
      ? await materializeMergeInputs(input.repoPath, values, definition.args)
      : [];

  try {
    await launcher.launch(definition.executable, args, {
      cwd: values.cwd ?? path.resolve(input.repoPath),
      // A tool the user is about to interact with needs a window.
      visible: true,
      ...(mergeInputs.length > 0
        ? { onExit: () => cleanupMergeInputs(mergeInputs) }
        : {})
    });
  } catch (error) {
    cleanupMergeInputs(mergeInputs);
    throw error;
  }

  return {
    launched: true,
    commandPreview: [definition.executable, ...args].join(' '),
    toolLabel: definition.label
  };
}
