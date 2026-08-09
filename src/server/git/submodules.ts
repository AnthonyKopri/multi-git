// Reading and changing submodules.
//
// Nothing here parses `git submodule status`. That command prints one line per
// submodule prefixed with a status character, which looks machine-readable
// until a path contains a space or the output is localised — and it has no
// porcelain mode to fall back on. Every field is instead read from the source
// git itself reads:
//
//   * `.gitmodules`, through `git config --file`, for name, path, url, branch.
//   * `git ls-tree HEAD`, for the gitlink each submodule is pinned to.
//   * `git rev-parse` and `git status --porcelain` inside the submodule, for
//     what its working tree is actually at.
//
// Submodule paths come out of `.gitmodules`, which is repository content and
// therefore not trusted: cloning someone else's repository is the normal
// workflow. Every path is resolved through `resolveInsideRepo` before it is
// used as a working directory, so a submodule declaring `../../..` addresses
// nothing.
import fs from 'node:fs';
import path from 'node:path';

import { runGitCommand, tryGitCommand, GitError } from './run';
import { resolveInsideRepo } from '../fs/paths';
import { refArg } from './args';
import type {
  SubmoduleActionResult,
  SubmoduleInfo,
  SubmoduleUpdateInput
} from '../../shared/submodule-types';

export class SubmoduleError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'SubmoduleError';
    this.statusCode = statusCode;
  }
}

/** Mode git gives a gitlink entry in a tree. */
const GITLINK_MODE = '160000';

/** The three `submodule.<name>.<field>` keys this build reads. */
const SUBMODULE_FIELDS = ['path', 'url', 'branch'] as const;
type SubmoduleField = (typeof SUBMODULE_FIELDS)[number];

/**
 * Splits `submodule.<name>.<field>` into its parts.
 *
 * The name is taken as everything between the prefix and the *last* dot,
 * because a submodule name is usually its path and paths contain dots —
 * `submodule.libs/json.net.url` names `libs/json.net`, not `libs/json`.
 */
function parseSubmoduleKey(key: string): { name: string; field: SubmoduleField } | null {
  if (!key.startsWith('submodule.')) {
    return null;
  }

  const rest = key.slice('submodule.'.length);
  const lastDot = rest.lastIndexOf('.');
  if (lastDot <= 0) {
    return null;
  }

  const field = rest.slice(lastDot + 1) as SubmoduleField;
  if (!SUBMODULE_FIELDS.includes(field)) {
    return null;
  }

  return { name: rest.slice(0, lastDot), field };
}

/**
 * The `.gitmodules` declarations, keyed by submodule name.
 *
 * Read with `--file` rather than from the config, because `.gitmodules` is the
 * committed declaration while `.git/config` holds only the submodules that have
 * been initialized. A submodule that has never been initialized exists only in
 * the first, and it is the one the panel most needs to show.
 */
async function readGitmodules(repoPath: string): Promise<Map<string, Record<string, string>>> {
  const declarations = new Map<string, Record<string, string>>();

  if (!fs.existsSync(path.join(repoPath, '.gitmodules'))) {
    return declarations;
  }

  const result = await tryGitCommand(repoPath, ['config', '--file', '.gitmodules', '--list', '-z']);
  if (!result) {
    return declarations;
  }

  for (const record of result.stdout.split('\0')) {
    if (record === '') {
      continue;
    }

    const newline = record.indexOf('\n');
    const key = newline === -1 ? record : record.slice(0, newline);
    const value = newline === -1 ? '' : record.slice(newline + 1);

    const parsed = parseSubmoduleKey(key);
    if (!parsed) {
      continue;
    }

    const entry = declarations.get(parsed.name) ?? {};
    entry[parsed.field] = value;
    declarations.set(parsed.name, entry);
  }

  return declarations;
}

/** Gitlink oids from the superproject's HEAD tree, keyed by path. */
async function readGitlinks(repoPath: string): Promise<Map<string, string>> {
  const links = new Map<string, string>();

  // `-r` so submodules nested inside directories are reached; without it only
  // the top level is listed and a submodule at `libs/x` never appears.
  const result = await tryGitCommand(repoPath, ['ls-tree', '-r', '-z', 'HEAD']);
  if (!result) {
    // No HEAD yet — an empty repository. Declarations still stand.
    return links;
  }

  for (const record of result.stdout.split('\0')) {
    if (record === '') {
      continue;
    }

    // `<mode> <type> <oid>\t<path>`
    const tab = record.indexOf('\t');
    if (tab === -1) {
      continue;
    }

    const [mode, , oid] = record.slice(0, tab).split(/\s+/);
    if (mode === GITLINK_MODE && oid) {
      links.set(record.slice(tab + 1), oid);
    }
  }

  return links;
}

/**
 * Resolves a submodule's working directory, or null when it is not usable.
 *
 * `allowMissing` is on because an uninitialized submodule is a path with no
 * folder behind it yet, which is a state to report rather than an error.
 */
function submoduleDir(repoPath: string, submodulePath: string): string | null {
  return resolveInsideRepo(repoPath, submodulePath, { allowMissing: true });
}

/** What the submodule's own working tree is at, and whether it is dirty. */
async function readCheckedOut(
  fullPath: string
): Promise<{ oid?: string; dirty: boolean; initialized: boolean }> {
  // A submodule is initialized when its folder holds a .git entry — a
  // directory for an old-style clone, a file for the modern gitdir pointer.
  if (!fs.existsSync(path.join(fullPath, '.git'))) {
    return { dirty: false, initialized: false };
  }

  const head = await tryGitCommand(fullPath, ['rev-parse', 'HEAD']);
  const status = await tryGitCommand(fullPath, ['status', '--porcelain']);

  return {
    ...(head ? { oid: head.stdout.trim() } : {}),
    dirty: (status?.stdout ?? '').trim() !== '',
    initialized: true
  };
}

export async function listSubmodules(repoPath: string): Promise<SubmoduleInfo[]> {
  const [declarations, gitlinks] = await Promise.all([
    readGitmodules(repoPath),
    readGitlinks(repoPath)
  ]);

  const submodules: SubmoduleInfo[] = [];

  for (const [name, entry] of declarations) {
    const submodulePath = entry['path'] ?? name;
    const fullPath = submoduleDir(repoPath, submodulePath);

    const state = fullPath
      ? await readCheckedOut(fullPath)
      : // A declared path that escapes the repository is reported as
        // uninitialized rather than acted on. Nothing below will run git in it.
        { dirty: false, initialized: false };

    const expectedOid = gitlinks.get(submodulePath);

    submodules.push({
      path: submodulePath,
      name,
      url: entry['url'] ?? '',
      ...(entry['branch'] ? { branch: entry['branch'] } : {}),
      ...(expectedOid ? { expectedOid } : {}),
      ...(state.oid ? { checkedOutOid: state.oid } : {}),
      initialized: state.initialized,
      dirty: state.dirty,
      // The folder is there and initialized, but git cannot say what it is at.
      missingCommit: state.initialized && state.oid === undefined
    });
  }

  return submodules.sort((a, b) => a.path.localeCompare(b.path));
}

export async function findSubmodule(
  repoPath: string,
  submodulePath: string
): Promise<SubmoduleInfo | null> {
  const submodules = await listSubmodules(repoPath);
  return submodules.find((entry) => entry.path === submodulePath) ?? null;
}

/**
 * Resolves requested paths to submodules git itself declared.
 *
 * Every action goes through this, so nothing downstream operates on a path the
 * caller supplied — only on `submodule.path`, which came out of `.gitmodules`
 * and was then checked for containment.
 */
async function requireSubmodules(
  repoPath: string,
  paths: readonly string[] | undefined
): Promise<SubmoduleInfo[]> {
  const all = await listSubmodules(repoPath);

  if (!paths || paths.length === 0) {
    return all;
  }

  return paths.map((requested) => {
    const found = all.find((entry) => entry.path === requested);
    if (!found) {
      throw new SubmoduleError(`This repository has no submodule at "${requested}".`, 404);
    }
    return found;
  });
}

/**
 * Runs one git command per submodule and collects the outcomes.
 *
 * Per target rather than one `git submodule update` over all of them, because
 * a single invocation stops at the first failure and reports nothing about the
 * rest. A submodule whose remote is down should not hide the nine that worked.
 */
async function perSubmodule(
  targets: readonly SubmoduleInfo[],
  run: (submodule: SubmoduleInfo) => Promise<void>
): Promise<SubmoduleActionResult[]> {
  const results: SubmoduleActionResult[] = [];

  for (const submodule of targets) {
    try {
      await run(submodule);
      results.push({ path: submodule.path, ok: true });
    } catch (error) {
      results.push({
        path: submodule.path,
        ok: false,
        message: error instanceof GitError ? error.displayMessage : String(error)
      });
    }
  }

  return results;
}

export async function updateSubmodules(
  repoPath: string,
  input: SubmoduleUpdateInput = {},
  options: { sshKeyPath?: string | null; signal?: AbortSignal } = {}
): Promise<SubmoduleActionResult[]> {
  const targets = await requireSubmodules(repoPath, input.paths);

  return perSubmodule(targets, async (submodule) => {
    const args = ['submodule', 'update'];
    if (input.init) {
      args.push('--init');
    }
    if (input.recursive) {
      args.push('--recursive');
    }
    // `--` so a submodule path beginning with a hyphen is a path, not a flag.
    args.push('--', submodule.path);

    await runGitCommand(repoPath, args, options.sshKeyPath ?? null, {
      signal: options.signal,
      envOverrides: { GIT_TERMINAL_PROMPT: '0' }
    });
  });
}

export async function initSubmodules(
  repoPath: string,
  paths?: readonly string[]
): Promise<SubmoduleActionResult[]> {
  const targets = await requireSubmodules(repoPath, paths);

  return perSubmodule(targets, async (submodule) => {
    await runGitCommand(repoPath, ['submodule', 'init', '--', submodule.path]);
  });
}

/**
 * Copies the URL from `.gitmodules` into `.git/config`.
 *
 * The one users reach for after a remote moves: `.gitmodules` is committed and
 * has the new URL, the local config still has the old one, and every fetch goes
 * to the wrong place until the two agree.
 */
export async function syncSubmodules(
  repoPath: string,
  paths?: readonly string[],
  recursive = false
): Promise<SubmoduleActionResult[]> {
  const targets = await requireSubmodules(repoPath, paths);

  return perSubmodule(targets, async (submodule) => {
    const args = ['submodule', 'sync'];
    if (recursive) {
      args.push('--recursive');
    }
    args.push('--', submodule.path);

    await runGitCommand(repoPath, args);
  });
}

export async function setSubmoduleBranch(
  repoPath: string,
  submodulePath: string,
  branch: string | null
): Promise<SubmoduleInfo> {
  const [submodule] = await requireSubmodules(repoPath, [submodulePath]);
  if (!submodule) {
    throw new SubmoduleError(`This repository has no submodule at "${submodulePath}".`, 404);
  }

  const args =
    branch === null || branch === ''
      ? ['submodule', 'set-branch', '--default', '--', submodule.path]
      : ['submodule', 'set-branch', '--branch', refArg(branch, 'Branch'), '--', submodule.path];

  await runGitCommand(repoPath, args);

  const updated = await findSubmodule(repoPath, submodule.path);
  if (!updated) {
    throw new SubmoduleError('The submodule was changed but could not be read back.', 500);
  }

  return updated;
}

/**
 * Removes a submodule's working tree, leaving the declaration in place.
 *
 * `force` is what makes this able to lose work: without it git refuses a
 * submodule with local modifications. The caller is responsible for capturing a
 * recovery point and for having asked; this reports the dirty state so the
 * route can refuse rather than discovering it from a git error.
 */
export async function deinitSubmodules(
  repoPath: string,
  paths: readonly string[] | undefined,
  force: boolean
): Promise<SubmoduleActionResult[]> {
  const targets = await requireSubmodules(repoPath, paths);

  if (!force) {
    const dirty = targets.filter((submodule) => submodule.dirty).map((submodule) => submodule.path);
    if (dirty.length > 0) {
      throw new SubmoduleError(
        `These submodules have uncommitted changes: ${dirty.join(', ')}. Removing their working trees would discard that work.`
      );
    }
  }

  return perSubmodule(targets, async (submodule) => {
    const args = ['submodule', 'deinit'];
    if (force) {
      args.push('--force');
    }
    args.push('--', submodule.path);

    await runGitCommand(repoPath, args);
  });
}

/** The absolute path a submodule can be opened as its own repository at. */
export function submoduleRepoPath(repoPath: string, submodulePath: string): string | null {
  const fullPath = submoduleDir(repoPath, submodulePath);

  if (!fullPath || !fs.existsSync(path.join(fullPath, '.git'))) {
    return null;
  }

  return fullPath;
}
