// The tools this application needs, and what it can do without them.
//
// Multi-Git shells out to git for everything, so without git it is a window
// with nothing behind it. It used to find that out at the first click, as a
// raw spawn error from a failed process. Asking once, at the start, is both
// kinder and more honest.

export type PrerequisiteId = 'git' | 'git-bash' | 'gh';

export interface PrerequisiteState {
  id: PrerequisiteId;
  /** Shown as the name of the thing. */
  label: string;
  installed: boolean;
  /** Reported by the tool itself, when it is there. */
  version?: string;
  /**
   * Where it was found. Useful when a machine has more than one copy and the
   * one on PATH is not the one the user expected.
   */
  path?: string;
  /**
   * Set for `gh`, which can be installed and still unusable. Absent for the
   * others, which have no such state.
   */
  signedIn?: boolean;
  /** What is lost without it, in the user's terms. */
  detail: string;
}

export interface PrerequisiteReport {
  /** Every tool, whether present or not, in the order to show them. */
  tools: PrerequisiteState[];
  /**
   * True when the application cannot function at all.
   *
   * Only git makes this true. The rest degrade rather than block.
   */
  blocked: boolean;
  /**
   * Whether one-click installation is possible here.
   *
   * winget ships with Windows 10 1809 and later; without it the buttons open
   * the download page instead, which works everywhere.
   */
  canInstall: boolean;
}

/**
 * What starting an installation did.
 *
 * `browser` is not a failure: where winget is absent the download page is the
 * correct answer, and the user still ends up with the tool.
 */
export type InstallOutcome =
  | { started: true; via: 'winget' }
  | { started: false; via: 'browser'; url: string };

/** The features that need `gh`, so the UI can disable exactly those. */
export const GH_DEPENDENT_FEATURES = [
  'Browse GitHub repositories when cloning',
  'Create a pull request',
  'Create the repository on GitHub in the New Repository wizard',
  'Repository maintenance checks that ask GitHub about a branch'
] as const;
