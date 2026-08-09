// The contract the preload script exposes to the renderer.
//
// contextIsolation is on, so the renderer never touches Electron directly;
// this is the entire surface between the two. Both sides import this type, so
// adding a channel on one side without the other is a compile error.
//
// Three of the methods below start a program. They are here, rather than on
// the HTTP API, on purpose: the loopback server answers anything on this
// machine that can reach the port, and "run this executable" is not a
// capability that should be reachable that way. The main process validates
// every path it is handed, and no channel accepts an executable name — the
// launcher only ever runs a definition already saved in the configuration.

import type { SshAgentRepairResult } from './ssh-agent-types';
import type { AgentLaunchInput, AgentLaunchResult } from './agent-types';

export interface DesktopApi {
  /** Opens the native folder picker. Resolves to '' when cancelled. */
  selectFolder: () => Promise<string>;
  /** Opens (or focuses) the Terminal Log window. */
  openLogWindow: () => Promise<void>;
  /**
   * Enables and starts the Windows OpenSSH Authentication Agent service.
   *
   * Takes no arguments, on purpose. The command it runs is a compile-time
   * constant in the main process: a handler that accepted a command from the
   * renderer would be an arbitrary-code-execution primitive behind a UAC
   * prompt the user has already been trained to approve.
   */
  repairSshAgent: () => Promise<SshAgentRepairResult>;

  /**
   * Opens a repository or worktree in its own window, or focuses the window
   * already showing it.
   */
  openRepoWindow: (repoPath: string) => Promise<boolean>;
  /** True when a window is already open for this path. */
  hasRepoWindow: (repoPath: string) => Promise<boolean>;
  /** Paths of every open window, for the "already open elsewhere" hint. */
  listRepoWindows: () => Promise<string[]>;
  /**
   * Tells the main process which repository this window now shows.
   *
   * Called whenever the renderer opens one. Without it the window opened at
   * launch stays registered under no repository, and "Open in new window" for
   * the repository it is actually showing would open a duplicate.
   */
  claimRepoWindow: (repoPath: string) => Promise<void>;

  /** Opens the platform terminal with the folder as its working directory. */
  openTerminalHere: (repoPath: string) => Promise<boolean>;
  /** Opens the folder in the configured editor, or the system default. */
  openEditor: (repoPath: string) => Promise<boolean>;
  /** Starts a configured external agent in a worktree. */
  launchAgent: (input: AgentLaunchInput) => Promise<AgentLaunchResult>;
}

/** IPC channel names, shared so main and preload cannot drift apart. */
export const IPC_CHANNELS = {
  selectFolder: 'app:select-folder',
  openLogWindow: 'app:open-log-window',
  repairSshAgent: 'ssh:repair-agent',
  openRepoWindow: 'window:open-repo',
  hasRepoWindow: 'window:has-repo',
  listRepoWindows: 'window:list-repos',
  claimRepoWindow: 'window:claim-repo',
  openTerminalHere: 'tool:open-terminal',
  openEditor: 'tool:open-editor',
  launchAgent: 'agent:launch'
} as const;

declare global {
  interface Window {
    /** Present only in the Electron desktop app, absent in browser mode. */
    desktopApi?: DesktopApi;
  }
}
