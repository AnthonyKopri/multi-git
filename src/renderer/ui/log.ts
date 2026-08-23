// Terminal Log: the narrative half.
//
// Commands are no longer written from here. The server records those where they
// run, with the argument vector that actually ran, because a line composed from
// intent reads like a git command without being one -- and this application's
// case for existing is that you can see and trust what it did to your
// repository. What is left here is the part the argv cannot say: why something
// was attempted, what it meant, and what the user should make of it.
//
// Lines are queued rather than posted one at a time. One request per line meant
// a refresh firing fourteen parallel requests could land its lines in any order,
// and a request that failed dropped its line into the developer console, where
// nobody would ever see it. The queue keeps the order they were written in, and
// keeps a line long enough to try again.
import { postLogs } from '../api/endpoints';
import { getState } from '../state/store';

export type LogType = 'info' | 'success' | 'error' | 'cmd';

interface QueuedLine {
  text: string;
  type: LogType;
  repoPath?: string;
}

/**
 * Lines written but not yet accepted by the server.
 *
 * Bounded: if the server is unreachable for a long time this must not grow
 * without limit, and the newest lines are the ones worth keeping.
 */
const pending: QueuedLine[] = [];
const MAX_PENDING = 500;

/** One flush in flight at a time, so batches cannot overtake each other. */
let flushing: Promise<void> | null = null;
let scheduled = false;

async function flush(): Promise<void> {
  while (pending.length > 0) {
    // Taken as a batch, and put back as a batch if the post fails, so a
    // failure costs order rather than content.
    const batch = pending.splice(0, 200);

    try {
      await postLogs(batch);
    } catch {
      // One retry, at the front where they belong. A second failure means the
      // server is gone, and holding them further would only crowd out newer
      // lines; the console is the last resort it always was.
      try {
        await postLogs(batch);
      } catch {
        for (const line of batch) {
          console.log(`[${line.type}] ${line.text}`);
        }
      }
    }
  }
}

function schedule(): void {
  if (scheduled) {
    return;
  }
  scheduled = true;

  // A microtask, so everything written during one synchronous run of app code
  // travels together and arrives in that order.
  queueMicrotask(() => {
    scheduled = false;
    flushing = (flushing ?? Promise.resolve()).then(flush).catch(() => undefined);
  });
}

/** Records a line. Never throws: logging must not break the action it describes. */
export function logToTerminal(text: string, type: LogType = 'info'): void {
  // Attributed as it is written, not as it is sent: by the time a batch leaves,
  // the user may have switched repositories.
  const repoPath = getState().activeRepo;

  pending.push({ text, type, ...(repoPath === null ? {} : { repoPath }) });

  while (pending.length > MAX_PENDING) {
    pending.shift();
  }

  schedule();
}

export function openLogWindow(): void {
  if (window.desktopApi?.openLogWindow) {
    void window.desktopApi.openLogWindow();
    return;
  }

  // Browser mode: the window name means repeated clicks reuse one tab.
  window.open('/logs.html', 'multi-git-logs');
}
