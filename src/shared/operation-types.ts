// The shape of a long-running operation as the renderer sees it.
//
// Lives in shared/ because the same record travels three ways: the registry
// holds it on the server, the SSE stream serialises it, and the renderer
// renders it. One definition keeps those from drifting.

export type OperationState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Terminal states never change again and are pruned from the registry. */
export const TERMINAL_OPERATION_STATES: readonly OperationState[] = [
  'succeeded',
  'failed',
  'cancelled'
];

export function isTerminalOperationState(state: OperationState): boolean {
  return TERMINAL_OPERATION_STATES.includes(state);
}

/**
 * What a data transfer can say beyond a count.
 *
 * `completed` and `total` describe the phase being worked on, and a clone has
 * several, each counting from zero. This is the whole-operation view of the
 * same work, for anything that wants to draw one bar.
 */
export interface TransferProgress {
  /** Progress across every phase, from 0 to 1. Never goes backwards. */
  fraction: number;
  /** Bytes received so far in the current phase, when the tool says. */
  bytes?: number;
  /** How fast it has been going lately, not since the start. */
  bytesPerSecond?: number;
  /** How large the whole transfer is expected to be, when something knows. */
  expectedBytes?: number;
  /**
   * A guess at the time left in the current phase. Absent while there is too
   * little to estimate from, and never a promise.
   */
  remainingMs?: number;
}

export interface OperationProgress {
  /** Stable for the life of the operation, including across reconnects. */
  id: string;
  /** What is running, such as `git.push` or `ssh.add`. Not user-facing text. */
  kind: string;
  repoPath?: string;
  state: OperationState;
  /** Short user-facing status. Never carries secrets or raw command output. */
  message?: string;
  completed?: number;
  total?: number;
  transfer?: TransferProgress;
  /**
   * Whether cancelling is meaningful. False for work that cannot be
   * interrupted safely, so the UI can hide the control rather than offer one
   * that does nothing.
   */
  cancellable: boolean;
}

export interface OperationListResponse {
  success: true;
  operations: OperationProgress[];
}

export interface OperationCancelResponse {
  success: true;
  /** False when the id is unknown or the operation had already finished. */
  cancelled: boolean;
}
