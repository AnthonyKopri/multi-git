// Minimal bridge between Electron and the web UI.
//
// Everything the renderer can ask the main process to do is listed here.
// Nothing else crosses the boundary: nodeIntegration is off and
// contextIsolation is on, so the page has no access to Node or Electron.
import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../shared/desktop-api';
import type { DesktopApi } from '../shared/desktop-api';

const desktopApi: DesktopApi = {
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectFolder) as Promise<string>,
  openLogWindow: () => ipcRenderer.invoke(IPC_CHANNELS.openLogWindow) as Promise<void>
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
