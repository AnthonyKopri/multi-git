const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  selectFolder: () => ipcRenderer.invoke('app:select-folder'),
  openLogWindow: () => ipcRenderer.invoke('app:open-log-window')
});
