// Shapes of the Git data the server produces and the renderer consumes.
// Both sides import these, so a change to a payload is a compile error rather
// than a silent runtime mismatch.

/** Single-character code from the first (index) or second (work tree) column of `git status --porcelain`. */
export type StatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?' | ' ';

export interface StagedFile {
  path: string;
  status: StatusCode;
  /** Original path for renames and copies; null otherwise. */
  origPath: string | null;
}

export interface UnstagedFile {
  path: string;
  status: StatusCode;
}

export interface ConflictedFile {
  path: string;
  /** Both columns together, e.g. "UU", "AA", "DD". */
  status: string;
}

export interface PorcelainStatus {
  branch: string;
  tracking: string;
  ahead: number;
  behind: number;
  detached: boolean;
  /** True on a fresh repository whose branch has no commits yet. */
  noCommits: boolean;
  staged: StagedFile[];
  unstaged: UnstagedFile[];
  conflicts: ConflictedFile[];
}

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
  /** Branch and tag names pointing at this commit, e.g. "HEAD -> main", "origin/main". */
  refs: string[];
}

export interface CommitDetails {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export interface CommitFile {
  status: string;
  path: string;
}

export type DiffLineType = 'hunk' | 'addition' | 'deletion' | 'normal';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  /** Line number in the pre-image, or null for additions and hunk headers. */
  oldLine: number | null;
  /** Line number in the post-image, or null for deletions and hunk headers. */
  newLine: number | null;
}

export interface BlameLine {
  hash: string;
  author: string;
  date: string;
  lineNum: number;
  content: string;
}

export interface BranchRefs {
  local: string[];
  remote: string[];
}

/** A run of ordinary text between conflict markers. */
export interface NormalBlock {
  type: 'normal';
  text: string;
}

/** One `<<<<<<< / ======= / >>>>>>>` group. */
export interface ConflictBlock {
  type: 'conflict';
  ours: string;
  theirs: string;
  /** Trailing label on the `>>>>>>>` line, usually a branch name or commit subject. */
  info: string;
}

export type ConflictFileBlock = NormalBlock | ConflictBlock;

export type RemoteProtocol = 'https' | 'ssh' | 'other';

export interface ParsedRemote {
  protocol: RemoteProtocol;
  /** Null when the URL shape is not one this app can rewrite. */
  host: string | null;
  /** Path portion without the trailing `.git`, or null for unrecognised URLs. */
  repoPath: string | null;
}
