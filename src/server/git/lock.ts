// Serialises mutating Git operations per repository.
//
// Git takes .git/index.lock for any command that writes the index. Two
// overlapping writes — easy to trigger by clicking Stage on several files
// quickly — make the second fail with "Unable to create index.lock: File
// exists", which surfaces as a confusing error for something the user did
// nothing wrong to cause.
//
// Read-only queries (status, log, diff) are deliberately not serialised: they
// take no lock, they are the bulk of the traffic, and holding them behind a
// mutex would make every refresh slower.

/** Tail of the queue per repository. Absent means idle. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Runs `operation` after any previously queued operation for the same
 * repository has settled.
 */
export function withRepoLock<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(repoPath) ?? Promise.resolve();

  // Swallow the predecessor's rejection: one failed operation must not cancel
  // the next one in line.
  const result = previous.then(operation, operation);

  // Keep a settled-only handle as the queue tail so an unhandled rejection is
  // never attributed to the queue itself.
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  queues.set(repoPath, tail);

  void tail.then(() => {
    // Drop the entry once this is the last queued operation, so the map does
    // not grow for every repository ever opened.
    if (queues.get(repoPath) === tail) {
      queues.delete(repoPath);
    }
  });

  return result;
}

/** Number of repositories with work queued. Used by tests. */
export function pendingRepoCount(): number {
  return queues.size;
}
