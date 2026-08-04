// Tracks long-running work so the renderer can show it and cancel it.
//
// Today the UI has one global busy flag: something is happening, you cannot
// tell what, and there is no way to stop it. A fetch against an unreachable
// host holds that flag for the full timeout.
//
// An operation here owns an AbortSignal. Cancelling flips the signal, the
// runner kills the process tree, and the operation reaches `cancelled` — a
// state of its own, distinct from `failed`, because the user asking to stop is
// not an error to apologise for.
import { randomUUID } from 'node:crypto';

import { isTerminalOperationState } from '../../shared/operation-types';
import type { OperationProgress, OperationState } from '../../shared/operation-types';

/**
 * How long a finished operation stays listed.
 *
 * Long enough that a renderer which just reconnected still sees how the last
 * thing it was watching ended, short enough that the list stays bounded.
 */
export const COMPLETED_RETENTION_MS = 60_000;

/** Hard ceiling on retained finished operations, whatever their age. */
export const MAX_COMPLETED_RETAINED = 50;

export interface OperationDescriptor {
  kind: string;
  repoPath?: string;
  message?: string;
  total?: number;
  /** Defaults to true. Set false for work that cannot be interrupted safely. */
  cancellable?: boolean;
}

/** Fields an in-flight operation may revise. */
export interface OperationUpdate {
  message?: string;
  completed?: number;
  total?: number;
}

export interface OperationHandle {
  readonly id: string;
  /** Passed to `ExecutableRunner.run` so cancelling kills the process tree. */
  readonly signal: AbortSignal;
  readonly cancelled: boolean;
  /** Moves `queued` to `running`. Idempotent. */
  start(message?: string): void;
  update(patch: OperationUpdate): void;
  succeed(message?: string): void;
  fail(message: string): void;
}

type Listener = (operation: OperationProgress) => void;

interface Entry {
  progress: OperationProgress;
  controller: AbortController;
  finishedAt: number | null;
}

export class OperationRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<Listener>();
  private readonly newId: () => string;

  /** `newId` is injectable so tests get stable, readable identifiers. */
  constructor(newId: () => string = randomUUID) {
    this.newId = newId;
  }

  /** Registers a new operation in the `queued` state. */
  begin(descriptor: OperationDescriptor): OperationHandle {
    this.prune();

    const id = this.newId();
    const controller = new AbortController();

    const progress: OperationProgress = {
      id,
      kind: descriptor.kind,
      state: 'queued',
      cancellable: descriptor.cancellable ?? true,
      ...(descriptor.repoPath !== undefined ? { repoPath: descriptor.repoPath } : {}),
      ...(descriptor.message !== undefined ? { message: descriptor.message } : {}),
      ...(descriptor.total !== undefined ? { total: descriptor.total } : {})
    };

    const entry: Entry = { progress, controller, finishedAt: null };
    this.entries.set(id, entry);
    this.publish(entry);

    const settle = (state: OperationState, message?: string): void => {
      if (isTerminalOperationState(entry.progress.state)) {
        return;
      }
      entry.progress.state = state;
      if (message !== undefined) {
        entry.progress.message = message;
      }
      entry.finishedAt = Date.now();
      this.publish(entry);
    };

    return {
      id,
      signal: controller.signal,
      get cancelled(): boolean {
        return controller.signal.aborted;
      },
      start: (message) => {
        if (entry.progress.state !== 'queued') {
          return;
        }
        entry.progress.state = 'running';
        if (message !== undefined) {
          entry.progress.message = message;
        }
        this.publish(entry);
      },
      update: (patch) => {
        if (isTerminalOperationState(entry.progress.state)) {
          return;
        }
        if (patch.message !== undefined) {
          entry.progress.message = patch.message;
        }
        if (patch.completed !== undefined) {
          entry.progress.completed = patch.completed;
        }
        if (patch.total !== undefined) {
          entry.progress.total = patch.total;
        }
        this.publish(entry);
      },
      // A cancelled operation reports `cancelled` however its body finished:
      // a killed git process usually returns normally, and reporting that as
      // success would leave the UI claiming a push landed when it did not.
      succeed: (message) => settle(controller.signal.aborted ? 'cancelled' : 'succeeded', message),
      fail: (message) => settle(controller.signal.aborted ? 'cancelled' : 'failed', message)
    };
  }

  /**
   * Runs `body` as a tracked operation.
   *
   * The handle is passed in so the body can report progress and hand the
   * signal to the runner.
   */
  async run<T>(
    descriptor: OperationDescriptor,
    body: (handle: OperationHandle) => Promise<T>
  ): Promise<T> {
    const handle = this.begin(descriptor);
    handle.start();

    try {
      const value = await body(handle);
      handle.succeed();
      return value;
    } catch (error) {
      handle.fail(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Requests cancellation. Returns false when the id is unknown, the
   * operation already finished, or it declared itself non-cancellable.
   */
  cancel(id: string): boolean {
    const entry = this.entries.get(id);

    if (
      !entry ||
      !entry.progress.cancellable ||
      isTerminalOperationState(entry.progress.state) ||
      entry.controller.signal.aborted
    ) {
      return false;
    }

    entry.controller.abort();

    // The state is not set here. The body is still unwinding — killing a
    // process tree is not instant — and it reports `cancelled` when it lands.
    // Publishing keeps the UI honest in the meantime.
    entry.progress.message = 'Cancelling…';
    this.publish(entry);

    return true;
  }

  /** Every operation currently tracked, oldest first. */
  list(): OperationProgress[] {
    this.prune();
    return [...this.entries.values()].map((entry) => ({ ...entry.progress }));
  }

  get(id: string): OperationProgress | null {
    const entry = this.entries.get(id);
    return entry ? { ...entry.progress } : null;
  }

  /** Subscribes to every state change. Returns a disposer. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Cancels everything in flight. Used when the server shuts down. */
  cancelAll(): void {
    for (const id of this.entries.keys()) {
      this.cancel(id);
    }
  }

  /** Empties the registry. Used by tests. */
  clear(): void {
    this.entries.clear();
  }

  private publish(entry: Entry): void {
    const snapshot = { ...entry.progress };

    for (const listener of this.listeners) {
      // One broken subscriber — a closed SSE response, say — must not stop
      // the others from being told.
      try {
        listener(snapshot);
      } catch {
        // Ignored deliberately.
      }
    }
  }

  /** Drops finished operations that are old enough, or simply too numerous. */
  private prune(now = Date.now()): void {
    const finished = [...this.entries.entries()].filter(([, entry]) => entry.finishedAt !== null);

    for (const [id, entry] of finished) {
      if (now - (entry.finishedAt ?? now) > COMPLETED_RETENTION_MS) {
        this.entries.delete(id);
      }
    }

    const stillFinished = [...this.entries.entries()]
      .filter(([, entry]) => entry.finishedAt !== null)
      .sort((a, b) => (a[1].finishedAt ?? 0) - (b[1].finishedAt ?? 0));

    // Math.max matters: a negative end index makes slice count back from the
    // end, which would select everything but the newest few and delete those.
    const excess = Math.max(0, stillFinished.length - MAX_COMPLETED_RETAINED);

    for (const [id] of stillFinished.slice(0, excess)) {
      this.entries.delete(id);
    }
  }
}

/** The registry the routes and services share. */
export const operations: OperationRegistry = new OperationRegistry();
