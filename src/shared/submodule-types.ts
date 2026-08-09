// A submodule as the UI sees it.
//
// The distinction that causes most of the confusion around submodules is the
// one between two commits, so both are here rather than one "is it up to date"
// flag:
//
//   * `expectedOid` is the gitlink — what the superproject's tree says this
//     submodule should be at. Changing it is a change to the superproject.
//   * `checkedOutOid` is what the submodule's own working tree is actually at.
//     Changing it is a change inside the submodule.
//
// They differ constantly and legitimately, and telling the user which one they
// are about to move is the difference between a usable panel and a dangerous
// one.

export interface SubmoduleInfo {
  /** Path relative to the superproject root, as `.gitmodules` records it. */
  path: string;
  /** The `submodule.<name>` section name, which need not equal the path. */
  name: string;
  url: string;
  /** `submodule.<name>.branch`, when the submodule tracks one. */
  branch?: string;
  /** The gitlink recorded in the superproject's HEAD tree. */
  expectedOid?: string;
  /** What the submodule's working tree is at. Absent when not initialized. */
  checkedOutOid?: string;
  initialized: boolean;
  /** Uncommitted changes inside the submodule's own working tree. */
  dirty: boolean;
  /**
   * True when the folder exists but holds no checked-out commit — a
   * `git clone` without `--recurse-submodules`, before `submodule update`.
   */
  missingCommit: boolean;
}

export interface SubmoduleListResponse {
  success: true;
  submodules: SubmoduleInfo[];
}

export interface SubmoduleUpdateInput {
  /** Submodule paths to act on. Empty means every one. */
  paths?: string[];
  /** `--init`, for a submodule that has never been checked out. */
  init?: boolean;
  /** `--recursive`, for submodules that contain their own. */
  recursive?: boolean;
}

/** One target's outcome, so a partial failure is inspectable rather than fatal. */
export interface SubmoduleActionResult {
  path: string;
  ok: boolean;
  /** Already redacted. */
  message?: string;
}

export interface SubmoduleActionResponse {
  success: true;
  results: SubmoduleActionResult[];
}
