// A bisect session.
//
// The session lives in the repository, not in this process: git keeps it in
// `.git/BISECT_*`, which is why it survives a restart and why closing the app
// mid-bisect leaves the repository in a state that has to be reset rather than
// forgotten.

export type BisectVerdict = 'good' | 'bad' | 'skip';

export interface BisectSession {
  state: 'none' | 'active' | 'complete';
  /** The commit currently checked out for judging. */
  currentOid?: string;
  currentSubject?: string;
  /**
   * Roughly how many more steps remain, as `rev-list --bisect-vars` estimates.
   * Log₂ of the range, so it is an estimate and is presented as one.
   */
  stepsRemaining?: number;
  /** Commits still in the range. */
  remaining?: number;
  /** Set once bisect has identified the commit. */
  firstBadOid?: string;
  firstBadSubject?: string;
  /** `git bisect log`, so a session can be inspected or replayed. */
  log?: string;
}

export interface BisectStartInput {
  goodRef: string;
  badRef: string;
}

/** One automated step: what ran, and what it decided. */
export interface BisectRunStep {
  oid: string;
  subject?: string;
  exitCode: number;
  verdict: BisectVerdict;
}

export interface BisectRunOutcome {
  steps: BisectRunStep[];
  session: BisectSession;
  cancelled: boolean;
}
