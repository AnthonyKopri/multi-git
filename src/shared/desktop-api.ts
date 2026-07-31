// The contract the preload script exposes to the renderer.
//
// contextIsolation is on, so the renderer never touches Electron directly;
// this is the entire surface between the two. Both sides import this type, so
// adding a channel on one side without the other is a compile error.

export interface DesktopApi {
  /** Opens the native folder picker. Resolves to '' when cancelled. */
  selectFolder: () => Promise<string>;
  /** Opens (or focuses) the Terminal Log window. */
  openLogWindow: () => Promise<void>;
}

/** IPC channel names, shared so main and preload cannot drift apart. */
export const IPC_CHANNELS = {
  selectFolder: 'app:select-folder',
  openLogWindow: 'app:open-log-window'
} as const;

declare global {
  interface Window {
    /** Present only in the Electron desktop app, absent in browser mode. */
    desktopApi?: DesktopApi;
  }
}
