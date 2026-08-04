// One stable key per repository, for anything stored per repository.
//
// A repository has many spellings that all name the same working tree:
// `D:\Work\app` and `d:\work\app` on a case-insensitive volume, a path with a
// trailing separator, a junction or symlink pointing at the real folder, and —
// on macOS — the decomposed and composed spellings of the same accented
// folder name. Keying settings by whichever string the user happened to click
// means the same repository gets two records and the second one silently
// starts from defaults.
//
// This is the key, not the label. It is never shown: `repoBaseName` still
// renders the path the user chose, with its original case.
import fs from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';

/**
 * The true on-disk path, with links resolved.
 *
 * `realpathSync.native` also corrects the case on Windows, so two spellings of
 * the same folder converge before the normalisation below ever runs. A path
 * that is not on disk yet has no realpath and is used as resolved.
 */
function realPathOrResolved(resolved: string): string {
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/** Removes a trailing separator, except from a filesystem root. */
function stripTrailingSeparator(target: string): string {
  if (target.length <= 1) {
    return target;
  }

  const trimmed = target.replace(/[\\/]+$/, '');

  // `C:\` and `/` are their own parents; trimming them produces `C:` or ``.
  return trimmed === '' || path.parse(target).root === target ? target : trimmed;
}

/**
 * The canonical identity of a repository, for use as a settings key.
 *
 * Returns '' for input that does not name a path at all, so callers can reject
 * it rather than writing a record under an empty key.
 */
export function canonicalRepoKey(repoPath: string): string {
  if (typeof repoPath !== 'string' || repoPath.trim() === '') {
    return '';
  }

  const resolved = path.resolve(repoPath);
  const real = stripTrailingSeparator(realPathOrResolved(resolved));

  // NFC because macOS returns decomposed names from readdir while the same
  // name typed or pasted elsewhere arrives composed.
  const normalized = real.normalize('NFC');

  // NTFS and APFS are case-insensitive by default; ext4 is not. Folding case
  // where the filesystem does not distinguish it is what makes `D:\Work` and
  // `d:\work` one repository rather than two.
  return isWindows ? normalized.toLowerCase() : normalized;
}

/** True when two paths name the same repository. */
export function isSameRepo(left: string, right: string): boolean {
  const leftKey = canonicalRepoKey(left);
  return leftKey !== '' && leftKey === canonicalRepoKey(right);
}
