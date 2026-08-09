// A remote as the UI sees it.
//
// Wider than `git remote -v` reports, because that only prints URLs. Refspecs,
// the prune preference and a separate push URL all live in `.git/config` and
// all change what a fetch or push actually does, so the editor has to show
// them or it is editing half the record.

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  /**
   * Where pushes go. Equal to `fetchUrl` unless `remote.<name>.pushurl` is
   * set — the fork workflow where you fetch from upstream and push to your own.
   */
  pushUrl: string;
  fetchRefspecs: string[];
  pushRefspecs: string[];
  /** `remote.<name>.prune`, or the inherited `fetch.prune`. */
  prune: boolean;
  /** True when prune is inherited from `fetch.prune` rather than set here. */
  pruneInherited: boolean;
  /** True when this is the repository's default push remote. */
  isDefaultPush: boolean;
}

export interface RemoteListResponse {
  success: true;
  remotes: RemoteInfo[];
  /** `remote.pushDefault`, when one is set. */
  defaultPushRemote?: string;
}

export interface AddRemoteInput {
  name: string;
  fetchUrl: string;
  pushUrl?: string;
  fetchRefspecs?: string[];
  pushRefspecs?: string[];
  prune?: boolean;
}

export type UpdateRemoteInput = Partial<Omit<AddRemoteInput, 'name'>> & {
  name: string;
  /** New name, when renaming. */
  newName?: string;
};

/**
 * What `git remote prune --dry-run` would delete.
 *
 * Shown before pruning rather than after, because a remote-tracking ref is the
 * only record that a branch existed once its remote is gone.
 */
export interface RemotePrunePreview {
  remote: string;
  /** Remote-tracking refs that would be removed. */
  staleRefs: string[];
}

/** The result of reaching a remote, as `git ls-remote` reports it. */
export interface RemoteConnectivity {
  remote: string;
  reachable: boolean;
  /** Refs seen, when reachable. Capped — this is a health check, not a listing. */
  refCount?: number;
  /** Already redacted. Safe to show and to copy. */
  message?: string;
  /**
   * True when the failure looks like authentication rather than the host being
   * unreachable, so the UI can point at the SSH profile instead of the network.
   */
  authFailure?: boolean;
}
