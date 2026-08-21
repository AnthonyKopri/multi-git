// Shapes of the on-disk configuration and of the sanitised copy sent to the
// client. Secrets never appear in either: passphrases live in the separate
// vault file, and the client only learns whether one is stored.

export interface SshProfile {
  id: string;
  label: string;
  /** Absolute path to the private key, with `~` already expanded. */
  privateKeyPath: string;
  /** Commit author name applied when this profile is selected. */
  userName?: string;
  /** Commit author email applied when this profile is selected. */
  userEmail?: string;
}

/** An SSH profile as sent to the client, with vault state resolved. */
export interface ClientSshProfile extends SshProfile {
  hasSavedPassword: boolean;
}

/** Selects a profile automatically when the origin URL contains `match`. */
export interface AccountRule {
  id: string;
  match: string;
  profileId: string;
}

export interface RepoSettings {
  /** Whether discarding a file asks for confirmation first. Defaults to true. */
  warnBeforeDelete?: boolean;
  /**
   * SSH profile this repository authenticates with. '' is the System profile.
   *
   * Server-side and per repository, unlike the older localStorage key, so a
   * second window or a fresh install of the app agrees about which account a
   * repository belongs to.
   */
  sshProfileId?: string;
  /** Branches the user pinned to the top of the list, in the order they chose. */
  pinnedBranches?: string[];
}

export interface AppSettings {
  /** Whether Multi-Git maintains its managed block in ~/.ssh/config. */
  manageSshConfig: boolean;
  /**
   * How long a Safety Net recovery point is kept, in days. 0 keeps them until
   * they are removed by hand. Absent means the built-in default.
   */
  recoveryRetentionDays?: number;
  /**
   * Whether the windows open at quit are reopened at the next launch.
   * Defaults to true; with no recorded windows the app opens one, as before.
   */
  restoreWindowsOnStartup?: boolean;
  /**
   * Folder new worktrees are suggested in. Absent means a sibling of the
   * repository named `<repo>.worktrees`.
   */
  worktreeParentDir?: string;
  /**
   * Whether the text of an initial agent prompt is kept in launch history.
   * Defaults to false: a prompt is the most sensitive thing in a launch.
   */
  storeAgentPrompts?: boolean;
  /**
   * Whether a fetch that finds the branch purely behind pulls on its own.
   * Defaults to false; only ever a fast-forward. See `shouldAutoPull`.
   */
  autoPull?: boolean;
}

/** A user-defined set of repositories that are fetched and opened together. */
export interface RepoGroup {
  id: string;
  label: string;
  /** CSS colour for the group's dot. Validated against a small palette. */
  color?: string;
  /** Material symbol name shown beside the label. */
  icon?: string;
  /** Position in the sidebar, ascending. */
  order: number;
  /** Canonical repository identities. See src/server/config/repo-identity.ts. */
  repos: string[];
}

/**
 * An external tool Multi-Git can start in a worktree.
 *
 * Multi-Git launches it and records that the launch happened. It does not
 * install hooks, read the tool's own session state, or report what it is doing:
 * "launched" means the process started, and nothing more is claimed.
 */
export interface ExternalAgentDefinition {
  id: string;
  label: string;
  /** Executable name or absolute path. Never a command line. */
  executable: string;
  /** Argument vector, kept as separate values all the way to spawn. */
  args: string[];
  terminal: 'direct' | 'windows-terminal' | 'powershell';
  enabled: boolean;
  /**
   * How an initial prompt is handed over. `none` means the definition takes no
   * prompt; `argument` appends it as one more argv element.
   */
  promptMode?: 'none' | 'argument';
  /** Extra environment for the launched process, filtered before use. */
  env?: Record<string, string>;
}

/**
 * What an external tool is for.
 *
 * Not decoration: the kind decides which placeholders a definition's arguments
 * may use, and a merge tool's `{base}` is meaningless to a file manager.
 */
export type ExternalToolKind = 'diff' | 'merge' | 'editor' | 'terminal' | 'file-manager';

export const EXTERNAL_TOOL_KINDS: readonly ExternalToolKind[] = [
  'diff',
  'merge',
  'editor',
  'terminal',
  'file-manager'
];

/**
 * A program Multi-Git will hand files or a folder to.
 *
 * Same discipline as {@link ExternalAgentDefinition}: an executable is a name
 * or a path and never a command line, and arguments stay separate strings all
 * the way to spawn. Placeholders are substituted per element, so a path with
 * spaces stays one argument.
 */
export interface ExternalToolDefinition {
  id: string;
  kind: ExternalToolKind;
  label: string;
  /** Executable name or absolute path. Never a command line. */
  executable: string;
  /**
   * Argument template. Each element may contain placeholders — `{local}`,
   * `{remote}`, `{base}`, `{merged}`, `{path}`, `{line}`, `{cwd}` — which are
   * replaced within the element rather than split on.
   */
  args: string[];
  enabled: boolean;
  /** True when this definition came from detection rather than the user. */
  detected?: boolean;
}

/**
 * A command a bisect run may execute to decide good or bad for each step.
 *
 * Stored rather than accepted per request: the HTTP surface takes an id, so
 * nothing reachable over the loopback port can name a program to run.
 */
export interface BisectCommandDefinition {
  id: string;
  label: string;
  executable: string;
  args: string[];
  /**
   * Exit code meaning "skip this commit", which git itself defines as 125.
   * Configurable because not every test runner can avoid using it.
   */
  skipExitCode?: number;
}

/** Whether the opt-in Windows Explorer entries are currently installed. */
export interface ShellIntegrationState {
  contextMenuInstalled: boolean;
}

export interface LfsSettings {
  /**
   * Whether previewing a file may download its LFS object.
   *
   * Defaults to false. An LFS object is large by definition, and opening a
   * folder is not consent to pull a gigabyte over someone's connection.
   */
  autoDownloadPreviews?: boolean;
}

/** One window to reopen at the next launch. */
export interface WindowRecord {
  /** Path of the repository or worktree the window had open. */
  repoPath: string;
  bounds?: { x: number; y: number; width: number; height: number };
  maximized?: boolean;
}

export interface WindowState {
  windows: WindowRecord[];
}

/** One entry in the agent launch history. Prompt text is never included. */
export interface AgentLaunchRecord {
  /** ISO 8601. */
  at: string;
  agentId: string;
  agentLabel: string;
  worktreePath: string;
  /** Whether the launch itself succeeded. Not whether the agent did anything. */
  ok: boolean;
  /** The command as it would read in the Terminal Log, already redacted. */
  commandPreview: string;
  pid?: number;
  error?: string;
}

export interface AppConfig {
  /**
   * Schema version of the file on disk. 0 is any file written before
   * versioning existed; see src/server/config/migrations.ts.
   */
  configVersion: number;
  recentRepos: string[];
  sshProfiles: SshProfile[];
  accountRules: AccountRule[];
  /**
   * Keyed by canonical repository identity, not by the path the user typed.
   * See src/server/config/repo-identity.ts.
   */
  repoSettings: Record<string, RepoSettings>;
  settings?: Partial<AppSettings>;
  /** Host to key path, the source of truth the ~/.ssh/config block is rendered from. */
  sshConfigHosts?: Record<string, string>;
  repoGroups?: RepoGroup[];
  externalAgents?: ExternalAgentDefinition[];
  windowState?: WindowState;
  /** Newest first, capped. See MAX_AGENT_LAUNCHES. */
  agentLaunches?: AgentLaunchRecord[];
  externalTools?: ExternalToolDefinition[];
  /**
   * Tool kinds whose definition the user has confirmed.
   *
   * Detection fills in definitions from what is on the machine, which is a
   * guess about both the program and its argument template. The first time a
   * kind is actually used the guess is shown and confirmed; this records that
   * it was, so it is asked once rather than every time.
   */
  toolsConfirmed?: Partial<Record<ExternalToolKind, boolean>>;
  bisectCommands?: BisectCommandDefinition[];
  shellIntegration?: ShellIntegrationState;
  lfs?: LfsSettings;
  /**
   * Sections written by a newer build than this one. Preserved untouched so a
   * downgrade does not discard them.
   */
  [unknownSection: string]: unknown;
}

export interface VaultStatus {
  hasVault: boolean;
  unlocked: boolean;
}

/** The payload GET /api/config returns. */
export interface ClientConfig {
  recentRepos: string[];
  sshProfiles: ClientSshProfile[];
  accountRules: AccountRule[];
  repoSettings: Record<string, RepoSettings>;
  vaultStatus: VaultStatus;
  settings: AppSettings;
  repoGroups: RepoGroup[];
  externalAgents: ExternalAgentDefinition[];
  agentLaunches: AgentLaunchRecord[];
  externalTools: ExternalToolDefinition[];
  toolsConfirmed: Partial<Record<ExternalToolKind, boolean>>;
  bisectCommands: BisectCommandDefinition[];
  shellIntegration: ShellIntegrationState;
  lfs: LfsSettings;
}
