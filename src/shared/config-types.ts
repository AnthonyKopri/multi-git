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
}

export interface AppSettings {
  /** Whether Multi-Git maintains its managed block in ~/.ssh/config. */
  manageSshConfig: boolean;
  /**
   * How long a Safety Net recovery point is kept, in days. 0 keeps them until
   * they are removed by hand. Absent means the built-in default.
   */
  recoveryRetentionDays?: number;
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
}
