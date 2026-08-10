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
  return (await readAvailabilityWithPatterns(repoPath)).availability;
}

/**
 * Availability, together with the tracked patterns it had to read anyway.
 *
 * `configured` cannot be decided without the pattern list, and `readStatus`
 * needs that same list for its own answer. Returning it here is what stops
 * `git lfs track` being run twice for one status read.
 */
async function readAvailabilityWithPatterns(
  repoPath: string
): Promise<{ availability: LfsAvailability; trackedPatterns: string[] }> {
  const version = await runLfs(repoPath, ['version'], { timeoutMs: 10_000 });

  if (version.spawnFailed || version.code !== 0) {
    return { availability: { installed: false, configured: false }, trackedPatterns: [] };
  }

  // "git-lfs/3.4.1 (GitHub; windows amd64; go 1.21.5)" — the first token is
  // the only part with a stable shape.
  const parsed = version.stdout.trim().match(/^git-lfs\/(\S+)/);

  // Configured means this repository actually uses LFS, which is a different
  // question from whether the program exists.
  const [attributes, trackedPatterns] = await Promise.all([
    tryGitCommand(repoPath, ['check-attr', '-a', '--', '.gitattributes']),
    readTrackedPatterns(repoPath)
  ]);

  return {
    availability: {
      installed: true,
      ...(parsed?.[1] ? { version: parsed[1] } : {}),
      configured: trackedPatterns.length > 0 || (attributes?.stdout ?? '').includes('lfs')
    },
    trackedPatterns
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
  return (await readTrackedPatterns(repoPath)).length > 0;
}

/** An attributes file, with the prefix its patterns are relative to. */
interface AttributeFile {
  file: string;
  prefix: string;
}

/**
 * Every attributes file that can route a file in this repository.
 *
 * `.git/info/attributes` is included because it is not a tracked file, so
 * ls-files will never return it, and it routes files just as effectively. The
 * working-tree root `.gitattributes` is read directly rather than through
 * ls-files, because git honours it whether or not it has been committed — and
 * reading only tracked files would call a repository that was set up but not
 * yet committed redundant, and offer to strip the hooks it is about to need.
 */
async function attributeFiles(repoPath: string): Promise<AttributeFile[]> {
  const files: AttributeFile[] = [];

  const infoPath = await tryGitCommand(repoPath, ['rev-parse', '--git-path', 'info/attributes']);
  const infoRelative = infoPath?.stdout.trim();

  if (infoRelative) {
    files.push({
      file: path.isAbsolute(infoRelative) ? infoRelative : path.join(repoPath, infoRelative),
      prefix: ''
    });
  }

  files.push({ file: path.join(repoPath, '.gitattributes'), prefix: '' });

  const listed = await tryGitCommand(repoPath, ['ls-files', '-z', '--', ...ATTRIBUTE_PATHSPECS]);

  const nested = (listed?.stdout ?? '')
    .split('\0')
    .filter((entry) => entry !== '' && entry !== '.gitattributes')
    .slice(0, ATTRIBUTE_FILE_LIMIT);

  for (const entry of nested) {
    // A nested file's patterns are relative to its own directory, which is what
    // makes `assets/*.psd` a different pattern from `*.psd`.
    files.push({
      file: path.join(repoPath, entry),
      prefix: `${path.posix.dirname(entry.replace(/\\/g, '/'))}/`
    });
  }

  return files;
}

/**
 * The LFS patterns one attributes file declares.
 *
 * `*.psd filter=lfs diff=lfs merge=lfs -text` — the filter is the part that
 * matters, and it has to be an attribute in its own right: `-filter=lfs` unsets
 * the filter, and a repository that had just switched LFS off for a path would
 * otherwise be read as still routing it.
 */
function lfsPatternsIn(attributesPath: string): string[] {
  let text: string;

  try {
    text = fs.readFileSync(attributesPath, 'utf8');
  } catch {
    // Absent, unreadable, a directory. Not something to claim as a pattern.
    return [];
  }

  const patterns: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    // Not a plain split on whitespace: a pattern containing a space is quoted.
    const match = trimmed.match(/^("(?:[^"\\]|\\.)*"|\S+)\s+(.*)$/);
    const pattern = match?.[1];
    const attributes = match?.[2];

    if (!pattern || !attributes || !/(^|\s)filter\s*=\s*lfs(\s|$)/.test(attributes)) {
      continue;
    }

    patterns.push(
      pattern.startsWith('"') ? pattern.slice(1, -1).replace(/\\(.)/g, '$1') : pattern
    );
  }

  return patterns;
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
 * Read from the attributes files, not from `git lfs track`, and that is the
 * whole point of it. `git lfs track` with no arguments looks like a listing,
 * but it reinstalls all four hooks as a side effect — so using it to read state
 * silently put back the hooks this panel had just been used to remove, on the
 * very next refresh, and made "Disable LFS here" look like it did nothing.
 *
 * Reading the files is also the only form of the question that still has an
 * answer on a machine where LFS is not installed, which is exactly when a stale
 * set of hooks is doing the most damage and the least good.
 */
export async function readTrackedPatterns(repoPath: string): Promise<string[]> {
  const patterns: string[] = [];
  const seen = new Set<string>();

  for (const { file, prefix } of await attributeFiles(repoPath)) {
    for (const pattern of lfsPatternsIn(file)) {
      // A leading slash anchors a pattern to its own file's directory, which
      // the prefix already expresses.
      const full = prefix === '' ? pattern : `${prefix}${pattern.replace(/^\//, '')}`;

      if (!seen.has(full)) {
        seen.add(full);
        patterns.push(full);
      }
    }
  }

  return patterns;
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

export interface LfsLockState {
  locks: LfsLock[];
  unavailable?: string;
}

/**
 * The bound on anything that talks to a lock server.
 *
 * Applied to `--verify` as well as to the listing. Without it that second call
 * falls through to the runner's five-minute default, and a lock server that
 * stops answering turns a status read into a five-minute stall under a line
 * that says "Reading Git LFS state".
 */
const LOCK_TIMEOUT_MS = 30_000;

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
): Promise<LfsLockState> {
  const result = await runLfs(repoPath, ['locks', '--json'], {
    ...options,
    timeoutMs: LOCK_TIMEOUT_MS
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

  let held: { id?: string; path?: string; owner?: { name?: string }; locked_at?: string }[];

  try {
    const parsed = JSON.parse(result.stdout) as typeof held;
    held = (Array.isArray(parsed) ? parsed : []).filter((lock) => typeof lock.path === 'string');
  } catch {
    return { locks: [], unavailable: 'The lock list could not be read.' };
  }

  // Nothing is locked, so there is nothing to attribute to anyone. `--verify`
  // is a second round trip to the same server for an answer already known, and
  // an empty list is the overwhelmingly common case — most repositories have
  // never taken a lock at all.
  if (held.length === 0) {
    return { locks: [] };
  }

  const mine = await ownedLockIds(repoPath, options);

  return {
    locks: held.map((lock) => ({
      id: String(lock.id ?? ''),
      path: lock.path as string,
      owner: lock.owner?.name ?? 'unknown',
      ...(lock.locked_at ? { lockedAt: lock.locked_at } : {}),
      mine: mine.has(String(lock.id ?? ''))
    }))
  };
}

/**
 * The ids of the locks this user holds, per `git lfs locks --verify`.
 *
 * Empty on any doubt, which leaves every lock reading as someone else's — the
 * safe direction, because it offers force-unlock rather than a plain one and so
 * asks the user instead of assuming.
 */
async function ownedLockIds(
  repoPath: string,
  options: { signal?: AbortSignal }
): Promise<Set<string>> {
  const verified = await runLfs(repoPath, ['locks', '--verify', '--json'], {
    ...options,
    timeoutMs: LOCK_TIMEOUT_MS
  });
  const mine = new Set<string>();

  if (verified.code !== 0 || verified.stdout.trim() === '') {
    return mine;
  }

  try {
    const parsed = JSON.parse(verified.stdout) as { ours?: { id?: string }[] };
    for (const lock of parsed.ours ?? []) {
      if (lock.id) {
        mine.add(lock.id);
      }
    }
  } catch {
    // Left empty deliberately; see above.
  }

  return mine;
}

/**
 * The lock list `readStatus` reads, remembered briefly.
 *
 * The panel and the sidebar summary are refreshed after every commit, checkout,
 * branch switch and window focus. Each of those reads is a network round trip
 * to the lock server, and repeating it seconds later cannot have a different
 * answer often enough to be worth the wait. The lock *tab* and every mutating
 * route still read through `listLocks` directly, so nothing a user does here is
 * ever answered from a stale copy.
 */
const LOCK_CACHE_TTL_MS = 30_000;

const lockCache = new Map<string, { readAt: number; state: LfsLockState }>();

/** Drops the remembered lock list, for a repository or for all of them. */
export function forgetLocks(repoPath?: string): void {
  if (repoPath === undefined) {
    lockCache.clear();
  } else {
    lockCache.delete(repoPath);
  }
}

async function recentLocks(
  repoPath: string,
  options: { signal?: AbortSignal }
): Promise<LfsLockState> {
  const cached = lockCache.get(repoPath);

  if (cached && Date.now() - cached.readAt < LOCK_CACHE_TTL_MS) {
    return cached.state;
  }

  const state = await listLocks(repoPath, options);
  lockCache.set(repoPath, { readAt: Date.now(), state });

  return state;
}

export async function createLock(repoPath: string, filePath: string): Promise<void> {
  await requireLfs(repoPath);

  const result = await runLfs(repoPath, ['lock', '--', pathArg(filePath)], {
    timeoutMs: LOCK_TIMEOUT_MS
  });

  forgetLocks(repoPath);

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

  const result = await runLfs(repoPath, args, { timeoutMs: LOCK_TIMEOUT_MS });

  forgetLocks(repoPath);

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

/**
 * Said instead of "nothing is locked" when the lock server was never asked.
 *
 * The two look identical in the panel and mean opposite things, which is the
 * same distinction the rest of this module keeps for an empty object list.
 */
const LOCKS_NOT_CHECKED =
  'Not checked. No file in this repository is routed through LFS, so the lock server was not contacted.';

export async function readStatus(
  repoPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<LfsStatus> {
  const { availability, trackedPatterns } = await readAvailabilityWithPatterns(repoPath);

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

  const [installation, objects] = await Promise.all([
    readInstallation(repoPath),
    listObjects(repoPath)
  ]);

  // Reading the locks is the only part of this that leaves the machine, and on
  // an SSH remote it is two round trips through `ssh git-lfs-authenticate`
  // costing seconds each. A repository that routes no file through LFS and
  // holds no LFS object cannot have anything worth locking, so it is not asked
  // — and this status read is refreshed after every commit, checkout, branch
  // switch and window focus, which is what made those seconds add up to a
  // "Reading Git LFS state" that never seemed to stop.
  const usesLfs = availability.configured || trackedPatterns.length > 0 || objects.length > 0;

  const lockState: LfsLockState = usesLfs
    ? // A lock server that is slow or unreachable is reported as unavailable,
      // never allowed to fail the rest of the panel.
      await recentLocks(repoPath, options).catch(() => ({ locks: [] as LfsLock[] }))
    : { locks: [], unavailable: LOCKS_NOT_CHECKED };

  return {
    availability,
    installation,
    trackedPatterns,
    objects,
    locks: lockState.locks,
    ...(lockState.unavailable ? { locksUnavailable: lockState.unavailable } : {})
  };
}
