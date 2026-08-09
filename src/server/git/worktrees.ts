// Worktree listing, creation and removal.
//
// Everything here reads `git worktree list --porcelain`, never the human
// listing: the porcelain form is a stable machine format, while the default one
// is aligned for reading and localised. `-z` is preferred on top of that
// because it is the only variant that survives a worktree path containing a
// newline, and because git does not quote lock reasons in that mode. Git older
// than 2.36 rejects `-z`, so the newline form is parsed as a fallback.
//
// The dangerous operation in this file is removal, and it is deliberately
// arranged so that this process never deletes a directory. Git is asked to do
// it, against a path git itself reported, after a recovery point exists.
import path from 'node:path';
import fs from 'node:fs';

import { runGitCommand, tryGitCommand } from './run';
import { parsePorcelainStatus } from './status';
import { refArg } from './args';
import { canonicalRepoKey } from '../config/repo-identity';
import type {
  CreateWorktreeInput,
  PrunePreviewEntry,
  WorktreeInfo,
  WorktreeStatusSummary
} from '../../shared/worktree-types';

/** Raised for a request that git would either refuse or misinterpret. */
export class WorktreeError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'WorktreeError';
    this.statusCode = statusCode;
  }
}

// ---------- porcelain parsing ----------

const QUOTE_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '"': '"',
  '\\': '\\'
};

/**
 * Undoes the `core.quotePath` style quoting git applies to a lock reason in
 * newline mode.
 *
 * Only needed for the fallback: with `-z` the reason is emitted raw, which is
 * one of the reasons `-z` is preferred.
 */
function unquoteReason(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) {
    return value;
  }

  const body = value.slice(1, -1);
  let result = '';

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== '\\') {
      result += body[index];
      continue;
    }

    const next = body[index + 1] ?? '';
    const replacement = QUOTE_ESCAPES[next];
    if (replacement !== undefined) {
      result += replacement;
      index += 1;
      continue;
    }

    // Octal, the form git uses for a byte it will not print literally.
    const octal = body.slice(index + 1, index + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      result += String.fromCharCode(Number.parseInt(octal, 8));
      index += 3;
      continue;
    }

    result += body[index];
  }

  return result;
}

/** Splits one `key value` attribute line. A boolean attribute has no value. */
function splitAttribute(line: string): { key: string; value: string } {
  const separator = line.indexOf(' ');
  return separator === -1
    ? { key: line, value: '' }
    : { key: line.slice(0, separator), value: line.slice(separator + 1) };
}

function emptyWorktree(): WorktreeInfo {
  return {
    path: '',
    head: '',
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
    isMain: false,
    present: true
  };
}

/**
 * Parses `git worktree list --porcelain` output into records.
 *
 * The first record is always the main worktree — the one holding the shared git
 * directory — which is why `isMain` can be decided here rather than by
 * comparing paths afterwards.
 */
export function parseWorktreePorcelain(
  stdout: string,
  options: { nulSeparated: boolean }
): WorktreeInfo[] {
  const separator = options.nulSeparated ? '\0' : '\n';
  const worktrees: WorktreeInfo[] = [];

  let current: WorktreeInfo | null = null;

  const flush = (): void => {
    if (current && current.path !== '') {
      current.isMain = worktrees.length === 0;
      worktrees.push(current);
    }
    current = null;
  };

  for (const rawLine of stdout.split(separator)) {
    // Trailing carriage returns appear when git's output crosses a Windows
    // pipe in newline mode. A worktree path never legitimately ends in one.
    const line = options.nulSeparated ? rawLine : rawLine.replace(/\r$/, '');

    if (line === '') {
      flush();
      continue;
    }

    const { key, value } = splitAttribute(line);

    if (key === 'worktree') {
      flush();
      current = emptyWorktree();
      current.path = value;
      continue;
    }

    if (!current) {
      // An attribute before any `worktree` line. Git does not emit this.
      continue;
    }

    switch (key) {
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        current.branch = value;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'locked':
        current.locked = true;
        if (value !== '') {
          current.lockReason = options.nulSeparated ? value : unquoteReason(value);
        }
        break;
      case 'prunable':
        current.prunable = true;
        if (value !== '') {
          current.prunableReason = options.nulSeparated ? value : unquoteReason(value);
        }
        break;
      default:
        // An attribute a newer git added. Ignored rather than treated as an
        // error, so a git upgrade cannot break the listing.
        break;
    }
  }

  flush();

  return worktrees;
}

// ---------- placement rules ----------

/** True when `child` is the same path as, or inside, `parent`. */
function isAtOrInside(parentKey: string, childKey: string): boolean {
  if (parentKey === '' || childKey === '') {
    return false;
  }
  if (parentKey === childKey) {
    return true;
  }

  const withSeparator = parentKey.endsWith(path.sep) ? parentKey : parentKey + path.sep;
  return childKey.startsWith(withSeparator);
}

/**
 * Rejects a target that overlaps a worktree that already exists.
 *
 * Git catches some of these itself, but only after it has started work and with
 * a message about administrative files. Checking first means the message names
 * the worktree actually in the way.
 *
 * Returns the reason, or null when the placement is fine.
 */
export function findPlacementConflict(
  targetPath: string,
  existingPaths: readonly string[]
): string | null {
  const targetKey = canonicalRepoKey(targetPath);
  if (targetKey === '') {
    return 'That is not a usable folder path.';
  }

  for (const existing of existingPaths) {
    const existingKey = canonicalRepoKey(existing);
    if (existingKey === '') {
      continue;
    }

    if (existingKey === targetKey) {
      return `${existing} is already a worktree of this repository.`;
    }
    if (isAtOrInside(existingKey, targetKey)) {
      return `That path is inside the existing worktree at ${existing}. Git worktrees cannot be nested.`;
    }
    if (isAtOrInside(targetKey, existingKey)) {
      return `That path contains the existing worktree at ${existing}. Git worktrees cannot be nested.`;
    }
  }

  return null;
}

/** A branch name reduced to something usable as a folder name. */
export function worktreeFolderName(branch: string): string {
  const cleaned = branch
    .replace(/^refs\/heads\//, '')
    // `feature/login` would otherwise create a nested folder.
    .replace(/[\\/]+/g, '-')
    // Reserved on Windows, and confusing everywhere else.
    .replace(/[<>:"|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');

  return cleaned === '' ? 'worktree' : cleaned;
}

/**
 * Where a new worktree is suggested: a sibling of the repository, in a folder
 * named after it.
 *
 * A sibling rather than a child because git refuses some nested layouts
 * outright, and because a worktree inside the repository shows up in its own
 * file tree and status output forever after.
 */
export function suggestWorktreeParent(mainPath: string, configuredParent?: string): string {
  if (configuredParent && configuredParent.trim() !== '') {
    return path.resolve(configuredParent);
  }

  const parent = path.dirname(mainPath);
  return path.join(parent, `${path.basename(mainPath)}.worktrees`);
}

export function suggestWorktreePath(
  mainPath: string,
  branch: string,
  configuredParent?: string
): string {
  return path.join(suggestWorktreeParent(mainPath, configuredParent), worktreeFolderName(branch));
}

/** True when the folder is absent or an existing empty directory. */
export function isUsableTargetFolder(targetPath: string): boolean {
  try {
    const stats = fs.statSync(targetPath);
    return stats.isDirectory() && fs.readdirSync(targetPath).length === 0;
  } catch {
    // Not there at all, which is the ordinary case.
    return true;
  }
}

// ---------- git-backed queries ----------

/**
 * The shared git directory, which is what makes a set of worktrees one family.
 *
 * `--path-format=absolute` is asked for first because plain `--git-common-dir`
 * answers relatively when run at the top of a repository, and a relative
 * `.git` is not a usable identity.
 */
export async function readGitCommonDir(repoPath: string): Promise<string> {
  const absolute = await tryGitCommand(repoPath, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir'
  ]);

  const resolved = absolute?.stdout.trim();
  if (resolved) {
    return path.resolve(resolved);
  }

  const relative = await tryGitCommand(repoPath, ['rev-parse', '--git-common-dir']);
  const value = relative?.stdout.trim();
  if (!value) {
    throw new WorktreeError('Could not determine the repository’s git directory.', 500);
  }

  return path.resolve(repoPath, value);
}

/** Canonical identity of the family. Every worktree of one repository shares it. */
export async function readFamilyKey(repoPath: string): Promise<string> {
  return canonicalRepoKey(await readGitCommonDir(repoPath));
}

/**
 * The main worktree of the family a folder belongs to, without running git.
 *
 * Needed by callers that are not async and cannot become so — the settings
 * lookup that decides which account a folder uses runs on every request. The
 * layout it reads is git's own and has been stable for a decade: a linked
 * worktree's `.git` is a file holding `gitdir: <common>/worktrees/<name>`, so
 * the shared git directory is the part before `/worktrees/`, and the main
 * worktree is its parent.
 *
 * Returns the path unchanged when it is already a main worktree, and null when
 * it is not a work tree at all. A submodule's `.git` file points into
 * `modules/` rather than `worktrees/`, so it is correctly not treated as one.
 */
export function mainWorktreePathSync(repoPath: string): string | null {
  const marker = path.join(repoPath, '.git');

  let stats: fs.Stats;
  try {
    stats = fs.statSync(marker);
  } catch {
    return null;
  }

  if (stats.isDirectory()) {
    return path.resolve(repoPath);
  }

  let pointer: string;
  try {
    pointer = fs.readFileSync(marker, 'utf8');
  } catch {
    return null;
  }

  const match = pointer.match(/^gitdir:\s*(.+)$/m);
  const gitDir = match?.[1]?.trim();
  if (!gitDir) {
    return null;
  }

  // Normalised first: git writes forward slashes here even on Windows.
  const segments = path.resolve(repoPath, gitDir).split(/[\\/]/);
  const index = segments.lastIndexOf('worktrees');
  if (index < 1) {
    return null;
  }

  // <common git dir>/worktrees/<name> → the main worktree is the git
  // directory's parent.
  const commonDir = segments.slice(0, index).join(path.sep);
  return commonDir === '' ? null : path.dirname(commonDir);
}

/** Whether `-z` worked here, cached per family so it is probed once. */
const nulSupport = new Map<string, boolean>();

/** Drops the `-z` support cache. Used by tests. */
export function clearWorktreeCaches(): void {
  nulSupport.clear();
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const familyKey = await readFamilyKey(repoPath);

  if (nulSupport.get(familyKey) !== false) {
    const zed = await tryGitCommand(repoPath, ['worktree', 'list', '--porcelain', '-z']);
    if (zed !== null) {
      nulSupport.set(familyKey, true);
      return withPresence(parseWorktreePorcelain(zed.stdout, { nulSeparated: true }));
    }
    // Git older than 2.36 does not know -z. Remember, so every later listing
    // goes straight to the form this git understands.
    nulSupport.set(familyKey, false);
  }

  const plain = await runGitCommand(repoPath, ['worktree', 'list', '--porcelain']);
  return withPresence(parseWorktreePorcelain(plain.stdout, { nulSeparated: false }));
}

/**
 * Normalises git's spelling of a path and records whether it is still there.
 *
 * Git prints `C:/Users/…` on Windows while every other path in this
 * application is `C:\Users\…`. One spelling has to win before these reach a
 * message, a settings key or a comparison, and the platform's own is the one
 * the user recognises.
 *
 * Presence is checked here because git reports a moved-away worktree as
 * `prunable` only once its administrative files say so; a folder deleted from
 * Explorer a moment ago is still listed as perfectly ordinary, and the UI needs
 * to know not to offer "open".
 */
function withPresence(worktrees: WorktreeInfo[]): WorktreeInfo[] {
  return worktrees.map((worktree) => ({
    ...worktree,
    path: path.resolve(worktree.path),
    present: fs.existsSync(worktree.path)
  }));
}

/** The main worktree: the one holding the shared git directory. */
export function mainWorktree(worktrees: readonly WorktreeInfo[]): WorktreeInfo | null {
  return worktrees.find((worktree) => worktree.isMain) ?? worktrees[0] ?? null;
}

/**
 * Finds the worktree a request names.
 *
 * Matching is on canonical identity so that a different casing or a junction
 * still resolves, but the value returned is git's own spelling — which is what
 * every later git command and the removal guard use.
 */
export function findWorktree(
  worktrees: readonly WorktreeInfo[],
  wanted: string
): WorktreeInfo | null {
  const wantedKey = canonicalRepoKey(wanted);
  if (wantedKey === '') {
    return null;
  }

  return worktrees.find((worktree) => canonicalRepoKey(worktree.path) === wantedKey) ?? null;
}

/** Dirty counts, tracking position and last commit date for one worktree. */
export async function readWorktreeStatus(
  worktreePath: string
): Promise<WorktreeStatusSummary | null> {
  const status = await tryGitCommand(worktreePath, ['status', '--porcelain', '-b']);
  if (status === null) {
    return null;
  }

  const parsed = parsePorcelainStatus(status.stdout);

  // The parser folds untracked files into `unstaged` with a `?` status, which
  // is what the staging list wants. Counted apart here, because "3 untracked"
  // and "3 modified" mean very different things when deciding to remove a
  // worktree.
  const untracked = parsed.unstaged.filter((file) => file.status === '?').length;

  const summary: WorktreeStatusSummary = {
    staged: parsed.staged.length,
    unstaged: parsed.unstaged.length - untracked,
    untracked,
    conflicts: parsed.conflicts.length,
    ahead: parsed.ahead,
    behind: parsed.behind,
    tracking: parsed.tracking
  };

  const lastCommit = await tryGitCommand(worktreePath, ['log', '-1', '--format=%cI']);
  const timestamp = lastCommit?.stdout.trim();
  if (timestamp) {
    summary.lastActivity = timestamp;
  }

  return summary;
}

/**
 * Fills in status for every worktree that is still on disk.
 *
 * Bounded concurrency, because this is one or two git processes per worktree
 * and a family of twenty would otherwise start forty at once and make the
 * machine unusable for the second it takes.
 */
export async function attachWorktreeStatus(
  worktrees: readonly WorktreeInfo[],
  options: { concurrency?: number; signal?: AbortSignal } = {}
): Promise<WorktreeInfo[]> {
  const limit = options.concurrency ?? 4;
  const result: WorktreeInfo[] = worktrees.map((worktree) => ({ ...worktree }));

  let next = 0;

  async function worker(): Promise<void> {
    while (next < result.length) {
      const index = next;
      next += 1;

      if (options.signal?.aborted) {
        return;
      }

      const worktree = result[index] as WorktreeInfo;
      if (!worktree.present || worktree.bare) {
        continue;
      }

      const status = await readWorktreeStatus(worktree.path);
      if (status) {
        worktree.status = status;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, result.length) }, () => worker()));

  return result;
}

// ---------- mutations ----------

/** Branches already checked out somewhere, mapped to the worktree holding them. */
export function checkedOutBranches(
  worktrees: readonly WorktreeInfo[]
): Map<string, WorktreeInfo> {
  const byBranch = new Map<string, WorktreeInfo>();

  for (const worktree of worktrees) {
    if (worktree.branch !== undefined) {
      byBranch.set(worktree.branch, worktree);
    }
  }

  return byBranch;
}

export async function createWorktree(
  input: CreateWorktreeInput
): Promise<{ path: string; stdout: string; stderr: string }> {
  const { repoPath, branchMode } = input;

  const targetPath = path.resolve(input.targetPath);
  const existing = await listWorktrees(repoPath);

  const conflict = findPlacementConflict(targetPath, existing.map((worktree) => worktree.path));
  if (conflict !== null) {
    throw new WorktreeError(conflict);
  }

  if (!isUsableTargetFolder(targetPath)) {
    throw new WorktreeError(
      `${targetPath} already exists and is not an empty folder. Choose a different location.`
    );
  }

  const args = ['worktree', 'add'];

  if (input.lock === true) {
    args.push('--lock');
  }

  if (branchMode === 'new') {
    const branch = refArg(input.branch, 'Branch name');

    const exists = await tryGitCommand(repoPath, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`
    ]);
    if (exists !== null) {
      throw new WorktreeError(
        `Branch "${branch}" already exists. Create the worktree from the existing branch instead.`
      );
    }

    args.push('-b', branch, targetPath);
    if (input.startPoint) {
      args.push(refArg(input.startPoint, 'Start point'));
    }
  } else if (branchMode === 'existing') {
    const branch = refArg(input.branch, 'Branch name');

    const holder = checkedOutBranches(existing).get(`refs/heads/${branch}`);
    if (holder) {
      throw new WorktreeError(
        `Branch "${branch}" is already checked out in ${holder.path}. A branch can only be checked out in one worktree at a time.`
      );
    }

    args.push(targetPath, branch);
  } else {
    // Detached: a position, not a branch, so nothing can collide.
    args.push('--detach', targetPath);
    if (input.startPoint) {
      args.push(refArg(input.startPoint, 'Start point'));
    }
  }

  const result = await runGitCommand(repoPath, args);

  return { path: targetPath, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Snapshots uncommitted work without touching any ref.
 *
 * `git stash create` writes the commit objects and prints the object name,
 * leaving the stash list and the working tree exactly as they were. The object
 * lives in the shared store, so it survives the worktree being deleted — which
 * is the only reason a forced removal is recoverable at all.
 *
 * Returns null when there was nothing to snapshot.
 */
export async function snapshotWorktree(worktreePath: string): Promise<string | null> {
  const result = await tryGitCommand(worktreePath, ['stash', 'create', 'Multi-Git worktree removal']);
  const oid = result?.stdout.trim();
  return oid ? oid : null;
}

/** Whether anything in the worktree would be lost by removing it. */
export function isDirty(status: WorktreeStatusSummary | null): boolean {
  if (!status) {
    return false;
  }
  return (
    status.staged > 0 || status.unstaged > 0 || status.untracked > 0 || status.conflicts > 0
  );
}

export async function parsePrunePreview(repoPath: string): Promise<PrunePreviewEntry[]> {
  const result = await tryGitCommand(repoPath, ['worktree', 'prune', '--dry-run', '-v']);
  if (result === null) {
    return [];
  }

  const entries: PrunePreviewEntry[] = [];

  // "Removing worktrees/feature-x: gitdir file points to non-existent location"
  for (const line of `${result.stdout}\n${result.stderr}`.split('\n')) {
    const match = line.match(/^Removing\s+worktrees\/(.+?):\s*(.*)$/);
    if (match?.[1]) {
      entries.push({ name: match[1], reason: match[2]?.trim() || 'no longer usable' });
    }
  }

  return entries;
}
