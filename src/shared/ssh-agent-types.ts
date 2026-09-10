// What the renderer knows about the native SSH agent.
//
// The distinction that matters throughout: an agent that answers with "no
// identities" is *working*. `ssh-add -l` reports that as exit code 1, which is
// easy to read as failure and is the reason the old code could not tell "your
// key is not loaded" from "there is no agent at all". Those need different
// words and a different button, so they are different states here.

export type SshAgentAvailability =
  /** Reachable. It may or may not hold the selected key. */
  | 'ready'
  /** The service exists and is startable, but is not running. */
  | 'stopped'
  /** The service exists but its start type is Disabled; starting it fails. */
  | 'disabled'
  /** No agent service, or no ssh-add binary, on this machine. */
  | 'missing'
  /** Present and apparently startable, yet nothing answers. */
  | 'unreachable';

/**
 * The values `process.platform` can take.
 *
 * Spelled out rather than reusing `NodeJS.Platform`: this module is imported
 * by the renderer, which compiles with no Node types at all. The union is
 * identical, so assigning `process.platform` to it still type-checks on the
 * server side.
 */
export type HostPlatform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd';

export interface SshAgentKey {
  /** `SHA256:…`, as ssh-add and ssh-keygen print it. */
  fingerprint: string;
  comment?: string;
  /**
   * Whether this Multi-Git process loaded it.
   *
   * Only session-owned identities are unloaded automatically. A key another
   * tool put in the agent is not ours to remove.
   */
  source: 'multi-git-session' | 'pre-existing';
}

export interface SshAgentState {
  platform: HostPlatform;
  availability: SshAgentAvailability;
  /** Windows service name, when there is one. */
  serviceName?: string;
  /** POSIX: SSH_AUTH_SOCK points at something. Windows: the pipe answered. */
  socketPresent: boolean;
  keys: SshAgentKey[];
  selectedProfileId?: string;
  selectedFingerprint?: string;
  selectedKeyLoaded: boolean;
  /** Whether fixing this needs an elevated prompt the user must approve. */
  repairRequiresElevation: boolean;
  /** One sentence naming the problem and what to do. Never carries secrets. */
  diagnostic?: string;
}

export interface SshAgentStatusResponse {
  success: true;
  agent: SshAgentState;
}

export interface SshAgentLoadResponse {
  success: boolean;
  agent: SshAgentState;
  /** Set when the key could not be loaded. Safe to show verbatim. */
  error?: string;
  /** Typed reason, so the UI can choose an action rather than parse prose. */
  code?: SshAgentErrorCode;
}

export type SshAgentErrorCode =
  | 'AGENT_UNAVAILABLE'
  | 'REPAIR_REQUIRED'
  | 'VAULT_LOCKED'
  | 'PASSPHRASE_REQUIRED'
  /** A passphrase was supplied and ssh-add did not accept it. Worth retrying. */
  | 'PASSPHRASE_REJECTED'
  | 'KEY_MISSING'
  | 'PROFILE_NOT_FOUND'
  | 'FINGERPRINT_MISMATCH'
  | 'LOAD_FAILED'
  | 'NOT_SESSION_OWNED';

/** Why one profile's key did or did not reach the agent in a bulk load. */
export type SshAgentBulkOutcome =
  /** It was already there — another window, another tool, or an earlier load. */
  | 'already-loaded'
  /** Loaded by this request. */
  | 'loaded'
  /** Passphrase-protected, and the vault is locked so the saved one is unreachable. */
  | 'vault-locked'
  /** Passphrase-protected, and nothing is saved for it. Needs the user to type it. */
  | 'passphrase-required'
  /** The key file is not where the profile says it is. */
  | 'key-missing'
  /** ssh-add refused it for some other reason. */
  | 'failed';

export interface SshAgentBulkEntry {
  profileId: string;
  label: string;
  outcome: SshAgentBulkOutcome;
  /** Present for the failing outcomes. Safe to show verbatim. */
  error?: string;
}

export interface SshAgentBulkLoadResponse {
  success: boolean;
  agent: SshAgentState;
  entries: SshAgentBulkEntry[];
  /** Set when nothing could be attempted at all, such as an unreachable agent. */
  error?: string;
  code?: SshAgentErrorCode;
}

export interface SshAgentRepairResult {
  success: boolean;
  /** True when the user dismissed the elevation prompt. Not an error. */
  cancelled: boolean;
  message: string;
}

// ---------- account verification ----------

/** Why a verification did not produce an account name. */
export type SshVerifyFailure =
  /** No ssh binary could be resolved on this machine. */
  | 'no-binary'
  /** ssh wanted a passphrase or a host-key answer that BatchMode refused. */
  | 'prompted'
  /** The host rejected every identity offered. */
  | 'refused'
  | 'timeout'
  /** Authenticated, but the host's greeting named no account. */
  | 'unparsed';

/**
 * What the remote says about who just authenticated.
 *
 * The point of asking rather than assuming: a pin can be syntactically perfect
 * and still authenticate as the wrong account, and the error the host then
 * returns — `ERROR: Repository not found.` — names the wrong problem entirely.
 */
export interface SshIdentityCheck {
  /** Whether authentication succeeded at all. */
  ok: boolean;
  /** The account the host greeted, when it named one. */
  account: string | null;
  /** The account the remote URL implies. Null when there is no usable remote. */
  expected: string | null;
  /** True only when both are known and they disagree. */
  mismatch: boolean;
  reason?: SshVerifyFailure;
  /** One sentence worth showing verbatim. Never carries a key or passphrase. */
  message: string;
}

// ---------- existing repository setup ----------

/** How a repository's `core.sshCommand` got there. */
export type RepoPinOrigin = 'none' | 'multi-git' | 'user';

/**
 * What a repository is currently configured to do, for the confirmation shown
 * before changing it.
 *
 * Reading this before a write is what turns "the app silently did something to
 * my .git/config" into a decision the user made.
 */
export interface RepoAccountSetup {
  pinOrigin: RepoPinOrigin;
  /** The raw core.sshCommand value, when there is one. */
  pinValue: string | null;
  /** The key path the pin names, when it names one. */
  pinKeyPath: string | null;
  /** The profile that key belongs to, when it belongs to one. */
  pinProfileId: string | null;
  pinProfileLabel: string | null;
  /** Repository-local identity. Null means it inherits the global one. */
  localName: string | null;
  localEmail: string | null;
  /** What git would actually use, local or inherited. */
  effectiveName: string | null;
  effectiveEmail: string | null;
  originRemoteUrl: string | null;
  /** Owner segment of the remote, e.g. `akopri-familiara`. */
  originOwner: string | null;
  /**
   * The account this repository should authenticate as.
   *
   * The remote's owner unless the user said otherwise, which they need to for
   * an organisation repository or a fork.
   */
  intendedAccount: string | null;
  /** Whether that came from the user rather than from the remote. */
  intendedIsOverride: boolean;
}
