// Which operating system the interface is being shown on.
//
// Read from the user agent rather than asked of the server: the answer is
// wanted synchronously while markup is being built, and the server and the
// window are on the same machine in both the desktop app and browser mode.

/** True on Windows. */
export function isWindowsHost(): boolean {
  return navigator.userAgent.includes('Windows');
}

/** True on macOS, where Cmd stands in for Ctrl. */
export function isMacHost(): boolean {
  return /Macintosh|Mac OS X/.test(navigator.userAgent);
}
