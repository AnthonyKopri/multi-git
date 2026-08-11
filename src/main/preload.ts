// Minimal bridge between Electron and the web UI.
//
// Everything the renderer can ask the main process to do is listed here.
// Nothing else crosses the boundary: nodeIntegration is off and
// contextIsolation is on, so the page has no access to Node or Electron.
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import { IPC_CHANNELS } from '../shared/desktop-api';
import type { DesktopApi, Unsubscribe } from '../shared/desktop-api';
import type { AgentLaunchInput, AgentLaunchResult } from '../shared/agent-types';
import type { UpdateState } from '../shared/update-types';

/**
 * Bridges a main-to-renderer push onto a plain callback.
 *
 * The IpcRendererEvent never crosses. It carries `sender`, which is a live
 * handle to ipcRenderer itself — handing the page that would give it `send` on
 * every channel, which is the one thing this whole file exists to prevent. Only
 * the structured payload is forwarded.
 *
 * A listener that throws is contained here so a bug in one renderer feature
 * cannot take the channel down for the rest of the session.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => {
    try {
      listener(payload);
    } catch {
      // Delivery continues; the page's own error handling is its business.
    }
  };

  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

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
    }) as Promise<boolean>,

  // A kind, or a saved id. Never an executable — the main process resolves the
  // definition, exactly as it does for agents and bisect commands.
  launchTool: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.launchTool, input) as ReturnType<DesktopApi['launchTool']>,

  shellIntegrationStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.shellIntegrationStatus) as ReturnType<
      DesktopApi['shellIntegrationStatus']
    >,
  // Both take no arguments: what gets written is a constant in the main
  // process, so a renderer cannot influence which keys are touched.
  installShellIntegration: () =>
    ipcRenderer.invoke(IPC_CHANNELS.installShellIntegration) as ReturnType<
      DesktopApi['installShellIntegration']
    >,
  removeShellIntegration: () =>
    ipcRenderer.invoke(IPC_CHANNELS.removeShellIntegration) as ReturnType<
      DesktopApi['removeShellIntegration']
    >,

  getUpdateState: () => ipcRenderer.invoke(IPC_CHANNELS.getUpdateState) as Promise<UpdateState>,
  checkForUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdate) as Promise<UpdateState>,
  // The three below forward no arguments, for the same reason repairSshAgent
  // does. Each ends in a file being written or a program being started, and the
  // release, the asset, the URL and the destination are all decided in the main
  // process. Whatever the page passes is dropped here.
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate) as Promise<void>,
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.installUpdate) as Promise<void>,
  skipUpdateVersion: () => ipcRenderer.invoke(IPC_CHANNELS.skipUpdateVersion) as Promise<void>,

  onUpdateState: (listener) => subscribe<UpdateState>(IPC_CHANNELS.updateState, listener),
  onUpdatePopup: (listener) => subscribe<void>(IPC_CHANNELS.updatePopup, () => listener())
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
