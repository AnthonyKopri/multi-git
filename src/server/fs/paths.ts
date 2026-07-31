// Containment checks for repository-relative paths supplied by the client.
import fs from 'node:fs';
import path from 'node:path';

/**
 * True when `candidate` is strictly below `root`. Both arguments must already
 * be absolute and normalised.
 */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The deepest ancestor of `target` that exists on disk, with symlinks
 * resolved. Returns null if not even the filesystem root resolves.
 */
function realpathOfNearestExisting(target: string): string | null {
  let current = target;

  for (;;) {
    try {
      return fs.realpathSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }
}

/**
 * Resolves a repository-relative path and guarantees the result stays inside
 * the repository, returning null when it does not.
 *
 * Two checks, not one. The lexical check rejects `../` traversal and absolute
 * paths. The realpath check then rejects symlinks that point outside: a
 * lexically innocent path like `docs/notes.txt` can be a symlink to
 * `~/.ssh/id_ed25519`, and a repository's contents are not trusted input —
 * cloning someone else's repository is this app's normal workflow.
 *
 * Callers that create a file pass `allowMissing`. A path that does not exist
 * has no realpath, so containment is checked against its nearest existing
 * ancestor instead, which still catches a symlinked parent directory.
 */
export function resolveInsideRepo(
  repoPath: string,
  filePath: string,
  options: { allowMissing?: boolean } = {}
): string | null {
  if (typeof repoPath !== 'string' || typeof filePath !== 'string' || filePath === '') {
    return null;
  }

  const repoRoot = path.resolve(repoPath);
  const fullPath = path.resolve(repoRoot, filePath);

  if (!isInside(repoRoot, fullPath)) {
    return null;
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(repoRoot);
  } catch {
    // The repository itself is unreadable, so nothing inside it resolves.
    return null;
  }

  if (!options.allowMissing && !fs.existsSync(fullPath)) {
    return null;
  }

  // When the target exists this resolves the target itself, so both the
  // existing and the to-be-created case share one check.
  const realTarget = realpathOfNearestExisting(fullPath);
  if (realTarget === null) {
    return null;
  }

  // The nearest existing ancestor may legitimately be the repository root.
  if (realTarget !== realRoot && !isInside(realRoot, realTarget)) {
    return null;
  }

  return fullPath;
}
