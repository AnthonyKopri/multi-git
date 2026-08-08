// Response shapes for the local API, imported by both the server routes and
// the renderer's endpoint functions.
import type {
  BlameLine,
  BranchRefs,
  Commit,
  CommitDetails,
  CommitFile,
  ConflictFileBlock,
  DiffLine,
  PorcelainStatus,
  RemoteProtocol
} from './git-types';
import type { ClientConfig, RepoSettings, VaultStatus } from './config-types';
import type { GitignoreSummary, LicenseSummary } from './template-types';

/** Every successful response carries this. */
export interface Ok {
  success: true;
}

/** Routes that just forward git's output. */
export interface GitOutput extends Ok {
  stdout: string;
  stderr: string;
}

export interface StatusResponse extends Ok, PorcelainStatus {
  isMerging: boolean;
  isRebasing: boolean;
}

export interface LogResponse extends Ok {
  commits: Commit[];
  hasMore: boolean;
}

export interface BranchesResponse extends Ok, BranchRefs {}

export interface DiffResponse extends Ok {
  diff: DiffLine[];
}

export interface BlameResponse extends Ok {
  blame: BlameLine[];
}

export interface FileContentResponse extends Ok {
  content: string;
  size?: number;
  /** Set when the file contains NUL bytes and was not decoded as text. */
  binary?: boolean;
  /** Set when the file exceeded the size cap. */
  truncated?: boolean;
}

export interface FilesResponse extends Ok {
  tracked: string[];
  untracked: string[];
}

export interface CommitDetailsResponse extends Ok {
  commit: CommitDetails;
  files: CommitFile[];
}

export interface FileHistoryResponse extends Ok {
  commits: { hash: string; author: string; date: string; message: string }[];
}

export interface ConflictFileResponse extends Ok {
  rawContent: string;
  blocks: ConflictFileBlock[];
}

/**
 * Merge, rebase, cherry-pick, and revert answer 200 with success:false when
 * git reports conflicts, because a conflict is a workflow state the UI drives
 * rather than a request that failed.
 */
export interface IntegrationResponse {
  success: boolean;
  conflict?: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface SyncResponse extends GitOutput {
  usedAskpass: boolean;
  profileLabel: string | null;
  originRemoteUrl: string;
}

export interface OriginResponse extends Ok {
  remoteUrl: string;
  protocol: RemoteProtocol;
  host: string | null;
  canToggle: boolean;
  suggestedUrl: string | null;
}

export interface StashEntry {
  ref: string;
  message: string;
  date: string;
}

export interface StashListResponse extends Ok {
  stashes: StashEntry[];
}

export interface TagEntry {
  name: string;
  hash: string;
  date: string;
}

export interface TagListResponse extends Ok {
  tags: TagEntry[];
}

export interface CheckpointEntry {
  id: string;
  label: string;
  head: string;
  createdAt: number;
}

export interface CheckpointsResponse extends Ok {
  checkpoints: CheckpointEntry[];
}

export interface TrashEntrySummary {
  id: string;
  path: string;
  savedAt: number;
}

export interface TrashResponse extends Ok {
  entries: TrashEntrySummary[];
}

export interface IdentityResponse extends Ok {
  name: string;
  email: string;
  isLocal: boolean;
}

export interface ConfigResponse extends ClientConfig {}

export interface VaultStatusResponse extends Ok, VaultStatus {
  /** Profile labels whose identities were removed from the agent on lock. */
  unloadedKeys?: string[];
  /** Labels that could not be removed, so the UI can say so rather than lie. */
  unloadFailures?: string[];
}

export interface RepoSettingsResponse extends Ok {
  repoPath: string;
  /** Canonical identity this repository's settings are stored under. */
  repoKey: string;
  repoSettings: RepoSettings;
}

export interface ConfigMutationResponse extends Ok {
  config: ClientConfig;
  warning?: string | null;
}

export interface SshTestResponse {
  success: boolean;
  message: string;
  usedSavedPassword: boolean;
}

export type SshHealthStatus = 'ok' | 'missing' | 'invalid' | 'passphrase' | 'unavailable';

export interface SshHealthResult {
  id: string;
  label: string;
  privateKeyPath: string;
  status: SshHealthStatus;
  message: string;
}

export interface SshValidateAllResponse extends Ok {
  /** True when ssh-keygen itself is missing, so per-profile results are moot. */
  unavailable: boolean;
  results: SshHealthResult[];
}

export interface SshPublicKeyResponse extends Ok {
  publicKeyPath: string;
  publicKey: string;
}

export interface GenerateKeyResponse extends Ok {
  profileId: string;
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
  sshConfigUpdated: boolean;
  sshConfigHost: string | null;
  sshConfigWarning: string | null;
  config: ClientConfig;
}

export interface AppInfoResponse extends Ok {
  /** Product name without the version, e.g. "Multi-Git Client". */
  name: string;
  /** From package.json. Empty only if the manifest carries no version. */
  version: string;
  /** Name and version together, ready to use as a window or tab title. */
  title: string;
}

export interface TemplateCatalogueResponse extends Ok {
  licenses: LicenseSummary[];
  gitignores: GitignoreSummary[];
}

export interface GithubCliResponse extends Ok {
  available: boolean;
  authenticated: boolean;
  account: string | null;
  version: string | null;
}

export interface NewRepoPreflightResponse extends Ok {
  repoPath: string;
  folderExists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  isEmpty: boolean;
  existingLicense: string | null;
  existingGitignore: boolean;
}

export interface CreatedRemote {
  name: string;
  visibility: 'private' | 'public';
  account: string | null;
  remoteUrl: string;
  htmlUrl: string | null;
  convertedToSsh: boolean;
}

export interface NewRepoResponse extends Ok {
  repoPath: string;
  visibility: 'private' | 'public';
  licenseFile: string | null;
  gitignoreWritten: boolean;
  openCustomGitignore: boolean;
  remote: CreatedRemote | null;
  steps: string[];
  warnings: string[];
}

export interface CloneResponse extends GitOutput {
  repoPath: string;
  profileLabel: string | null;
}

export interface SelectFolderResponse extends Ok {
  path: string;
}

export interface LastCommitMessageResponse extends Ok {
  message: string;
}

export interface IgnoreResponse extends Ok {
  rule: string;
}

export interface TrashRestoreResponse extends Ok {
  restoredPath: string;
}

export interface UndoOperationResponse extends GitOutput {
  restoredHead: string;
}

export interface ApplySshConfigResponse extends Ok {
  skipped?: boolean;
  host?: string;
  updated?: boolean;
  removed?: boolean;
  warning?: string | null;
}
