// The only Electron-aware part of updating.
//
// Builds the service's dependencies out of `app` and `BrowserWindow`, decides
// which window gets the popup, and schedules the checks. Everything with a
// decision in it lives in the modules this imports, which is what makes those
// testable without an Electron build.

import { spawn } from 'node:child_process';

import { app, BrowserWindow } from 'electron';

import { createUpdateService } from './service';
import type { UpdateService, UpdateSettings } from './service';
import { detectInstallKind, portableDirectory } from './install-target';
import type { InstallEnvironment } from './install-target';
import {
  RateLimitedError,
  downloadToFile,
  fetchJson,
  fetchText,
  fileSinkFactory,
  httpsFetcher
} from './net';
import { readConfig, writeConfig } from '../../server/config/store';
import { appVersion } from '../../server/app-root';
import { IPC_CHANNELS } from '../../shared/desktop-api';
import type { UpdateState } from '../../shared/update-types';

/** Long enough that a check never competes with opening the first window. */
const FIRST_CHECK_DELAY_MS = 10_000;
/** Four checks a day, against an unauthenticated limit of sixty an hour. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function environment(): InstallEnvironment {
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    env: process.env
  };
}

function readUpdateSettings(): UpdateSettings {
  const settings = readConfig().settings;
  return {
    // Opt-out, not opt-in: the default is to check.
    checkForUpdates: settings?.checkForUpdates !== false,
    ...(settings?.skippedUpdateVersion !== undefined
      ? { skippedUpdateVersion: settings.skippedUpdateVersion }
      : {})
  };
}

function writeSkippedVersion(version: string): void {
  const config = readConfig();
  writeConfig({
    ...config,
    settings: { ...(config.settings ?? { manageSshConfig: false }), skippedUpdateVersion: version }
  });
}

/** Supplies the windows that can show update UI. Excludes the log window. */
export type TargetWindows = () => BrowserWindow[];

/** Every window, so each navbar's icon agrees with the others. */
function broadcastState(targets: TargetWindows, state: UpdateState): void {
  for (const window of targets()) {
    window.webContents.send(IPC_CHANNELS.updateState, state);
  }
}

/**
 * One window, so one popup.
 *
 * The focused window when it is one of the targets, otherwise the first still
 * open. Sending to all of them would put an identical modal in front of every
 * repository the user has open; sending to the focused window unconditionally
 * would sometimes mean the Terminal Log window, which has no preload and would
 * swallow the popup entirely.
 */
function requestPopup(targets: TargetWindows): void {
  const windows = targets();
  const focused = BrowserWindow.getFocusedWindow();
  const target = focused && windows.includes(focused) ? focused : windows[0];

  if (target) {
    target.webContents.send(IPC_CHANNELS.updatePopup);
  }
}

export function createUpdateWiring(targets: TargetWindows): UpdateService {
  const installKind = detectInstallKind(environment());

  return createUpdateService({
    currentVersion: appVersion(),
    installKind,
    portableDir: portableDirectory(environment()),
    tempDir: app.getPath('temp'),
    fetchJson: (url) => fetchJson(url, httpsFetcher),
    fetchText: (url) => fetchText(url, httpsFetcher),
    downloadToFile: (url, destPath, onProgress) =>
      downloadToFile(url, destPath, {
        fetcher: httpsFetcher,
        openSink: fileSinkFactory,
        onProgress
      }),
    isRateLimit: (error) => error instanceof RateLimitedError,
    // Detached and unref'd: the installer has to outlive the process that
    // started it, because the next thing that happens is this one quitting.
    spawnDetached: (file, args) => {
      const child = spawn(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false
      });
      child.unref();
    },
    // app.quit(), never app.exit(): `before-quit` is where main.ts flushes the
    // window layout, and exit() would silently discard it on every update.
    quit: () => app.quit(),
    broadcastState: (state) => broadcastState(targets, state),
    requestPopup: () => requestPopup(targets),
    readSettings: readUpdateSettings,
    writeSkippedVersion
  });
}

/** Starts the background schedule. Returns a stop function for quit. */
export function startUpdateChecks(service: UpdateService): () => void {
  if (!service.getState().supported) {
    return () => {};
  }

  const runCheck = (): void => {
    void service.check().catch(() => {
      // check() already reports failure through the state; an unhandled
      // rejection here would only add noise to the console.
    });
  };

  // Both unref'd: a pending update check must never be the reason the process
  // is still alive after the last window closes.
  const first = setTimeout(runCheck, FIRST_CHECK_DELAY_MS);
  first.unref();
  const repeat = setInterval(runCheck, CHECK_INTERVAL_MS);
  repeat.unref();

  return () => {
    clearTimeout(first);
    clearInterval(repeat);
  };
}
