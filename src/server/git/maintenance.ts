// The survey behind the Maintenance tab, and the purge it authorises.
//
// Two halves, deliberately separated. `evaluateStaleness` is a pure function
// over facts already gathered: it is where the user's definition of stale is
// applied, and it can be reasoned about and tested without a repository. The
// gathering around it is ordinary git plumbing, plus one `gh` call when the
// pull-request signal is switched on.
//
// The rule the whole file is built around: an unanswerable question is never
// evidence. If `gh` is missing, "no pull request was opened for this branch"
// is unknown rather than true, and a branch is not proposed for deletion on
// the strength of a lookup that never happened.
import { refArg } from './args';
import { withRepoLock } from './lock';
import { GitError, runGitCommand, tryGitCommand } from './run';
import {
  findWorktree,
  isDirty,
  listWorktrees,
  mainWorktree,
  readWorktreeStatus,
  snapshotWorktree
} from './worktrees';
import { canonicalRepoKey } from '../config/repo-identity';
import { pinnedBranchesFor } from '../config/store';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { checkGithubAvailability, isGithubRemote, runGh } from '../providers/github';
import { getOriginRemoteUrl } from '../ssh/profiles';
import { STALE_SIGNALS } from '../../shared/maintenance-types';
import type { ExecutableRunner } from '../process/runner';
import type { WorktreeInfo } from '../../shared/worktree-types';
import type {
  BranchFacts,
  MaintenanceSurvey,
  MergedBranchCandidate,
  PullRequestLookup,
  PullRequestRef,
  PurgeOutcome,
  PurgeWorktreesInput,
  PurgeWorktreesResult,
  SkippedWorktree,
  StaleRules,
  StaleSignal,
  StaleVerdict,
  WorktreeCandidate
} from '../../shared/maintenance-types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pull requests read per repository. Enough to cover a branch list; bounded. */
const MAX_PULL_REQUESTS = 200;

const FACT_FORMAT = [
  '%(refname:short)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(committerdate:iso-strict)',
  '%(HEAD)'
].join('\x1f');

// ---------- the rules ----------

/** Whole days between an ISO date and now, or null when it is not a date. */
export function daysSince(iso: string, now: number): number | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  // Floored, so 59 and a half days is not reported as 60 against a 60-day rule.
  return Math.floor((now - parsed) / DAY_MS);
}

/** Whether one signal holds, does not hold, or cannot be judged. */
function signalHolds(
  signal: StaleSignal,
  facts: BranchFacts,
  rules: StaleRules
): boolean | 'unknown' {
  switch (signal) {
    case 'no-pull-request':
      // Not "no open pull request": a branch whose pull request was merged or
      // closed was still proposed to somebody, and this signal is about work
      // nobody ever showed anyone.
      return facts.pullRequestKnown ? facts.pullRequest === null : 'unknown';
    case 'unpushed':
      return !facts.pushed;
    case 'inactive':
      return facts.daysSinceCommit === null
        ? 'unknown'
        : facts.daysSinceCommit >= rules.inactiveDays;
  }
}

function enabledSignals(rules: StaleRules): StaleSignal[] {
  return STALE_SIGNALS.filter((signal) => {
    if (signal === 'no-pull-request') {
      return rules.requireNoPullRequest;
    }
    if (signal === 'unpushed') {
      return rules.requireUnpushed;
    }
    return rules.requireInactive;
  });
}

function describe(signal: StaleSignal, facts: BranchFacts, rules: StaleRules): string {
  switch (signal) {
    case 'no-pull-request':
      return 'no pull request was ever opened';
    case 'unpushed':
      return facts.upstreamGone ? 'its remote branch is gone' : 'never pushed to a remote';
    case 'inactive':
      return `no commits for ${facts.daysSinceCommit ?? rules.inactiveDays} days`;
  }
}

/**
 * Applies the user's definition of stale to one branch.
 *
 * Pure, and the only place that definition is applied. `all` requires every
 * enabled signal to hold, `any` requires one — and under both, a signal that
 * could not be judged counts as not holding, so a missing GitHub CLI can only
 * ever make the purge list shorter.
 *
 * Takes facts rather than a clock: "days since the last commit" is measured
 * once, when the facts are gathered, so every branch in one survey is judged
 * against the same instant.
 */
export function evaluateStaleness(facts: BranchFacts, rules: StaleRules): StaleVerdict {
  const enabled = enabledSignals(rules);

  const held: StaleSignal[] = [];
  const unknown: StaleSignal[] = [];

  for (const signal of enabled) {
    const outcome = signalHolds(signal, facts, rules);
    if (outcome === 'unknown') {
      unknown.push(signal);
    } else if (outcome) {
      held.push(signal);
    }
  }

  // No rule enabled means no definition of stale, so nothing qualifies. The
  // alternative — everything qualifies — is a list of every worktree you have,
  // offered for deletion.
  const stale =
    enabled.length > 0 &&
    (rules.match === 'any' ? held.length > 0 : held.length === enabled.length);

  return {
    stale,
    signals: held,
    reasons: held.map((signal) => describe(signal, facts, rules)),
    unknown
  };
}

// ---------- gathering ----------

/** `[ahead 3, behind 1]`, or `[gone]` when the remote branch was deleted. */
function trackingGone(value: string): boolean {
  return value.includes('gone');
}

/**
 * Pull requests by head branch, from the output of one `gh pr list`.
 *
 * One call for the repository rather than one per branch: forty branches would
 * otherwise be forty round trips to GitHub before the tab could draw anything.
 */
export function parsePullRequestList(stdout: string): Map<string, PullRequestRef> {
  const byBranch = new Map<string, PullRequestRef>();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return byBranch;
  }

  if (!Array.isArray(parsed)) {
    return byBranch;
  }

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const branch = record['headRefName'];
    const number = record['number'];

    if (typeof branch !== 'string' || branch === '' || typeof number !== 'number') {
      continue;
    }

    // The newest pull request for a branch wins, and gh lists newest first.
    if (!byBranch.has(branch)) {
      byBranch.set(branch, {
        number,
        state: typeof record['state'] === 'string' ? record['state'] : '',
        url: typeof record['url'] === 'string' ? record['url'] : ''
      });
    }
  }

  return byBranch;
}

export interface PullRequestIndex {
  byBranch: Map<string, PullRequestRef>;
  lookup: PullRequestLookup;
  /** Why the lookup could not answer, when it could not. */
  message?: string;
}

/**
 * Asks GitHub which branches have ever had a pull request.
 *
 * Only called when the rule that needs it is switched on: it is a network
 * round trip, and a survey of a repository that is not on GitHub should not
 * pay for one. `--state all`, because a closed or merged pull request still
 * proves the work was proposed.
 */
export async function readPullRequests(
  repoPath: string,
  runner?: ExecutableRunner
): Promise<PullRequestIndex> {
  const empty = new Map<string, PullRequestRef>();

  const remoteUrl = await getOriginRemoteUrl(repoPath);
  if (!isGithubRemote(remoteUrl)) {
    return {
      byBranch: empty,
      lookup: 'not-github',
      message:
        'This repository’s origin is not on GitHub, so Multi-Git cannot tell which branches had a pull request.'
    };
  }

  const availability = await checkGithubAvailability(runner);
  if (!availability.available) {
    return {
      byBranch: empty,
      lookup: 'cli-unavailable',
      message: availability.message ?? 'GitHub CLI is not available.'
    };
  }

  const result = await runGh(
    [
      'pr',
      'list',
      '--state',
      'all',
      '--limit',
      String(MAX_PULL_REQUESTS),
      '--json',
      'number,state,url,headRefName'
    ],
    { cwd: repoPath, ...(runner ? { runner } : {}) }
  );

  if (!result.ok) {
    return {
      byBranch: empty,
      lookup: 'cli-unavailable',
      message: 'GitHub CLI could not list this repository’s pull requests.'
    };
  }

  return { byBranch: parsePullRequestList(result.stdout), lookup: 'ok' };
}

/**
 * The branch this repository merges into.
 *
 * `origin/HEAD` first, because "merged" means merged into the default branch
 * and not into whatever happens to be checked out here. The remote-tracking
 * copy is preferred over the local one: a local `main` that has not been
 * pulled for a month would call almost nothing merged.
 */
export async function readMergeBase(repoPath: string): Promise<string> {
  const symbolic = await tryGitCommand(repoPath, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD'
  ]);

  const fromRef = symbolic?.stdout.trim();
  if (fromRef) {
    return fromRef;
  }

  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    const exists = await tryGitCommand(repoPath, ['rev-parse', '--verify', '--quiet', candidate]);
    if (exists && exists.stdout.trim() !== '') {
      return candidate;
    }
  }

  return 'HEAD';
}

/** Short branch names some remote has a copy of, e.g. `feature/login`. */
async function pushedBranchNames(repoPath: string): Promise<Set<string>> {
  const listed = await tryGitCommand(repoPath, [
    'for-each-ref',
    'refs/remotes',
    '--format=%(refname:short)'
  ]);

  const names = new Set<string>();

  for (const line of (listed?.stdout ?? '').split('\n')) {
    const value = line.trim();
    // `origin/feature/login` → `feature/login`. The remote name is the first
    // segment; the branch name may contain the rest of the slashes.
    const withoutRemote = value.replace(/^[^/]+\//, '');
    if (withoutRemote !== '' && !withoutRemote.endsWith('HEAD')) {
      names.add(withoutRemote);
    }
  }

  return names;
}

export interface FactsOptions {
  rules: StaleRules;
  runner?: ExecutableRunner | undefined;
  now?: number;
}

export interface BranchFactsResult {
  facts: BranchFacts[];
  mergedInto: string;
  pullRequests: PullRequestIndex;
}

/**
 * Everything the rules are evaluated against, for every local branch.
 *
 * A handful of git reads and at most one `gh` call, whatever the branch count.
 */
export async function readBranchFacts(
  repoPath: string,
  options: FactsOptions
): Promise<BranchFactsResult> {
  const now = options.now ?? Date.now();
  const worktrees = await listWorktrees(repoPath);
  const mergedInto = await readMergeBase(repoPath);

  const [listed, mergedList, pushed] = await Promise.all([
    runGitCommand(repoPath, ['for-each-ref', 'refs/heads', `--format=${FACT_FORMAT}`]),
    tryGitCommand(repoPath, ['branch', '--merged', mergedInto, '--format=%(refname:short)']),
    pushedBranchNames(repoPath)
  ]);

  const pullRequests: PullRequestIndex = options.rules.requireNoPullRequest
    ? await readPullRequests(repoPath, options.runner)
    : { byBranch: new Map<string, PullRequestRef>(), lookup: 'not-asked' };

  const merged = new Set(
    (mergedList?.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const pinned = new Set(pinnedBranchesFor(repoPath));

  const holders = new Map<string, string>();
  for (const worktree of worktrees) {
    if (worktree.branch !== undefined) {
      holders.set(worktree.branch.replace(/^refs\/heads\//, ''), worktree.path);
    }
  }

  const facts = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): BranchFacts => {
      const [name, , track, date, headMarker] = line.split('\x1f');
      const branch = name ?? '';
      const lastCommit = date ?? '';

      return {
        name: branch,
        lastCommit,
        daysSinceCommit: daysSince(lastCommit, now),
        pushed: pushed.has(branch),
        upstreamGone: trackingGone(track ?? ''),
        pullRequest: pullRequests.byBranch.get(branch) ?? null,
        pullRequestKnown: pullRequests.lookup === 'ok',
        merged: merged.has(branch),
        isCurrent: (headMarker ?? '').trim() === '*',
        pinned: pinned.has(branch),
        checkedOutIn: holders.get(branch) ?? null
      };
    });

  return { facts, mergedInto, pullRequests };
}

/** The last path segment, which is what a worktree is called in the UI. */
export function folderName(worktreePath: string): string {
  const parts = worktreePath.split(/[\\/]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? worktreePath;
}

function shortBranch(ref: string | undefined): string | null {
  return ref === undefined ? null : ref.replace(/^refs\/heads\//, '');
}

/**
 * Why a worktree is not on offer, or null when it is.
 *
 * The main worktree is the repository. The active one is the folder this
 * window is looking at. A locked one was locked precisely so that housekeeping
 * would leave it alone, and this is housekeeping.
 */
export function protectedReason(
  worktree: WorktreeInfo,
  main: WorktreeInfo | null,
  activeKey: string
): string | null {
  if (worktree.isMain || (main !== null && worktree.path === main.path)) {
    return 'the repository itself';
  }
  if (canonicalRepoKey(worktree.path) === activeKey) {
    return 'open in this window';
  }
  if (worktree.locked) {
    return worktree.lockReason ? `locked — ${worktree.lockReason}` : 'locked';
  }
  if (worktree.bare) {
    return 'bare';
  }

  return null;
}

export interface SurveyOptions {
  rules: StaleRules;
  runner?: ExecutableRunner | undefined;
  now?: number;
}

/**
 * What the Maintenance tab shows: the worktrees the rules call abandoned, the
 * branches already merged, and everything deliberately left out of both.
 */
export async function surveyMaintenance(
  repoPath: string,
  options: SurveyOptions
): Promise<MaintenanceSurvey> {
  const { rules } = options;
  const now = options.now ?? Date.now();

  const worktrees = await listWorktrees(repoPath);
  const { facts, mergedInto, pullRequests } = await readBranchFacts(repoPath, {
    rules,
    runner: options.runner,
    now
  });

  const factsByBranch = new Map(facts.map((entry) => [entry.name, entry]));
  const main = mainWorktree(worktrees);
  const activeKey = canonicalRepoKey(repoPath);

  const staleWorktrees: WorktreeCandidate[] = [];
  const keptWorktrees: SkippedWorktree[] = [];

  for (const worktree of worktrees) {
    const name = folderName(worktree.path);
    const guard = protectedReason(worktree, main, activeKey);

    if (guard !== null) {
      keptWorktrees.push({ path: worktree.path, name, reason: guard });
      continue;
    }

    const branch = shortBranch(worktree.branch);
    const branchFacts = branch === null ? null : (factsByBranch.get(branch) ?? null);

    if (branchFacts?.pinned === true) {
      keptWorktrees.push({ path: worktree.path, name, reason: `${branch ?? ''} is pinned` });
      continue;
    }

    // A detached worktree has no branch to judge, so it is judged on its own
    // HEAD date alone — the one signal that still means anything there.
    const judged: BranchFacts = branchFacts ?? {
      name: '',
      lastCommit: '',
      daysSinceCommit: null,
      pushed: false,
      upstreamGone: false,
      pullRequest: null,
      pullRequestKnown: false,
      merged: false,
      isCurrent: false,
      pinned: false,
      checkedOutIn: worktree.path
    };

    if (branchFacts === null && worktree.present) {
      const head = await tryGitCommand(worktree.path, ['log', '-1', '--format=%cI']);
      judged.lastCommit = head?.stdout.trim() ?? '';
      judged.daysSinceCommit = daysSince(judged.lastCommit, now);
    }

    const verdict = evaluateStaleness(judged, rules);
    if (!verdict.stale) {
      continue;
    }

    const status = worktree.present ? await readWorktreeStatus(worktree.path) : null;
    const dirty = isDirty(status);

    const candidate: WorktreeCandidate = {
      path: worktree.path,
      name,
      branch,
      verdict,
      facts: branchFacts,
      dirty,
      uncommittedFiles: status
        ? status.staged + status.unstaged + status.untracked + status.conflicts
        : 0,
      present: worktree.present,
      branchDeletable: branch !== null && branchFacts !== null && !branchFacts.isCurrent
    };

    if (branch === null) {
      candidate.branchBlockedReason = 'detached, so there is no branch to delete';
    } else if (branchFacts?.isCurrent === true) {
      candidate.branchBlockedReason = 'checked out in the repository itself';
    }

    staleWorktrees.push(candidate);
  }

  const mergedBranches: MergedBranchCandidate[] = facts
    .filter((entry) => entry.merged && !entry.isCurrent && !entry.pinned)
    .map((entry) => {
      const blocked =
        entry.checkedOutIn === null ? undefined : `checked out in ${folderName(entry.checkedOutIn)}`;

      return {
        name: entry.name,
        lastCommit: entry.lastCommit,
        pullRequest: entry.pullRequest,
        checkedOutIn: entry.checkedOutIn,
        deletable: blocked === undefined,
        ...(blocked === undefined ? {} : { blockedReason: blocked })
      };
    });

  const warnings: string[] = [];

  if (enabledSignals(rules).length === 0) {
    warnings.push(
      'No rule is switched on, so nothing counts as stale. Choose at least one signal below.'
    );
  }
  if (pullRequests.message !== undefined && rules.requireNoPullRequest) {
    // An unanswerable rule is never treated as satisfied, so under "all" it
    // holds back the entire list. Saying so is the difference between a tab
    // that looks broken and one the user knows how to fix.
    warnings.push(
      rules.match === 'all'
        ? `${pullRequests.message} Nothing can be listed while that rule is ticked — untick it, or switch the rules to "any one is enough".`
        : `${pullRequests.message} That rule cannot contribute, so the list below rests on the others.`
    );
  }

  return {
    rules,
    mergedInto,
    staleWorktrees,
    keptWorktrees,
    mergedBranches,
    pullRequestLookup: pullRequests.lookup,
    warnings
  };
}

// ---------- the purge ----------

/**
 * Deletes one branch, trying the safe form first.
 *
 * `-d` refuses a branch that is not merged, which is exactly the state a stale
 * unpushed branch is in. `-D` is only reached when the caller asked for it,
 * and by then a recovery point already records the branch tip.
 */
async function deleteBranch(
  repoPath: string,
  branch: string,
  force: boolean
): Promise<{ deleted: boolean; error?: string }> {
  const safeBranch = refArg(branch, 'Branch name');

  try {
    await withRepoLock(repoPath, () => runGitCommand(repoPath, ['branch', '-d', safeBranch]));
    return { deleted: true };
  } catch (error) {
    if (!force) {
      // Git's own diagnostic rather than its exit code: "the branch is not
      // fully merged" is the whole reason this branch is still here, and it is
      // what the row has to say.
      const message = gitMessage(error);
      return {
        deleted: false,
        error: /not fully merged/i.test(message)
          ? 'Kept: it is not merged anywhere, and force-delete was not asked for.'
          : message
      };
    }
  }

  try {
    await withRepoLock(repoPath, () => runGitCommand(repoPath, ['branch', '-D', safeBranch]));
    return { deleted: true };
  } catch (error) {
    return { deleted: false, error: gitMessage(error) };
  }
}

/** What git actually said, which is on stderr rather than in the exit code. */
function gitMessage(error: unknown, fallback = 'Git refused.'): string {
  if (error instanceof GitError) {
    return error.displayMessage;
  }
  return error instanceof Error ? error.message : fallback;
}

/** Forgets git's records for worktree folders that are no longer on disk. */
async function pruneWorktreeRecords(repoPath: string): Promise<string[]> {
  const result = await tryGitCommand(repoPath, ['worktree', 'prune', '-v']);
  if (result === null) {
    return [];
  }

  const pruned: string[] = [];

  // "Removing worktrees/feature-x: gitdir file points to non-existent location"
  for (const line of `${result.stdout}\n${result.stderr}`.split('\n')) {
    const match = line.match(/^Removing\s+worktrees\/(.+?):/);
    if (match?.[1]) {
      pruned.push(match[1]);
    }
  }

  return pruned;
}

/**
 * Removes the worktrees the user was shown, and optionally their branches.
 *
 * Every path is resolved against `git worktree list` before anything happens,
 * so the only folders this can act on are ones git itself reported. The guards
 * that protect the repository, the open window and a locked worktree are the
 * same ones the survey applies, checked again here rather than trusted from
 * the request. One entry git refuses is reported and the rest continue.
 */
export async function purgeWorktrees(
  repoPath: string,
  input: PurgeWorktreesInput
): Promise<PurgeWorktreesResult> {
  const worktrees = await listWorktrees(repoPath);
  const main = mainWorktree(worktrees);
  const activeKey = canonicalRepoKey(repoPath);
  const results: PurgeOutcome[] = [];

  // Resolved first, so the recovery point can name every branch about to be at
  // risk — including the ones whose removal later fails.
  const targets: { worktree: WorktreeInfo; branch: string | null }[] = [];

  for (const requested of input.paths) {
    const worktree = findWorktree(worktrees, requested);

    if (!worktree) {
      results.push({
        path: requested,
        name: folderName(requested),
        removed: false,
        error: 'That path is not a worktree of this repository.'
      });
      continue;
    }

    const guard = protectedReason(worktree, main, activeKey);
    if (guard !== null) {
      results.push({
        path: worktree.path,
        name: folderName(worktree.path),
        removed: false,
        error: `Not removed: ${guard}.`
      });
      continue;
    }

    targets.push({ worktree, branch: shortBranch(worktree.branch) });
  }

  if (targets.length === 0) {
    return { success: true, results, removed: 0, branchesDeleted: 0, pruned: [] };
  }

  // Captured against the main worktree: a doomed worktree's own git directory
  // goes with it, and a recovery point written there would be deleted by the
  // very operation it exists to undo.
  const journalPath = main?.path ?? repoPath;

  await captureCheckpoint(journalPath, `Before purging ${targets.length} worktree(s)`, {
    operation: 'worktree-remove',
    refs: targets
      .filter((target) => target.branch !== null)
      .map((target) => `refs/heads/${target.branch as string}`)
  });

  let branchesDeleted = 0;

  for (const { worktree, branch } of targets) {
    const name = folderName(worktree.path);
    const outcome: PurgeOutcome = { path: worktree.path, name, removed: false };
    if (branch !== null) {
      outcome.branch = branch;
    }

    const status = worktree.present ? await readWorktreeStatus(worktree.path) : null;
    const dirty = isDirty(status);

    if (dirty && !input.includeDirty) {
      outcome.error = 'Skipped: it has uncommitted changes.';
      results.push(outcome);
      continue;
    }

    if (dirty && worktree.present) {
      // `stash create` writes into the shared object store, so the snapshot
      // outlives the folder that is about to be deleted.
      const snapshotRef = await snapshotWorktree(worktree.path);
      if (snapshotRef) {
        outcome.snapshotRef = snapshotRef;
        await captureCheckpoint(journalPath, `Uncommitted work from ${name}`, {
          operation: 'worktree-remove',
          stashRef: snapshotRef,
          ...(branch === null ? {} : { refs: [`refs/heads/${branch}`] })
        });
      }
    }

    try {
      // Git does the deleting, against its own path. This process never removes
      // a directory tree it computed. `--force` is needed for a folder that is
      // already gone as well as for one with changes in it.
      await withRepoLock(repoPath, () =>
        runGitCommand(repoPath, [
          'worktree',
          'remove',
          ...(dirty || !worktree.present ? ['--force'] : []),
          worktree.path
        ])
      );
      outcome.removed = true;
    } catch (error) {
      outcome.error = gitMessage(error, 'Git refused to remove it.');
      results.push(outcome);
      continue;
    }

    if (input.deleteBranches && branch !== null) {
      const deleted = await deleteBranch(repoPath, branch, input.forceBranchDelete);
      outcome.branchDeleted = deleted.deleted;
      if (deleted.error !== undefined) {
        outcome.branchError = deleted.error;
      }
      if (deleted.deleted) {
        branchesDeleted += 1;
      }
    }

    results.push(outcome);
  }

  // Records for folders that had already gone before any of this started.
  const pruned = await pruneWorktreeRecords(repoPath);

  return {
    success: true,
    results,
    removed: results.filter((entry) => entry.removed).length,
    branchesDeleted,
    pruned
  };
}
