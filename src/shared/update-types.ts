// What the renderer is told about an available update.
//
// The main process owns the release it resolved: which tag, which asset, which
// URL. None of that is in this type, and none of it crosses the bridge. The
// renderer receives a version to display and a phase to render, and sends back
// intent — "download", "install", "skip" — with no arguments at all. A page
// that a crafted repository managed to get script into can therefore ask for
// the update the main process already chose, and nothing else.

/** How the running copy was installed, which decides what gets downloaded. */
export type InstallKind = 'installer' | 'portable' | 'unsupported';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error';

/**
 * The parts of a GitHub release the UI shows.
 *
 * No URL, deliberately. `createMainWindow` sets no `will-navigate` handler and
 * no `setWindowOpenHandler`, so an `<a href>` in the update modal would carry
 * the app window itself off to github.com — into a page with neither the CSP
 * nor the preload. Not putting a link in the payload is what keeps that
 * mistake from being one line of markup away.
 */
export interface UpdateReleaseInfo {
  /** Bare semver, with the `Release_v` prefix already stripped. */
  version: string;
  tag: string;
  name: string;
  /** Release body, as plain text. Rendered with textContent, never as HTML. */
  notes: string;
}

export interface UpdateState {
  phase: UpdatePhase;
  /**
   * False on non-Windows, in browser mode, and when running unpackaged. The
   * renderer shows no update UI at all in that case.
   */
  supported: boolean;
  installKind: InstallKind;
  currentVersion: string;
  latest?: UpdateReleaseInfo;
  /** 0-100 while downloading. */
  percent?: number;
  /** Why the last step failed, for the `error` phase. */
  message?: string;
}

/** The state a window sees before the first check has run. */
export function idleUpdateState(
  currentVersion: string,
  installKind: InstallKind
): UpdateState {
  return {
    phase: 'idle',
    supported: installKind !== 'unsupported',
    installKind,
    currentVersion
  };
}
