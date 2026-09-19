// The terminal edition's installation, as the desktop's Settings shows it.

/**
 * - `unavailable`: this desktop build carries no terminal edition (a
 *   development run), and none is installed.
 * - `not-installed`: nothing installed; enabling would install the bundled one.
 * - `ready`: installed, and `multi-git` in a new terminal runs it.
 * - `reopen-terminal`: installed, but terminals opened before now do not see it.
 * - `shadowed`: installed, but another `multi-git` comes first on PATH.
 * - `damaged`: the installation is incomplete; repairing reinstalls it.
 */
export type TerminalState =
  | 'unavailable'
  | 'not-installed'
  | 'ready'
  | 'reopen-terminal'
  | 'shadowed'
  | 'damaged';

export interface TerminalInstallationStatus {
  state: TerminalState;
  /** One sentence for the user, saying what the state means for them. */
  message: string;
  /** The version inside this desktop build; null when it carries none. */
  bundledVersion: string | null;
  installedVersion: string | null;
  /** True when enabling would install a newer version than the installed one. */
  canUpgrade: boolean;
  /** The per-user folder the terminal edition lives in. */
  location: string;
  /** The launcher `multi-git` should resolve to. */
  command: string;
  /** What `multi-git` resolves to in a new terminal, or null when nothing does. */
  resolvedCommand: string | null;
  /** What enabling would change, in words, shown before anything is changed. */
  plannedChanges: string[];
  /** The first-run choice, remembered so the question is asked once. */
  setupChoice: 'enabled' | 'skipped' | null;
  /** An MCP client entry that starts `multi-git mcp`, as JSON. Null until installed. */
  mcpConfig: string | null;
  /** Where the agent skills are, for pointing an agent at them. Null until installed. */
  skillsPath: string | null;
}
