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
  | 'KEY_MISSING'
  | 'PROFILE_NOT_FOUND'
  | 'FINGERPRINT_MISMATCH'
  | 'LOAD_FAILED'
  | 'NOT_SESSION_OWNED';

export interface SshAgentRepairResult {
  success: boolean;
  /** True when the user dismissed the elevation prompt. Not an error. */
  cancelled: boolean;
  message: string;
}
