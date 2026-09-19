// Runs a piece of work as a tracked, cancellable operation.
import { operations } from './registry';

/**
 * Runs a network operation as a tracked, cancellable one.
 *
 * The app still blocks while these run — that did not change — but the
 * operations bar can now show what is happening and end it. Before this, a
 * fetch against an unreachable host was a spinner with no way out but the
 * five-minute timeout.
 *
 * A cancelled operation says the remote may already have received part of it,
 * because cancelling a push is not the same as undoing one. The objects may be
 * on the server already, and reporting a clean stop would be a claim the user
 * would then act on.
 */
export async function asOperation<T>(
  kind: string,
  repoPath: string,
  message: string,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const operation = operations.begin({ kind, repoPath, message });
  operation.start();

  try {
    const result = await run(operation.signal);
    operation.succeed();
    return result;
  } catch (error) {
    operation.fail(
      operation.cancelled
        ? 'Cancelled. The remote may already have received part of this.'
        : error instanceof Error
          ? error.message
          : 'Failed'
    );
    throw error;
  }
}
