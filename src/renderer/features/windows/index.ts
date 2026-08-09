// Opening a repository or worktree in a window of its own.
//
// Two environments, one behaviour. In the desktop app the main process owns a
// registry keyed by canonical repository identity, so asking twice focuses the
// window that already exists. In a browser there is no window to control, but
// a named target does the same job: `window.open(url, name)` reuses the tab
// with that name instead of opening another. Neither pretends to be the other.
import { canonicalWindowName } from './name';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { errorMessage } from '../../api/client';

/** True in the Electron app, false in a browser tab. */
export function isDesktop(): boolean {
  return typeof window.desktopApi?.openRepoWindow === 'function';
}

export async function openRepoInNewWindow(repoPath: string): Promise<void> {
  if (!repoPath) {
    return;
  }

  if (isDesktop()) {
    try {
      await window.desktopApi?.openRepoWindow?.(repoPath);
    } catch (error) {
      const message = errorMessage(error, 'Could not open that folder in a new window.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 6000);
    }
    return;
  }

  // A named target focuses an existing tab rather than duplicating it, which
  // is the honest browser equivalent of focusing a window.
  const opened = window.open(
    `/?repo=${encodeURIComponent(repoPath)}`,
    canonicalWindowName(repoPath)
  );

  if (!opened) {
    showToast('Your browser blocked the new tab. Allow pop-ups for this page to use this.', 'warn', 7000);
  }
}

/** Paths that already have a window, so the UI can say so. */
export async function openWindowPaths(): Promise<string[]> {
  if (!isDesktop()) {
    return [];
  }

  try {
    return (await window.desktopApi?.listRepoWindows?.()) ?? [];
  } catch {
    return [];
  }
}
