// The durable half of Safety Net.
//
// checkpoints.ts keeps an in-memory undo stack that is gone when the backend
// restarts, which the UI has always said plainly. That is fine for "I just did
// that by accident" and useless for "what did I do to this branch on Friday".
//
// A recovery point is the durable form: written to disk beside the repository,
// it records what the operation was and where every ref it could move was
// pointing beforehand. It does not copy objects — git's reflog already keeps
// those reachable — so a point is a small, legible index into recovery that
// git can already perform.
//
// It lives in the repository's own git directory rather than in the user's
// config, for two reasons: a recovery point is meaningless without the objects
// it names, and deleting a repository should take its recovery points with it.
import fs from 'node:fs';
import path from 'node:path';

import { writeJsonAtomic } from '../fs/atomic';
import { tryGitCommand } from '../git/run';
import { readConfig } from '../config/store';
import type { RecoveryOperation, RecoveryPoint } from '../../shared/recovery-types';

/** Default retention. Long enough to cover a weekend and a Monday morning. */
export const DEFAULT_RETENTION_DAYS = 14;

/** Points kept per repository, regardless of age. */
export const MAX_RECOVERY_POINTS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

const gitDirCache = new Map<string, string>();

/**
 * The repository's git directory.
 *
 * Asked of git rather than assumed to be `<repo>/.git`, because in a linked
 * worktree that path is a file pointing elsewhere — and worktrees are Phase 3,
 * so getting this wrong now would be a bug that only appears later.
 */
async function gitDir(repoPath: string): Promise<string | null> {
  const cached = gitDirCache.get(repoPath);
  if (cached !== undefined) {
    return cached;
  }

  const result = await tryGitCommand(repoPath, ['rev-parse', '--absolute-git-dir']);
  const resolved = result?.stdout.trim();
  if (!resolved) {
    return null;
  }

  gitDirCache.set(repoPath, resolved);
  return resolved;
}

/** Drops the resolved git directories. Tests reuse paths across repositories. */
export function clearRecoveryCache(): void {
  gitDirCache.clear();
}

async function journalPath(repoPath: string): Promise<string | null> {
  const directory = await gitDir(repoPath);
  return directory === null ? null : path.join(directory, 'multi-git', 'recovery.json');
}

function readJournal(file: string): RecoveryPoint[] {
  try {
    if (!fs.existsSync(file)) {
      return [];
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as RecoveryPoint[]) : [];
  } catch (error) {
    console.warn('Could not read the recovery journal:', (error as Error).message);
    return [];
  }
}

function writeJournal(file: string, points: RecoveryPoint[]): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJsonAtomic(file, points);
  } catch (error) {
    console.warn('Could not write the recovery journal:', (error as Error).message);
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Configured retention in days. 0 means points are kept until removed by hand.
 *
 * Read here rather than passed in from each call site, so every capture in the
 * application agrees about it without threading a setting through five routes.
 */
export function retentionDays(): number {
  const configured = readConfig().settings?.recoveryRetentionDays;
  return typeof configured === 'number' && configured >= 0 ? configured : DEFAULT_RETENTION_DAYS;
}

/** Drops expired and over-quota points. Never touches the objects they name. */
export function pruneRecoveryPoints(
  points: readonly RecoveryPoint[],
  now = Date.now()
): RecoveryPoint[] {
  return points
    .filter((point) => point.expiresAt === null || Date.parse(point.expiresAt) > now)
    .slice(0, MAX_RECOVERY_POINTS);
}

export interface CaptureInput {
  operation: RecoveryOperation;
  label: string;
  /** Extra refs the operation could move, beyond HEAD and the current branch. */
  refs?: readonly string[];
  /** A stash commit the operation would otherwise drop. */
  stashRef?: string;
  retentionDays?: number;
}

/**
 * Records where things stand before a destructive operation.
 *
 * Never throws and never blocks the operation: a recovery point that could not
 * be written is worth a warning, not a refusal to do what the user asked. It
 * returns the point so a caller can mention it, and null when there was
 * nothing to record — a repository with no commits has no position to return
 * to.
 */
export async function captureRecoveryPoint(
  repoPath: string,
  input: CaptureInput
): Promise<RecoveryPoint | null> {
  try {
    const head = await tryGitCommand(repoPath, ['rev-parse', 'HEAD']);
    const headOid = head?.stdout.trim();
    if (!headOid) {
      return null;
    }

    const refs: Record<string, string> = { HEAD: headOid };

    // symbolic-ref fails on a detached HEAD, which is a state and not an error.
    const symbolic = await tryGitCommand(repoPath, ['symbolic-ref', '--quiet', 'HEAD']);
    const headRef = symbolic?.stdout.trim() || null;
    if (headRef) {
      refs[headRef] = headOid;
    }

    for (const ref of input.refs ?? []) {
      const resolved = await tryGitCommand(repoPath, ['rev-parse', '--verify', '--quiet', ref]);
      const oid = resolved?.stdout.trim();
      if (oid) {
        refs[ref] = oid;
      }
    }

    const retention = input.retentionDays ?? retentionDays();
    const createdAt = Date.now();

    const point: RecoveryPoint = {
      id: newId(),
      operation: input.operation,
      label: input.label,
      refs,
      headRef,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: retention > 0 ? new Date(createdAt + retention * DAY_MS).toISOString() : null
    };

    if (input.stashRef !== undefined && input.stashRef !== '') {
      point.stashRef = input.stashRef;
    }

    const file = await journalPath(repoPath);
    if (file === null) {
      return null;
    }

    writeJournal(file, pruneRecoveryPoints([point, ...readJournal(file)], createdAt));
    return point;
  } catch (error) {
    console.warn('Could not record a recovery point:', (error as Error).message);
    return null;
  }
}

export interface ListOptions {
  /**
   * Skips expiry. Cleaning up mid-rebase would remove the very point the user
   * needs if the rebase goes wrong, so an unfinished operation freezes the
   * journal instead.
   */
  skipExpiry?: boolean;
  now?: number;
}

export async function listRecoveryPoints(
  repoPath: string,
  options: ListOptions = {}
): Promise<RecoveryPoint[]> {
  const file = await journalPath(repoPath);
  if (file === null) {
    return [];
  }

  const points = readJournal(file);
  if (options.skipExpiry === true) {
    return points;
  }

  const kept = pruneRecoveryPoints(points, options.now);
  if (kept.length !== points.length) {
    writeJournal(file, kept);
  }

  return kept;
}

export async function findRecoveryPoint(
  repoPath: string,
  id: string
): Promise<RecoveryPoint | null> {
  const points = await listRecoveryPoints(repoPath, { skipExpiry: true });
  return points.find((point) => point.id === id) ?? null;
}

/** Removes one point. The objects it named are git's to keep or collect. */
export async function forgetRecoveryPoint(repoPath: string, id: string): Promise<boolean> {
  const file = await journalPath(repoPath);
  if (file === null) {
    return false;
  }

  const points = readJournal(file);
  const kept = points.filter((point) => point.id !== id);
  if (kept.length === points.length) {
    return false;
  }

  writeJournal(file, kept);
  return true;
}
