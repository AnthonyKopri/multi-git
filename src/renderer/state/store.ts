// The renderer's state, in one place.
//
// Replaces 21 module-level `let` bindings that any function could reassign,
// with no way to see what a change affected. Here every write goes through
// `update`, and interested modules subscribe rather than being called
// explicitly by whoever happened to change something.

import type {
  AccountRule,
  ClientSshProfile,
  RepoSettings,
  VaultStatus
} from '../../shared/config-types';
import type { BranchRefs, Commit } from '../../shared/git-types';
import type {
  GithubCliResponse,
  IdentityResponse,
  OriginResponse,
  StatusResponse,
  TemplateCatalogueResponse
} from '../../shared/api-types';

/** The file currently shown in the diff pane. */
export interface ActiveDiffFile {
  path: string;
  staged: boolean;
  statusChar: string;
}

export interface AppState {
  // Repository
  /** The resolved path, as shown to the user and sent as x-repo-path. */
  activeRepo: string | null;
  /**
   * Canonical identity of the active repository, supplied by the server.
   *
   * Separate from `activeRepo` because `repoSettings` is keyed by identity
   * while the header shows the path: on Windows those differ in case, and
   * anywhere they differ whenever a symlink or junction is involved.
   */
  activeRepoKey: string | null;
  recentRepos: string[];
  repoSettings: Record<string, RepoSettings>;

  // Accounts
  sshProfiles: ClientSshProfile[];
  accountRules: AccountRule[];
  vaultStatus: VaultStatus;
  /** '' means System SSH. */
  activeProfileId: string;
  manageSshConfig: boolean;

  // Repository state
  status: StatusResponse | null;
  branches: BranchRefs;
  identity: IdentityResponse | null;
  origin: OriginResponse | null;

  // History graph
  commits: Commit[];
  commitHashes: Set<string>;
  hasMoreCommits: boolean;
  loadingCommits: boolean;

  // Views
  activeDiffFile: ActiveDiffFile | null;
  selectedExplorerFile: string | null;
  blameActive: boolean;

  // Wizard caches
  templateCatalogue: TemplateCatalogueResponse | null;
  githubCli: GithubCliResponse | null;

  // Transient UI
  generatingSshKey: boolean;
}

function initialState(): AppState {
  return {
    activeRepo: null,
    activeRepoKey: null,
    recentRepos: [],
    repoSettings: {},

    sshProfiles: [],
    accountRules: [],
    vaultStatus: { hasVault: false, unlocked: false },
    activeProfileId: '',
    manageSshConfig: true,

    status: null,
    branches: { local: [], remote: [] },
    identity: null,
    origin: null,

    commits: [],
    commitHashes: new Set(),
    hasMoreCommits: false,
    loadingCommits: false,

    activeDiffFile: null,
    selectedExplorerFile: null,
    blameActive: false,

    templateCatalogue: null,
    githubCli: null,

    generatingSshKey: false
  };
}

let state: AppState = initialState();

export type StateKey = keyof AppState;
type Listener = (state: Readonly<AppState>, changed: ReadonlySet<StateKey>) => void;

const listeners = new Set<Listener>();

/** The current state. Treat it as read-only; use `update` to change it. */
export function getState(): Readonly<AppState> {
  return state;
}

/**
 * Applies a partial change and notifies subscribers.
 *
 * Keys whose value is unchanged are not reported, so a subscriber watching
 * one slice is not woken by unrelated writes.
 */
export function update(changes: Partial<AppState>): void {
  const changed = new Set<StateKey>();

  for (const [key, value] of Object.entries(changes) as [StateKey, unknown][]) {
    if (!Object.is(state[key], value)) {
      (state as Record<StateKey, unknown>)[key] = value;
      changed.add(key);
    }
  }

  if (changed.size === 0) {
    return;
  }

  for (const listener of listeners) {
    listener(state, changed);
  }
}

/** Subscribes to every change. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes to changes touching any of `keys`. */
export function subscribeTo(keys: readonly StateKey[], listener: Listener): () => void {
  const watched = new Set(keys);

  return subscribe((next, changed) => {
    for (const key of changed) {
      if (watched.has(key)) {
        listener(next, changed);
        return;
      }
    }
  });
}

/** Resets everything. Used when closing a repository and by tests. */
export function resetState(): void {
  state = initialState();
}

// ---------- selectors ----------

export function activeProfile(): ClientSshProfile | null {
  const { activeProfileId, sshProfiles } = state;
  return activeProfileId ? (sshProfiles.find((p) => p.id === activeProfileId) ?? null) : null;
}

export function isConflicted(): boolean {
  const status = state.status;
  return Boolean(
    status && (status.isMerging || status.isRebasing || status.conflicts.length > 0)
  );
}

/**
 * Whether discarding in this repository should ask for confirmation.
 *
 * Defaults to warning: an unknown repository is one whose preference has not
 * been recorded, and the safe reading of "unknown" is to ask.
 */
export function shouldWarnBeforeDelete(): boolean {
  const key = state.activeRepoKey;
  if (!key) {
    return true;
  }
  return state.repoSettings[key]?.warnBeforeDelete !== false;
}

/** The profile an auto-select rule picks for the current origin URL. */
export function ruleProfileFor(remoteUrl: string | null): ClientSshProfile | null {
  if (!remoteUrl) {
    return null;
  }

  const lower = remoteUrl.toLowerCase();
  // Rules are evaluated in order; the first match wins.
  const rule = state.accountRules.find((candidate) =>
    lower.includes(candidate.match.toLowerCase())
  );
  if (!rule) {
    return null;
  }

  return state.sshProfiles.find((profile) => profile.id === rule.profileId) ?? null;
}
