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
