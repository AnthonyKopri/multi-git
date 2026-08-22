// Repository maintenance: the definition of stale, and the purge it feeds.
//
// The rule evaluation is pure, so it is tested as arithmetic — including the
// cases that decide whether something gets deleted on evidence that was never
// gathered. The rest runs against real repositories and a real git, because
// the whole point of the purge is what it does to folders and refs.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';

import {
  daysSince,
  evaluateStaleness,
  parsePullRequestList,
  purgeWorktrees,
  readMergeBase,
  surveyMaintenance
} from '../src/server/git/maintenance';
import { clearWorktreeCaches } from '../src/server/git/worktrees';
import { clearCheckpoints } from '../src/server/safety-net/checkpoints';
import { clearRecoveryCache } from '../src/server/safety-net/recovery';
import { validateStaleRules } from '../src/server/config/validate';
import { DEFAULT_STALE_RULES } from '../src/shared/maintenance-types';
import { cleanupRepos, createRepoWithHistory, createTempDir, git, writeFile } from './helpers/temp-repo';
import type { BranchFacts, StaleRules } from '../src/shared/maintenance-types';

const DAY_MS = 24 * 60 * 60 * 1000;

function facts(overrides: Partial<BranchFacts> = {}): BranchFacts {
  return {
    name: 'feature/login',
    lastCommit: '2026-01-01T00:00:00Z',
    daysSinceCommit: 90,
    pushed: false,
    upstreamGone: false,
    pullRequest: null,
    pullRequestKnown: true,
    merged: false,
    isCurrent: false,
    pinned: false,
    checkedOutIn: null,
    ...overrides
  };
}

function rules(overrides: Partial<StaleRules> = {}): StaleRules {
  return { ...DEFAULT_STALE_RULES, ...overrides };
}

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  const headers = (req: request.Test): request.Test =>
    req.set('Host', '127.0.0.1').set('x-repo-path', repo);

  return {
    get: (url: string) => headers(agent.get(url)),
    post: (url: string) => headers(agent.post(url))
  };
}

beforeEach(() => {
  clearRepoPathCache();
  clearWorktreeCaches();
  clearCheckpoints();
  clearRecoveryCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('the definition of stale', () => {
  it('needs every ticked rule under "all"', () => {
    const strict = rules({ requireNoPullRequest: true, requireUnpushed: true, requireInactive: true });

    expect(evaluateStaleness(facts(), strict).stale).toBe(true);
    // Pushed, so one of the three no longer holds.
    expect(evaluateStaleness(facts({ pushed: true }), strict).stale).toBe(false);
  });

  it('needs only one ticked rule under "any"', () => {
    const loose = rules({
      match: 'any',
      requireNoPullRequest: true,
      requireUnpushed: true,
      requireInactive: true
    });

    expect(evaluateStaleness(facts({ pushed: true, daysSinceCommit: 2 }), loose).stale).toBe(true);
  });

  it('counts a branch as inactive only once the threshold is reached', () => {
    const inactiveOnly = rules({
      requireNoPullRequest: false,
      requireUnpushed: false,
      requireInactive: true,
      inactiveDays: 30
    });

    expect(evaluateStaleness(facts({ daysSinceCommit: 29 }), inactiveOnly).stale).toBe(false);
    expect(evaluateStaleness(facts({ daysSinceCommit: 30 }), inactiveOnly).stale).toBe(true);
  });

  it('never treats an unanswered pull-request lookup as evidence', () => {
    const withPrRule = rules({ requireNoPullRequest: true, requireInactive: false });
    const verdict = evaluateStaleness(facts({ pullRequestKnown: false }), withPrRule);

    expect(verdict.stale).toBe(false);
    expect(verdict.unknown).toEqual(['no-pull-request']);
    expect(verdict.signals).toEqual([]);
  });

  it('does not resurrect a branch that had a pull request, whatever its state', () => {
    const withPrRule = rules({ requireNoPullRequest: true, requireInactive: false });
    const closed = facts({ pullRequest: { number: 12, state: 'CLOSED', url: 'https://x/12' } });

    // A closed pull request still means the work was proposed to somebody.
    expect(evaluateStaleness(closed, withPrRule).stale).toBe(false);
  });

  it('calls nothing stale when every rule is switched off', () => {
    const none = rules({
      requireNoPullRequest: false,
      requireUnpushed: false,
      requireInactive: false
    });

    expect(evaluateStaleness(facts(), none).stale).toBe(false);
  });

  it('reports a reason for each signal that held', () => {
    const strict = rules({ requireNoPullRequest: true, requireUnpushed: true, requireInactive: true });
    const verdict = evaluateStaleness(facts({ daysSinceCommit: 91 }), strict);

    expect(verdict.reasons).toEqual([
      'no pull request was ever opened',
      'never pushed to a remote',
      'no commits for 91 days'
    ]);
  });

  it('says so when the remote branch was deleted rather than never pushed', () => {
    const unpushedOnly = rules({
      requireNoPullRequest: false,
      requireUnpushed: true,
      requireInactive: false
    });

    expect(evaluateStaleness(facts({ upstreamGone: true }), unpushedOnly).reasons).toEqual([
      'its remote branch is gone'
    ]);
  });

  it('cannot judge inactivity without a date', () => {
    const inactiveOnly = rules({ requireNoPullRequest: false, requireInactive: true });
    const verdict = evaluateStaleness(facts({ daysSinceCommit: null }), inactiveOnly);

    expect(verdict.stale).toBe(false);
    expect(verdict.unknown).toEqual(['inactive']);
  });
});

describe('daysSince', () => {
  const now = Date.parse('2026-08-21T12:00:00Z');

  it('floors, so a partial day does not reach the threshold early', () => {
    expect(daysSince(new Date(now - 30 * DAY_MS + 3600_000).toISOString(), now)).toBe(29);
  });

  it('is null for anything that is not a date', () => {
    expect(daysSince('', now)).toBeNull();
    expect(daysSince('not a date', now)).toBeNull();
  });
});

describe('reading gh output', () => {
  it('indexes pull requests by their head branch', () => {
    const index = parsePullRequestList(
      JSON.stringify([
        { number: 7, state: 'MERGED', url: 'https://x/7', headRefName: 'feature/login' },
        { number: 8, state: 'OPEN', url: 'https://x/8', headRefName: 'spike/perf' }
      ])
    );

    expect(index.get('feature/login')).toEqual({
      number: 7,
      state: 'MERGED',
      url: 'https://x/7'
    });
    expect(index.size).toBe(2);
  });

  it('keeps the newest pull request when a branch has several', () => {
    const index = parsePullRequestList(
      JSON.stringify([
        { number: 9, state: 'OPEN', url: 'https://x/9', headRefName: 'feature/login' },
        { number: 3, state: 'CLOSED', url: 'https://x/3', headRefName: 'feature/login' }
      ])
    );

    expect(index.get('feature/login')?.number).toBe(9);
  });

  it('survives output that is not the JSON it expected', () => {
    // A gh that printed a banner, or a version whose --json behaves
    // differently, must not be read as "no branch has a pull request".
    expect(parsePullRequestList('gh: command failed').size).toBe(0);
    expect(parsePullRequestList('{"not":"an array"}').size).toBe(0);
    expect(parsePullRequestList(JSON.stringify([{ headRefName: 'x' }])).size).toBe(0);
  });
});

describe('validating the stored rules', () => {
  it('clamps a day count that would call everything stale', () => {
    expect(validateStaleRules({ inactiveDays: 0 })?.inactiveDays).toBe(1);
    expect(validateStaleRules({ inactiveDays: 999_999 })?.inactiveDays).toBe(3650);
  });

  it('fills in the shipped default for anything missing rather than dropping the record', () => {
    expect(validateStaleRules({ requireUnpushed: true })).toEqual({
      ...DEFAULT_STALE_RULES,
      requireUnpushed: true
    });
  });

  it('accepts only the two match modes', () => {
    expect(validateStaleRules({ match: 'any' })?.match).toBe('any');
    expect(validateStaleRules({ match: 'whatever' })?.match).toBe('all');
  });
});

// ---------- against real repositories ----------

/** A repository, a folder to hang worktrees off, and a branch in each. */
function repoWithWorktrees(): { repo: string; parent: string } {
  const repo = createRepoWithHistory();
  const parent = createTempDir('multi-git-maint-');
  return { repo, parent };
}

function addWorktree(repo: string, parent: string, branch: string): string {
  const target = path.join(parent, branch.replace(/\//g, '-'));
  git(repo, 'worktree', 'add', '-b', branch, target);
  return target;
}

/** Rules that need no network: inactivity alone, with a zero-day threshold. */
const localRules = (inactiveDays = 1): StaleRules => ({
  inactiveDays,
  requireNoPullRequest: false,
  requireUnpushed: true,
  requireInactive: false,
  match: 'all'
});

describe('surveying a repository', () => {
  it('offers an unpushed worktree and never the repository itself', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');

    const survey = await surveyMaintenance(repo, { rules: localRules() });

    expect(survey.staleWorktrees.map((candidate) => candidate.path)).toEqual([login]);
    expect(survey.staleWorktrees[0]).toMatchObject({
      branch: 'feature/login',
      dirty: false,
      present: true,
      branchDeletable: true
    });
    expect(survey.keptWorktrees.map((entry) => entry.reason)).toContain('the repository itself');
  });

  it('never offers the worktree the window is open on', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');

    // The survey is asked from inside the linked worktree this time.
    const survey = await surveyMaintenance(login, { rules: localRules() });

    expect(survey.staleWorktrees).toHaveLength(0);
    expect(survey.keptWorktrees.map((entry) => entry.reason)).toContain('open in this window');
  });

  it('never offers a locked worktree, and says that is why', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');
    git(repo, 'worktree', 'lock', '--reason', 'on the build machine', login);

    const survey = await surveyMaintenance(repo, { rules: localRules() });

    expect(survey.staleWorktrees).toHaveLength(0);
    expect(survey.keptWorktrees.map((entry) => entry.reason)).toContain(
      'locked — on the build machine'
    );
  });

  it('flags uncommitted work instead of hiding it', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');
    fs.writeFileSync(path.join(login, 'scratch.txt'), 'half a thought\n');

    const survey = await surveyMaintenance(repo, { rules: localRules() });

    expect(survey.staleWorktrees[0]).toMatchObject({ dirty: true, uncommittedFiles: 1 });
  });

  it('warns, and lists nothing, when the pull-request rule cannot be answered', async () => {
    const { repo, parent } = repoWithWorktrees();
    addWorktree(repo, parent, 'feature/login');

    // No origin at all, so there is nothing to ask about pull requests.
    const survey = await surveyMaintenance(repo, {
      rules: { ...DEFAULT_STALE_RULES, inactiveDays: 1, requireInactive: false }
    });

    expect(survey.staleWorktrees).toHaveLength(0);
    expect(survey.pullRequestLookup).toBe('not-github');
    expect(survey.warnings.join(' ')).toContain('Nothing can be listed while that rule is ticked');
  });

  it('lists a merged branch, and leaves out the one that is checked out', async () => {
    const { repo, parent } = repoWithWorktrees();

    git(repo, 'switch', '-c', 'feature/done');
    writeFile(repo, 'done.txt', 'finished\n');
    git(repo, 'add', 'done.txt');
    git(repo, 'commit', '-m', 'feat: finish it');
    git(repo, 'switch', 'main');
    git(repo, 'merge', '--no-ff', '-m', 'merge: bring it in', 'feature/done');

    // Merged, but held by a worktree, so deleting it is not on offer.
    git(repo, 'branch', 'feature/held');
    addWorktree(repo, parent, 'feature/spare');
    git(repo, 'worktree', 'add', path.join(parent, 'held'), 'feature/held');

    const survey = await surveyMaintenance(repo, { rules: localRules() });
    const byName = new Map(survey.mergedBranches.map((entry) => [entry.name, entry]));

    expect(byName.get('feature/done')).toMatchObject({ deletable: true });
    expect(byName.get('feature/held')).toMatchObject({
      deletable: false,
      blockedReason: 'checked out in held'
    });
    // The branch the survey was run on is never offered for deletion.
    expect(byName.has('main')).toBe(false);
  });

  it('measures merged against the default branch it can find', async () => {
    const repo = createRepoWithHistory();
    expect(await readMergeBase(repo)).toBe('main');
  });
});

describe('purging', () => {
  it('removes the worktree and its branch together', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');

    const result = await purgeWorktrees(repo, {
      paths: [login],
      deleteBranches: true,
      includeDirty: false,
      forceBranchDelete: true
    });

    expect(result.removed).toBe(1);
    expect(result.branchesDeleted).toBe(1);
    expect(fs.existsSync(login)).toBe(false);
    expect(git(repo, 'branch', '--list', 'feature/login').trim()).toBe('');
  });

  it('keeps an unmerged branch unless force was asked for, and says why', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');
    writeFile(login, 'work.txt', 'unmerged work\n');
    git(login, 'add', 'work.txt');
    git(login, 'commit', '-m', 'feat: unmerged');

    const result = await purgeWorktrees(repo, {
      paths: [login],
      deleteBranches: true,
      includeDirty: false,
      forceBranchDelete: false
    });

    expect(result.removed).toBe(1);
    expect(result.branchesDeleted).toBe(0);
    expect(result.results[0]?.branchError).toContain('not merged');
    expect(git(repo, 'branch', '--list', 'feature/login')).toContain('feature/login');
  });

  it('leaves the branch alone when it was not asked to delete branches', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');

    await purgeWorktrees(repo, {
      paths: [login],
      deleteBranches: false,
      includeDirty: false,
      forceBranchDelete: false
    });

    expect(git(repo, 'branch', '--list', 'feature/login')).toContain('feature/login');
  });

  it('skips a worktree with uncommitted changes rather than losing the work', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');
    fs.writeFileSync(path.join(login, 'scratch.txt'), 'half a thought\n');

    const result = await purgeWorktrees(repo, {
      paths: [login],
      deleteBranches: true,
      includeDirty: false,
      forceBranchDelete: false
    });

    expect(result.removed).toBe(0);
    expect(result.results[0]?.error).toContain('uncommitted changes');
    expect(fs.existsSync(login)).toBe(true);
  });

  it('snapshots tracked work before purging a dirty worktree that was opted in', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');
    fs.appendFileSync(path.join(login, 'README.md'), 'a tracked edit\n');

    const result = await purgeWorktrees(repo, {
      paths: [login],
      deleteBranches: false,
      includeDirty: true,
      forceBranchDelete: false
    });

    const snapshot = result.results[0]?.snapshotRef;
    expect(result.removed).toBe(1);
    expect(snapshot).toBeTruthy();
    // The snapshot lives in the shared object store, so it outlived the folder.
    expect(git(repo, 'show', '--stat', snapshot as string)).toContain('README.md');
  });

  it('refuses the main worktree, whatever the request says', async () => {
    const { repo } = repoWithWorktrees();

    const result = await purgeWorktrees(repo, {
      paths: [repo],
      deleteBranches: true,
      includeDirty: true,
      forceBranchDelete: true
    });

    expect(result.removed).toBe(0);
    expect(result.results[0]?.error).toContain('the repository itself');
    expect(fs.existsSync(repo)).toBe(true);
  });

  it('refuses a path that is not a worktree of this repository', async () => {
    const { repo } = repoWithWorktrees();
    const elsewhere = createTempDir('multi-git-elsewhere-');

    const result = await purgeWorktrees(repo, {
      paths: [elsewhere],
      deleteBranches: false,
      includeDirty: false,
      forceBranchDelete: false
    });

    expect(result.results[0]?.error).toContain('not a worktree');
    expect(fs.existsSync(elsewhere)).toBe(true);
  });

  it('reports each worktree separately rather than stopping at the first refusal', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');
    const spike = addWorktree(repo, parent, 'spike/perf');
    fs.writeFileSync(path.join(login, 'scratch.txt'), 'in progress\n');

    const result = await purgeWorktrees(repo, {
      paths: [login, spike],
      deleteBranches: true,
      includeDirty: false,
      forceBranchDelete: true
    });

    expect(result.removed).toBe(1);
    expect(fs.existsSync(login)).toBe(true);
    expect(fs.existsSync(spike)).toBe(false);
  });

  it('purges a worktree whose folder someone already deleted', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');
    fs.rmSync(login, { recursive: true, force: true });

    const result = await purgeWorktrees(repo, {
      paths: [login],
      deleteBranches: true,
      includeDirty: false,
      forceBranchDelete: true
    });

    expect(result.removed).toBe(1);
    expect(git(repo, 'worktree', 'list')).not.toContain('feature-login');
  });
});

describe('the routes', () => {
  it('surveys a repository with the stored rules', async () => {
    const { repo, parent } = repoWithWorktrees();
    addWorktree(repo, parent, 'feature/login');

    const { body } = await api(repo).get('/api/maintenance/survey').expect(200);

    // The shipped rules include the pull-request one, and this repository has
    // no GitHub origin to ask, so the tab is told why its list is empty rather
    // than being handed one built on evidence nobody gathered.
    expect(body.survey.rules).toEqual(DEFAULT_STALE_RULES);
    expect(body.survey.pullRequestLookup).toBe('not-github');
    expect(body.survey.staleWorktrees).toHaveLength(0);
    expect(body.survey.warnings).toHaveLength(1);
  });

  it('refuses a purge that names nothing', async () => {
    const { repo } = repoWithWorktrees();

    await api(repo).post('/api/maintenance/purge-worktrees').send({ paths: [] }).expect(400);
    await api(repo).post('/api/maintenance/purge-worktrees').send({}).expect(400);
    await api(repo)
      .post('/api/maintenance/purge-worktrees')
      .send({ paths: [''] })
      .expect(400);
  });

  it('purges over HTTP, and defaults every escalation to off', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');
    fs.writeFileSync(path.join(login, 'scratch.txt'), 'in progress\n');

    // No includeDirty in the body, so the worktree holding work survives.
    const { body } = await api(repo)
      .post('/api/maintenance/purge-worktrees')
      .send({ paths: [login] })
      .expect(200);

    expect(body.removed).toBe(0);
    expect(fs.existsSync(login)).toBe(true);

    const purged = await api(repo)
      .post('/api/maintenance/purge-worktrees')
      .send({ paths: [login], includeDirty: true, deleteBranches: true, forceBranchDelete: true })
      .expect(200);

    expect(purged.body.removed).toBe(1);
    expect(fs.existsSync(login)).toBe(false);
  });

  it('records a recovery point before it removes anything', async () => {
    const { repo, parent } = repoWithWorktrees();
    const login = addWorktree(repo, parent, 'feature/login');

    await api(repo)
      .post('/api/maintenance/purge-worktrees')
      .send({ paths: [login], deleteBranches: true, forceBranchDelete: true })
      .expect(200);

    const { body } = await api(repo).get('/api/git/recovery').expect(200);
    const point = body.points[0];

    expect(point.operation).toBe('worktree-remove');
    // The branch tip is in the point, so the purge can be undone.
    expect(Object.keys(point.refs)).toContain('refs/heads/feature/login');
  });
});
