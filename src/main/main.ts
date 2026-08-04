// Electron lifecycle: start the local backend, then show the window.
import type { Server } from 'node:http';
import { BrowserWindow, app, ipcMain } from 'electron';

import { startServer } from '../server/index';
import { repairSshAgentElevated } from './ssh-agent-elevation';
import { IPC_CHANNELS } from '../shared/desktop-api';
import {
  createLogWindow,
  createMainWindow,
  createStartupFailureWindow,
  selectFolder
} from './windows';

let mainWindow: BrowserWindow | null = null;
let logWindow: BrowserWindow | null = null;
let backendServer: Server | null = null;
let serverUrl = 'http://localhost:3000';

// Windows uses this ID to associate windows with the packaged executable and
// its embedded icon rather than with the Electron host process.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.multigit.client');
}

function showMainWindow(): void {
  mainWindow = createMainWindow(serverUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
    // The log window is a companion of the main window, not a reason to keep
    // the app alive on its own.
    if (logWindow && !logWindow.isDestroyed()) {
      logWindow.close();
    }
  });
}

function openLogWindow(): void {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return;
  }

  logWindow = createLogWindow(serverUrl);
  logWindow.on('closed', () => {
    logWindow = null;
  });
}

async function startApp(): Promise<void> {
  ipcMain.handle(IPC_CHANNELS.selectFolder, () => selectFolder(mainWindow));
  ipcMain.handle(IPC_CHANNELS.openLogWindow, () => {
    openLogWindow();
  });
  // Deliberately ignores every argument the renderer sends. The command it
  // runs is a constant; see src/main/ssh-agent-elevation.ts.
  ipcMain.handle(IPC_CHANNELS.repairSshAgent, () => repairSshAgentElevated());

  try {
    // Port 0 asks the OS for a free port, so a busy 3000, or a second
    // instance of the app, does not prevent startup.
    backendServer = await startServer({ openBrowser: false, port: 0 });

    const address = backendServer.address();
    const port = typeof address === 'object' && address !== null ? address.port : 3000;
    serverUrl = `http://localhost:${port}`;

    showMainWindow();
  } catch (error) {
    console.error('Failed to boot desktop app:', error);
    mainWindow = createStartupFailureWindow(error);
  }
}

app.on('ready', () => {
  void startApp();
});

app.on('window-all-closed', () => {
  // On macOS applications conventionally stay active until the user quits
  // explicitly with Cmd+Q.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    showMainWindow();
  }
});

app.on('quit', () => {
  backendServer?.close();
  backendServer = null;
});
