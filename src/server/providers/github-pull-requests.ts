// Preflight and creation for GitHub pull requests.
//
// Preflight answers, in one round trip, every question that decides whether
// Create is safe to press: is there a CLI, is it signed in, is this even a
// GitHub remote, where does HEAD point, has it been pushed, is there anything
// to merge, does a PR already exist. The window renders that; it does not
// re-derive it.
import { tryGitCommand } from '../git/run';
import { refArg } from '../git/args';
import { getOriginRemoteUrl, runSyncOperationWithProfile } from '../ssh/profiles';
import {
  checkGithubAvailability,
  ghErrorMessage,
  isGithubRemote,
  ownerRepoFromRemote,
  readPullRequestTemplate,
  runGh
} from './github';
import type { ExecutableRunner } from '../process/runner';
import type {
  PullRequestCreateInput,
  PullRequestCreateResult,
  PullRequestErrorCode,
  PullRequestPreflight
} from '../../shared/pull-request-types';

/** Commits summarised in the window before it stops listing them. */
const MAX_COMMIT_SUBJECTS = 50;

export class PullRequestError extends Error {
  readonly code: PullRequestErrorCode;
  readonly statusCode: number;
  /** True when the branch was pushed before the failure. */
  readonly pushed: boolean;

  constructor(
    code: PullRequestErrorCode,
    message: string,
    options: { statusCode?: number; pushed?: boolean } = {}
  ) {
    super(message);
    this.name = 'PullRequestError';
    this.code = code;
    this.statusCode = options.statusCode ?? 400;
    this.pushed = options.pushed ?? false;
  }
}

async function currentBranch(repoPath: string): Promise<{ name: string; detached: boolean }> {
  const result = await tryGitCommand(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = result?.stdout.trim() ?? '';

  // `rev-parse --abbrev-ref HEAD` answers literally "HEAD" when detached.
  return { name: name === 'HEAD' ? '' : name, detached: name === 'HEAD' || name === '' };
}

async function localBranches(repoPath: string): Promise<string[]> {
  const result = await tryGitCommand(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads'
  ]);

  return (result?.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The repository's default branch, as GitHub sees it.
 *
 * `origin/HEAD` is the local cache of it and is often missing on a shallow or
 * hand-configured clone, so gh is asked as a fallback and a plausible local
 * branch is the last resort.
 */
async function defaultBaseBranch(
  repoPath: string,
  branches: readonly string[],
  runner?: ExecutableRunner
): Promise<string> {
  const symbolic = await tryGitCommand(repoPath, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD'
  ]);
  const fromRef = symbolic?.stdout.trim().replace(/^origin\//, '');
  if (fromRef) {
    return fromRef;
  }

  const viaGh = await runGh(
    ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
    { cwd: repoPath, ...(runner ? { runner } : {}) }
  );
  const ghBranch = viaGh.ok ? viaGh.stdout.trim() : '';
  if (ghBranch) {
    return ghBranch;
  }

  return ['main', 'master', 'develop'].find((candidate) => branches.includes(candidate)) ?? '';
}

async function countRange(repoPath: string, range: string): Promise<number> {
  const result = await tryGitCommand(repoPath, ['rev-list', '--count', range]);
  const parsed = Number.parseInt(result?.stdout.trim() ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Whether origin already has this branch.
 *
 * Read from the local remote-tracking ref rather than `git ls-remote`, which
 * would put a network round trip — and an SSH authentication attempt — in a
 * preflight that runs every time the window opens. A stale tracking ref can
 * only understate things: the answer is then "not pushed", and the push that
 * follows is a fast-forward no-op rather than a wrong result.
 */
async function remoteBranchExists(repoPath: string, branch: string): Promise<boolean> {
  const result = await tryGitCommand(repoPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/origin/${branch}`
  ]);

  return result !== null && result.stdout.trim() !== '';
}

async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
  const result = await tryGitCommand(repoPath, ['status', '--porcelain']);
  return (result?.stdout ?? '').trim() !== '';
}

/** Subjects of commits on head that base does not have, newest first. */
async function commitSubjects(repoPath: string, base: string, head: string): Promise<string[]> {
  const result = await tryGitCommand(repoPath, [
    'log',
    '--format=%s',
    '-n',
    String(MAX_COMMIT_SUBJECTS),
    `${base}..${head}`
  ]);

  return (result?.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function changedFileCount(repoPath: string, base: string, head: string): Promise<number> {
  const result = await tryGitCommand(repoPath, ['diff', '--name-only', `${base}...${head}`]);
  return (result?.stdout ?? '').split('\n').filter((line) => line.trim() !== '').length;
}

/** Turns `feat/add-login-page` into `Add login page`. */
export function titleFromBranchName(branch: string): string {
  const withoutPrefix = branch.replace(/^(?:feat|fix|chore|docs|refactor|test|perf)[/-]/i, '');
  const words = withoutPrefix.replace(/[-_/]+/g, ' ').trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An existing open PR for this head branch, if there is one. */
async function existingPullRequest(
  repoPath: string,
  head: string,
  runner?: ExecutableRunner
): Promise<string | null> {
  const result = await runGh(
    ['pr', 'list', '--head', head, '--state', 'open', '--json', 'url', '--jq', '.[0].url'],
    { cwd: repoPath, ...(runner ? { runner } : {}) }
  );

  const url = result.ok ? result.stdout.trim() : '';
  return url && url !== 'null' ? url : null;
}

export interface PreflightOptions {
  repoPath: string;
  headBranch?: string | undefined;
  baseBranch?: string | undefined;
  runner?: ExecutableRunner | undefined;
}

export async function preflightPullRequest(
  options: PreflightOptions
): Promise<PullRequestPreflight> {
  const { repoPath, runner } = options;
  const warnings: string[] = [];

  const remoteUrl = await getOriginRemoteUrl(repoPath);
  const head = await currentBranch(repoPath);
  const branches = await localBranches(repoPath);
  const headBranch = options.headBranch || head.name;

  const availability = await checkGithubAvailability(runner);
  const cliAvailable = availability.available || availability.reason !== 'not-installed';
  const authenticated = availability.available;

  const base =
    options.baseBranch || (await defaultBaseBranch(repoPath, branches, runner)) || 'main';

  const preflight: PullRequestPreflight = {
    provider: 'github',
    authenticated,
    cliAvailable,
    headBranch,
    headPushed: false,
    defaultBaseBranch: base,
    branches,
    commitsAhead: 0,
    commitsBehind: 0,
    isDetachedHead: head.detached,
    hasUncommittedChanges: await hasUncommittedChanges(repoPath),
    commitSubjects: [],
    changedFileCount: 0,
    suggestedTitle: '',
    suggestedBody: '',
    warnings
  };

  const target = ownerRepoFromRemote(remoteUrl);
  if (target) {
    preflight.targetRepo = target;
  }

  if (!isGithubRemote(remoteUrl)) {
    warnings.push(
      remoteUrl
        ? `The origin remote (${remoteUrl}) is not a GitHub repository, so pull requests cannot be created here yet.`
        : 'This repository has no origin remote, so there is nowhere to open a pull request.'
    );
    return preflight;
  }

  if (!availability.available && availability.message) {
    warnings.push(availability.message);
  }

  if (head.detached) {
    warnings.push('HEAD is detached. Check out a branch before creating a pull request.');
    return preflight;
  }

  preflight.headPushed = await remoteBranchExists(repoPath, headBranch);

  if (base && headBranch && base !== headBranch) {
    // Against the remote base when it exists, because the local copy may be
    // stale and would overstate how far ahead the branch is.
    const baseRef = (await tryGitCommand(repoPath, ['rev-parse', '--verify', `origin/${base}`]))
      ? `origin/${base}`
      : base;

    preflight.commitsAhead = await countRange(repoPath, `${baseRef}..${headBranch}`);
    preflight.commitsBehind = await countRange(repoPath, `${headBranch}..${baseRef}`);
    preflight.commitSubjects = await commitSubjects(repoPath, baseRef, headBranch);
    preflight.changedFileCount = await changedFileCount(repoPath, baseRef, headBranch);
  }

  if (base === headBranch) {
    warnings.push('The base and compare branches are the same. Pick a different base.');
  } else if (preflight.commitsAhead === 0) {
    warnings.push(`${headBranch} has no commits that ${base} does not already have.`);
  }

  if (!preflight.headPushed) {
    warnings.push(`${headBranch} has not been pushed yet. Use "Push and create" to publish it first.`);
  }

  if (preflight.hasUncommittedChanges) {
    warnings.push('There are uncommitted changes. They will not be part of this pull request.');
  }

  if (preflight.commitsBehind > 0) {
    warnings.push(
      `${headBranch} is ${preflight.commitsBehind} commit(s) behind ${base}. Merging may need a rebase.`
    );
  }

  if (authenticated) {
    const existing = await existingPullRequest(repoPath, headBranch, runner);
    if (existing) {
      preflight.existingPullRequestUrl = existing;
      warnings.push('An open pull request already exists for this branch.');
    }
  }

  // Seeded last, so it can use the commit list gathered above. A single
  // commit's subject is almost always the right title; more than one and the
  // branch name is a better summary than any one of them.
  const [firstSubject] = preflight.commitSubjects;
  preflight.suggestedTitle =
    preflight.commitSubjects.length === 1 && firstSubject
      ? firstSubject
      : titleFromBranchName(headBranch);

  const template = readPullRequestTemplate(repoPath);
  preflight.suggestedBody =
    template ??
    (preflight.commitSubjects.length > 1
      ? preflight.commitSubjects.map((subject) => `- ${subject}`).join('\n')
      : '');

  return preflight;
}

/** Maps a gh failure onto a code the window can act on. */
function classifyCreateFailure(stderr: string): { code: PullRequestErrorCode; message: string } {
  const lower = stderr.toLowerCase();

  if (lower.includes('already exists')) {
    return { code: 'PR_EXISTS', message: 'A pull request for this branch already exists.' };
  }
  if (lower.includes('protected branch') || lower.includes('not authorized')) {
    return {
      code: 'PROTECTED_BRANCH',
      message: 'GitHub rejected the request: the base branch is protected or you lack permission.'
    };
  }
  if (lower.includes('no commits between')) {
    return {
      code: 'NO_COMMITS_AHEAD',
      message: 'There are no commits between the base and compare branches.'
    };
  }
  if (lower.includes('authentication') || lower.includes('gh auth login')) {
    return { code: 'AUTH_REQUIRED', message: 'GitHub CLI authentication has expired. Run "gh auth login".' };
  }

  return { code: 'PROVIDER_ERROR', message: stderr };
}

/**
 * Publishes the head branch.
 *
 * Injectable for the same reason the runner is: "the push landed but creating
 * the pull request then failed" is a state the window has to handle correctly,
 * and it is not reachable in a test that has to reach a real remote.
 */
export type PushBranch = (
  repoPath: string,
  branch: string,
  profileId: string | undefined
) => Promise<void>;

const defaultPush: PushBranch = async (repoPath, branch, profileId) => {
  // Through the profile pipeline, so the push uses the selected SSH identity
  // and its stored passphrase rather than whatever the ambient environment
  // happens to offer.
  await runSyncOperationWithProfile(
    repoPath,
    ['push', '--set-upstream', 'origin', branch],
    profileId,
    undefined
  );
};

export interface CreateOptions extends PullRequestCreateInput {
  runner?: ExecutableRunner | undefined;
  push?: PushBranch | undefined;
}

export async function createPullRequest(
  options: CreateOptions
): Promise<PullRequestCreateResult> {
  const { repoPath, runner } = options;

  // Branch names reach gh's argv. Without this a branch called `--repo` would
  // be read as a flag rather than a ref.
  const base = refArg(options.baseBranch, 'Base branch');
  const head = refArg(options.headBranch, 'Compare branch');

  const title = options.title.trim();
  if (title === '') {
    throw new PullRequestError('VALIDATION', 'A pull request title is required.');
  }
  if (base === head) {
    throw new PullRequestError('VALIDATION', 'The base and compare branches must differ.');
  }

  const availability = await checkGithubAvailability(runner);
  if (!availability.available) {
    throw new PullRequestError(
      availability.reason === 'not-installed' ? 'CLI_MISSING' : 'AUTH_REQUIRED',
      availability.message ?? 'GitHub CLI is not available.'
    );
  }

  let pushed = false;

  if (options.pushFirst) {
    try {
      await (options.push ?? defaultPush)(repoPath, head, options.profileId);
      pushed = true;
    } catch (error) {
      throw new PullRequestError(
        'PUSH_FAILED',
        error instanceof Error ? error.message : 'Could not push the branch.',
        { statusCode: 502 }
      );
    }
  } else if (!(await remoteBranchExists(repoPath, head))) {
    throw new PullRequestError(
      'HEAD_NOT_PUSHED',
      `${head} does not exist on origin yet. Choose "Push and create" to publish it first.`
    );
  }

  const args = ['pr', 'create', '--base', base, '--head', head, '--title', title];

  // The body goes over stdin. A Markdown body contains newlines, quotes and
  // backticks, and there is no quoting of it into a command line that is worth
  // trusting.
  args.push('--body-file', '-');

  if (options.draft) {
    args.push('--draft');
  }
  for (const reviewer of options.reviewers ?? []) {
    args.push('--reviewer', reviewer);
  }
  for (const assignee of options.assignees ?? []) {
    args.push('--assignee', assignee);
  }
  for (const label of options.labels ?? []) {
    args.push('--label', label);
  }

  const result = await runGh(args, {
    cwd: repoPath,
    input: options.body ?? '',
    ...(runner ? { runner } : {})
  });

  if (!result.ok) {
    const { code, message } = classifyCreateFailure(ghErrorMessage(result, 'gh pr create failed.'));
    throw new PullRequestError(code, message, { statusCode: 502, pushed });
  }

  const url = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line))
    .pop();

  if (!url) {
    throw new PullRequestError(
      'PROVIDER_ERROR',
      'The pull request was created, but gh did not report its URL.',
      { statusCode: 502, pushed }
    );
  }

  const number = Number.parseInt(url.split('/').pop() ?? '', 10);

  return {
    provider: 'github',
    number: Number.isFinite(number) ? number : 0,
    url,
    state: options.draft ? 'draft' : 'open'
  };
}

/**
 * `maintainerCanModify` is accepted by the API but not settable through
 * `gh pr create`, which always creates with it enabled. Reported rather than
 * silently ignored.
 */
export const MAINTAINER_MODIFY_NOTE =
  'GitHub CLI always allows maintainer edits on a new pull request; this setting cannot be changed here yet.';
