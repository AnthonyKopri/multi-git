// One typed function per API route.
//
// This is where the shared types earn their keep: a route's response shape is
// declared once in src/shared/api-types.ts, the server returns it, and the
// renderer consumes it. Renaming a field breaks the build on both sides
// instead of producing undefined at runtime.
import { api } from './client';
import type * as Api from '../../shared/api-types';
import type {
  SshAgentBulkLoadResponse,
  SshAgentLoadResponse,
  SshAgentStatusResponse
} from '../../shared/ssh-agent-types';
import type {
  PullRequestCreateInput,
  PullRequestCreateResponse,
  PullRequestPreflightResponse
} from '../../shared/pull-request-types';
import type {
  ApplyPatchResponse,
  DiffFile,
  DiffSource,
  PatchAction
} from '../../shared/diff-types';
import type { RecoveryResponse } from '../../shared/recovery-types';
import type {
  AddRemoteInput,
  RemoteConnectivity,
  RemoteInfo,
  RemoteListResponse,
  RemotePrunePreview,
  UpdateRemoteInput
} from '../../shared/remote-types';
import type {
  AmState,
  ApplyPatchOutcome,
  ApplyPatchRequest,
  PatchPreview,
  PatchRequest
} from '../../shared/patch-types';
import type { BisectSession, BisectVerdict } from '../../shared/bisect-types';
import type {
  LfsInstallAction,
  LfsInstallResponse,
  LfsLock,
  LfsStatusResponse,
  LfsTransferPreview
} from '../../shared/lfs-types';
import type {
  SubmoduleActionResponse,
  SubmoduleInfo,
  SubmoduleListResponse,
  SubmoduleUpdateInput
} from '../../shared/submodule-types';
import type { Commit } from '../../shared/git-types';
import type {
  PublishedBranchWarning,
  RebasePlan,
  RebaseStatus
} from '../../shared/rebase-types';
import type {
  SignatureInfo,
  SigningMode,
  SigningStatusResponse
} from '../../shared/signing-types';
import type {
  CreateWorktreeInput,
  PrunePreviewResponse,
  RemoveWorktreeInput,
  RemoveWorktreeResult,
  WorktreeActionResult,
  WorktreeInfo,
  WorktreeListResponse
} from '../../shared/worktree-types';
import type {
  AgentLaunchRecord,
  BisectCommandDefinition,
  ExternalAgentDefinition,
  ExternalToolDefinition,
  ExternalToolKind,
  RepoGroup
} from '../../shared/config-types';
import type { DetectedTool } from '../../shared/tool-types';
import type { DetectedAgent } from '../../shared/agent-types';

/** Requests that are not about the open repository. */
const global = { repoScoped: false, ignoreRepoGeneration: true } as const;

// ---------- configuration and secrets ----------

export const getConfig = () => api.get<Api.ConfigResponse>('/api/config', global);

export const getVaultStatus = () =>
  api.get<Api.VaultStatusResponse>('/api/secrets/status', global);

export const unlockVault = (masterKey: string) =>
  api.post<Api.VaultStatusResponse>('/api/secrets/unlock', { ...global, body: { masterKey } });

export const lockVault = () =>
  api.post<Api.VaultStatusResponse>('/api/secrets/lock', global);

export const rememberRepo = (repoPath: string) =>
  api.post<Api.ConfigMutationResponse & { repoPath: string; repoKey: string }>(
    '/api/config/repo',
    { ...global, body: { repoPath } }
  );

export const forgetRepo = (repoPath: string) =>
  api.delete<Api.ConfigMutationResponse>('/api/config/repo', { ...global, body: { repoPath } });

export const saveRepoSettings = (repoPath: string, warnBeforeDelete: boolean) =>
  api.post<Api.RepoSettingsResponse>('/api/config/repo-settings', {
    ...global,
    body: { repoPath, warnBeforeDelete }
  });

export const saveAppSettings = (manageSshConfig: boolean, removeManagedBlock: boolean) =>
  api.post<Api.ConfigMutationResponse>('/api/config/settings', {
    ...global,
    body: { manageSshConfig, removeManagedBlock }
  });

// ---------- SSH profiles ----------

export interface SaveProfileInput {
  id?: string;
  label: string;
  privateKeyPath: string;
  userName?: string;
  userEmail?: string;
  keepPassword?: boolean;
  passphrase?: string;
}

export const saveSshProfile = (profile: SaveProfileInput) =>
  api.post<Api.ConfigMutationResponse>('/api/config/ssh', { ...global, body: profile });

export const deleteSshProfile = (id: string) =>
  api.delete<Api.ConfigMutationResponse>('/api/config/ssh', { ...global, body: { id } });

export const testSshKey = (input: { profileId?: string; privateKeyPath?: string; passphrase?: string }) =>
  api.post<Api.SshTestResponse>('/api/config/ssh/test', { ...global, body: input });

export const validateAllSshKeys = () =>
  api.post<Api.SshValidateAllResponse>('/api/config/ssh/validate-all', global);

export const getPublicKey = (input: { profileId?: string; privateKeyPath?: string }) =>
  api.post<Api.SshPublicKeyResponse>('/api/config/ssh/public', { ...global, body: input });

export interface GenerateKeyInput {
  label: string;
  keyType: 'ed25519' | 'rsa';
  passphrase?: string;
  keepPassword?: boolean;
  keyName?: string;
  userName?: string;
  userEmail?: string;
  repoPath?: string;
}

export const generateSshKey = (input: GenerateKeyInput) =>
  api.post<Api.GenerateKeyResponse>('/api/config/ssh/generate', { ...global, body: input });

export const openKeyLocation = (targetPath: string) =>
  api.post<Api.Ok & { openedPath: string }>('/api/config/ssh/open-location', {
    ...global,
    body: { targetPath }
  });

export const applySshConfig = (profileId: string, repoPath: string) =>
  api.post<Api.ApplySshConfigResponse>('/api/config/ssh/apply-ssh-config', {
    ...global,
    body: { profileId, repoPath }
  });

export const addAccountRule = (match: string, profileId: string) =>
  api.post<Api.ConfigMutationResponse>('/api/config/account-rules', {
    ...global,
    body: { match, profileId }
  });

export const deleteAccountRule = (id: string) =>
  api.delete<Api.ConfigMutationResponse>('/api/config/account-rules', {
    ...global,
    body: { id }
  });

// ---------- repository status ----------

export const getStatus = () => api.get<Api.StatusResponse>('/api/git/status');

export const getLog = (limit: number, skip: number, all = true) =>
  api.get<Api.LogResponse>('/api/git/log', { query: { limit, skip, all: all ? '1' : '0' } });

export const getBranches = () => api.get<Api.BranchesResponse>('/api/git/branches');

export const getFiles = () => api.get<Api.FilesResponse>('/api/git/files');

export const getIdentity = () => api.get<Api.IdentityResponse>('/api/git/identity');

export const setIdentity = (name: string, email: string) =>
  api.post<Api.IdentityResponse>('/api/git/identity', { body: { name, email } });

// ---------- staging ----------

export const stage = (files: string[]) =>
  api.post<Api.GitOutput>('/api/git/stage', { body: { files } });

export const unstage = (files: string[]) =>
  api.post<Api.GitOutput>('/api/git/unstage', { body: { files } });

export const ignoreFile = (filePath: string) =>
  api.post<Api.IgnoreResponse>('/api/git/ignore', { body: { filePath } });

export const discard = (filePath: string, isUntracked: boolean) =>
  api.post<Api.Ok>('/api/git/discard', { body: { filePath, isUntracked } });

export const discardAll = (deleteUntracked: boolean) =>
  api.post<Api.Ok>('/api/git/discard-all', { body: { deleteUntracked } });

export const commit = (message: string, amend = false, sign?: boolean) =>
  api.post<Api.GitOutput>('/api/git/commit', { body: { message, amend, sign } });

export const getLastCommitMessage = () =>
  api.get<Api.LastCommitMessageResponse>('/api/git/last-commit-message');

export const undoCommit = () => api.post<Api.GitOutput>('/api/git/undo-commit');

export const getDiff = (path: string, staged: boolean, untracked: boolean) =>
  api.get<Api.DiffResponse>('/api/git/diff', {
    query: { path, staged: staged ? 'true' : 'false', untracked: untracked ? 'true' : 'false' }
  });

// ---------- precision staging ----------

export interface StructuredDiffPayload {
  success: true;
  file: DiffFile | null;
  source: DiffSource;
  untracked: boolean;
  tooLarge: boolean;
  sizeBytes: number;
  limitBytes: number;
}

export type WhitespaceMode = 'show' | 'ignore-change' | 'ignore-all';

export const getStructuredDiff = (
  path: string,
  source: DiffSource,
  force = false,
  whitespace: WhitespaceMode = 'show'
) =>
  api.get<StructuredDiffPayload>('/api/git/diff/structured', {
    query: { path, source, force: force ? 'true' : undefined, whitespace }
  });

export interface BlobSideResult {
  dataUri: string | null;
  sizeBytes: number;
  mimeType: string | null;
  exists: boolean;
}

export const getDiffBlobs = (path: string, source: DiffSource) =>
  api.get<
    Api.Ok & {
      filePath: string;
      isImage: boolean;
      old: BlobSideResult;
      new: BlobSideResult;
      sizeDelta: number;
    }
  >('/api/git/diff/blobs', { query: { path, source } });

export const searchStashes = (query: string) =>
  api.get<
    Api.Ok & {
      query: string;
      stashes: { ref: string; message: string; date: string; matchedFiles: string[] }[];
    }
  >('/api/git/stash/search', { query: { query } });

export interface ApplySelectionInput {
  action: PatchAction;
  filePath: string;
  /** Omit both lists to act on the whole file; an empty list is refused. */
  hunkIds?: string[];
  lineIds?: string[];
}

export const applyDiffSelection = (input: ApplySelectionInput) =>
  api.post<ApplyPatchResponse>('/api/git/diff/apply-selection', { body: input });

// ---------- branches ----------

export const checkout = (branch: string, isRemote: boolean) =>
  api.post<Api.GitOutput>('/api/git/checkout', { body: { branch, isRemote } });

export const createBranch = (branchName: string) =>
  api.post<Api.GitOutput>('/api/git/create-branch', { body: { branchName } });

export const deleteBranch = (branch: string, force: boolean) =>
  api.post<Api.GitOutput>('/api/git/delete-branch', { body: { branch, force } });

export const merge = (branch: string) =>
  api.post<Api.IntegrationResponse>('/api/git/merge', { body: { branch } });

export const rebase = (branch: string) =>
  api.post<Api.IntegrationResponse>('/api/git/rebase', { body: { branch } });

export const abortIntegration = (type: 'merge' | 'rebase') =>
  api.post<Api.GitOutput>('/api/git/abort', { body: { type } });

export const continueIntegration = (type: 'merge' | 'rebase') =>
  api.post<Api.GitOutput>('/api/git/conflict/continue', { body: { type } });

// ---------- conflicts ----------

export const getConflictFile = (path: string) =>
  api.get<Api.ConflictFileResponse>('/api/git/conflict/file', { query: { path } });

export const resolveConflict = (filePath: string, resolvedContent: string) =>
  api.post<Api.GitOutput>('/api/git/conflict/resolve', { body: { filePath, resolvedContent } });

// ---------- sync ----------

export interface SyncInput {
  profileId?: string;
  sshKeyPath?: string;
  branch?: string;
  force?: boolean;
}

export const push = (input: SyncInput) =>
  api.post<Api.SyncResponse>('/api/git/push', { body: input });

export const pull = (input: SyncInput) =>
  api.post<Api.SyncResponse>('/api/git/pull', { body: input });

export const fetchRemote = (input: SyncInput) =>
  api.post<Api.SyncResponse>('/api/git/fetch', { body: input });

export const getOrigin = () => api.get<Api.OriginResponse>('/api/git/remote/origin');

export const toggleOriginProtocol = () =>
  api.post<Api.OriginResponse>('/api/git/remote/origin/toggle-protocol');

export interface CloneInput {
  url: string;
  parentDir: string;
  folderName?: string;
  profileId?: string;
}

export const clone = (input: CloneInput) =>
  api.post<Api.CloneResponse>('/api/git/clone', { ...global, body: input });

// ---------- history ----------

export const getCommitDetails = (hash: string) =>
  api.get<Api.CommitDetailsResponse>('/api/git/commit/details', { query: { hash } });

export const getCommitDiff = (hash: string, path: string) =>
  api.get<Api.DiffResponse>('/api/git/commit/diff', { query: { hash, path } });

export const getFileHistory = (path: string) =>
  api.get<Api.FileHistoryResponse>('/api/git/file/history', { query: { path } });

export const cherryPick = (hash: string) =>
  api.post<Api.IntegrationResponse>('/api/git/cherry-pick', { body: { hash } });

export const revert = (hash: string) =>
  api.post<Api.IntegrationResponse>('/api/git/revert', { body: { hash } });

export const reset = (hash: string, mode: 'soft' | 'mixed' | 'hard') =>
  api.post<Api.GitOutput>('/api/git/reset', { body: { hash, mode } });

// ---------- stashes and tags ----------

export const getStashes = () => api.get<Api.StashListResponse>('/api/git/stash');

export interface StashPushInput {
  message?: string;
  includeUntracked?: boolean;
  keepIndex?: boolean;
  files?: string[];
  selections?: { filePath: string; hunkIds?: string[]; lineIds?: string[] }[];
}

export const pushStash = (input: StashPushInput) =>
  api.post<Api.GitOutput & { partial: boolean; filesStashed: number }>('/api/git/stash', {
    body: input
  });

export const showStash = (ref: string) =>
  api.get<Api.Ok & { ref: string; files: { status: string; path: string }[]; diff: DiffFile[] }>(
    '/api/git/stash/show',
    { query: { ref } }
  );

export const applyStash = (ref: string, pop: boolean, restoreIndex = false) =>
  api.post<Api.GitOutput>('/api/git/stash/apply', { body: { ref, pop, restoreIndex } });

export const branchFromStash = (ref: string, branchName: string) =>
  api.post<Api.GitOutput & { branch: string }>('/api/git/stash/branch', {
    body: { ref, branchName }
  });

export const dropStash = (ref: string) =>
  api.post<Api.GitOutput>('/api/git/stash/drop', { body: { ref } });

// ---------- search, compare and branch maintenance ----------

export interface CommitSearchInput {
  query?: string;
  author?: string;
  paths?: string;
  since?: string;
  until?: string;
  refs?: string;
  limit?: number;
  skip?: number;
}

export const searchCommits = (input: CommitSearchInput) =>
  api.get<Api.Ok & { commits: Commit[]; hasMore: boolean; skip: number; limit: number }>(
    '/api/git/search/commits',
    { query: { ...input } }
  );

export interface CompareResult extends Api.Ok {
  base: string;
  head: string;
  ahead: number;
  behind: number;
  mergeBase: string | null;
  aheadCommits: Commit[];
  behindCommits: Commit[];
  files: { status: string; path: string }[];
}

export const compareRefs = (base: string, head: string) =>
  api.get<CompareResult>('/api/git/compare', { query: { base, head } });

export interface BranchDetail {
  name: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  upstreamGone: boolean;
  oid: string;
  date: string;
  subject: string;
  isCurrent: boolean;
  merged: boolean;
  pinned: boolean;
  stale: boolean;
}

export const getBranchDetails = () =>
  api.get<Api.Ok & { branches: BranchDetail[]; staleAfterDays: number }>(
    '/api/git/branches/details'
  );

export const renameBranch = (from: string, to: string) =>
  api.post<Api.Ok & { from: string; to: string }>('/api/git/branch/rename', { body: { from, to } });

export const setBranchUpstream = (branch: string, upstream: string | null) =>
  api.post<Api.Ok & { upstream: string | null }>('/api/git/branch/upstream', {
    body: { branch, upstream }
  });

export const pinBranch = (branch: string, pinned: boolean) =>
  api.post<Api.Ok & { pinnedBranches: string[] }>('/api/git/branch/pin', {
    body: { branch, pinned }
  });

// ---------- signing ----------

export const getSigningStatus = () =>
  api.get<SigningStatusResponse>('/api/git/signing/status');

export interface SigningConfigInput {
  mode: SigningMode;
  signingKey?: string | null;
  allowedSignersFile?: string | null;
  signCommitsByDefault?: boolean;
  signTagsByDefault?: boolean;
}

export const saveSigningConfig = (input: SigningConfigInput) =>
  api.post<SigningStatusResponse>('/api/git/signing/config', { body: input });

export const getCommitSignature = (hash: string) =>
  api.get<Api.Ok & { signature: SignatureInfo }>('/api/git/signature/commit', { query: { hash } });

export const getTagSignature = (tag: string) =>
  api.get<Api.Ok & { signature: SignatureInfo }>('/api/git/signature/tag', { query: { tag } });

// ---------- interactive rebase ----------

export const getRebasePlan = (onto: string, autosquash: boolean) =>
  api.get<Api.Ok & { plan: RebasePlan; warning: PublishedBranchWarning }>('/api/git/rebase/plan', {
    query: { onto, autosquash: autosquash ? 'true' : 'false' }
  });

export const getRebaseStatus = () =>
  api.get<
    Api.Ok & {
      status: RebaseStatus;
      remainder: { staged: number; unstaged: number; clean: boolean } | null;
    }
  >('/api/git/rebase/status');

export const startRebase = (plan: RebasePlan) =>
  api.post<Api.Ok & { status: RebaseStatus; stopped: boolean }>('/api/git/rebase/start', {
    body: { plan }
  });

export const stepRebase = (step: 'continue' | 'skip' | 'abort') =>
  api.post<Api.Ok & { status: RebaseStatus }>('/api/git/rebase/step', { body: { step } });

export const splitRebaseCommit = () =>
  api.post<Api.Ok & { status: RebaseStatus; remainder: { staged: number; unstaged: number } }>(
    '/api/git/rebase/split'
  );

export const deleteBranches = (branches: string[], force: boolean) =>
  api.post<
    Api.Ok & { deleted: number; results: { branch: string; deleted: boolean; error?: string }[] }
  >('/api/git/branches/delete-many', { body: { branches, force } });

export const getTags = () => api.get<Api.TagListResponse>('/api/git/tags');

export const createTag = (name: string, hash?: string, message?: string, sign?: boolean) =>
  api.post<Api.GitOutput>('/api/git/tag', { body: { name, hash, message, sign } });

export const deleteTag = (name: string) =>
  api.delete<Api.GitOutput>('/api/git/tag', { body: { name } });

export const pushTag = (name: string, profileId?: string, sshKeyPath?: string) =>
  api.post<Api.GitOutput & { profileLabel: string | null }>('/api/git/tag/push', {
    body: { name, profileId, sshKeyPath }
  });

// ---------- files and explorer ----------

export const getFileContent = (path: string) =>
  api.get<Api.FileContentResponse>('/api/git/file/content', { query: { path } });

export const getBlame = (path: string) =>
  api.get<Api.BlameResponse>('/api/git/file/blame', { query: { path } });

export const openInEditor = (repoPath: string, filePath: string) =>
  api.post<Api.Ok & { openedPath: string }>('/api/git/open-in-editor', {
    body: { repoPath, filePath }
  });

// ---------- safety net ----------

export const getCheckpoints = () => api.get<Api.CheckpointsResponse>('/api/git/checkpoints');

export const undoOperation = (checkpointId: string) =>
  api.post<Api.UndoOperationResponse>('/api/git/undo-operation', { body: { checkpointId } });

export const getTrash = () => api.get<Api.TrashResponse>('/api/git/trash');

export const getRecovery = () => api.get<RecoveryResponse>('/api/git/recovery');

export const recoveryBranch = (oid: string, branchName: string) =>
  api.post<Api.Ok & { branch: string; oid: string }>('/api/git/recovery/branch', {
    body: { oid, branchName }
  });

export const recoveryRestore = (pointId: string, ref: string) =>
  api.post<Api.Ok & { ref: string; oid: string; shortOid: string }>('/api/git/recovery/restore', {
    body: { pointId, ref }
  });

export const forgetRecoveryPoint = (id: string) =>
  api.delete<Api.Ok>('/api/git/recovery', { body: { id } });

export const restoreFromTrash = (id: string) =>
  api.post<Api.TrashRestoreResponse>('/api/git/trash/restore', { body: { id } });

// ---------- new repository wizard ----------

export const getTemplateCatalogue = () =>
  api.get<Api.TemplateCatalogueResponse>('/api/repo-templates', global);

export const getGithubCliStatus = (refresh = false) =>
  api.get<Api.GithubCliResponse>('/api/github/cli-status', {
    ...global,
    query: refresh ? { refresh: '1' } : {}
  });

export const newRepoPreflight = (repoPath: string) =>
  api.post<Api.NewRepoPreflightResponse>('/api/git/new-repo/preflight', {
    ...global,
    body: { repoPath }
  });

export interface NewRepoInput {
  repoPath: string;
  visibility: 'private' | 'public';
  licenseId: string;
  licenseYear?: string;
  licenseHolder?: string;
  gitignoreId: string;
  replaceLicense?: boolean;
  replaceGitignore?: boolean;
  createRemote?: boolean;
  useSshRemote?: boolean;
  /** Author of the first commit, when the active account carries an identity. */
  authorName?: string;
  authorEmail?: string;
  /** SSH identity for the first push, same shape as the sync endpoints take. */
  profileId?: string;
  sshKeyPath?: string;
}

export const createNewRepo = (input: NewRepoInput) =>
  api.post<Api.NewRepoResponse>('/api/git/new-repo', { ...global, body: input });

export const selectFolderViaServer = () =>
  api.get<Api.SelectFolderResponse>('/api/git/select-folder', global);

// ---------- application identity ----------

export const getAppInfo = () => api.get<Api.AppInfoResponse>('/api/app-info', global);

// ---------- terminal log ----------

export const postLog = (text: string, type: string) =>
  api.post<Api.Ok>('/api/logs', { ...global, body: { text, type } });

// ---------- ssh agent ----------

export const getSshAgentStatus = (repoPath?: string, profileId?: string) =>
  api.get<SshAgentStatusResponse>('/api/ssh/agent/status', {
    ...global,
    query: { repoPath, profileId }
  });

export interface LoadKeyOptions {
  /** A passphrase the user just typed. Used once, then forgotten. */
  passphrase?: string;
  /** Stores that passphrase in the vault. Ignored while the vault is locked. */
  savePassphrase?: boolean;
}

export const loadSshAgentKey = (
  repoPath: string | null,
  profileId: string,
  options: LoadKeyOptions = {}
) =>
  api.post<SshAgentLoadResponse & { routingChanged: boolean }>('/api/ssh/agent/load', {
    ...global,
    body: { repoPath, profileId, ...options }
  });

export const unloadSshAgentKey = (profileId: string, force = false) =>
  api.post<SshAgentLoadResponse>('/api/ssh/agent/unload', {
    ...global,
    body: { profileId, force }
  });

/** Loads every profile's key into the machine's agent. Never prompts. */
export const loadAllSshAgentKeys = () =>
  api.post<SshAgentBulkLoadResponse>('/api/ssh/agent/load-all', { ...global, body: {} });

// ---------- pull requests ----------

export const preflightPullRequest = (headBranch?: string, baseBranch?: string) =>
  api.get<PullRequestPreflightResponse>('/api/pull-requests/preflight', {
    query: { headBranch, baseBranch }
  });

export const createPullRequest = (input: PullRequestCreateInput & { pushFirst?: boolean }) =>
  api.post<PullRequestCreateResponse>('/api/pull-requests', { body: input });

// ---------- worktrees ----------

export const getWorktrees = () => api.get<WorktreeListResponse>('/api/worktrees');

export const getWorktreeStatus = () =>
  api.get<{ success: true; worktrees: WorktreeInfo[]; cancelled: boolean }>(
    '/api/worktrees/status'
  );

export const createWorktree = (input: Omit<CreateWorktreeInput, 'repoPath'>) =>
  api.post<WorktreeActionResult>('/api/worktrees', { body: input });

export const moveWorktree = (from: string, to: string) =>
  api.post<WorktreeActionResult>('/api/worktrees/move', { body: { from, to } });

export const lockWorktree = (path: string, reason?: string) =>
  api.post<WorktreeActionResult>('/api/worktrees/lock', { body: { path, reason } });

export const unlockWorktree = (path: string) =>
  api.post<WorktreeActionResult>('/api/worktrees/unlock', { body: { path } });

export const repairWorktrees = (paths?: string[]) =>
  api.post<WorktreeActionResult>('/api/worktrees/repair', { body: { paths } });

export const previewWorktreePrune = () =>
  api.get<PrunePreviewResponse>('/api/worktrees/prune-preview');

export const removeWorktree = (input: RemoveWorktreeInput) =>
  api.delete<RemoveWorktreeResult>('/api/worktrees', { body: input });

// ---------- repository groups ----------

/** A group's members resolved to paths, with the ones that have gone flagged. */
export interface GroupMember {
  repoPath: string;
  missing: boolean;
}

export interface ClientRepoGroup extends RepoGroup {
  members: GroupMember[];
}

export const getRepoGroups = () =>
  api.get<{ success: true; groups: ClientRepoGroup[] }>('/api/repo-groups', global);

export const saveRepoGroup = (group: Partial<RepoGroup> & { label: string }) =>
  api.post<Api.ConfigMutationResponse>('/api/repo-groups', { ...global, body: group });

export const deleteRepoGroup = (id: string) =>
  api.delete<Api.ConfigMutationResponse>('/api/repo-groups', { ...global, body: { id } });

export interface GroupFetchOutcome {
  repoPath: string;
  ok: boolean;
  message: string;
}

export const fetchRepoGroup = (id: string) =>
  api.post<{ success: true; cancelled: boolean; operationId: string; results: GroupFetchOutcome[] }>(
    '/api/repo-groups/fetch',
    { ...global, body: { id } }
  );

// ---------- external agents ----------

export const getAgents = () =>
  api.get<{ success: true; agents: ExternalAgentDefinition[]; launches: AgentLaunchRecord[] }>(
    '/api/agents',
    global
  );

export const detectAgents = () =>
  api.get<{ success: true; detected: DetectedAgent[] }>('/api/agents/detect', global);

export const addDetectedAgents = () =>
  api.post<{ success: true; added: ExternalAgentDefinition[] } & Api.ConfigMutationResponse>(
    '/api/agents/detect',
    global
  );

export const saveAgent = (agent: Partial<ExternalAgentDefinition>) =>
  api.post<{ success: true; agent: ExternalAgentDefinition } & Api.ConfigMutationResponse>(
    '/api/agents',
    { ...global, body: agent }
  );

export const deleteAgent = (id: string) =>
  api.delete<Api.ConfigMutationResponse>('/api/agents', { ...global, body: { id } });

// ---------- remotes ----------

export const getRemotes = () => api.get<RemoteListResponse>('/api/remotes');

export const addRemote = (input: AddRemoteInput) =>
  api.post<{ success: true; remote: RemoteInfo; remotes: RemoteInfo[] }>('/api/remotes', {
    body: input
  });

export const updateRemote = (input: UpdateRemoteInput) =>
  api.post<{ success: true; remote: RemoteInfo; remotes: RemoteInfo[] }>('/api/remotes/update', {
    body: input
  });

export const removeRemote = (name: string) =>
  api.delete<{ success: true; removed: RemoteInfo; remotes: RemoteInfo[] }>('/api/remotes', {
    body: { name }
  });

export const setDefaultPushRemote = (name: string | null) =>
  api.post<{ success: true; remotes: RemoteInfo[] }>('/api/remotes/default-push', {
    body: { name }
  });

export const previewRemotePrune = (name: string) =>
  api.get<{ success: true; preview: RemotePrunePreview }>(
    `/api/remotes/prune-preview?name=${encodeURIComponent(name)}`
  );

export const pruneRemote = (name: string) =>
  api.post<{ success: true; pruned: string[] }>('/api/remotes/prune', { body: { name } });

export const testRemote = (name: string) =>
  api.post<{ success: true; result: RemoteConnectivity }>('/api/remotes/test', { body: { name } });

export const fetchAllRemotes = (prune = false) =>
  api.post<{ success: true; results: { remote: string; ok: boolean; message?: string }[]; cancelled: boolean }>(
    '/api/remotes/fetch-all',
    { body: { prune } }
  );

// ---------- submodules ----------

export const getSubmodules = () => api.get<SubmoduleListResponse>('/api/submodules');

export const initSubmodules = (paths?: string[]) =>
  api.post<SubmoduleActionResponse & { submodules: SubmoduleInfo[] }>('/api/submodules/init', {
    body: { paths }
  });

export const updateSubmodules = (input: SubmoduleUpdateInput) =>
  api.post<SubmoduleActionResponse & { submodules: SubmoduleInfo[] }>('/api/submodules/update', {
    body: input
  });

export const syncSubmodules = (paths?: string[], recursive = false) =>
  api.post<SubmoduleActionResponse & { submodules: SubmoduleInfo[] }>('/api/submodules/sync', {
    body: { paths, recursive }
  });

export const setSubmoduleBranch = (path: string, branch: string | null) =>
  api.post<{ success: true; submodule: SubmoduleInfo; submodules: SubmoduleInfo[] }>(
    '/api/submodules/set-branch',
    { body: { path, branch } }
  );

export const deinitSubmodules = (paths: string[] | undefined, force: boolean) =>
  api.post<SubmoduleActionResponse & { submodules: SubmoduleInfo[] }>('/api/submodules/deinit', {
    body: { paths, force }
  });

export const getSubmoduleRepoPath = (path: string) =>
  api.get<{ success: true; path: string }>(
    `/api/submodules/repo-path?path=${encodeURIComponent(path)}`
  );

// ---------- Git LFS ----------

export const getLfsStatus = () => api.get<LfsStatusResponse>('/api/lfs/status');

export const setLfsInstallation = (action: LfsInstallAction) =>
  api.post<LfsInstallResponse>('/api/lfs/installation', { body: { action } });

export const trackLfsPattern = (pattern: string) =>
  api.post<{ success: true; trackedPatterns: string[] }>('/api/lfs/track', { body: { pattern } });

export const untrackLfsPattern = (pattern: string) =>
  api.post<{ success: true; trackedPatterns: string[] }>('/api/lfs/untrack', { body: { pattern } });

export const previewLfsTransfer = (action: 'fetch' | 'pull' | 'prune') =>
  api.get<{ success: true; preview: LfsTransferPreview }>(`/api/lfs/preview?action=${action}`);

export const runLfsTransfer = (action: 'fetch' | 'pull' | 'prune') =>
  api.post<{ success: true; cancelled: boolean }>('/api/lfs/transfer', { body: { action } });

export const getLfsLocks = () =>
  api.get<{ success: true; locks: LfsLock[]; unavailable?: string }>('/api/lfs/locks');

export const createLfsLock = (path: string) =>
  api.post<{ success: true; locks: LfsLock[]; unavailable?: string }>('/api/lfs/lock', {
    body: { path }
  });

export const releaseLfsLock = (path: string, force = false) =>
  api.post<{ success: true; locks: LfsLock[]; unavailable?: string }>('/api/lfs/unlock', {
    body: { path, force }
  });

// ---------- patches ----------

export const createPatch = (request: PatchRequest) =>
  api.post<{ success: true; preview: PatchPreview }>('/api/patches/create', { body: request });

export const applyPatch = (request: ApplyPatchRequest) =>
  api.post<{ success: true; outcome: ApplyPatchOutcome }>('/api/patches/apply', { body: request });

export const getAmState = () =>
  api.get<{ success: true; state: AmState }>('/api/patches/am-state');

export const controlAm = (action: 'continue' | 'skip' | 'abort') =>
  api.post<{ success: true; state: AmState }>('/api/patches/am', { body: { action } });

// ---------- bisect ----------

export const getBisect = () =>
  api.get<{ success: true; session: BisectSession; commands: BisectCommandDefinition[] }>(
    '/api/bisect'
  );

export const startBisect = (goodRef: string, badRef: string) =>
  api.post<{ success: true; session: BisectSession }>('/api/bisect/start', {
    body: { goodRef, badRef }
  });

export const markBisect = (verdict: BisectVerdict) =>
  api.post<{ success: true; session: BisectSession }>('/api/bisect/mark', { body: { verdict } });

export const resetBisect = () =>
  api.post<{ success: true; session: BisectSession }>('/api/bisect/reset');

export const saveBisectCommand = (definition: Partial<BisectCommandDefinition>) =>
  api.post<{ success: true; commands: BisectCommandDefinition[] }>('/api/bisect/commands', {
    body: definition
  });

// ---------- notes ----------

export const getNotesRefs = () =>
  api.get<{ success: true; refs: string[]; defaultRef: string }>('/api/notes/refs');

export const getNotesIndex = (ref?: string) =>
  api.get<{ success: true; commits: string[] }>(
    `/api/notes/index${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`
  );

export const getNote = (commit: string, ref?: string) =>
  api.get<{ success: true; note: string | null }>(
    `/api/notes?commit=${encodeURIComponent(commit)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`
  );

export const saveNote = (commit: string, message: string, ref?: string) =>
  api.post<{ success: true; note: string | null }>('/api/notes', {
    body: { commit, message, ref }
  });

export const deleteNote = (commit: string, ref?: string) =>
  api.delete<{ success: true }>('/api/notes', { body: { commit, ref } });

export const syncNotes = (direction: 'fetch' | 'push', remote = 'origin', ref?: string) =>
  api.post<{ success: true }>('/api/notes/sync', { body: { direction, remote, ref } });

// ---------- external tools ----------

export const getTools = () =>
  api.get<{ success: true; tools: ExternalToolDefinition[]; confirmed: Record<string, boolean> }>(
    '/api/tools',
    global
  );

export const detectTools = () =>
  api.get<{ success: true; detected: DetectedTool[] }>('/api/tools/detect', global);

export const addDetectedTools = () =>
  api.post<{ success: true; added: ExternalToolDefinition[]; tools: ExternalToolDefinition[] }>(
    '/api/tools/detect',
    global
  );

export const saveTool = (tool: Partial<ExternalToolDefinition>) =>
  api.post<{ success: true; tool: ExternalToolDefinition; tools: ExternalToolDefinition[] }>(
    '/api/tools',
    { ...global, body: tool }
  );

export const deleteTool = (id: string) =>
  api.delete<{ success: true; tools: ExternalToolDefinition[] }>('/api/tools', {
    ...global,
    body: { id }
  });

export const confirmToolKind = (kind: ExternalToolKind) =>
  api.post<{ success: true; confirmed: boolean }>('/api/tools/confirm', {
    ...global,
    body: { kind }
  });
