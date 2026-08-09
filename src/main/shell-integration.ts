// Opt-in Windows Explorer context-menu entries.
//
// The only part of this application that writes outside its own configuration,
// so the boundaries are deliberately narrow:
//
//   * HKEY_CURRENT_USER only. No HKLM, so no administrator rights are needed
//     and nothing is changed for other accounts on the machine.
//   * Two keys, both under a name only this application uses. Nothing existing
//     is modified, and no file association is claimed.
//   * Install and remove are both user-triggered, and the exact keys are shown
//     before either runs. Remove deletes precisely what install wrote.
//
// `reg.exe` through the argv-only runner rather than a registry library: it is
// already on every Windows machine, it needs no native module, and every
// argument stays a separate value the way everything else in this codebase
// spawns programs.
import { executableRunner } from '../server/process/runner';
import type { ExecutableRunner } from '../server/process/runner';

/** The two places Explorer looks for a directory's context menu. */
export const CONTEXT_MENU_KEYS = {
  /** Right-clicking a folder. */
  directory: 'HKCU\\Software\\Classes\\Directory\\shell\\MultiGit',
  /** Right-clicking the background of an open folder. */
  background: 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\MultiGit'
} as const;

export interface ShellIntegrationStatus {
  supported: boolean;
  installed: boolean;
  /** The keys that would be written, so they can be shown before writing. */
  keys: string[];
  /** Why it is unavailable, when it is. */
  reason?: string;
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * The command Explorer runs.
 *
 * `%V` is the folder that was right-clicked — the directory itself for a
 * right-click on it, and the open folder for a right-click on the background.
 * `%1` would be wrong for the background case.
 */
function commandFor(executablePath: string): string {
  return `"${executablePath}" "%V"`;
}

export async function readStatus(
  runner: ExecutableRunner = executableRunner
): Promise<ShellIntegrationStatus> {
  const keys = [CONTEXT_MENU_KEYS.directory, CONTEXT_MENU_KEYS.background];

  if (!isWindows()) {
    return {
      supported: false,
      installed: false,
      keys,
      reason: 'Explorer integration is a Windows feature.'
    };
  }

  try {
    await runner.run('reg', ['query', CONTEXT_MENU_KEYS.directory], { timeoutMs: 10_000 });
    return { supported: true, installed: true, keys };
  } catch {
    // A non-zero exit from `reg query` means the key is not there, which is an
    // answer rather than a failure.
    return { supported: true, installed: false, keys };
  }
}

function assertWindows(): void {
  if (!isWindows()) {
    throw new Error('Explorer integration is only available on Windows.');
  }
}

/**
 * Writes the two entries.
 *
 * Four `reg add` calls: a default value naming the menu item, and a `command`
 * subkey holding what to run, for each of the two locations.
 */
export async function install(
  executablePath: string,
  runner: ExecutableRunner = executableRunner
): Promise<ShellIntegrationStatus> {
  assertWindows();

  if (executablePath.trim() === '') {
    throw new Error('The application path could not be determined, so nothing was written.');
  }

  const command = commandFor(executablePath);

  for (const [key, label] of [
    [CONTEXT_MENU_KEYS.directory, 'Open in Multi-Git'],
    [CONTEXT_MENU_KEYS.background, 'Open worktree in Multi-Git']
  ] as const) {
    await runner.run('reg', ['add', key, '/ve', '/d', label, '/f'], { timeoutMs: 10_000 });
    await runner.run('reg', ['add', `${key}\\command`, '/ve', '/d', command, '/f'], {
      timeoutMs: 10_000
    });
  }

  return readStatus(runner);
}

/**
 * Removes exactly what install wrote.
 *
 * `/f` so a key that is already gone is not an error: the user asking to remove
 * something that is not there should get "it is not there", not a failure.
 */
export async function remove(
  runner: ExecutableRunner = executableRunner
): Promise<ShellIntegrationStatus> {
  assertWindows();

  for (const key of [CONTEXT_MENU_KEYS.directory, CONTEXT_MENU_KEYS.background]) {
    try {
      await runner.run('reg', ['delete', key, '/f'], { timeoutMs: 10_000 });
    } catch {
      // Already absent. Deleting the other one still has to be attempted.
    }
  }

  return readStatus(runner);
}
