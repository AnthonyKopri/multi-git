// Creating and applying patches.

/**
 * How a patch is written out.
 *
 * `diff` is a plain unified diff, applied with `git apply` as working-tree
 * changes. `mailbox` is `format-patch` output, applied with `git am`, and keeps
 * each commit's author, date and message — which is the reason to choose it.
 */
export type PatchFormat = 'diff' | 'mailbox';

export interface PatchRequest {
  format: PatchFormat;
  /** A commit, a ref, or a range endpoint. */
  from: string;
  /** The other end of a range. Absent means "just `from`". */
  to?: string;
  /** Limits the patch to these paths. Empty or absent means everything. */
  selectedPaths?: string[];
  /** Builds from uncommitted work instead of from history. */
  source?: 'commits' | 'working' | 'staged';
}

export interface PatchPreview {
  /** The patch itself, decoded for display only. */
  text: string;
  /** Byte length of the real patch, which is what would be written. */
  byteLength: number;
  /** Paths the patch touches, parsed from its headers. */
  paths: string[];
  /** True when any file in it is binary, which `git am` cannot always take. */
  hasBinary: boolean;
}

/** How `git apply` should treat whitespace errors. */
export type WhitespacePolicy = 'nowarn' | 'warn' | 'fix' | 'error';

export interface ApplyPatchRequest {
  /** The patch text, as read from a file or the clipboard. */
  patch: string;
  /** `working` applies with `git apply`; `commits` replays with `git am`. */
  mode: 'working' | 'commits';
  /** Check only. Nothing is written. */
  dryRun?: boolean;
  whitespace?: WhitespacePolicy;
  /** Applies to the index as well as the working tree. */
  index?: boolean;
  /** `git apply -3` / `git am -3`, which can leave conflicts to resolve. */
  threeWay?: boolean;
}

export interface ApplyPatchOutcome {
  applied: boolean;
  /** True when the patch was only checked. */
  dryRun: boolean;
  /** Paths the patch reported touching. */
  paths: string[];
  /** Already redacted. */
  message?: string;
  /** True when `git am` stopped and is waiting for continue, skip or abort. */
  amInProgress?: boolean;
  /** Files left conflicted by a three-way apply. */
  conflicts?: string[];
}

/** Where a `git am` run has got to, so the UI can offer the right controls. */
export interface AmState {
  inProgress: boolean;
  /** Which patch of the series, when one is in progress. */
  current?: number;
  total?: number;
  /** Subject line of the patch that stopped. */
  subject?: string;
}
