// The three steps that turn `git init` into a repository somebody can push.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  FALLBACK_INITIAL_BRANCH,
  createInitialCommit,
  initRepository,
  resolveInitialBranch
} from '../src/server/git/bootstrap';
import { runGitCommand } from '../src/server/git/run';
import { cleanupRepos, createTempDir } from './helpers/temp-repo';

const AUTHOR = { name: 'Test User', email: 'test@example.com' };

// `init.defaultBranch` is exactly what these tests are about, so a developer
// who has set one must not get different answers from the suite than CI does.
//
// `user.useConfigOnly` is here for the same reason from the other direction:
// without it git invents an identity from the machine's username and hostname
// on some platforms and not others, so "git has nobody to commit as" would be
// a state that only some machines can reach.
const PRISTINE_CONFIG = '[user]\n\tuseConfigOnly = true\n';

const previous = {
  global: process.env['GIT_CONFIG_GLOBAL'],
  system: process.env['GIT_CONFIG_SYSTEM']
};

let globalConfig = '';
let systemConfig = '';

/** Rewrites the global config git will see, on top of the pristine baseline. */
function writeGlobalConfig(extra = ''): void {
  fs.writeFileSync(globalConfig, PRISTINE_CONFIG + extra, 'utf8');
}

beforeAll(() => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-gitconfig-'));
  globalConfig = path.join(folder, 'global');
  systemConfig = path.join(folder, 'system');

  process.env['GIT_CONFIG_GLOBAL'] = globalConfig;
  process.env['GIT_CONFIG_SYSTEM'] = systemConfig;
});

beforeEach(() => {
  writeGlobalConfig();
  fs.writeFileSync(systemConfig, '', 'utf8');
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

afterEach(() => {
  cleanupRepos();
});

describe('resolveInitialBranch', () => {
  it('answers main when the machine has no opinion', async () => {
    // Git's own fallback is still master, and it only warns about it, which is
    // how a repository ends up on a branch its GitHub remote does not expect.
    expect(await resolveInitialBranch(createTempDir())).toBe('main');
    expect(FALLBACK_INITIAL_BRANCH).toBe('main');
  });

  it('honours a default branch the user set in their own configuration', async () => {
    writeGlobalConfig('[init]\n\tdefaultBranch = trunk\n');

    expect(await resolveInitialBranch(createTempDir())).toBe('trunk');
  });

  it('ignores a default branch that only the system configuration sets', async () => {
    // The Git for Windows installer writes `init.defaultBranch = master` into
    // its system config, so a merged read finds master on a machine whose
    // owner never chose anything — and the repository is created on a branch
    // its brand-new GitHub remote does not have.
    fs.writeFileSync(systemConfig, '[init]\n\tdefaultBranch = master\n', 'utf8');

    expect(await resolveInitialBranch(createTempDir())).toBe('main');
  });

  it('falls back rather than passing a configured name git would read as an option', async () => {
    // `git config` would refuse to store this, which is the point: a value
    // only reachable by editing the file by hand still must not reach an
    // argument vector.
    writeGlobalConfig('[init]\n\tdefaultBranch = --upload-pack=evil\n');

    expect(await resolveInitialBranch(createTempDir())).toBe('main');
  });
});

describe('initRepository', () => {
  it('puts HEAD on the branch before any commit exists', async () => {
    const folder = createTempDir();
    await initRepository(folder, 'main');

    const { stdout } = await runGitCommand(folder, ['symbolic-ref', 'HEAD']);
    expect(stdout.trim()).toBe('refs/heads/main');

    // Which is what makes the first push name a branch that exists locally.
    const branch = await runGitCommand(folder, ['branch', '--show-current']);
    expect(branch.stdout.trim()).toBe('main');
  });

  it('refuses a branch name git would read as an option', async () => {
    await expect(initRepository(createTempDir(), '--upload-pack=evil')).rejects.toThrow(
      /may not start with/
    );
  });
});

describe('createInitialCommit', () => {
  it('commits everything the working tree holds', async () => {
    const folder = createTempDir();
    await initRepository(folder, 'main');
    fs.writeFileSync(path.join(folder, 'a.txt'), 'one\n', 'utf8');
    fs.mkdirSync(path.join(folder, 'src'));
    fs.writeFileSync(path.join(folder, 'src', 'b.txt'), 'two\n', 'utf8');

    const result = await createInitialCommit(folder, {
      message: 'Initial commit',
      author: AUTHOR
    });

    expect(result.committed).toBe(true);

    const tracked = await runGitCommand(folder, ['ls-files']);
    expect(tracked.stdout.split('\n').map((line) => line.trim())).toEqual(
      expect.arrayContaining(['a.txt', 'src/b.txt'])
    );
  });

  it('writes the author into the repository so a machine with no identity can commit', async () => {
    const folder = createTempDir();
    await initRepository(folder, 'main');
    fs.writeFileSync(path.join(folder, 'a.txt'), 'one\n', 'utf8');

    await createInitialCommit(folder, { message: 'Initial commit', author: AUTHOR });

    const { stdout } = await runGitCommand(folder, ['log', '-1', '--pretty=format:%an <%ae>']);
    expect(stdout.trim()).toBe('Test User <test@example.com>');
  });

  it('leaves ignored files out of the commit', async () => {
    const folder = createTempDir();
    await initRepository(folder, 'main');
    fs.writeFileSync(path.join(folder, '.gitignore'), 'node_modules/\n', 'utf8');
    fs.mkdirSync(path.join(folder, 'node_modules'));
    fs.writeFileSync(path.join(folder, 'node_modules', 'dep.js'), 'noise\n', 'utf8');

    await createInitialCommit(folder, { message: 'Initial commit', author: AUTHOR });

    const tracked = await runGitCommand(folder, ['ls-files']);
    expect(tracked.stdout).not.toContain('node_modules');
  });

  it('reports rather than throws when there is nothing to commit', async () => {
    const folder = createTempDir();
    await initRepository(folder, 'main');

    const result = await createInitialCommit(folder, {
      message: 'Initial commit',
      author: AUTHOR
    });

    expect(result).toMatchObject({ committed: false });
    expect(result.committed === false && result.reason).toMatch(/nothing to commit/i);
  });

  it('reports rather than throws when git has no identity to commit as', async () => {
    // The repository, its templates and its remote all exist by this point.
    // Losing them to an unconfigured user.email would be the worse outcome.
    const folder = createTempDir();
    await initRepository(folder, 'main');
    fs.writeFileSync(path.join(folder, 'a.txt'), 'one\n', 'utf8');

    const result = await createInitialCommit(folder, { message: 'Initial commit', author: null });

    expect(result.committed).toBe(false);
    expect(result.committed === false && result.reason).toMatch(/Could not create the first commit/);
  });
});
