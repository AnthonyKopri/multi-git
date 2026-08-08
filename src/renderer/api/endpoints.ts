// One typed function per API route.
//
// This is where the shared types earn their keep: a route's response shape is
// declared once in src/shared/api-types.ts, the server returns it, and the
// renderer consumes it. Renaming a field breaks the build on both sides
// instead of producing undefined at runtime.
import { api } from './client';
import type * as Api from '../../shared/api-types';
import type {
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
import type { Commit } from '../../shared/git-types';

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

export const commit = (message: string, amend = false) =>
  api.post<Api.GitOutput>('/api/git/commit', { body: { message, amend } });

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

export const getStructuredDiff = (path: string, source: DiffSource, force = false) =>
  api.get<StructuredDiffPayload>('/api/git/diff/structured', {
    query: { path, source, force: force ? 'true' : undefined }
  });

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

export const pruneRemote = (remote: string, dryRun = false) =>
  api.post<Api.Ok & { pruned: string[] }>('/api/git/remote/prune', { body: { remote, dryRun } });

export const deleteBranches = (branches: string[], force: boolean) =>
  api.post<
    Api.Ok & { deleted: number; results: { branch: string; deleted: boolean; error?: string }[] }
  >('/api/git/branches/delete-many', { body: { branches, force } });

export const getTags = () => api.get<Api.TagListResponse>('/api/git/tags');

export const createTag = (name: string, hash?: string, message?: string) =>
  api.post<Api.GitOutput>('/api/git/tag', { body: { name, hash, message } });

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
}

export const createNewRepo = (input: NewRepoInput) =>
  api.post<Api.NewRepoResponse>('/api/git/new-repo', { ...global, body: input });

export const initRepo = (repoPath: string) =>
  api.post<Api.Ok & { message: string }>('/api/git/init', { ...global, body: { repoPath } });

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

export const loadSshAgentKey = (repoPath: string | null, profileId: string) =>
  api.post<SshAgentLoadResponse & { routingChanged: boolean }>('/api/ssh/agent/load', {
    ...global,
    body: { repoPath, profileId }
  });

export const unloadSshAgentKey = (profileId: string, force = false) =>
  api.post<SshAgentLoadResponse>('/api/ssh/agent/unload', {
    ...global,
    body: { profileId, force }
  });

// ---------- pull requests ----------

export const preflightPullRequest = (headBranch?: string, baseBranch?: string) =>
  api.get<PullRequestPreflightResponse>('/api/pull-requests/preflight', {
    query: { headBranch, baseBranch }
  });

export const createPullRequest = (input: PullRequestCreateInput & { pushFirst?: boolean }) =>
  api.post<PullRequestCreateResponse>('/api/pull-requests', { body: input });
