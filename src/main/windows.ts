// Window creation for the desktop app.
import { BrowserWindow, dialog } from 'electron';

import { fromAppRoot } from '../server/app-root';

const ICON = (): string => fromAppRoot('Multi Git Logo.ico');

/**
 * Web preferences applied to every window.
 *
 * The renderer loads a local HTTP origin that can drive an API capable of
 * running Git commands, so it gets no Node access at all: the preload bridge
 * is the entire privileged surface.
 */
const SECURE_WEB_PREFERENCES = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true
} as const;

export function createMainWindow(serverUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    title: 'Multi-Git Client',
    icon: ICON(),
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: fromAppRoot('out', 'node', 'main', 'preload.js')
    }
  });

  window.loadURL(serverUrl);
  window.setMenuBarVisibility(false);

  return window;
}

export function createLogWindow(serverUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 720,
    height: 520,
    title: 'Multi-Git - Terminal Log',
    icon: ICON(),
    // The log window is read-only and needs no bridge.
    webPreferences: SECURE_WEB_PREFERENCES
  });

  window.setMenuBarVisibility(false);
  window.loadURL(`${serverUrl}/logs.html`);

  return window;
}

/**
 * Last-resort window shown when the backend could not start, so the app
 * explains itself instead of appearing to do nothing.
 */
export function createStartupFailureWindow(error: unknown): BrowserWindow {
  const window = new BrowserWindow({
    width: 700,
    height: 450,
    title: 'Multi-Git Client - Startup Error',
    icon: ICON(),
    webPreferences: SECURE_WEB_PREFERENCES
  });

  const message =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');

  const html = `
    <html>
      <head><title>Startup Error</title></head>
      <body style="font-family: Segoe UI, sans-serif; margin: 24px; line-height: 1.5;">
        <h2>Failed to start Multi-Git backend</h2>
        <p>The desktop window could not start because the local backend server failed to launch.</p>
        <pre style="background:#f6f8fa; border:1px solid #ddd; padding:12px; white-space:pre-wrap;">${message.replace(
          /</g,
          '&lt;'
        )}</pre>
        <p>Common causes: port 3000 is already in use, or required dependencies are missing.</p>
      </body>
    </html>
  `;

  window.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  return window;
}

/** Opens the native directory picker. Returns '' when cancelled. */
export async function selectFolder(parent: BrowserWindow | null): Promise<string> {
  if (!parent) {
    return '';
  }

  const result = await dialog.showOpenDialog(parent, {
    title: 'Select Repository Folder',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return '';
  }

  return result.filePaths[0] ?? '';
}
