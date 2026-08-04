// The pull-request lane, against real git repositories and a scripted gh.
//
// git is real because the preflight's whole job is reading repository state.
// gh is scripted because these must pass with no GitHub account, no network,
// and no CLI installed — which is also every one of the failure states the
// window has to handle.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  createPullRequest,
  preflightPullRequest,
  PullRequestError,
  titleFromBranchName
} from '../src/server/providers/github-pull-requests';
import {
  ghErrorMessage,
  isGithubRemote,
  ownerRepoFromRemote,
  readPullRequestTemplate
} from '../src/server/providers/github';
import { FakeRunner, command } from './helpers/fake-runner';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

/** A gh that is installed, signed in, and has no existing PR. */
function signedInGh(): FakeRunner {
  return new FakeRunner()
    .on(command('gh', '--version'), { stdout: 'gh version 2.60.0' })
    .on(command('gh', 'auth', 'status'), { stdout: 'Logged in to github.com account octocat' })
    .on(command('gh', 'pr', 'list'), { stdout: '' })
    .on(command('gh', 'repo', 'view'), { stdout: 'main' })
    .on(command('gh', 'pr', 'create'), {
      stdout: 'https://github.com/octocat/demo/pull/42\n'
    });
}

let repo: string;

beforeEach(() => {
  repo = createRepoWithHistory();
  git(repo, 'remote', 'add', 'origin', 'git@github.com:octocat/demo.git');
});

afterAll(() => {
  cleanupRepos();
});

describe('remote recognition', () => {
  it('recognises github.com and Enterprise hosts', () => {
    expect(isGithubRemote('git@github.com:octocat/demo.git')).toBe(true);
    expect(isGithubRemote('https://github.com/octocat/demo.git')).toBe(true);
    expect(isGithubRemote('git@github.acme-corp.com:team/app.git')).toBe(true);
  });

  it('rejects other hosts and nothing at all', () => {
    expect(isGithubRemote('git@gitlab.com:team/app.git')).toBe(false);
    expect(isGithubRemote('')).toBe(false);
    expect(isGithubRemote(null)).toBe(false);
  });

  it('extracts owner/repo from either protocol', () => {
    expect(ownerRepoFromRemote('git@github.com:octocat/demo.git')).toBe('octocat/demo');
    expect(ownerRepoFromRemote('https://github.com/octocat/demo')).toBe('octocat/demo');
    expect(ownerRepoFromRemote('not a url')).toBeNull();
  });
});

describe('titleFromBranchName', () => {
  it('turns a branch name into a sentence', () => {
    expect(titleFromBranchName('feat/add-login-page')).toBe('Add login page');
    expect(titleFromBranchName('fix-crash_on_open')).toBe('Crash on open');
    expect(titleFromBranchName('cleanup')).toBe('Cleanup');
  });
});

describe('ghErrorMessage', () => {
  it('uses the last actionable line', () => {
    const result = { ok: false, stdout: '', stderr: 'banner\n---\nGraphQL: bad thing', exitCode: 1, missing: false };

    expect(ghErrorMessage(result, 'fallback')).toBe('GraphQL: bad thing');
  });

  it('falls back when there is nothing to read', () => {
    expect(ghErrorMessage({ ok: false, stdout: '', stderr: '', exitCode: 1, missing: false }, 'fallback')).toBe(
      'fallback'
    );
  });
});

describe('readPullRequestTemplate', () => {
  it('finds a template in .github', () => {
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    writeFile(repo, '.github/pull_request_template.md', '## What changed\n');

    expect(readPullRequestTemplate(repo)).toContain('## What changed');
  });

  it('returns null when the repository has none', () => {
    expect(readPullRequestTemplate(repo)).toBeNull();
  });
});

describe('preflight', () => {
  it('reports the current branch and the default base', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/thing');
    writeFile(repo, 'a.txt', 'change');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'feat: add a thing');

    const preflight = await preflightPullRequest({ repoPath: repo, runner: signedInGh() });

    expect(preflight.provider).toBe('github');
    expect(preflight.headBranch).toBe('feat/thing');
    expect(preflight.authenticated).toBe(true);
    expect(preflight.cliAvailable).toBe(true);
    expect(preflight.targetRepo).toBe('octocat/demo');
    expect(preflight.branches).toContain('feat/thing');
  });

  it('warns that an unpushed branch needs publishing', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/unpushed');
    writeFile(repo, 'a.txt', 'change');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'feat: unpushed work');

    const preflight = await preflightPullRequest({ repoPath: repo, runner: signedInGh() });

    expect(preflight.headPushed).toBe(false);
    expect(preflight.warnings.join(' ')).toContain('has not been pushed');
  });

  it('reports a detached HEAD instead of offering to create', async () => {
    const hash = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'checkout', '-q', '--detach', hash);

    const preflight = await preflightPullRequest({ repoPath: repo, runner: signedInGh() });

    expect(preflight.isDetachedHead).toBe(true);
    expect(preflight.warnings.join(' ')).toContain('detached');
  });

  it('warns when the remote is not GitHub', async () => {
    git(repo, 'remote', 'set-url', 'origin', 'git@gitlab.com:team/app.git');

    const preflight = await preflightPullRequest({ repoPath: repo, runner: signedInGh() });

    expect(preflight.warnings.join(' ')).toContain('not a GitHub repository');
  });

  it('warns when there is no remote at all', async () => {
    git(repo, 'remote', 'remove', 'origin');

    const preflight = await preflightPullRequest({ repoPath: repo, runner: signedInGh() });

    expect(preflight.warnings.join(' ')).toContain('no origin remote');
  });

  it('reports a missing CLI without failing the whole preflight', async () => {
    const runner = new FakeRunner().on(command('gh'), { spawnError: true });

    const preflight = await preflightPullRequest({ repoPath: repo, runner });

    expect(preflight.cliAvailable).toBe(false);
    expect(preflight.authenticated).toBe(false);
    expect(preflight.warnings.join(' ')).toContain('cli.github.com');
  });

  it('reports expired authentication distinctly from a missing CLI', async () => {
    const runner = new FakeRunner()
      .on(command('gh', '--version'), { stdout: 'gh version 2.60.0' })
      .on(command('gh', 'auth', 'status'), { exitCode: 1, stderr: 'not logged in' });

    const preflight = await preflightPullRequest({ repoPath: repo, runner });

    expect(preflight.cliAvailable).toBe(true);
    expect(preflight.authenticated).toBe(false);
    expect(preflight.warnings.join(' ')).toContain('gh auth login');
  });

  it('surfaces an existing open pull request', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/dup');
    const runner = signedInGh().on(command('gh', 'pr', 'list'), {
      stdout: 'https://github.com/octocat/demo/pull/7\n'
    });

    const preflight = await preflightPullRequest({ repoPath: repo, runner });

    expect(preflight.existingPullRequestUrl).toBe('https://github.com/octocat/demo/pull/7');
    expect(preflight.warnings.join(' ')).toContain('already exists');
  });

  it('warns about uncommitted changes', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/dirty');
    writeFile(repo, 'dirty.txt', 'not committed');

    const preflight = await preflightPullRequest({ repoPath: repo, runner: signedInGh() });

    expect(preflight.hasUncommittedChanges).toBe(true);
    expect(preflight.warnings.join(' ')).toContain('uncommitted changes');
  });

  it('seeds the title from a single commit subject', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/single');
    writeFile(repo, 'a.txt', 'change');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'feat: exactly one commit');

    const preflight = await preflightPullRequest({
      repoPath: repo,
      baseBranch: 'main',
      runner: signedInGh()
    });

    expect(preflight.commitsAhead).toBe(1);
    expect(preflight.suggestedTitle).toBe('feat: exactly one commit');
  });

  it('falls back to the branch name and lists commits when there are several', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/several-things');
    for (const [index, message] of ['feat: first', 'feat: second'].entries()) {
      // The filename cannot echo the commit subject: NTFS rejects a colon.
      writeFile(repo, `change-${index}.txt`, 'x');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', message);
    }

    const preflight = await preflightPullRequest({
      repoPath: repo,
      baseBranch: 'main',
      runner: signedInGh()
    });

    expect(preflight.commitsAhead).toBe(2);
    expect(preflight.suggestedTitle).toBe('Several things');
    expect(preflight.suggestedBody).toContain('- feat: first');
    expect(preflight.suggestedBody).toContain('- feat: second');
  });

  it('prefers a repository template over generated body text', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/templated');
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    writeFile(repo, '.github/pull_request_template.md', '## Checklist\n- [ ] tests\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'chore: template');

    const preflight = await preflightPullRequest({
      repoPath: repo,
      baseBranch: 'main',
      runner: signedInGh()
    });

    expect(preflight.suggestedBody).toContain('## Checklist');
  });

  it('warns when the branch has nothing the base lacks', async () => {
    const preflight = await preflightPullRequest({
      repoPath: repo,
      baseBranch: 'main',
      headBranch: 'main',
      runner: signedInGh()
    });

    expect(preflight.warnings.join(' ')).toContain('same');
  });
});

describe('createPullRequest', () => {
  const baseInput = {
    baseBranch: 'main',
    headBranch: 'feat/thing',
    title: 'feat: add a thing',
    body: 'Body with `backticks`, "quotes" and\nnewlines.',
    draft: false,
    maintainerCanModify: true
  };

  /**
   * Makes the branch look already published.
   *
   * The remote-tracking ref is what preflight reads, so this needs no network
   * and no real origin.
   */
  function withPushedHead(runner: FakeRunner): FakeRunner {
    git(repo, 'branch', '-f', 'feat/thing');
    git(repo, 'update-ref', 'refs/remotes/origin/feat/thing', 'HEAD');
    return runner;
  }

  it('rejects an empty title before running anything', async () => {
    const runner = signedInGh();

    await expect(
      createPullRequest({ ...baseInput, repoPath: repo, title: '   ', runner })
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    expect(runner.calls).toHaveLength(0);
  });

  it('rejects a base equal to head', async () => {
    await expect(
      createPullRequest({
        ...baseInput,
        repoPath: repo,
        headBranch: 'main',
        runner: signedInGh()
      })
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses a branch name that git would read as an option', async () => {
    await expect(
      createPullRequest({
        ...baseInput,
        repoPath: repo,
        headBranch: '--upload-pack=touch /tmp/pwned',
        runner: signedInGh()
      })
    ).rejects.toThrow();
  });

  it('sends the body over stdin rather than in argv', async () => {
    const runner = withPushedHead(signedInGh());

    await createPullRequest({ ...baseInput, repoPath: repo, runner });

    const create = runner.callsTo('gh').find((call) => call.args.includes('create'));
    // A Markdown body has newlines, quotes and backticks. There is no quoting
    // of that into a command line worth trusting.
    expect(create?.args).toContain('--body-file');
    expect(create?.args).toContain('-');
    expect(create?.options.input).toBe(baseInput.body);
    expect(create?.args.join(' ')).not.toContain('backticks');
  });

  it('returns the number and URL gh printed', async () => {
    const runner = withPushedHead(signedInGh());

    const result = await createPullRequest({
      ...baseInput,
      repoPath: repo,
      runner
    });

    expect(result).toEqual({
      provider: 'github',
      number: 42,
      url: 'https://github.com/octocat/demo/pull/42',
      state: 'open'
    });
  });

  it('passes --draft and reports the draft state', async () => {
    const runner = withPushedHead(signedInGh());

    const result = await createPullRequest({
      ...baseInput,
      repoPath: repo,
      draft: true,
      runner
    });

    expect(runner.callsTo('gh').some((call) => call.args.includes('--draft'))).toBe(true);
    expect(result.state).toBe('draft');
  });

  it('passes reviewers, assignees and labels as separate arguments', async () => {
    const runner = withPushedHead(signedInGh());

    await createPullRequest({
      ...baseInput,
      repoPath: repo,
      reviewers: ['octocat'],
      assignees: ['hubot'],
      labels: ['bug', 'needs review'],
      runner
    });

    const create = runner.callsTo('gh').find((call) => call.args.includes('create'));
    expect(create?.args).toEqual(expect.arrayContaining(['--reviewer', 'octocat']));
    expect(create?.args).toEqual(expect.arrayContaining(['--assignee', 'hubot']));
    expect(create?.args).toEqual(expect.arrayContaining(['--label', 'needs review']));
  });

  it('refuses to create when the head is unpushed and push was not requested', async () => {
    await expect(
      createPullRequest({ ...baseInput, repoPath: repo, headBranch: 'never-pushed', runner: signedInGh() })
    ).rejects.toMatchObject({ code: 'HEAD_NOT_PUSHED' });
  });

  it('reports a missing CLI', async () => {
    const runner = new FakeRunner().on(command('gh'), { spawnError: true });

    await expect(
      createPullRequest({ ...baseInput, repoPath: repo, runner })
    ).rejects.toMatchObject({ code: 'CLI_MISSING' });
  });

  it('reports expired authentication', async () => {
    const runner = new FakeRunner()
      .on(command('gh', '--version'), { stdout: 'gh version 2.60.0' })
      .on(command('gh', 'auth', 'status'), { exitCode: 1, stderr: 'not logged in' });

    await expect(
      createPullRequest({ ...baseInput, repoPath: repo, runner })
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('classifies a duplicate pull request', async () => {
    const runner = withPushedHead(signedInGh()).on(command('gh', 'create'), {
      exitCode: 1,
      stderr: 'a pull request for branch "feat/thing" already exists'
    });

    await expect(
      createPullRequest({ ...baseInput, repoPath: repo, runner })
    ).rejects.toMatchObject({ code: 'PR_EXISTS' });
  });

  it('classifies a protected base branch', async () => {
    const runner = withPushedHead(signedInGh()).on(command('gh', 'create'), {
      exitCode: 1,
      stderr: 'GraphQL: protected branch update failed'
    });

    await expect(
      createPullRequest({ ...baseInput, repoPath: repo, runner })
    ).rejects.toMatchObject({ code: 'PROTECTED_BRANCH' });
  });

  it('publishes the branch when asked, before creating', async () => {
    const runner = signedInGh();
    const pushed: string[] = [];

    await createPullRequest({
      ...baseInput,
      repoPath: repo,
      pushFirst: true,
      profileId: 'profile-work',
      push: async (_repoPath, branch, profileId) => {
        pushed.push(`${branch}:${profileId}`);
      },
      runner
    });

    // The push must carry the selected SSH profile, not whatever ambient
    // credentials happen to be around.
    expect(pushed).toEqual(['feat/thing:profile-work']);
  });

  it('reports a push failure without attempting to create', async () => {
    const runner = signedInGh();

    await expect(
      createPullRequest({
        ...baseInput,
        repoPath: repo,
        pushFirst: true,
        push: () => Promise.reject(new Error('Permission denied (publickey).')),
        runner
      })
    ).rejects.toMatchObject({ code: 'PUSH_FAILED' });

    expect(runner.callsTo('gh').some((call) => call.args.includes('create'))).toBe(false);
  });

  it('reports that the push landed when creation then fails', async () => {
    // The state the window must not lose: retrying must not push again, and
    // the user needs to know the branch is already published.
    const runner = signedInGh().on(command('gh', 'create'), {
      exitCode: 1,
      stderr: 'GraphQL: something went wrong'
    });

    const failure = createPullRequest({
      ...baseInput,
      repoPath: repo,
      pushFirst: true,
      push: async () => {},
      runner
    });

    await expect(failure).rejects.toBeInstanceOf(PullRequestError);
    await failure.catch((error: PullRequestError) => {
      expect(error.pushed).toBe(true);
      expect(error.code).toBe('PROVIDER_ERROR');
    });
  });

  it('never lets a hostile title or body reach a shell', async () => {
    const runner = withPushedHead(signedInGh());

    await createPullRequest({
      ...baseInput,
      repoPath: repo,
      title: '$(touch /tmp/pwned) && echo hi',
      body: '`rm -rf ~`; drop table users;--',
      runner
    });

    const create = runner.callsTo('gh').find((call) => call.args.includes('create'));
    // Present verbatim as one argv entry, which is exactly right: nothing
    // interprets it, because no shell is involved anywhere in the runner.
    expect(create?.args).toContain('$(touch /tmp/pwned) && echo hi');
    expect(create?.options.input).toContain('rm -rf ~');
  });
});
