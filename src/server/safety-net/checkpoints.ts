// Session-scoped undo points for operations that rewrite history.
//
// HEAD is recorded before a merge, rebase, cherry-pick, revert, or reset so
// the user gets a one-click undo. These live in memory only and are gone when
// the backend restarts, which the UI states plainly — they are a convenience,
// not a backup.
//
// The durable half is recovery.ts, and this is the one place that writes to
// both. Every existing caller already sits exactly where a recovery point
// belongs, so routing the durable capture through here means a new destructive
// operation cannot record one and forget the other.
import path from 'node:path';

import { tryGitCommand } from '../git/run';
import { captureRecoveryPoint } from './recovery';
import type { RecoveryOperation } from '../../shared/recovery-types';

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

export interface CheckpointOptions {
  /** Classifies the durable recovery point. Omit for the in-memory undo only. */
  operation?: RecoveryOperation;
  /** Refs beyond HEAD and the current branch that the operation could move. */
  refs?: readonly string[];
  /** A stash commit the operation would otherwise drop. */
  stashRef?: string;
}

/**
 * Records HEAD before a risky operation.
 *
 * Silently does nothing in a repository with no commits, where there is no
 * HEAD to return to. Passing an `operation` also writes a durable recovery
 * point, which is what survives a restart.
 */
export async function captureCheckpoint(
  repoPath: string,
  label: string,
  options: CheckpointOptions = {}
): Promise<void> {
  const result = await tryGitCommand(repoPath, ['rev-parse', 'HEAD']);
  const head = result?.stdout.trim();
  if (!head) {
    return;
  }

  const stack = checkpointsByRepo.get(key(repoPath)) ?? [];
  stack.unshift({ id: newId(), label, head, createdAt: Date.now() });
  checkpointsByRepo.set(key(repoPath), stack.slice(0, MAX_CHECKPOINTS));

  if (options.operation !== undefined) {
    const input: Parameters<typeof captureRecoveryPoint>[1] = {
      operation: options.operation,
      label
    };
    if (options.refs !== undefined) {
      input.refs = options.refs;
    }
    if (options.stashRef !== undefined) {
      input.stashRef = options.stashRef;
    }

    await captureRecoveryPoint(repoPath, input);
  }
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
