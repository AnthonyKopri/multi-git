// Hands a path to the desktop environment.
//
// Both helpers spawn with `shell: false` and detach, so the child outlives the
// request and no shell ever sees the path.
import os from 'node:os';
import { spawn } from 'node:child_process';

function launchDetached(command: string, args: readonly string[]): Promise<true> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    });

    child.on('error', (error: Error) => {
      reject(new Error(`Failed to open location: ${error.message}`));
    });

    child.unref();
    resolve(true);
  });
}

/** Opens a folder in the platform file manager. */
export function openPathInFileExplorer(targetPath: string): Promise<true> {
  if (os.platform() === 'win32') {
    return launchDetached('explorer', [targetPath]);
  }
  if (os.platform() === 'darwin') {
    return launchDetached('open', [targetPath]);
  }
  return launchDetached('xdg-open', [targetPath]);
}

/**
 * Opens a file with whatever application the desktop associates with it.
 *
 * On Windows explorer.exe resolves the association, and shows the "Open with"
 * picker when there is none, which is what extension-less files such as
 * .gitignore normally hit.
 */
export function openPathInDefaultApp(targetPath: string): Promise<true> {
  if (os.platform() === 'win32') {
    return launchDetached('explorer', [targetPath]);
  }
  if (os.platform() === 'darwin') {
    // -t routes through the default *text* editor, so a file with no
    // extension does not land in an unrelated app.
    return launchDetached('open', ['-t', targetPath]);
  }
  return launchDetached('xdg-open', [targetPath]);
}

/**
 * Opens the native folder picker in browser mode on Windows.
 *
 * Desktop mode uses Electron's dialog instead. The script is a constant, but
 * it still runs through spawn with an argument vector rather than exec, so no
 * shell is involved and -NoProfile keeps a user profile script from
 * interfering.
 */
export async function pickFolderWithPowerShell(): Promise<string> {
  const { runProcess } = await import('../process/run');

  const script = [
    "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;",
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
    "$dialog.Description = 'Select Git Repository Folder';",
    '$result = $dialog.ShowDialog();',
    "if ($result -eq 'OK') { Write-Output $dialog.SelectedPath }"
  ].join(' ');

  const result = await runProcess(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
    // No timeout that could fire while the user is still browsing.
    { timeoutMs: 10 * 60 * 1000 }
  );

  if (result.spawnError) {
    throw new Error(`Failed to open file dialog: ${result.spawnError.message}`);
  }

  return result.stdout.trim();
}
