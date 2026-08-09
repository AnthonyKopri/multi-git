// Creating and applying patches.
//
// The rule this file inherits from ./encoding.ts: a patch is bytes. Git emits
// them, `git apply` consumes them, and decoding to UTF-8 anywhere in between
// replaces every byte that is not valid UTF-8 with U+FFFD — which either makes
// the patch fail to apply or, worse, applies a corrupted version of it. So the
// patch travels as a latin1 transport string and is decoded only for display.
//
// The dangerous direction is applying. A patch is untrusted input: it arrives
// from a file, a clipboard, an email. `git apply` is happy to write outside the
// repository if the patch asks it to, so every path the patch names is checked
// before anything runs, and a recovery point is captured first.
import path from 'node:path';

import { runGitCommand, tryGitCommand, GitError } from './run';
import { bytesToTransport, transportToDisplay } from './encoding';
import { commitish, pathArgs } from './args';
import type {
  AmState,
  ApplyPatchOutcome,
  ApplyPatchRequest,
  PatchPreview,
  PatchRequest,
  WhitespacePolicy
} from '../../shared/patch-types';

export class PatchError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'PatchError';
    this.statusCode = statusCode;
  }
}

// ---------- creating ----------

function whitespaceArg(policy: WhitespacePolicy | undefined): string[] {
  if (policy === undefined) {
    return [];
  }
  if (!['nowarn', 'warn', 'fix', 'error'].includes(policy)) {
    throw new PatchError(`Unknown whitespace policy "${policy}".`);
  }
  return [`--whitespace=${policy}`];
}

/**
 * Builds the argument vector for a patch request.
 *
 * `format-patch --stdout` for a mailbox and `diff` for a plain one. Both take
 * the same path limiting, through `pathArgs`, which puts `--` in front so a
 * file named `-x` stays a file.
 */
function buildArgs(request: PatchRequest): string[] {
  const paths =
    request.selectedPaths && request.selectedPaths.length > 0
      ? pathArgs(request.selectedPaths)
      : [];

  if (request.source === 'working') {
    return ['diff', ...paths];
  }
  if (request.source === 'staged') {
    return ['diff', '--cached', ...paths];
  }

  const from = commitish(request.from, 'Starting commit');

  if (request.format === 'mailbox') {
    // `-1` for a single commit; a range otherwise. format-patch's range is
    // exclusive at the left, which is what `<a>..<b>` already means.
    const range = request.to ? `${from}..${commitish(request.to, 'Ending commit')}` : `${from}~1..${from}`;
    return ['format-patch', '--stdout', range, ...paths];
  }

  const range = request.to ? [from, commitish(request.to, 'Ending commit')] : [`${from}~1`, from];
  return ['diff', ...range, ...paths];
}

/** Paths a patch touches, read from its own headers. */
export function pathsInPatch(patchText: string): string[] {
  const paths = new Set<string>();

  for (const line of patchText.split(/\r?\n/)) {
    // `diff --git a/x b/y` is the authoritative header; `+++ b/x` covers the
    // plain `diff -u` output that has no git header at all.
    const gitHeader = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitHeader) {
      paths.add(gitHeader[1] as string);
      paths.add(gitHeader[2] as string);
      continue;
    }

    const plusHeader = line.match(/^\+\+\+ (?:b\/)?(.+?)(?:\t.*)?$/);
    if (plusHeader && plusHeader[1] !== '/dev/null') {
      paths.add(plusHeader[1] as string);
    }
  }

  return [...paths];
}

export async function createPatch(
  repoPath: string,
  request: PatchRequest
): Promise<{ preview: PatchPreview; bytes: Buffer }> {
  const result = await runGitCommand(repoPath, buildArgs(request), null, { binaryStdout: true });

  const bytes = result.stdoutBuffer ?? Buffer.alloc(0);
  if (bytes.length === 0) {
    throw new PatchError('That produced an empty patch — there is nothing to write.');
  }

  const transport = bytesToTransport(bytes);

  return {
    bytes,
    preview: {
      // Decoded only here, for a human to read. The bytes above are what gets
      // written or applied.
      text: transportToDisplay(transport),
      byteLength: bytes.length,
      paths: pathsInPatch(transport),
      // Two different shapes for the same fact. `format-patch` embeds the
      // object as a "GIT binary patch" block; a plain `diff` only says the
      // files differ and carries no content at all — which matters more, since
      // such a patch cannot be applied even in principle.
      hasBinary: /^GIT binary patch$/m.test(transport) || /^Binary files .* differ$/m.test(transport)
    }
  };
}

// ---------- applying ----------

/**
 * Refuses a patch that would write outside the repository.
 *
 * `git apply` will happily follow `../../..` if a patch asks it to, and a patch
 * is untrusted input — it came from a file, a clipboard or an email. Checked
 * here rather than relying on `git apply --directory`, which is about
 * prefixing, not containment.
 */
function assertContained(repoPath: string, paths: readonly string[]): void {
  const root = path.resolve(repoPath);

  for (const candidate of paths) {
    if (path.isAbsolute(candidate)) {
      throw new PatchError(`This patch writes to an absolute path (${candidate}), which is refused.`);
    }

    const resolved = path.resolve(root, candidate);
    const relative = path.relative(root, resolved);

    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new PatchError(
        `This patch writes outside the repository (${candidate}), which is refused.`
      );
    }
  }
}

/** Whether `git am` is part-way through a series. */
export async function readAmState(repoPath: string): Promise<AmState> {
  // `rev-parse --git-path` resolves the right directory for a linked worktree,
  // where `.git` is a file rather than a folder.
  const gitDir = await tryGitCommand(repoPath, ['rev-parse', '--git-path', 'rebase-apply']);
  const dir = gitDir?.stdout.trim();

  if (!dir) {
    return { inProgress: false };
  }

  const next = await tryGitCommand(repoPath, ['rev-parse', '--git-path', 'rebase-apply/next']);
  const last = await tryGitCommand(repoPath, ['rev-parse', '--git-path', 'rebase-apply/last']);

  // Reading these through the filesystem rather than git, because git has no
  // porcelain for "which patch of the series stopped".
  const fs = await import('node:fs');
  if (!fs.existsSync(path.resolve(repoPath, dir))) {
    return { inProgress: false };
  }

  const readNumber = (target: string | undefined): number | undefined => {
    if (!target) {
      return undefined;
    }
    try {
      const value = Number(fs.readFileSync(path.resolve(repoPath, target), 'utf8').trim());
      return Number.isFinite(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };

  const current = readNumber(next?.stdout.trim());
  const total = readNumber(last?.stdout.trim());

  return {
    inProgress: true,
    ...(current !== undefined ? { current } : {}),
    ...(total !== undefined ? { total } : {})
  };
}

/** Files git left conflicted, as `diff --name-only --diff-filter=U` reports. */
async function conflictedPaths(repoPath: string): Promise<string[]> {
  const result = await tryGitCommand(repoPath, ['diff', '--name-only', '--diff-filter=U']);

  return (result?.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Checks a patch is well-formed and stays inside the repository.
 *
 * Split out from `applyPatch` so the route can run it *before* it captures a
 * recovery point. A patch refused at the door changed nothing, and a journal
 * entry for it would be a record of something that never happened.
 */
export function validatePatch(repoPath: string, patch: string): string[] {
  if (typeof patch !== 'string' || patch.trim() === '') {
    throw new PatchError('There is no patch to apply.');
  }

  const paths = pathsInPatch(patch);
  if (paths.length === 0) {
    throw new PatchError('That does not look like a patch — no file headers were found in it.');
  }

  assertContained(repoPath, paths);
  return paths;
}

export async function applyPatch(
  repoPath: string,
  request: ApplyPatchRequest
): Promise<ApplyPatchOutcome> {
  const paths = validatePatch(repoPath, request.patch);

  /*
   * UTF-8, not the latin1 transport ./encoding.ts uses elsewhere.
   *
   * That transport exists for the pipeline where a string came *from*
   * `bytesToTransport` — git's bytes, held one byte per code unit. This string
   * did not: it arrived as text in a JSON body, having been read from a file or
   * a clipboard by the renderer, which decoded it as UTF-8. Encoding it back as
   * latin1 would corrupt every character above U+00FF.
   *
   * The limitation this leaves is real and worth stating: a patch whose bytes
   * are not valid UTF-8 cannot round-trip through a text field, because the
   * decode already happened before this process saw it. `createPatch` flags a
   * binary patch in its preview for the same reason.
   */
  const input = Buffer.from(request.patch, 'utf8');

  const args =
    request.mode === 'commits'
      ? buildAmArgs(request)
      : buildApplyArgs(request);

  try {
    await runGitCommand(repoPath, args, null, { input });
  } catch (error) {
    const conflicts = await conflictedPaths(repoPath);
    const amState = request.mode === 'commits' ? await readAmState(repoPath) : { inProgress: false };

    // A three-way apply that leaves conflicts has not failed — it has done what
    // it was asked and stopped for a human. Reporting it as a failure would
    // send the user looking for a problem with the patch.
    if (conflicts.length > 0 || amState.inProgress) {
      return {
        applied: false,
        dryRun: request.dryRun === true,
        paths,
        conflicts,
        ...(amState.inProgress ? { amInProgress: true } : {}),
        message:
          error instanceof GitError ? error.displayMessage : 'The patch stopped part-way through.'
      };
    }

    throw new PatchError(
      error instanceof GitError ? error.displayMessage : 'The patch could not be applied.',
      409
    );
  }

  return { applied: request.dryRun !== true, dryRun: request.dryRun === true, paths };
}

function buildApplyArgs(request: ApplyPatchRequest): string[] {
  const args = ['apply'];

  if (request.dryRun) {
    args.push('--check');
  }
  if (request.index) {
    args.push('--index');
  }
  if (request.threeWay) {
    args.push('--3way');
  }
  args.push(...whitespaceArg(request.whitespace));

  // Never `--directory`: its value would have to come from the request, and a
  // prefix taken from the same untrusted source as the paths defeats the point
  // of checking them.
  return args;
}

function buildAmArgs(request: ApplyPatchRequest): string[] {
  const args = ['am'];

  if (request.threeWay) {
    args.push('--3way');
  }
  args.push(...whitespaceArg(request.whitespace));

  return args;
}

/** `git am --continue`, `--skip` or `--abort`. */
export async function controlAm(
  repoPath: string,
  action: 'continue' | 'skip' | 'abort'
): Promise<AmState> {
  const state = await readAmState(repoPath);

  if (!state.inProgress) {
    throw new PatchError('No patch series is in progress.', 409);
  }

  await runGitCommand(repoPath, ['am', `--${action}`]);
  return readAmState(repoPath);
}
