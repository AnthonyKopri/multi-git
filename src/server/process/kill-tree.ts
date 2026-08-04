// Terminates a child process together with everything it started.
//
// Killing only the direct child is not enough for anything this application
// runs. `git push` spawns `ssh`, which holds the network connection and the
// terminal; `gh repo create` spawns `git`. Killing the parent alone leaves the
// grandchild attached to the pipes, so the promise never settles and the
// credential prompt stays on screen after the user pressed Cancel.
//
// The two platforms need opposite approaches:
//
//   * Windows has no process groups that signals reach. `taskkill /T` walks
//     the child list from the process table, which is the only reliable way to
//     reach a grandchild.
//
//   * POSIX has process groups, but a child only gets its own group if it was
//     spawned detached. With that, one negative-pid signal reaches the whole
//     tree; without it, the signal stops at the direct child.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const isWindows = process.platform === 'win32';

/**
 * Spawn options that make a process killable as a tree.
 *
 * `detached` is deliberately POSIX-only. On Windows it means "new console",
 * which would flash a console window on every git command, and it does nothing
 * for reachability there because taskkill works from the process table anyway.
 */
export const TREE_KILLABLE_SPAWN_OPTIONS: { detached: boolean } = {
  detached: !isWindows
};

/** How long a POSIX tree gets to exit on SIGTERM before SIGKILL. */
export const KILL_GRACE_MS = 3000;

function killWindowsTree(pid: number): void {
  // /T includes the child tree, /F skips the polite close request that a
  // console process without a message loop never receives.
  const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore'
  });

  // taskkill failing is not actionable here: the usual cause is that the
  // process already exited, which is the outcome we wanted.
  killer.on('error', () => {});
}

function killPosixTree(child: ChildProcess, pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative pid addresses the process group, which detached spawning gave
    // this child to itself.
    process.kill(-pid, signal);
  } catch {
    // ESRCH means it is already gone. EPERM means the group is not ours,
    // which happens if the child re-parented itself; the direct kill below is
    // still worth attempting.
    try {
      child.kill(signal);
    } catch {
      // Already exited.
    }
  }
}

/**
 * Kills `child` and its descendants.
 *
 * Returns a disposer that cancels the pending SIGKILL escalation, so a caller
 * that has already seen the process exit does not leave a timer behind.
 */
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): () => void {
  const pid = child.pid;

  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return () => {};
  }

  if (isWindows) {
    killWindowsTree(pid);
    return () => {};
  }

  killPosixTree(child, pid, signal);

  if (signal === 'SIGKILL') {
    return () => {};
  }

  // A process ignoring SIGTERM — ssh waiting on a passphrase prompt is the
  // case here — would otherwise hang the operation forever.
  const escalation = setTimeout(() => {
    killPosixTree(child, pid, 'SIGKILL');
  }, KILL_GRACE_MS);

  // Nothing should be kept alive purely to deliver a follow-up kill.
  escalation.unref?.();

  return () => clearTimeout(escalation);
}
