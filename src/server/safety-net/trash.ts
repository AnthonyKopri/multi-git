// Snapshots of file contents taken immediately before a discard.
//
// Makes "discard changes" recoverable for a while. Deliberately bounded: 24
// hours and the 30 most recent files per repository, in the OS temp
// directory. This is a safety rail, not a backup system, and the UI says so.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveInsideRepo } from '../fs/paths';
import { writeJsonAtomic } from '../fs/atomic';
import { reportServerProblem } from '../logs';
import { canonicalRepoKey } from '../config/repo-identity';

export const TRASH_ROOT = path.join(os.tmpdir(), 'multi-git-trash');
export const TRASH_TTL_MS = 24 * 60 * 60 * 1000;
export const TRASH_MAX_ENTRIES = 30;
const LEGACY_OWNER_FILE = 'migration-owner.json';

export interface TrashEntry {
  id: string;
  /** Repository-relative path the snapshot came from. */
  path: string;
  savedAt: number;
  /** Absolute path of the copied contents. */
  trashFile: string;
}

function trashDirForIdentity(identity: string): string {
  const digest = crypto.createHash('md5').update(identity).digest('hex').slice(0, 12);
  return path.join(TRASH_ROOT, digest);
}

/**
 * Per-repository trash directory, named by a digest of the repository path so
 * two repositories with the same folder name stay separate.
 *
 * MD5 is not a security choice here — it only derives a directory name, and
 * nothing trusts it. POSIX keys use a v2 namespace so even an all-lowercase
 * current identity cannot collide with the old always-lowercased bucket; that
 * old bucket remains available through the guarded migration below.
 */
export function repoTrashDir(repoPath: string): string {
  // The repository key follows the filesystem: it folds Windows paths but
  // preserves case on case-sensitive POSIX volumes. Lower-casing every path
  // merged `/Projects/App` and `/Projects/app` into one Safety Net on macOS.
  const identity = canonicalRepoKey(repoPath) || path.resolve(repoPath).normalize('NFC');
  return trashDirForIdentity(process.platform === 'win32' ? identity : `posix-v2\0${identity}`);
}

/** Directory key used by releases before case-sensitive POSIX parity. */
export function legacyRepoTrashDir(repoPath: string): string {
  return trashDirForIdentity(path.resolve(repoPath).toLowerCase());
}

export function readTrashIndex(trashDir: string): TrashEntry[] {
  try {
    const indexPath = path.join(trashDir, 'index.json');
    if (!fs.existsSync(indexPath)) {
      return [];
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(parsed) ? (parsed as TrashEntry[]) : [];
  } catch (error) {
    reportServerProblem(`Safety Net could not read its index: ${(error as Error).message}`);
    return [];
  }
}

export function writeTrashIndex(trashDir: string, entries: TrashEntry[]): void {
  try {
    fs.mkdirSync(trashDir, { recursive: true });
    writeJsonAtomic(path.join(trashDir, 'index.json'), entries);
  } catch (error) {
    reportServerProblem(`Safety Net could not write its index: ${(error as Error).message}`);
  }
}

function legacyOwner(trashDir: string): string | null | undefined {
  const ownerPath = path.join(trashDir, LEGACY_OWNER_FILE);
  if (!fs.existsSync(ownerPath)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null &&
      typeof (parsed as { repo?: unknown }).repo === 'string'
      ? (parsed as { repo: string }).repo
      : null;
  } catch {
    return null;
  }
}

/** True when the real parent contains two directories differing only by case. */
function hasCaseDistinctSibling(repoPath: string): boolean {
  if (process.platform === 'win32') {
    return false;
  }

  const identity = canonicalRepoKey(repoPath) || path.resolve(repoPath).normalize('NFC');
  const wanted = path.basename(identity).normalize('NFC').toLocaleLowerCase('en-US');
  try {
    const matches = fs
      .readdirSync(path.dirname(identity), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name.normalize('NFC'))
      .filter((name) => name.toLocaleLowerCase('en-US') === wanted);
    return new Set(matches).size > 1;
  } catch {
    // An unreadable parent cannot prove that claiming a shared legacy bucket
    // is safe. Losing a compatibility view is preferable to cross-repo restore.
    return true;
  }
}

/**
 * Atomically assigns an unowned legacy bucket to one unambiguous repository.
 * The old index did not record repository identity, so case-colliding paths
 * must never both merge it.
 */
function claimLegacyTrash(repoPath: string, legacyDir: string): boolean {
  const identity = canonicalRepoKey(repoPath) || path.resolve(repoPath).normalize('NFC');
  const owner = legacyOwner(legacyDir);
  if (owner !== undefined) {
    return owner === identity;
  }
  if (hasCaseDistinctSibling(repoPath)) {
    return false;
  }

  try {
    fs.writeFileSync(
      path.join(legacyDir, LEGACY_OWNER_FILE),
      `${JSON.stringify({ repo: identity }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return legacyOwner(legacyDir) === identity;
    }
    reportServerProblem(
      `Safety Net could not claim its legacy index safely: ${(error as Error).message}`
    );
    return false;
  }
}

function legacyTrashOwnedBy(repoPath: string, legacyDir: string): boolean {
  const identity = canonicalRepoKey(repoPath) || path.resolve(repoPath).normalize('NFC');
  return legacyOwner(legacyDir) === identity;
}

/** Writes the current index and removes consumed/pruned rows from the legacy one. */
export function writeRepoTrashIndex(repoPath: string, entries: TrashEntry[]): void {
  const currentDir = repoTrashDir(repoPath);
  const legacyDir = legacyRepoTrashDir(repoPath);
  writeTrashIndex(currentDir, entries);

  if (legacyDir !== currentDir && legacyTrashOwnedBy(repoPath, legacyDir)) {
    const retainedIds = new Set(entries.map((entry) => entry.id));
    const legacyEntries = readTrashIndex(legacyDir);
    const retainedLegacy = legacyEntries.filter((entry) => retainedIds.has(entry.id));
    if (retainedLegacy.length !== legacyEntries.length) {
      writeTrashIndex(legacyDir, retainedLegacy);
    }
  }
}

/**
 * Reads the current index plus the pre-macOS key for one 24-hour compatibility
 * window. Migrated entries keep their absolute legacy snapshot paths; copying
 * or moving them could make an old case-colliding repository lose its only
 * recovery copy.
 */
function readRepoTrashEntries(repoPath: string): TrashEntry[] {
  const currentDir = repoTrashDir(repoPath);
  const legacyDir = legacyRepoTrashDir(repoPath);
  const legacyEntries = legacyDir === currentDir ? [] : readTrashIndex(legacyDir);
  const readableLegacy =
    legacyEntries.length > 0 && claimLegacyTrash(repoPath, legacyDir) ? legacyEntries : [];
  const combined = [
    ...readTrashIndex(currentDir),
    ...readableLegacy
  ].sort((left, right) => right.savedAt - left.savedAt);

  const seen = new Set<string>();
  return combined.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

/** Drops expired and over-quota entries, deleting their snapshots. */
export function pruneTrash(entries: TrashEntry[], now = Date.now()): TrashEntry[] {
  const kept: TrashEntry[] = [];
  const dropped: TrashEntry[] = [];

  for (const entry of entries) {
    if (now - entry.savedAt < TRASH_TTL_MS && kept.length < TRASH_MAX_ENTRIES) {
      kept.push(entry);
    } else {
      dropped.push(entry);
    }
  }

  for (const entry of dropped) {
    try {
      if (fs.existsSync(entry.trashFile)) {
        fs.unlinkSync(entry.trashFile);
      }
    } catch {
      // Best effort; a leftover temp file is harmless.
    }
  }

  return kept;
}

/**
 * Copies a file's current contents into the trash. Never throws: failing to
 * snapshot must not prevent the discard the user asked for.
 */
export function saveToTrash(repoPath: string, relativePath: string): void {
  saveManyToTrash(repoPath, [relativePath]);
}

/**
 * The same, for a whole set at once.
 *
 * A bulk discard used to call saveToTrash per file, and each call read the
 * index, pruned it and wrote it back — so discarding five hundred files meant
 * five hundred read/prune/write cycles, and the prune inside the loop deleted
 * snapshots taken moments earlier as the quota filled. Reading once and writing
 * once at the end keeps the newest TRASH_MAX_ENTRIES of the batch, which is
 * what the quota is supposed to mean.
 */
export function saveManyToTrash(repoPath: string, relativePaths: readonly string[]): void {
  if (relativePaths.length === 0) {
    return;
  }

  const trashDir = repoTrashDir(repoPath);
  let entries: TrashEntry[] | null = null;

  for (const relativePath of relativePaths) {
    try {
      const fullPath = resolveInsideRepo(repoPath, relativePath);
      if (!fullPath || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        continue;
      }

      // Deferred until there is something worth saving, so a discard that
      // touches nothing does not create a trash directory for this repository.
      if (entries === null) {
        fs.mkdirSync(trashDir, { recursive: true });
        entries = readRepoTrashEntries(repoPath);
      }

      const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const trashFile = path.join(trashDir, `${id}.bin`);
      fs.copyFileSync(fullPath, trashFile);

      entries.unshift({ id, path: relativePath, savedAt: Date.now(), trashFile });
    } catch (error) {
      reportServerProblem(`Safety Net could not keep a copy of ${relativePath}: ${(error as Error).message}`);
    }
  }

  if (entries !== null) {
    writeRepoTrashIndex(repoPath, pruneTrash(entries));
  }
}

export function listTrash(repoPath: string): TrashEntry[] {
  const entries = pruneTrash(readRepoTrashEntries(repoPath));
  // Writing the merged index makes the fallback self-migrating while the
  // legacy directory remains readable until its entries naturally expire.
  writeRepoTrashIndex(repoPath, entries);
  return entries;
}
