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
  openLogWindow: () => ipcRenderer.invoke(IPC_CHANNELS.openLogWindow) as Promise<void>,
  // No arguments are forwarded. Whatever the page passes is dropped here, so
  // the elevated command in the main process cannot be influenced from a
  // renderer that a crafted repository managed to get script into.
  repairSshAgent: () =>
    ipcRenderer.invoke(IPC_CHANNELS.repairSshAgent) as ReturnType<DesktopApi['repairSshAgent']>
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
