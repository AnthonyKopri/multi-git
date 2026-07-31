// Session-scoped undo points for operations that rewrite history.
//
// HEAD is recorded before a merge, rebase, cherry-pick, revert, or reset so
// the user gets a one-click undo. These live in memory only and are gone when
// the backend restarts, which the UI states plainly — they are a convenience,
// not a backup.
import path from 'node:path';

import { tryGitCommand } from '../git/run';

export interface Checkpoint {
  id: string;
  label: string;
  /** Full object name of HEAD before the operation. */
  head: string;
  createdAt: number;
}

/** What the client sees: an abbreviated head, not the full object name. */
export interface ClientCheckpoint {
  id: string;
  label: string;
  head: string;
  createdAt: number;
}

export const MAX_CHECKPOINTS = 10;

const checkpointsByRepo = new Map<string, Checkpoint[]>();

function key(repoPath: string): string {
  return path.resolve(repoPath);
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * Records HEAD before a risky operation.
 *
 * Silently does nothing in a repository with no commits, where there is no
 * HEAD to return to.
 */
export async function captureCheckpoint(repoPath: string, label: string): Promise<void> {
  const result = await tryGitCommand(repoPath, ['rev-parse', 'HEAD']);
  const head = result?.stdout.trim();
  if (!head) {
    return;
  }

  const stack = checkpointsByRepo.get(key(repoPath)) ?? [];
  stack.unshift({ id: newId(), label, head, createdAt: Date.now() });
  checkpointsByRepo.set(key(repoPath), stack.slice(0, MAX_CHECKPOINTS));
}

export function listCheckpoints(repoPath: string): ClientCheckpoint[] {
  return (checkpointsByRepo.get(key(repoPath)) ?? []).map((checkpoint) => ({
    id: checkpoint.id,
    label: checkpoint.label,
    head: checkpoint.head.substring(0, 8),
    createdAt: checkpoint.createdAt
  }));
}

export function findCheckpoint(repoPath: string, checkpointId: string): Checkpoint | null {
  return (
    (checkpointsByRepo.get(key(repoPath)) ?? []).find(
      (checkpoint) => checkpoint.id === checkpointId
    ) ?? null
  );
}

/**
 * Drops the used checkpoint and every checkpoint newer than it, since undoing
 * to an older state makes the intermediate ones meaningless.
 */
export function consumeCheckpoint(repoPath: string, checkpointId: string): void {
  const stack = checkpointsByRepo.get(key(repoPath)) ?? [];
  const index = stack.findIndex((checkpoint) => checkpoint.id === checkpointId);
  if (index >= 0) {
    checkpointsByRepo.set(key(repoPath), stack.slice(index + 1));
  }
}

/** Clears all checkpoints. Used by tests. */
export function clearCheckpoints(): void {
  checkpointsByRepo.clear();
}
