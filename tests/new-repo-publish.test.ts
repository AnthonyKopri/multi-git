// The publishing half of the New Repository wizard, end to end.
//
// `gh` is mocked, and not only for determinism: a test that let the real
// GitHub CLI run would create a repository on the account of whoever ran the
// suite. The mock stands in for `gh repo create` by wiring origin to a bare
// repository in a temp folder, so everything after it — the commit, the real
// `git push -u origin <branch>`, the upstream it sets — is the product code
// doing the actual thing.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

const gh = vi.hoisted(() => ({ remoteUrl: '' }));

vi.mock('../src/server/external/github-cli', () => ({
  detectGithubCli: async () => ({
    available: true,
    authenticated: true,
    account: 'test-account',
    version: 'gh version 0.0.0 (mock)'
  }),
  invalidateGithubCliCache: () => {},
  createGithubRepository: async (options: { repoPath: string; visibility: string }) => {
    if (!gh.remoteUrl) {
      return {
        error: 'GitHub CLI (gh) was not found on PATH, so the repository stayed local only.'
      };
    }

    // What `gh repo create --source --remote origin` leaves behind.
    execFileSync('git', ['remote', 'add', 'origin', gh.remoteUrl], { cwd: options.repoPath });

    return {
      name: path.basename(options.repoPath),
      visibility: options.visibility,
      account: 'test-account',
      remoteUrl: gh.remoteUrl,
      htmlUrl: null,
      convertedToSsh: false
    };
  }
}));

const { createApp } = await import('../src/server/app');
const app: Express = createApp();

function api() {
  return request(app).post('/api/git/new-repo').set('Host', '127.0.0.1');
}

/** Runs git in a fixture. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

const previous = {
  global: process.env['GIT_CONFIG_GLOBAL'],
  system: process.env['GIT_CONFIG_SYSTEM']
};

let workspace = '';

beforeAll(() => {
  // `init.defaultBranch` decides the branch under test, and Git for Windows
  // sets it system-wide, so both scopes are pinned to an empty file.
  const config = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-ghcfg-')), 'config');
  fs.writeFileSync(config, '', 'utf8');
  process.env['GIT_CONFIG_GLOBAL'] = config;
  process.env['GIT_CONFIG_SYSTEM'] = config;
});

afterAll(() => {
  for (const [key, value] of [
    ['GIT_CONFIG_GLOBAL', previous.global],
    ['GIT_CONFIG_SYSTEM', previous.system]
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-publish-')));
  gh.remoteUrl = '';
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

/** A bare repository standing in for the GitHub repository `gh` would create. */
function createOrigin(): string {
  const bare = path.join(workspace, 'origin.git');
  fs.mkdirSync(bare, { recursive: true });
  git(bare, 'init', '--bare', '--initial-branch=main');
  return bare;
}

const AUTHOR = { authorName: 'Test User', authorEmail: 'test@example.com' };

describe('publishing a new repository', () => {
  it('commits and pushes, leaving nothing to run by hand', async () => {
    // The bug this whole change exists for: the wizard used to stop after
    // `git init`, so the first push was rejected with "src refspec main does
    // not match any" and the four commands GitHub prints had to be typed out.
    gh.remoteUrl = createOrigin();

    const target = path.join(workspace, 'project');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'app.js'), 'console.log(1);\n', 'utf8');

    const { body } = await api()
      .send({
        repoPath: target,
        licenseId: 'none',
        gitignoreId: 'none',
        createRemote: true,
        ...AUTHOR
      })
      .expect(200);

    expect(body).toMatchObject({ branch: 'main', initialCommit: true, pushed: true });
    expect(body.warnings).toEqual([]);

    // The commit reached the remote, and the branch is tracking it, so the
    // Push button has an upstream and stops offering Publish.
    expect(git(gh.remoteUrl, 'rev-parse', 'main').trim()).toHaveLength(40);
    expect(git(target, 'rev-parse', '--abbrev-ref', 'main@{upstream}').trim()).toBe('origin/main');
    expect(git(gh.remoteUrl, 'ls-tree', '--name-only', 'main')).toContain('app.js');
  });

  it('keeps the files its .gitignore excludes out of the first commit', async () => {
    gh.remoteUrl = createOrigin();

    const target = path.join(workspace, 'noisy');
    fs.mkdirSync(path.join(target, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(target, 'node_modules', 'dep.js'), 'noise\n', 'utf8');
    fs.writeFileSync(path.join(target, 'index.js'), 'console.log(1);\n', 'utf8');

    await api()
      .send({
        repoPath: target,
        licenseId: 'mit',
        licenseYear: '2026',
        licenseHolder: 'Test Holder',
        gitignoreId: 'node',
        createRemote: true,
        ...AUTHOR
      })
      .expect(200);

    const tracked = git(target, 'ls-files')
      .split('\n')
      .map((line) => line.trim());

    expect(tracked).toContain('index.js');
    expect(tracked).toContain('LICENSE');
    expect(tracked).toContain('.gitignore');
    // The template is written before anything is staged, so the folder it
    // ignores never reaches the commit it would otherwise dominate.
    expect(tracked).not.toContain('node_modules/dep.js');
  });

  it('still commits when the remote could not be created, so Publish can retry', async () => {
    // The repository and its commit exist; only the remote is missing. That is
    // a warning on something usable, not a half-created repository.
    const target = path.join(workspace, 'no-remote');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'app.js'), 'console.log(1);\n', 'utf8');

    const { body } = await api()
      .send({
        repoPath: target,
        licenseId: 'none',
        gitignoreId: 'none',
        createRemote: true,
        ...AUTHOR
      })
      .expect(200);

    expect(body).toMatchObject({ initialCommit: true, pushed: false, remote: null });
    expect(body.warnings.join(' ')).toMatch(/GitHub CLI/);
    expect(git(target, 'log', '--oneline').trim()).toContain('Initial commit');
  });

  it('says so when an empty folder leaves nothing to publish', async () => {
    gh.remoteUrl = createOrigin();

    const target = path.join(workspace, 'empty');

    const { body } = await api()
      .send({
        repoPath: target,
        licenseId: 'none',
        gitignoreId: 'none',
        createRemote: true,
        ...AUTHOR
      })
      .expect(200);

    expect(body).toMatchObject({ branch: 'main', initialCommit: false, pushed: false });
    expect(body.warnings.join(' ')).toMatch(/nothing to commit/i);
  });

  it('makes no commit at all when the repository is staying local', async () => {
    const target = path.join(workspace, 'local');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'app.js'), 'console.log(1);\n', 'utf8');

    const { body } = await api()
      .send({ repoPath: target, licenseId: 'none', gitignoreId: 'none', ...AUTHOR })
      .expect(200);

    expect(body).toMatchObject({ initialCommit: false, pushed: false });
    // No warning either: not committing is the intent here, not a failure.
    expect(body.warnings).toEqual([]);
    expect(git(target, 'ls-files').trim()).toBe('');
  });
});
