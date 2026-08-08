// Reading a structured diff and applying part of it.
//
// The two halves of precision staging that touch git. Everything about *what*
// a patch should contain is in patch-build.ts; this module is about getting
// the diff out of git and the patch back in.
//
// Staleness is handled by never trusting the diff the user was shown. A
// selection arrives as hunk and line ids, the diff is read again here, and the
// ids are resolved against that fresh read. A hunk that moved or changed has a
// different id, so it is simply not found and the request is refused — rather
// than being applied to whatever lines now sit at those coordinates.
import fs from 'node:fs';
import path from 'node:path';

import { pathArg } from './args';
import { parseSingleFileDiff } from './structured-diff';
import { buildSelectedPatch, PatchSelectionError } from './patch-build';
import { executableRunner } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';
import { resolveInsideRepo } from '../fs/paths';
import type {
  DiffFile,
  DiffSource,
  PatchAction,
  PatchSelection
} from '../../shared/diff-types';

/** Context lines around each change. Fixed, so `diff.context` cannot alter it. */
const CONTEXT_LINES = 3;

/** A file this large is not offered as a line-by-line diff without asking. */
export const LARGE_DIFF_BYTES = 2 * 1024 * 1024;

export interface ReadDiffResult {
  file: DiffFile | null;
  untracked: boolean;
  /** Set when the diff was skipped for size and the caller asked not to force. */
  tooLarge: boolean;
  sizeBytes: number;
}

/**
 * Wraps a path in git's quoting rules when it needs them.
 *
 * Only used for the header of a synthesised patch; every path git itself
 * printed is replayed exactly as git wrote it. Control characters are already
 * rejected by `pathArg`, which leaves the quote and the backslash.
 */
function quoteGitPath(value: string): string {
  if (!/["\\]/.test(value)) {
    return value;
  }
  return `"${value.replace(/([\\"])/g, '\\$1')}"`;
}

function diffArgs(filePath: string, source: DiffSource): string[] {
  const args = [
    // A configured external diff driver or textconv filter would return
    // something that is not a patch, and this output has to round-trip.
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    `-U${CONTEXT_LINES}`
  ];

  if (source === 'index') {
    args.push('--cached');
  }

  args.push('--', filePath);
  return args;
}

async function isUntracked(
  repoPath: string,
  filePath: string,
  runner: ExecutableRunner
): Promise<boolean> {
  const result = await runner.run(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', filePath],
    { cwd: repoPath }
  );
  return result.stdout.trim() !== '';
}

function looksBinary(contents: Buffer): boolean {
  // Git's own heuristic: a NUL byte in the first 8 KiB.
  return contents.subarray(0, 8000).includes(0);
}

/**
 * Builds the diff git will not produce: an untracked file has no pre-image, so
 * `git diff` says nothing about it. The result is a real added-file patch, so
 * the same selection and apply path works on it.
 */
function synthesiseAddedFileDiff(fullPath: string, relativePath: string): DiffFile {
  const contents = fs.readFileSync(fullPath);
  const quoted = quoteGitPath(relativePath);
  const executable = (fs.statSync(fullPath).mode & 0o111) !== 0;

  const headerLines = [
    `diff --git a/${quoted} b/${quoted}`,
    `new file mode ${executable ? '100755' : '100644'}`,
    '--- /dev/null',
    `+++ b/${quoted}`
  ];

  if (looksBinary(contents)) {
    return {
      oldPath: null,
      newPath: relativePath,
      status: 'added',
      additions: 0,
      deletions: 0,
      binary: true,
      modeChanged: false,
      hunks: [],
      headerLines
    };
  }

  const text = contents.toString('utf8');
  const raw = text.split('\n');
  // A trailing newline leaves an empty final element; its absence means the
  // last line really is unterminated.
  const endsWithNewline = raw[raw.length - 1] === '';
  if (endsWithNewline) {
    raw.pop();
  }

  const hunkId = 'untracked';
  const lines = raw.map((content, index) => ({
    id: `${hunkId}:${index}`,
    kind: 'addition' as const,
    content,
    oldLine: null,
    newLine: index + 1,
    noNewline: !endsWithNewline && index === raw.length - 1
  }));

  return {
    oldPath: null,
    newPath: relativePath,
    status: 'added',
    additions: lines.length,
    deletions: 0,
    binary: false,
    modeChanged: false,
    hunks:
      lines.length === 0
        ? []
        : [
            {
              id: hunkId,
              header: `@@ -0,0 +1,${lines.length} @@`,
              oldStart: 0,
              oldCount: 0,
              newStart: 1,
              newCount: lines.length,
              lines
            }
          ],
    headerLines
  };
}

export interface ReadDiffOptions {
  /** Reads a diff past LARGE_DIFF_BYTES instead of reporting it as too large. */
  force?: boolean;
  runner?: ExecutableRunner;
}

/** Reads one file's diff against the working tree or the index. */
export async function readFileDiff(
  repoPath: string,
  rawPath: unknown,
  source: DiffSource,
  options: ReadDiffOptions = {}
): Promise<ReadDiffResult> {
  const runner = options.runner ?? executableRunner;
  const filePath = pathArg(rawPath);

  if (source === 'working-tree' && (await isUntracked(repoPath, filePath, runner))) {
    const fullPath = resolveInsideRepo(repoPath, filePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      return { file: null, untracked: true, tooLarge: false, sizeBytes: 0 };
    }

    const sizeBytes = fs.statSync(fullPath).size;
    if (sizeBytes > LARGE_DIFF_BYTES && options.force !== true) {
      return { file: null, untracked: true, tooLarge: true, sizeBytes };
    }

    return {
      file: synthesiseAddedFileDiff(fullPath, path.relative(repoPath, fullPath).replace(/\\/g, '/')),
      untracked: true,
      tooLarge: false,
      sizeBytes
    };
  }

  const result = await runner.run('git', diffArgs(filePath, source), { cwd: repoPath });
  const sizeBytes = Buffer.byteLength(result.stdout, 'utf8');

  if (sizeBytes > LARGE_DIFF_BYTES && options.force !== true) {
    return { file: null, untracked: false, tooLarge: true, sizeBytes };
  }

  return {
    file: parseSingleFileDiff(result.stdout),
    untracked: false,
    tooLarge: false,
    sizeBytes
  };
}

/** Which diff an action selects from, and which way the patch is applied. */
const ACTION_PLAN: Record<PatchAction, { source: DiffSource; reverse: boolean; cached: boolean }> = {
  stage: { source: 'working-tree', reverse: false, cached: true },
  unstage: { source: 'index', reverse: true, cached: true },
  discard: { source: 'working-tree', reverse: true, cached: false }
};

export interface ApplySelectionInput {
  action: PatchAction;
  filePath: unknown;
  selection: PatchSelection;
}

export interface ApplySelectionResult {
  hunksApplied: number;
  linesApplied: number;
  filePath: string;
}

/**
 * Applies the selected part of a file's changes.
 *
 * Re-reads the diff first: the ids in `selection` are resolved against that
 * read, not against whatever the client last saw.
 */
export async function applySelection(
  repoPath: string,
  input: ApplySelectionInput,
  options: { runner?: ExecutableRunner } = {}
): Promise<ApplySelectionResult> {
  const runner = options.runner ?? executableRunner;
  const plan = ACTION_PLAN[input.action];
  if (!plan) {
    throw new PatchSelectionError(`Unknown action "${String(input.action)}".`);
  }

  const filePath = pathArg(input.filePath);
  const { file, untracked } = await readFileDiff(repoPath, filePath, plan.source, {
    force: true,
    runner
  });

  if (!file) {
    throw new PatchSelectionError(
      'That file has no changes left to act on. Reload the diff and try again.',
      409
    );
  }

  if (untracked && input.action !== 'stage') {
    throw new PatchSelectionError(
      'This file is not tracked yet, so only staging can act on part of it. Discard the whole file instead.'
    );
  }

  const patch = buildSelectedPatch(file, input.selection, plan.reverse);

  const args = ['apply', '--whitespace=nowarn'];
  if (plan.cached) {
    args.push('--cached');
  }
  if (plan.reverse) {
    args.push('--reverse');
  }

  // No path argument: git apply reads the patch from standard input, so the
  // patch text is never an argument and never reaches a command line.
  await runner.run('git', args, { cwd: repoPath, input: patch.text });

  return {
    filePath,
    hunksApplied: patch.hunksApplied,
    linesApplied: patch.linesApplied
  };
}
