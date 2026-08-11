// Electron lifecycle: start the local backend, then show the windows.
import fs from 'node:fs';
import type { Server } from 'node:http';
import { BrowserWindow, app, dialog, ipcMain, screen } from 'electron';

import { startServer } from '../server/index';
import { repairSshAgentElevated } from './ssh-agent-elevation';
import { IPC_CHANNELS } from '../shared/desktop-api';
import { readConfig, writeConfig } from '../server/config/store';
import { resolveRepoPath } from '../server/middleware/repo-path';
import { launchAgent, openEditorAt, openTerminalAt } from '../server/agents/service';
import { runBisect } from '../server/git/bisect';
import { launchTool } from '../server/tools/launch';
import * as shellIntegration from './shell-integration';
import { createUpdateWiring, startUpdateChecks } from './update/wiring';
import type { UpdateService } from './update/service';
import { WindowRegistry, clampBoundsToDisplays, restorableWindows } from './window-registry';
import type { ManagedWindow } from './window-registry';
import {
  createLogWindow,
  createMainWindow,
  createStartupFailureWindow,
  selectFolder
} from './windows';
import type { AgentLaunchInput } from '../shared/agent-types';
import type { ExternalToolKind } from '../shared/config-types';

let logWindow: BrowserWindow | null = null;
let backendServer: Server | null = null;
let serverUrl = 'http://localhost:3000';
let windows: WindowRegistry | null = null;
let updates: UpdateService | null = null;
let stopUpdateChecks: (() => void) | null = null;

/** True once quit has begun, so a closing window stops rewriting the record. */
let quitting = false;

/**
 * Destinations the user has just chosen in a native Save dialog.
 *
 * `writeTextFile` exists so the renderer can save a patch, and a channel that
 * writes to any path the page names would be a file-write primitive. A path
 * only becomes writable by going through the dialog, and is spent on first use,
 * so one dialog authorises exactly one write.
 */
const rememberedSavePaths = new Set<string>();

async function selectSaveFile(
  parent: BrowserWindow | null,
  options: { suggestedName: string; extension: string }
): Promise<string> {
  const filters = options.extension
    ? [{ name: options.extension.toUpperCase(), extensions: [options.extension] }]
    : [];

  const result = await dialog.showSaveDialog(parent ?? undefined!, {
    ...(options.suggestedName ? { defaultPath: options.suggestedName } : {}),
    filters: [...filters, { name: 'All files', extensions: ['*'] }]
  });

  if (result.canceled || !result.filePath) {
    return '';
  }

  rememberedSavePaths.add(result.filePath);
  return result.filePath;
}

/** True when this path came from a Save dialog. Consumes it either way. */
function consumeSavePath(filePath: string): boolean {
  return rememberedSavePaths.delete(filePath);
}

// Windows uses this ID to associate windows with the packaged executable and
// its embedded icon rather than with the Electron host process.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.multigit.client');
}

/**
 * Persists which windows are open, coalesced.
 *
 * Every move and resize asks for a save, and writing the configuration file on
 * each one would mean hundreds of atomic writes while a window is dragged.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWindowStateSave(): void {
  if (quitting || saveTimer !== null) {
    return;
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveWindowState();
  }, 500);
}

function saveWindowState(): void {
  if (!windows) {
    return;
  }

  try {
    const config = readConfig();
    config.windowState = { windows: windows.snapshot() };
    writeConfig(config);
  } catch (error) {
    // Losing the window layout is not worth failing anything over.
    console.warn('Could not record the open windows:', (error as Error).message);
  }
}

/** Work areas of the attached displays, primary first. */
function displayAreas(): { x: number; y: number; width: number; height: number }[] {
  const primary = screen.getPrimaryDisplay();
  const rest = screen.getAllDisplays().filter((display) => display.id !== primary.id);

  return [primary, ...rest].map((display) => ({ ...display.workArea }));
}

function createRegistry(): WindowRegistry {
  return new WindowRegistry((repoPath: string): ManagedWindow => {
    const window = createMainWindow(serverUrl, repoPath ? { repoPath } : {});
    return window as unknown as ManagedWindow;
  }, scheduleWindowStateSave);
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

/**
 * Reopens the windows that were open at the last quit.
 *
 * Returns false when there was nothing to restore, so the caller falls back to
 * the single window this app has always opened. Bounds are clamped first: a
 * window last closed on a monitor that is no longer attached would otherwise
 * come back somewhere nobody can see it.
 */
function restoreWindows(): boolean {
  const config = readConfig();

  if (config.settings?.restoreWindowsOnStartup === false) {
    return false;
  }

  const areas = displayAreas();
  const records = restorableWindows(config.windowState?.windows ?? [], (repoPath) => {
    try {
      resolveRepoPath(repoPath);
      return true;
    } catch {
      // Deleted, renamed, or on a drive that is not mounted today.
      return false;
    }
  });

  for (const record of records) {
    const options = {
      repoPath: record.repoPath,
      ...(record.bounds ? { bounds: clampBoundsToDisplays(record.bounds, areas) } : {}),
      ...(record.maximized ? { maximized: true } : {})
    };

    const window = createMainWindow(serverUrl, options);
    // Registered by hand so the registry owns a window it did not build,
    // keeping the saved bounds rather than the factory's defaults.
    windows?.adopt(record.repoPath, window as unknown as ManagedWindow);
  }

  return records.length > 0;
}

/** Opens one window on the most recent repository, the way it always did. */
function openInitialWindow(): void {
  const [mostRecent] = readConfig().recentRepos;
  windows?.openOrFocus(mostRecent ?? '');
}

/** Rejects a path the renderer sent that is not an existing repository folder. */
function validatedRepoPath(raw: unknown): string {
  return resolveRepoPath(typeof raw === 'string' ? raw : '');
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.selectFolder, () => selectFolder(BrowserWindow.getFocusedWindow()));
  ipcMain.handle(IPC_CHANNELS.openLogWindow, () => {
    openLogWindow();
  });
  // Deliberately ignores every argument the renderer sends. The command it
  // runs is a constant; see src/main/ssh-agent-elevation.ts.
  ipcMain.handle(IPC_CHANNELS.repairSshAgent, () => repairSshAgentElevated());

  ipcMain.handle(IPC_CHANNELS.openRepoWindow, (_event, repoPath: unknown) => {
    windows?.openOrFocus(validatedRepoPath(repoPath));
    return true;
  });

  ipcMain.handle(
    IPC_CHANNELS.hasRepoWindow,
    (_event, repoPath: unknown) => windows?.find(String(repoPath ?? '')) !== null
  );

  ipcMain.handle(IPC_CHANNELS.listRepoWindows, () => windows?.openPaths() ?? []);

  ipcMain.handle(IPC_CHANNELS.claimRepoWindow, (event, repoPath: unknown) => {
    // The window is taken from the sender, never from the message: a page
    // cannot claim a repository on behalf of a window it does not own.
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (sender) {
      windows?.rekey(sender as unknown as ManagedWindow, validatedRepoPath(repoPath));
    }
  });

  ipcMain.handle(IPC_CHANNELS.openTerminalHere, (_event, repoPath: unknown) =>
    openTerminalAt(validatedRepoPath(repoPath))
  );

  ipcMain.handle(IPC_CHANNELS.openEditor, (_event, repoPath: unknown) =>
    openEditorAt(validatedRepoPath(repoPath))
  );

  ipcMain.handle(IPC_CHANNELS.launchAgent, (_event, input: AgentLaunchInput) => {
    // The worktree is validated; the agent is looked up by id in the saved
    // configuration, so the page never names a program to run.
    const worktreePath = validatedRepoPath(input?.worktreePath);

    return launchAgent({
      repoPath: worktreePath,
      worktreePath,
      agentId: String(input?.agentId ?? ''),
      ...(typeof input?.initialPrompt === 'string' ? { initialPrompt: input.initialPrompt } : {})
    });
  });

  ipcMain.handle(
    IPC_CHANNELS.runBisect,
    async (_event, input: { repoPath?: unknown; commandId?: unknown }) => {
      // Same boundary as launchAgent, and the reason it is not an HTTP route:
      // this starts a program. The repository is validated, and the command is
      // looked up by id in the saved configuration — the page never names one.
      const repoPath = validatedRepoPath(input?.repoPath);
      const commandId = String(input?.commandId ?? '');

      const definition = (readConfig().bisectCommands ?? []).find(
        (candidate) => candidate.id === commandId
      );

      if (!definition) {
        throw new Error('That test command is not one of the saved ones.');
      }

      return runBisect(repoPath, definition);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.selectSaveFile,
    (_event, input: { suggestedName?: unknown; extension?: unknown }) =>
      selectSaveFile(BrowserWindow.getFocusedWindow(), {
        suggestedName: String(input?.suggestedName ?? ''),
        extension: String(input?.extension ?? '')
      })
  );

  ipcMain.handle(
    IPC_CHANNELS.writeTextFile,
    async (_event, input: { filePath?: unknown; contents?: unknown }) => {
      // Only to a path the user just chose in the native Save dialog, which is
      // what `rememberedSavePath` records. A renderer cannot name an arbitrary
      // destination and have it written.
      const filePath = String(input?.filePath ?? '');
      if (!consumeSavePath(filePath)) {
        throw new Error('That destination was not chosen in a Save dialog.');
      }

      await fs.promises.writeFile(filePath, String(input?.contents ?? ''), 'utf8');
      return true;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.launchTool,
    (
      _event,
      input: { repoPath?: unknown; kind?: unknown; toolId?: unknown; placeholders?: unknown }
    ) =>
      launchTool({
        repoPath: validatedRepoPath(input?.repoPath),
        kind: String(input?.kind ?? '') as ExternalToolKind,
        ...(typeof input?.toolId === 'string' ? { toolId: input.toolId } : {}),
        // Each value is resolved against the repository inside launchTool
        // before it becomes an argument.
        placeholders: (input?.placeholders ?? {}) as Record<string, string>
      })
  );

  // The three below take no arguments at all. What gets written is a constant
  // in src/main/shell-integration.ts, so a renderer cannot choose a key.
  ipcMain.handle(IPC_CHANNELS.shellIntegrationStatus, () => shellIntegration.readStatus());

  ipcMain.handle(IPC_CHANNELS.installShellIntegration, async () => {
    const status = await shellIntegration.install(app.getPath('exe'));
    rememberShellIntegration(status.installed);
    return status;
  });

  ipcMain.handle(IPC_CHANNELS.removeShellIntegration, async () => {
    const status = await shellIntegration.remove();
    rememberShellIntegration(status.installed);
    return status;
  });

  // Every update handler below ignores its arguments, like repairSshAgent and
  // the two above. The release, its assets, the URLs and the download
  // destination are resolved in src/main/update/service.ts and never named by
  // the renderer — a channel that accepted any of them would be a
  // download-and-execute primitive reachable from the page.
  ipcMain.handle(IPC_CHANNELS.getUpdateState, () => updates?.getState() ?? null);
  ipcMain.handle(IPC_CHANNELS.checkForUpdate, () => updates?.check() ?? null);
  ipcMain.handle(IPC_CHANNELS.downloadUpdate, async () => {
    await updates?.download();
  });
  ipcMain.handle(IPC_CHANNELS.installUpdate, async () => {
    await updates?.install();
  });
  ipcMain.handle(IPC_CHANNELS.skipUpdateVersion, async () => {
    await updates?.skipCurrent();
  });
}

/**
 * Windows that can show update UI.
 *
 * The Terminal Log window is excluded: it is created without a preload
 * (src/main/windows.ts), so it has no bridge to receive on, and picking it as
 * the popup's target would mean the popup silently going nowhere.
 */
function updateTargetWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(
    (window) => window !== logWindow && !window.isDestroyed()
  );
}

/** Keeps the configuration's record in step with what the registry says. */
function rememberShellIntegration(installed: boolean): void {
  const config = readConfig();
  writeConfig({ ...config, shellIntegration: { contextMenuInstalled: installed } });
}

async function startApp(): Promise<void> {
  registerIpcHandlers();

  try {
    // Port 0 asks the OS for a free port, so a busy 3000, or a second
    // instance of the app, does not prevent startup.
    backendServer = await startServer({ openBrowser: false, port: 0 });

    const address = backendServer.address();
    const port = typeof address === 'object' && address !== null ? address.port : 3000;
    serverUrl = `http://localhost:${port}`;

    windows = createRegistry();

    if (!restoreWindows()) {
      openInitialWindow();
    }

    // After the windows exist, so the first broadcast has somewhere to land.
    updates = createUpdateWiring(updateTargetWindows);
    stopUpdateChecks = startUpdateChecks(updates);
  } catch (error) {
    console.error('Failed to boot desktop app:', error);
    createStartupFailureWindow(error);
  }
}

app.on('ready', () => {
  void startApp();
});

app.on('window-all-closed', () => {
  // The log window is a companion of the repository windows, not a reason to
  // keep the app alive on its own.
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.close();
  }

  // On macOS applications conventionally stay active until the user quits
  // explicitly with Cmd+Q.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (windows && windows.size === 0) {
    openInitialWindow();
  }
});

app.on('before-quit', () => {
  // The last chance to record the layout: by `quit` the windows are gone and
  // their bounds with them.
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveWindowState();
  quitting = true;

  stopUpdateChecks?.();
  stopUpdateChecks = null;
});

app.on('quit', () => {
  backendServer?.close();
  backendServer = null;
});
