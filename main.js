const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');

const { startServer } = require('./server.js');

let mainWindow;
let logWindow = null;
let backendServer;
let serverUrl = 'http://localhost:3000';

async function handleSelectFolder() {
  if (!mainWindow) {
    return '';
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Repository Folder',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return '';
  }

  return result.filePaths[0];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    title: 'Multi-Git Client',
    icon: path.join(__dirname, 'public', 'favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the Express server URL
  mainWindow.loadURL(serverUrl);

  // Disable default menu bar
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', function () {
    mainWindow = null;
    // The log window is a companion of the main window, not a reason to keep
    // the app alive on its own.
    if (logWindow && !logWindow.isDestroyed()) {
      logWindow.close();
    }
  });
}

function openLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 720,
    height: 520,
    title: 'Multi-Git - Terminal Log',
    icon: path.join(__dirname, 'public', 'favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  logWindow.setMenuBarVisibility(false);
  logWindow.loadURL(`${serverUrl}/logs.html`);

  logWindow.on('closed', function () {
    logWindow = null;
  });
}

function createStartupFailureWindow(error) {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 450,
    title: 'Multi-Git Client - Startup Error',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const message = error && error.message ? error.message : String(error || 'Unknown error');
  const html = `
    <html>
      <head><title>Startup Error</title></head>
      <body style="font-family: Segoe UI, sans-serif; margin: 24px; line-height: 1.5;">
        <h2>Failed to start Multi-Git backend</h2>
        <p>The desktop window could not start because the local backend server failed to launch.</p>
        <pre style="background:#f6f8fa; border:1px solid #ddd; padding:12px; white-space:pre-wrap;">${message.replace(/</g, '&lt;')}</pre>
        <p>Common causes: port 3000 is already in use, or required dependencies are missing.</p>
      </body>
    </html>
  `;

  mainWindow.loadURL(`data:text/html,${encodeURIComponent(html)}`);
}

async function startApp() {
  ipcMain.handle('app:select-folder', handleSelectFolder);
  ipcMain.handle('app:open-log-window', () => openLogWindow());

  try {
    // Port 0 = let the OS pick a free port, so a busy port 3000 (or a second
    // app instance) doesn't prevent startup.
    backendServer = await startServer({ openBrowser: false, port: 0 });
    serverUrl = `http://localhost:${backendServer.address().port}`;
    createWindow();
  } catch (error) {
    console.error('Failed to boot desktop app:', error);
    createStartupFailureWindow(error);
  }
}

app.on('ready', startApp);

app.on('window-all-closed', function () {
  // On macOS, it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('quit', () => {
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
});
