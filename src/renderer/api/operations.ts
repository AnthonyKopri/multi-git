// Renderer half of the operation boundary: list, subscribe, cancel.
//
// This is the seam, not the UI. It keeps a live map of what the server is
// running and tells subscribers when it changes; deciding what that looks like
// on screen belongs to the feature that owns the panel.
//
// Requests here are deliberately not repo-scoped and ignore the repository
// generation: an operation started against the previous repository is still
// running, and still worth being able to cancel, after the user switches away.
import { api } from './client';
import type {
  OperationCancelResponse,
  OperationListResponse,
  OperationProgress
} from '../../shared/operation-types';
import { isTerminalOperationState } from '../../shared/operation-types';

type Listener = (operations: OperationProgress[]) => void;

const known = new Map<string, OperationProgress>();
const listeners = new Set<Listener>();
let stream: EventSource | null = null;

function snapshot(): OperationProgress[] {
  return [...known.values()];
}

function notify(): void {
  const current = snapshot();
  for (const listener of listeners) {
    listener(current);
  }
}

function apply(operation: OperationProgress): void {
  known.set(operation.id, operation);
  notify();
}

function replaceAll(list: readonly OperationProgress[]): void {
  known.clear();
  for (const operation of list) {
    known.set(operation.id, operation);
  }
  notify();
}

/** Everything the server is running, as of the last event received. */
export function listOperations(): OperationProgress[] {
  return snapshot();
}

export function activeOperations(): OperationProgress[] {
  return snapshot().filter((operation) => !isTerminalOperationState(operation.state));
}

/** Fetches the current list once, without opening a stream. */
export async function fetchOperations(): Promise<OperationProgress[]> {
  const response = await api.get<OperationListResponse>('/api/operations', {
    repoScoped: false,
    ignoreRepoGeneration: true
  });

  replaceAll(response.operations);
  return snapshot();
}

/** Asks the server to stop an operation. False means it was already over. */
export async function cancelOperation(id: string): Promise<boolean> {
  const response = await api.post<OperationCancelResponse>('/api/operations/cancel', {
    body: { id },
    repoScoped: false,
    ignoreRepoGeneration: true
  });

  return response.cancelled;
}

/**
 * Subscribes to operation changes, opening the event stream on first use.
 *
 * Returns a disposer. The stream stays open once opened: reconnecting on every
 * subscriber change would lose the backlog each time, and the server sends a
 * fresh snapshot when it does reconnect.
 */
export function subscribeToOperations(listener: Listener): () => void {
  listeners.add(listener);
  openStream();

  // Whatever is already known, so a subscriber does not sit blank until the
  // next change happens to arrive.
  listener(snapshot());

  return () => {
    listeners.delete(listener);
  };
}

function openStream(): void {
  if (stream !== null) {
    return;
  }

  stream = new EventSource('/api/operations/stream');

  stream.addEventListener('snapshot', (event) => {
    const parsed = parse<OperationProgress[]>(event);
    if (parsed) {
      replaceAll(parsed);
    }
  });

  stream.addEventListener('message', (event) => {
    const parsed = parse<OperationProgress>(event);
    if (parsed) {
      apply(parsed);
    }
  });

  // EventSource reconnects on its own, and the server answers a reconnect with
  // a fresh snapshot, so an error needs no handling beyond not throwing.
  stream.addEventListener('error', () => {});
}

function parse<T>(event: Event): T | null {
  const data = (event as MessageEvent<string>).data;

  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/** Closes the stream and drops all state. Used when the app tears down. */
export function resetOperations(): void {
  stream?.close();
  stream = null;
  listeners.clear();
  known.clear();
}
