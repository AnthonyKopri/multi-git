// Git LFS: detection, tracked patterns, objects, transfers and locks.
//
// LFS is a separate program that git shells out to, and it may simply not be
// installed. Nothing here installs it, and nothing here degrades quietly: every
// entry point checks first and raises `LFS_MISSING` with a documentation
// pointer, so the panel can say "install this" instead of showing an empty list
// that looks like "you have no large files".
//
// LFS failures are also kept distinct from ordinary git failures. A push that
// fails because the LFS server rejected an upload is a different problem with a
// different fix from a push that fails because the branch moved, and reporting
// the first as the second sends the user looking in the wrong place.
import fs from 'node:fs';
import path from 'node:path';

import { executableRunner, CommandSpawnError } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';
import { tryGitCommand } from './run';
import { pathArg } from './args';
import type {
  LfsAvailability,
  LfsErrorCode,
  LfsInstallAction,
  LfsInstallation,
  LfsLock,
  LfsObject,
  LfsStatus,
  LfsTransferPreview
} from '../../shared/lfs-types';

export class LfsError extends Error {
  readonly statusCode: number;
  readonly code: LfsErrorCode;
  /** Shown beside the message when the fix is "go and install something". */
  readonly documentation?: string;

  constructor(
    message: string,
    code: LfsErrorCode,
    options: { statusCode?: number; documentation?: string } = {}
  ) {
    super(message);
    this.name = 'LfsError';
    this.code = code;
    this.statusCode = options.statusCode ?? 400;
    if (options.documentation !== undefined) {
      this.documentation = options.documentation;
    }
  }
}

const INSTALL_DOCS = 'https://git-lfs.com';

/**
 * The runner every `git lfs` call goes through.
 *
 * Injectable for the same reason the agent launcher is: `git lfs` is a separate
 * program that need not be installed, and a suite that could only be run on a
 * machine with it would be a suite that mostly did not run. Tests script it;
 * production gets the real one.
 */
let runner: ExecutableRunner = executableRunner;

/** Swaps the runner. Tests only — production never calls this. */
export function setLfsRunner(replacement: ExecutableRunner = executableRunner): void {
  runner = replacement;
}

interface LfsResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The executable could not be started, which means LFS is not installed. */
  spawnFailed: boolean;
}

/**
 * Runs `git lfs`, argv-only, with no shell.
 *
 * `allowNonZero` covers every code rather than a list: `git lfs` exits
 * non-zero for several conditions this module treats as answers rather than
 * failures — a server without the lock API, a repository with no LFS in it —
 * and the raw result is more useful than an exception in all of them. The
 * callers decide which codes matter.
 */
async function runLfs(
  repoPath: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<LfsResult> {
  try {
    const result = await runner.run('git', ['lfs', ...args], {
      cwd: repoPath,
      env: {
        ...process.env,
        LC_ALL: 'C',
        LANG: 'C',
        // A transfer that needs credentials must fail rather than block on a
        // prompt nothing is reading.
        GIT_TERMINAL_PROMPT: '0'
      },
      allowNonZero: ALL_EXIT_CODES,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });

    return {
      code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      spawnFailed: false
    };
  } catch (error) {
    if (error instanceof CommandSpawnError) {
      return { code: -1, stdout: '', stderr: error.message, spawnFailed: true };
    }
    throw error;
  }
}

/** 0–255, so no exit code is treated as a thrown failure. */
const ALL_EXIT_CODES: readonly number[] = Array.from({ length: 256 }, (_, code) => code);

// ---------- availability ----------

export async function readAvailability(repoPath: string): Promise<LfsAvailability> {
  const version = await runLfs(repoPath, ['version'], { timeoutMs: 10_000 });

  if (version.spawnFailed || version.code !== 0) {
    return { installed: false, configured: false };
  }

  // "git-lfs/3.4.1 (GitHub; windows amd64; go 1.21.5)" — the first token is
  // the only part with a stable shape.
  const parsed = version.stdout.trim().match(/^git-lfs\/(\S+)/);

  // Configured means this repository actually uses LFS, which is a different
  // question from whether the program exists.
  const attributes = await tryGitCommand(repoPath, ['check-attr', '-a', '--', '.gitattributes']);
  const patterns = await readTrackedPatterns(repoPath);

  return {
    installed: true,
    ...(parsed?.[1] ? { version: parsed[1] } : {}),
    configured: patterns.length > 0 || (attributes?.stdout ?? '').includes('lfs')
  };
}

/** Throws unless LFS is installed. Every mutating entry point calls this. */
async function requireLfs(repoPath: string): Promise<LfsAvailability> {
  const availability = await readAvailability(repoPath);

  if (!availability.installed) {
    throw new LfsError(
      'Git LFS is not installed, or is not on this application’s PATH. Multi-Git does not install it for you.',
      'LFS_MISSING',
      { statusCode: 409, documentation: INSTALL_DOCS }
    );
  }

  return availability;
}

// ---------- repository installation ----------

/**
 * The hooks `git lfs install` writes.
 *
 * `post-commit` is in the list even though it does no network work: it is one
 * of the four the installer writes, and a partial set is still an installation.
 */
const LFS_HOOKS = ['post-checkout', 'post-commit', 'post-merge', 'pre-push'] as const;

/**
 * Whether a hook file is LFS's rather than the user's own.
 *
 * Matched on the body rather than the name because all four are ordinary git
 * hook names that a project may well use for something else. Deleting a
 * hand-written `pre-push` because it shares a name with LFS's would be a far
 * worse bug than failing to notice LFS is installed.
 */
function isLfsHook(hookPath: string): boolean {
  try {
    return /git[- ]lfs/.test(fs.readFileSync(hookPath, 'utf8'));
  } catch {
    // Unreadable, a directory, a dangling link. Not something to claim as ours.
    return false;
  }
}

/**
 * The hooks directory git would actually use.
 *
 * `rev-parse --git-path` rather than `.git/hooks`: it honours `core.hooksPath`
 * and resolves correctly inside a linked worktree, both of which put the hooks
 * somewhere other than where the obvious guess would look.
 */
async function hooksDirectory(repoPath: string): Promise<string | null> {
  const result = await tryGitCommand(repoPath, ['rev-parse', '--git-path', 'hooks']);
  const relative = result?.stdout.trim();

  if (!relative) {
    return null;
  }

  return path.isAbsolute(relative) ? relative : path.join(repoPath, relative);
}

/**
 * Whether LFS is wired into this repository, as opposed to merely present on
 * the machine or actually used by the project.
 *
 * Git for Windows ships `filter.lfs.*` in its *system* config, so the presence
 * of a filter proves nothing on its own — only a repository-local one was
 * written by `git lfs install --local`. `--local` is therefore not optional
 * here; without it every repository on a Windows box reads as installed.
 */
export async function readInstallation(repoPath: string): Promise<LfsInstallation> {
  const directory = await hooksDirectory(repoPath);

  const hooks = directory
    ? LFS_HOOKS.filter((hook) => isLfsHook(path.join(directory, hook)))
    : [];

  const filters = await tryGitCommand(repoPath, [
    'config',
    '--local',
    '--get-regexp',
    '^filter\\.lfs\\.'
  ]);
  const localFilters = (filters?.stdout ?? '').trim() !== '';

  const installed = hooks.length > 0 || localFilters;

  if (!installed) {
    return { installed, hooks: [], localFilters, redundant: false };
  }

  // Read from `.gitattributes` rather than from `git lfs track`, because the
  // case this most needs to get right is a repository whose hooks outlived the
  // program: `git lfs track` cannot run there, would answer "no patterns", and
  // would make a repository that genuinely uses LFS look safe to strip.
  const routed = await hasLfsAttributes(repoPath);

  // Objects are consulted as well as attributes because a clone can hold LFS
  // content whose `.gitattributes` entry has since been removed. Calling that
  // redundant would offer to remove the hooks that still fetch it.
  const objects = routed ? [] : await listObjects(repoPath);

  return {
    installed,
    hooks: [...hooks],
    localFilters,
    redundant: !routed && objects.length === 0
  };
}

/** Attribute files git knows about, root and nested. */
const ATTRIBUTE_PATHSPECS = [':(glob).gitattributes', ':(glob)**/.gitattributes'] as const;

/** How many attribute files are worth opening before taking the hint. */
const ATTRIBUTE_FILE_LIMIT = 50;

/**
 * Whether anything in this repository is routed through the LFS filter.
 *
 * Deliberately reads the files instead of asking `git lfs`, so the answer holds
 * on a machine where LFS is not installed — which is precisely when a stale set
 * of hooks is doing the most damage and the least good.
 */
async function hasLfsAttributes(repoPath: string): Promise<boolean> {
  // `.git/info/attributes` is not a tracked file, so ls-files will never
  // return it, and it routes files just as effectively.
  const infoPath = await tryGitCommand(repoPath, ['rev-parse', '--git-path', 'info/attributes']);
  const infoRelative = infoPath?.stdout.trim();

  if (infoRelative) {
    const resolved = path.isAbsolute(infoRelative)
      ? infoRelative
      : path.join(repoPath, infoRelative);
    if (mentionsLfsFilter(resolved)) {
      return true;
    }
  }

  // The working-tree root file, checked directly rather than through
  // `ls-files`. Git honours `.gitattributes` whether or not it is committed, so
  // a repository set up but not yet committed still routes its files — and
  // reading only tracked files would call that repository redundant and offer
  // to strip the hooks it is about to need.
  if (mentionsLfsFilter(path.join(repoPath, '.gitattributes'))) {
    return true;
  }

  const listed = await tryGitCommand(repoPath, ['ls-files', '-z', '--', ...ATTRIBUTE_PATHSPECS]);

  const files = (listed?.stdout ?? '')
    .split('\0')
    .filter((entry) => entry !== '')
    .slice(0, ATTRIBUTE_FILE_LIMIT);

  return files.some((file) => mentionsLfsFilter(path.join(repoPath, file)));
}

/** `*.psd filter=lfs diff=lfs merge=lfs -text` — the filter is the part that matters. */
function mentionsLfsFilter(attributesPath: string): boolean {
  try {
    return /filter\s*=\s*lfs/.test(fs.readFileSync(attributesPath, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Runs `git lfs install --local` or `uninstall --local`.
 *
 * `--local` throughout, and deliberately: the unscoped forms write to the
 * user's *global* config, so an "uninstall" meant to speed up one repository
 * would quietly take LFS out of every other repository on the machine.
 */
export async function setInstallation(
  repoPath: string,
  action: LfsInstallAction
): Promise<LfsInstallation> {
  if (action === 'install') {
    // Nothing can write LFS's hooks except LFS itself.
    await requireLfs(repoPath);
  }

  const result = await runLfs(repoPath, [action, '--local'], { timeoutMs: 60_000 });

  if (result.code === 0) {
    return readInstallation(repoPath);
  }

  // The repository whose hooks outlived the program. `git lfs uninstall`
  // cannot run, yet those hooks are exactly what is slowing every pull down,
  // so the removal is done directly rather than left as advice.
  if (action === 'uninstall' && result.spawnFailed) {
    return removeInstallationWithoutLfs(repoPath);
  }

  throw new LfsError(
    result.stderr.trim() || `git lfs ${action} --local failed.`,
    'LFS_INSTALL_FAILED',
    { statusCode: 500 }
  );
}

/**
 * Undoes `git lfs install --local` without `git lfs`.
 *
 * Only hooks whose body names LFS are deleted — the check `readInstallation`
 * already applies — so a hand-written `pre-push` that happens to share a name
 * is never removed. Config is unset with `--local`, which cannot reach the
 * global or system filters other repositories rely on.
 */
async function removeInstallationWithoutLfs(repoPath: string): Promise<LfsInstallation> {
  const directory = await hooksDirectory(repoPath);

  if (directory) {
    for (const hook of LFS_HOOKS) {
      const hookPath = path.join(directory, hook);
      if (isLfsHook(hookPath)) {
        try {
          fs.rmSync(hookPath);
        } catch {
          // Left in place, and reported as still installed by the re-read
          // below rather than claimed as removed.
        }
      }
    }
  }

  for (const key of ['filter.lfs.clean', 'filter.lfs.smudge', 'filter.lfs.process', 'filter.lfs.required']) {
    await tryGitCommand(repoPath, ['config', '--local', '--unset-all', key]);
  }

  return readInstallation(repoPath);
}

// ---------- tracked patterns ----------

/**
 * The patterns `.gitattributes` routes through LFS.
 *
 * `git lfs track` with no arguments lists them, one per line, indented, in the
 * form `    *.psd (.gitattributes)`. The pattern is the first token; the file
 * it came from is in parentheses and is not needed here.
 */
export async function readTrackedPatterns(repoPath: string): Promise<string[]> {
  const result = await runLfs(repoPath, ['track']);

  if (result.spawnFailed || result.code !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .slice(1) // The first line is a heading, not a pattern.
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.replace(/\s*\([^)]*\)\s*$/, '').trim())
    .filter((pattern) => pattern !== '');
}

export async function trackPattern(repoPath: string, pattern: string): Promise<string[]> {
  await requireLfs(repoPath);

  // Through pathArg: a pattern beginning with `-` would be read as a flag, and
  // `git lfs track` writes it into .gitattributes verbatim.
  const result = await runLfs(repoPath, ['track', '--', pathArg(pattern, 'Pattern')]);

  if (result.code !== 0) {
    throw new LfsError(
      result.stderr.trim() || 'Could not add that pattern.',
      'LFS_TRANSFER_FAILED'
    );
  }

  return readTrackedPatterns(repoPath);
}

export async function untrackPattern(repoPath: string, pattern: string): Promise<string[]> {
  await requireLfs(repoPath);

  const result = await runLfs(repoPath, ['untrack', '--', pathArg(pattern, 'Pattern')]);

  if (result.code !== 0) {
    throw new LfsError(
      result.stderr.trim() || 'Could not remove that pattern.',
      'LFS_TRANSFER_FAILED'
    );
  }

  return readTrackedPatterns(repoPath);
}

// ---------- objects ----------

/**
 * Every LFS-tracked file, and whether its real bytes are in this clone.
 *
 * `ls-files --json` rather than the default listing: the plain form separates
 * the oid, a one-character status marker and the path with spaces, which is
 * unparseable for a path that contains one.
 */
export async function listObjects(repoPath: string): Promise<LfsObject[]> {
  const result = await runLfs(repoPath, ['ls-files', '--json', '--size']);

  if (result.spawnFailed || result.code !== 0 || result.stdout.trim() === '') {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      files?: { name?: string; oid?: string; size?: number; downloaded?: boolean }[];
    };

    return (parsed.files ?? [])
      .filter((file) => typeof file.name === 'string' && typeof file.oid === 'string')
      .map((file) => ({
        oid: file.oid as string,
        size: typeof file.size === 'number' ? file.size : 0,
        path: file.name as string,
        // `downloaded` is LFS's own word for "the object, not just the pointer".
        present: file.downloaded === true
      }));
  } catch {
    // A version whose --json shape this build does not recognise. An empty
    // list is honest; guessing at the plain format would not be.
    return [];
  }
}

// ---------- transfers ----------

function parseTransferPreview(output: string): LfsTransferPreview {
  // `--dry-run` prints one "fetch <oid> => <path>" or "prune <oid>" line per
  // object. Only the count and the paths are stable enough to rely on.
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(fetch|prune|push|pull)\b/i.test(line));

  const samplePaths = lines
    .map((line) => line.split(/=>\s*/).pop() ?? '')
    .filter((entry) => entry !== '')
    .slice(0, 20);

  return { objectCount: lines.length, totalBytes: 0, samplePaths };
}

export async function previewTransfer(
  repoPath: string,
  action: 'fetch' | 'pull' | 'prune',
  options: { signal?: AbortSignal } = {}
): Promise<LfsTransferPreview> {
  await requireLfs(repoPath);

  const result = await runLfs(repoPath, [action, '--dry-run'], options);

  if (result.code !== 0 && result.stdout.trim() === '') {
    throw new LfsError(
      result.stderr.trim() || `Could not work out what ${action} would do.`,
      'LFS_TRANSFER_FAILED'
    );
  }

  const preview = parseTransferPreview(`${result.stdout}\n${result.stderr}`);

  if (action !== 'prune') {
    // Sizes are known for fetch and pull because ls-files has them; prune
    // works on the local store and reports nothing comparable.
    const objects = await listObjects(repoPath);
    const missing = objects.filter((object) => !object.present);
    preview.totalBytes = missing.reduce((sum, object) => sum + object.size, 0);
  }

  return preview;
}

export async function runTransfer(
  repoPath: string,
  action: 'fetch' | 'pull' | 'prune',
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  await requireLfs(repoPath);

  const result = await runLfs(repoPath, [action], { ...options, timeoutMs: 30 * 60_000 });

  if (result.code !== 0) {
    // Its own error code, so the UI never reports an LFS transfer problem as
    // an ordinary git failure — the two have different fixes.
    throw new LfsError(
      result.stderr.trim() || `git lfs ${action} failed.`,
      'LFS_TRANSFER_FAILED',
      { statusCode: 502 }
    );
  }
}

// ---------- locks ----------

/**
 * Reads the locks a server holds.
 *
 * Locking is optional in the LFS spec. A server that does not implement it
 * answers with an error, which is a fact to report rather than a failure — so
 * this returns the reason instead of throwing.
 */
export async function listLocks(
  repoPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<{ locks: LfsLock[]; unavailable?: string }> {
  const result = await runLfs(repoPath, ['locks', '--json'], {
    ...options,
    timeoutMs: 30_000
  });

  if (result.spawnFailed) {
    return { locks: [], unavailable: 'Git LFS is not installed.' };
  }
  if (result.code !== 0) {
    return {
      locks: [],
      unavailable: result.stderr.trim() || 'This remote does not support LFS file locking.'
    };
  }
  if (result.stdout.trim() === '') {
    return { locks: [] };
  }

  // Which locks are the user's own is answered by `--verify`, which splits them
  // into "ours" and "theirs". Without it every lock looks like someone else's.
  const verified = await runLfs(repoPath, ['locks', '--verify', '--json'], options);
  const mine = new Set<string>();

  if (verified.code === 0 && verified.stdout.trim() !== '') {
    try {
      const parsed = JSON.parse(verified.stdout) as { ours?: { id?: string }[] };
      for (const lock of parsed.ours ?? []) {
        if (lock.id) {
          mine.add(lock.id);
        }
      }
    } catch {
      // Leave every lock reading as someone else's, which is the safe
      // direction: it offers force-unlock rather than a plain one.
    }
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      id?: string;
      path?: string;
      owner?: { name?: string };
      locked_at?: string;
    }[];

    return {
      locks: (Array.isArray(parsed) ? parsed : [])
        .filter((lock) => typeof lock.path === 'string')
        .map((lock) => ({
          id: String(lock.id ?? ''),
          path: lock.path as string,
          owner: lock.owner?.name ?? 'unknown',
          ...(lock.locked_at ? { lockedAt: lock.locked_at } : {}),
          mine: mine.has(String(lock.id ?? ''))
        }))
    };
  } catch {
    return { locks: [], unavailable: 'The lock list could not be read.' };
  }
}

export async function createLock(repoPath: string, filePath: string): Promise<void> {
  await requireLfs(repoPath);

  const result = await runLfs(repoPath, ['lock', '--', pathArg(filePath)], { timeoutMs: 30_000 });

  if (result.code !== 0) {
    throw new LfsError(
      result.stderr.trim() || 'Could not take that lock.',
      'LFS_LOCKS_UNAVAILABLE',
      { statusCode: 502 }
    );
  }
}

/**
 * Releases a lock.
 *
 * `force` takes someone else's, which is why it is a separate argument the
 * route has to be asked for explicitly rather than a retry this function does
 * on its own when the plain form is refused.
 */
export async function releaseLock(
  repoPath: string,
  filePath: string,
  force: boolean
): Promise<void> {
  await requireLfs(repoPath);

  const args = ['unlock'];
  if (force) {
    args.push('--force');
  }
  args.push('--', pathArg(filePath));

  const result = await runLfs(repoPath, args, { timeoutMs: 30_000 });

  if (result.code !== 0) {
    const message = result.stderr.trim();

    throw new LfsError(
      message || 'Could not release that lock.',
      'LFS_LOCKS_UNAVAILABLE',
      { statusCode: /forbidden|permission|denied/i.test(message) ? 403 : 502 }
    );
  }
}

// ---------- the whole picture ----------

export async function readStatus(
  repoPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<LfsStatus> {
  const availability = await readAvailability(repoPath);

  if (!availability.installed) {
    // The repository can still carry hooks from a machine that did have LFS,
    // and those hooks are exactly what makes git slow here now — so this is
    // read even when the program itself is gone.
    return {
      availability,
      installation: await readInstallation(repoPath),
      trackedPatterns: [],
      objects: [],
      locks: []
    };
  }

  const [installation, trackedPatterns, objects, lockState] = await Promise.all([
    readInstallation(repoPath),
    readTrackedPatterns(repoPath),
    listObjects(repoPath),
    // Locks are the only part that reaches the network, and a server that is
    // slow or does not support them must not hold up the rest of the panel.
    listLocks(repoPath, options).catch(() => ({ locks: [] as LfsLock[] }))
  ]);

  return {
    availability,
    installation,
    trackedPatterns,
    objects,
    locks: lockState.locks,
    ...('unavailable' in lockState && lockState.unavailable
      ? { locksUnavailable: lockState.unavailable }
      : {})
  };
}
