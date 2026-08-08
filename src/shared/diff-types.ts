// The structured diff model.
//
// Distinct from `DiffLine` in git-types.ts, which is a flat list of rendered
// lines and carries no notion of which hunk a line belongs to. Precision
// staging needs the structure: a selection is a set of hunk or line
// identifiers, and the patch that carries it out is generated from the same
// model the user was looking at.

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

/** Which pair of trees a diff compares. */
export type DiffSource = 'working-tree' | 'index' | 'commit';

export type DiffLineKind = 'context' | 'addition' | 'deletion';

export interface StructuredDiffLine {
  /** Stable within the file: `<hunk id>:<index in hunk>`. */
  id: string;
  kind: DiffLineKind;
  /** Without git's leading +/-/space, and with the line's own CR preserved. */
  content: string;
  oldLine: number | null;
  newLine: number | null;
  /** Git printed `\ No newline at end of file` after this line. */
  noNewline: boolean;
}

export interface DiffHunk {
  /**
   * Content-derived, so it changes whenever the hunk does. That is what makes
   * a selection built against an older read detectable as stale rather than
   * silently applied to different lines.
   */
  id: string;
  /** The raw `@@ … @@` line, section heading included. */
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: StructuredDiffLine[];
}

export interface DiffFile {
  /** Null for an added file. */
  oldPath: string | null;
  /** Null for a deleted file. */
  newPath: string | null;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  /** No line-level model exists; hunks is empty and selection is refused. */
  binary: boolean;
  /** Git recorded an `old mode`/`new mode` pair for this file. */
  modeChanged: boolean;
  /** Empty for a binary file, a pure rename, or a mode-only change. */
  hunks: DiffHunk[];
  /**
   * Every header line git emitted for this file, verbatim, from `diff --git`
   * to just before the first hunk. Replayed unchanged when a patch is rebuilt,
   * so path quoting, modes, and rename metadata survive a round trip.
   */
  headerLines: string[];
}

/**
 * What the user picked.
 *
 * Omitting both lists means the whole file. Sending an empty list is a
 * selection of nothing, and is refused — the two are deliberately different.
 */
export interface PatchSelection {
  hunkIds?: string[];
  lineIds?: string[];
}

export type PatchAction = 'stage' | 'unstage' | 'discard';

export interface StructuredDiffResponse {
  success: true;
  /** Null when the file has no changes against the requested source. */
  file: DiffFile | null;
  source: DiffSource;
  /** True when the diff was synthesised for a file git does not track yet. */
  untracked: boolean;
}

export interface ApplyPatchResponse {
  success: true;
  action: PatchAction;
  filePath: string;
  hunksApplied: number;
  linesApplied: number;
}
