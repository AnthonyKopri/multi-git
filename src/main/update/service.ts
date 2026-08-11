// The update state machine.
//
// Every effect it has on the world — network, disk, starting a program,
// quitting — arrives as an injected dependency, so the ordering that matters
// can be tested exactly: that the checksum is compared before anything is
// spawned, that a mismatch deletes the file and stops, and that the app does
// not quit if the installer failed to start.
//
// The release this resolved is held here and never handed to the renderer. The
// page asks for "the update"; the main process is the one that knows which.

import path from 'node:path';

import {
  CHECKSUM_ASSET,
  RELEASES_URL,
  assetBasename,
  findAsset,
  lookupChecksum,
  parseChecksumManifest,
  selectUpdate
} from './release-feed';
import type { ReleaseCandidate } from './release-feed';
import { installCommand } from './install-target';
import type { StagedDownload } from './net';
import type { InstallKind, UpdateState } from '../../shared/update-types';
import { idleUpdateState } from '../../shared/update-types';

/** Release notes are shown as text; a novel in the modal helps nobody. */
const MAX_NOTES_CHARS = 2000;

export interface UpdateSettings {
  checkForUpdates: boolean;
  skippedUpdateVersion?: string | undefined;
}

export interface UpdateServiceDeps {
  currentVersion: string;
  installKind: InstallKind;
  /** Where a portable replacement goes: beside the running exe. */
  portableDir: string | null;
  /** Where an installer is staged. */
  tempDir: string;
  fetchJson: (url: string) => Promise<unknown>;
  fetchText: (url: string) => Promise<string>;
  /** Resolves with the download staged, not yet at its destination. */
  downloadToFile: (
    url: string,
    destPath: string,
    onProgress: (percent: number) => void
  ) => Promise<StagedDownload>;
  /** True when the failure was GitHub's hourly limit, which is not an error. */
  isRateLimit: (error: unknown) => boolean;
  /** Starts the downloaded file. Throws if it could not be started. */
  spawnDetached: (file: string, args: string[]) => void;
  quit: () => void;
  broadcastState: (state: UpdateState) => void;
  /** Asks the one chosen window to show the popup. */
  requestPopup: () => void;
  readSettings: () => UpdateSettings;
  writeSkippedVersion: (version: string) => void;
}

export interface UpdateService {
  getState: () => UpdateState;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<UpdateState>;
  skipCurrent: () => Promise<UpdateState>;
}

function describe(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim() === '' ? fallback : message;
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  let state = idleUpdateState(deps.currentVersion, deps.installKind);
  let resolved: ReleaseCandidate | null = null;
  let downloadedPath: string | null = null;
  /** One popup per app run, however many windows are open. */
  let popupShown = false;

  function publish(next: Partial<UpdateState>): UpdateState {
    state = { ...state, ...next };
    deps.broadcastState(state);
    return state;
  }

  function fail(error: unknown, fallback: string): UpdateState {
    return publish({ phase: 'error', message: describe(error, fallback) });
  }

  /** Where the downloaded artifact belongs, per build kind. */
  function destinationFor(basename: string): string {
    if (deps.installKind === 'portable') {
      if (!deps.portableDir) {
        throw new Error('Could not work out where this portable copy lives.');
      }
      return path.join(deps.portableDir, basename);
    }
    return path.join(deps.tempDir, 'multi-git-update', basename);
  }

  async function check(): Promise<UpdateState> {
    if (!state.supported) {
      return state;
    }
    // A check landing mid-download would replace the release under the file
    // already being written for it.
    if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing') {
      return state;
    }
    if (!deps.readSettings().checkForUpdates) {
      return state;
    }

    publish({ phase: 'checking', message: undefined });

    let releases: unknown;
    try {
      releases = await deps.fetchJson(RELEASES_URL);
    } catch (error) {
      // A spent hourly quota is not something the user did or can fix — behind
      // shared egress it may not even have been them. Go quiet and try later
      // rather than putting an error in front of them.
      if (deps.isRateLimit(error)) {
        return publish({ phase: 'idle', message: undefined });
      }
      return fail(error, 'Could not reach GitHub to check for updates.');
    }

    const candidate = selectUpdate({
      releases,
      currentVersion: deps.currentVersion,
      installKind: deps.installKind === 'portable' ? 'portable' : 'installer',
      skippedVersion: deps.readSettings().skippedUpdateVersion
    });

    if (!candidate) {
      resolved = null;
      return publish({ phase: 'up-to-date', latest: undefined, percent: undefined });
    }

    resolved = candidate;
    // A fresh check means a fresh download, even if an older one was staged.
    downloadedPath = null;

    const next = publish({
      phase: 'available',
      percent: undefined,
      message: undefined,
      latest: {
        version: candidate.version,
        tag: candidate.tag,
        name: candidate.name,
        notes: candidate.notes.slice(0, MAX_NOTES_CHARS)
      }
    });

    if (!popupShown) {
      popupShown = true;
      deps.requestPopup();
    }

    return next;
  }

  async function download(): Promise<UpdateState> {
    if (!state.supported || !resolved) {
      return state;
    }
    if (state.phase === 'downloading' || state.phase === 'installing') {
      return state;
    }

    const release = resolved;
    const kind = deps.installKind === 'portable' ? 'portable' : 'installer';
    const basename = assetBasename(kind, release.version);

    let destination: string;
    try {
      destination = destinationFor(basename);
    } catch (error) {
      return fail(error, 'Could not work out where to put the download.');
    }

    const asset = findAsset(release, basename);
    if (!asset) {
      return fail(null, `Release ${release.tag} has no ${basename} to download.`);
    }

    // Fail closed: without the manifest there is nothing to verify against, so
    // the download is refused rather than trusted.
    const checksumAsset = findAsset(release, CHECKSUM_ASSET);
    if (!checksumAsset) {
      return fail(null, `Release ${release.tag} published no ${CHECKSUM_ASSET} to verify against.`);
    }

    publish({ phase: 'downloading', percent: 0, message: undefined });

    let expectedDigest: string;
    try {
      const manifest = parseChecksumManifest(await deps.fetchText(checksumAsset.browser_download_url));
      expectedDigest = lookupChecksum(manifest, basename);
    } catch (error) {
      return fail(error, 'Could not read the release checksums.');
    }

    let staged: StagedDownload;
    try {
      staged = await deps.downloadToFile(asset.browser_download_url, destination, (percent) => {
        if (state.phase === 'downloading') {
          publish({ percent });
        }
      });
    } catch (error) {
      return fail(error, 'The update could not be downloaded.');
    }

    if (staged.sha256.toLowerCase() !== expectedDigest) {
      // The bytes are not the bytes the release published. They are still in
      // staging and have never carried the destination's name, so throwing
      // them away is all that is needed — nothing could have run them.
      try {
        await staged.discard();
      } catch {
        // Reporting the mismatch matters more than the cleanup succeeding.
      }
      return fail(null, 'The downloaded file did not match the release checksum, so it was discarded.');
    }

    // Verified: only now does the file take the name the installer will run.
    try {
      await staged.commit();
    } catch (error) {
      await staged.discard().catch(() => {});
      return fail(error, 'The verified update could not be saved.');
    }

    downloadedPath = destination;
    return publish({ phase: 'ready', percent: 100 });
  }

  async function install(): Promise<UpdateState> {
    if (state.phase !== 'ready' || !downloadedPath) {
      return state;
    }

    publish({ phase: 'installing' });

    const command = installCommand(deps.installKind, downloadedPath);

    try {
      deps.spawnDetached(command.file, command.args);
    } catch (error) {
      // Quitting here would close the app into nothing. Stay open and say so.
      return fail(error, 'The update could not be started.');
    }

    // Only once the new process is running does this one step aside.
    deps.quit();
    return state;
  }

  async function skipCurrent(): Promise<UpdateState> {
    if (!resolved) {
      return state;
    }

    deps.writeSkippedVersion(resolved.version);
    resolved = null;
    downloadedPath = null;
    return publish({ phase: 'up-to-date', latest: undefined, percent: undefined, message: undefined });
  }

  return {
    getState: () => state,
    check,
    download,
    install,
    skipCurrent
  };
}
