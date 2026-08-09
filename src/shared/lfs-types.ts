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
  | 'LFS_TRANSFER_FAILED';

export interface LfsStatusResponse {
  success: true;
  status: LfsStatus;
}
