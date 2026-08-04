// Pull-request payloads, shared by the server routes and the creator window.

import type { HostingProviderId } from './provider-types';

/**
 * Everything the creator needs to know before it lets someone press Create.
 *
 * Gathered in one call on purpose: the window opens with a complete picture
 * rather than filling in over four round trips, which is what made the state
 * "is this button safe to press yet?" ambiguous in every client that does it
 * piecemeal.
 */
export interface PullRequestPreflight {
  provider: HostingProviderId;
  authenticated: boolean;
  cliAvailable: boolean;
  headBranch: string;
  headPushed: boolean;
  defaultBaseBranch: string;
  /** Local branches offered in the base/head selectors. */
  branches: string[];
  commitsAhead: number;
  commitsBehind: number;
  existingPullRequestUrl?: string;
  /** owner/repo of the repository the PR would target. */
  targetRepo?: string;
  /** Set when head lives in a fork and base is upstream. */
  forkOwner?: string;
  isDetachedHead: boolean;
  hasUncommittedChanges: boolean;
  /** Subject lines of the commits that would be included, newest first. */
  commitSubjects: string[];
  changedFileCount: number;
  /** Seeded title, from the branch's single commit or its name. */
  suggestedTitle: string;
  /** Seeded body, from the repository's PR template or the commit bodies. */
  suggestedBody: string;
  /** Non-blocking things the user should read before creating. */
  warnings: string[];
}

export interface PullRequestCreateInput {
  repoPath: string;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
  draft: boolean;
  maintainerCanModify: boolean;
  reviewers?: string[];
  assignees?: string[];
  labels?: string[];
  /** Push the head branch first. Required when preflight says it is unpushed. */
  pushFirst?: boolean;
  /** SSH profile the push should authenticate with. */
  profileId?: string;
}

export interface PullRequestCreateResult {
  provider: HostingProviderId;
  number: number;
  url: string;
  state: 'draft' | 'open';
}

/**
 * Typed failure reasons.
 *
 * The window picks an action from these rather than matching on prose, so a
 * reworded `gh` message cannot turn a recoverable state into a dead end.
 */
export type PullRequestErrorCode =
  | 'CLI_MISSING'
  | 'AUTH_REQUIRED'
  | 'NOT_A_GITHUB_REMOTE'
  | 'NO_COMMITS_AHEAD'
  | 'HEAD_NOT_PUSHED'
  | 'PUSH_FAILED'
  | 'PR_EXISTS'
  | 'PROTECTED_BRANCH'
  | 'DETACHED_HEAD'
  | 'VALIDATION'
  | 'CANCELLED'
  | 'PROVIDER_ERROR';

export interface PullRequestPreflightResponse {
  success: true;
  preflight: PullRequestPreflight;
}

export interface PullRequestCreateResponse {
  success: boolean;
  pullRequest?: PullRequestCreateResult;
  error?: string;
  code?: PullRequestErrorCode;
  /**
   * True when the branch was pushed but creating the PR then failed.
   *
   * The window keeps the form open and says so, because retrying must not
   * push again and the user needs to know the push already landed.
   */
  pushed?: boolean;
}
