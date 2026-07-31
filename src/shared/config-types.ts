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
  /** Profile chosen for this repository; '' means System SSH. */
  profileId?: string;
  /** Set when the user disabled the discard confirmation for this repository. */
  skipDeleteWarning?: boolean;
}

export interface AppSettings {
  /** Whether Multi-Git maintains its managed block in ~/.ssh/config. */
  manageSshConfig: boolean;
}

export interface AppConfig {
  recentRepos: string[];
  sshProfiles: SshProfile[];
  accountRules: AccountRule[];
  /** Keyed by resolved repository path. */
  repoSettings: Record<string, RepoSettings>;
  settings?: Partial<AppSettings>;
  /** Host to key path, the source of truth the ~/.ssh/config block is rendered from. */
  sshConfigHosts?: Record<string, string>;
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
