// Short-lived bridge that feeds a stored passphrase to ssh without a prompt.
//
// ssh only reads a passphrase from a terminal or from the program named by
// SSH_ASKPASS, so a temporary script is the only way to supply one
// non-interactively. That script necessarily contains the passphrase in
// plaintext, which makes how it is created the whole security story:
//
//   * It lives in a directory created by mkdtemp with mode 0700, so it is
//     never in a world-listable location such as the root of the temp
//     directory.
//   * It is opened with 'wx' and an explicit mode, so it is created with the
//     right permissions rather than being widened by umask and narrowed a
//     moment later. The previous implementation wrote the file first and
//     chmod'ed afterwards, leaving a window in which any local user could
//     read it.
//   * Cleanup runs in a finally block, and any bridge still alive at process
//     exit is removed by a shutdown hook, so a crash mid-operation does not
//     leave a passphrase on disk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AskpassBridge {
  /** Environment additions that point ssh and git at the script. */
  envOverrides: NodeJS.ProcessEnv;
  cleanup: () => void;
}

/** Bridges that have not been cleaned up yet, swept on process exit. */
const liveBridges = new Set<string>();
let exitHookInstalled = false;

function removeDirectory(directory: string): void {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // Best effort: the process may already be tearing down.
  }
}

function installExitHook(): void {
  if (exitHookInstalled) {
    return;
  }
  exitHookInstalled = true;

  const sweep = (): void => {
    for (const directory of liveBridges) {
      removeDirectory(directory);
    }
    liveBridges.clear();
  };

  process.on('exit', sweep);
  // 'exit' does not fire for these, and leaving a passphrase behind is worse
  // than the small cost of handling them.
  process.on('SIGINT', sweep);
  process.on('SIGTERM', sweep);
}

/** Escapes a passphrase for a single `echo` in a Windows batch file. */
function escapeForBatch(passphrase: string): string {
  return passphrase.replace(/%/g, '%%').replace(/([&|<>()^])/g, '^$1');
}

/** Escapes a passphrase for single quotes in a POSIX shell script. */
function escapeForShell(passphrase: string): string {
  return passphrase.replace(/'/g, `'"'"'`);
}

export function createAskpassBridge(passphrase: string): AskpassBridge {
  installExitHook();

  const isWindows = os.platform() === 'win32';

  // mkdtemp creates with 0700 on POSIX, so the script is unreadable by other
  // users before it exists.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-askpass-'));
  liveBridges.add(directory);

  const scriptPath = path.join(directory, isWindows ? 'askpass.cmd' : 'askpass.sh');
  const script = isWindows
    ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\necho ${escapeForBatch(passphrase)}\r\n`
    : `#!/bin/sh\necho '${escapeForShell(passphrase)}'\n`;

  // 'wx' fails if the path exists, and the mode applies at creation time.
  const handle = fs.openSync(scriptPath, 'wx', isWindows ? 0o600 : 0o700);
  try {
    fs.writeFileSync(handle, script, 'utf8');
  } finally {
    fs.closeSync(handle);
  }

  let cleanedUp = false;

  return {
    envOverrides: {
      // Never fall back to an interactive prompt: the server has no terminal,
      // so a prompt would hang the request until it timed out.
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: scriptPath,
      SSH_ASKPASS: scriptPath,
      // ssh only consults SSH_ASKPASS when it believes it has no terminal,
      // which it infers from DISPLAY being set on platforms that use it.
      DISPLAY: 'multi-git'
    },
    cleanup: () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      removeDirectory(directory);
      liveBridges.delete(directory);
    }
  };
}
