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

export const TRASH_ROOT = path.join(os.tmpdir(), 'multi-git-trash');
export const TRASH_TTL_MS = 24 * 60 * 60 * 1000;
export const TRASH_MAX_ENTRIES = 30;

export interface TrashEntry {
  id: string;
  /** Repository-relative path the snapshot came from. */
  path: string;
  savedAt: number;
  /** Absolute path of the copied contents. */
  trashFile: string;
}

/**
 * Per-repository trash directory, named by a digest of the repository path so
 * two repositories with the same folder name stay separate.
 *
 * MD5 is not a security choice here — it only derives a directory name, and
 * nothing trusts it. It stays MD5 because changing the digest would rename
 * every existing trash directory and orphan snapshots users could still
 * restore.
 */
export function repoTrashDir(repoPath: string): string {
  const digest = crypto
    .createHash('md5')
    .update(path.resolve(repoPath).toLowerCase())
    .digest('hex')
    .slice(0, 12);

  return path.join(TRASH_ROOT, digest);
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
    console.warn('Failed to read trash index:', (error as Error).message);
    return [];
  }
}

export function writeTrashIndex(trashDir: string, entries: TrashEntry[]): void {
  try {
    fs.mkdirSync(trashDir, { recursive: true });
    writeJsonAtomic(path.join(trashDir, 'index.json'), entries);
  } catch (error) {
    console.warn('Failed to write trash index:', (error as Error).message);
  }
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
  try {
    const fullPath = resolveInsideRepo(repoPath, relativePath);
    if (!fullPath || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      return;
    }

    const trashDir = repoTrashDir(repoPath);
    fs.mkdirSync(trashDir, { recursive: true });

    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const trashFile = path.join(trashDir, `${id}.bin`);
    fs.copyFileSync(fullPath, trashFile);

    const entries = readTrashIndex(trashDir);
    entries.unshift({ id, path: relativePath, savedAt: Date.now(), trashFile });
    writeTrashIndex(trashDir, pruneTrash(entries));
  } catch (error) {
    console.warn(`Failed to save ${relativePath} to trash:`, (error as Error).message);
  }
}

export function listTrash(repoPath: string): TrashEntry[] {
  const trashDir = repoTrashDir(repoPath);
  const entries = pruneTrash(readTrashIndex(trashDir));
  writeTrashIndex(trashDir, entries);
  return entries;
}

export function findTrashEntry(repoPath: string, id: string): TrashEntry | null {
  return readTrashIndex(repoTrashDir(repoPath)).find((entry) => entry.id === id) ?? null;
}
