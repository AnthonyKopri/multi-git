// Minimal bridge between Electron and the web UI.
//
// Everything the renderer can ask the main process to do is listed here.
// Nothing else crosses the boundary: nodeIntegration is off and
// contextIsolation is on, so the page has no access to Node or Electron.
import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../shared/desktop-api';
import type { DesktopApi } from '../shared/desktop-api';
import type { AgentLaunchInput, AgentLaunchResult } from '../shared/agent-types';

const desktopApi: DesktopApi = {
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectFolder) as Promise<string>,
  openLogWindow: () => ipcRenderer.invoke(IPC_CHANNELS.openLogWindow) as Promise<void>,
  // No arguments are forwarded. Whatever the page passes is dropped here, so
  // the elevated command in the main process cannot be influenced from a
  // renderer that a crafted repository managed to get script into.
  repairSshAgent: () =>
    ipcRenderer.invoke(IPC_CHANNELS.repairSshAgent) as ReturnType<DesktopApi['repairSshAgent']>,

  // The path arguments below are forwarded, and every one of them is
  // re-validated in the main process before it is used. This side coerces to a
  // string so a non-string cannot reach a handler expecting one, but it is not
  // the check that matters — the renderer is not trusted.
  openRepoWindow: (repoPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.openRepoWindow, String(repoPath)) as Promise<boolean>,
  hasRepoWindow: (repoPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.hasRepoWindow, String(repoPath)) as Promise<boolean>,
  listRepoWindows: () => ipcRenderer.invoke(IPC_CHANNELS.listRepoWindows) as Promise<string[]>,
  claimRepoWindow: (repoPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.claimRepoWindow, String(repoPath)) as Promise<void>,

  openTerminalHere: (repoPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.openTerminalHere, String(repoPath)) as Promise<boolean>,
  openEditor: (repoPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.openEditor, String(repoPath)) as Promise<boolean>,
  // Carries an agent id, not an executable: the main process looks the
  // definition up in the saved configuration, so the page cannot name a
  // program to run.
  launchAgent: (input: AgentLaunchInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.launchAgent, input) as Promise<AgentLaunchResult>,

  // Same shape as launchAgent, for the same reason: a saved definition's id,
  // never a command line.
  runBisect: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.runBisect, {
      repoPath: String(input?.repoPath ?? ''),
      commandId: String(input?.commandId ?? '')
    }) as ReturnType<DesktopApi['runBisect']>,

  selectSaveFile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.selectSaveFile, {
      suggestedName: String(input?.suggestedName ?? ''),
      extension: String(input?.extension ?? '')
    }) as Promise<string>,
  writeTextFile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeTextFile, {
      filePath: String(input?.filePath ?? ''),
      contents: String(input?.contents ?? '')
    }) as Promise<boolean>
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
