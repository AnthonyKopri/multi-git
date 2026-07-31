// Opens the default browser at the local server URL in browser mode.
import os from 'node:os';
import { spawn } from 'node:child_process';

export function openUrlInBrowser(url: string): void {
  // The URL is constructed from a port number this process chose, so it is
  // never attacker-influenced. It still goes through an argument vector with
  // no shell, rather than the string `start <url>` the previous code passed
  // to exec.
  let command: string;
  let args: string[];

  if (os.platform() === 'win32') {
    // "start" is a cmd builtin, not an executable; the empty string is the
    // window title cmd otherwise consumes the URL for.
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (os.platform() === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    });

    child.on('error', (error: Error) => {
      console.warn(`Could not open a browser automatically: ${error.message}`);
      console.warn(`Open ${url} manually.`);
    });

    child.unref();
  } catch (error) {
    console.warn(`Could not open a browser automatically: ${(error as Error).message}`);
  }
}
