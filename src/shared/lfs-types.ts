// Git LFS as the UI sees it.
//
// The distinction this file exists to carry is pointer versus object. A file
// tracked by LFS is committed as a small text pointer; the real bytes live in
// the LFS store and may or may not be on this machine. "The file is here" and
// "the file's contents are here" are different questions, and a UI that
// conflates them will happily try to preview a 2GB video it does not have.

/** LFS is a separate program. It may simply not be installed. */
export interface LfsAvailability {
  installed: boolean;
  version?: string;
  /** True when this repository has LFS hooks and tracked patterns configured. */
  configured: boolean;
}

/**
 * Whether `git lfs install` has been run *in this repository*.
 *
 * A third question, separate from both "is the program on PATH" and "does this
 * repository track anything". `git lfs install` writes four hooks and a set of
 * `filter.lfs.*` entries, and it does that whether or not a single file is
 * tracked. The hooks then run on every pull, merge, checkout and commit — and
 * on an SSH remote `git lfs` shells out to `ssh` for an endpoint token, so a
 * repository that tracks nothing can still sit waiting on an SSH passphrase
 * prompt under a line that says Git LFS.
 *
 * That is the state `redundant` names: hooks installed, nothing tracked, all
 * cost and no benefit.
 */
export interface LfsInstallation {
  /** Any LFS hook or repository-local `filter.lfs.*` entry is present. */
  installed: boolean;
  /** Hook file names found in this repository's hooks directory. */
  hooks: string[];
  /** Repository-local `filter.lfs.*` config exists (as opposed to global). */
  localFilters: boolean;
  /**
   * Installed here, yet nothing is tracked and no object is present.
   *
   * The hooks cost something on every pull and return nothing. Reported so the
   * panel can offer to remove them rather than leaving the user to guess why
   * pulls pause on a repository with no large files in it.
   */
  redundant: boolean;
}

export interface LfsObject {
  oid: string;
  /** Size in bytes, as recorded in the pointer. */
  size: number;
  path: string;
  /**
   * Whether the real bytes are in this clone's LFS store.
   *
   * False means the working tree holds the pointer text, not the content.
   */
  present: boolean;
}

export interface LfsLock {
  id: string;
  path: string;
  owner: string;
  lockedAt?: string;
  /** True when the lock belongs to the account this repository authenticates as. */
  mine: boolean;
}

export interface LfsStatus {
  availability: LfsAvailability;
  /** Whether LFS is wired into this repository, and whether that earns its keep. */
  installation: LfsInstallation;
  trackedPatterns: string[];
  objects: LfsObject[];
  locks: LfsLock[];
  /**
   * Set when locking is unavailable — an older LFS, or a server that does not
   * implement the lock API. Locking is optional in the LFS spec, so its absence
   * is a fact to report rather than an error.
   */
  locksUnavailable?: string;
}

/** What a fetch or prune would move, before it moves it. */
export interface LfsTransferPreview {
  objectCount: number;
  totalBytes: number;
  /** A sample, not the whole list: this is a preview, not a listing. */
  samplePaths: string[];
}

export type LfsErrorCode =
  /** `git lfs` is not on PATH. */
  | 'LFS_MISSING'
  /** The repository does not use LFS. */
  | 'LFS_NOT_CONFIGURED'
  /** The server refused, or does not implement, the lock API. */
  | 'LFS_LOCKS_UNAVAILABLE'
  /** The transfer itself failed, as distinct from an ordinary git failure. */
  | 'LFS_TRANSFER_FAILED'
  /** `git lfs install --local` or `uninstall --local` failed. */
  | 'LFS_INSTALL_FAILED';

export interface LfsStatusResponse {
  success: true;
  status: LfsStatus;
}

/** `install` writes the repository's hooks and filters; `uninstall` removes them. */
export type LfsInstallAction = 'install' | 'uninstall';

export interface LfsInstallResponse {
  success: true;
  installation: LfsInstallation;
}
