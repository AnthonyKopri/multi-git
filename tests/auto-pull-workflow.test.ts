// The fetch workflow's auto-pull, against real repositories.
//
// The guarantee is the one the desktop has always made: an automatic pull is
// a fast-forward or nothing. What is new is where it is decided — once, in the
// backend, under the repository lock — so these check the decision there.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { fetchWithAutoPull } from '../src/server/workflows/sync';
import { readConfig, writeConfig } from '../src/server/config/store';
import { cleanupRepos, createTempDir, git, writeFile } from './helpers/temp-repo';

let upstream: string;
let colleague: string;
let local: string;

function setAutoPull(enabled: boolean): void {
  const config = readConfig();
  config.settings = { ...(config.settings ?? { manageSshConfig: false }), autoPull: enabled };
  writeConfig(config);
}

function clone(into: string): string {
  git(path.dirname(into), 'clone', upstream, path.basename(into));
  git(into, 'config', 'user.name', 'Test User');
  git(into, 'config', 'user.email', 'test@example.com');
  git(into, 'config', 'commit.gpgsign', 'false');
  git(into, 'config', 'core.autocrlf', 'false');
  return into;
}

function commit(repo: string, file: string, contents: string): string {
  writeFile(repo, file, contents);
  git(repo, 'add', file);
  git(repo, 'commit', '-m', `change ${file}`);
  return git(repo, 'rev-parse', 'HEAD').trim();
}

const head = (repo: string): string => git(repo, 'rev-parse', 'HEAD').trim();

beforeEach(() => {
  const root = createTempDir('multi-git-auto-pull-');
  upstream = path.join(root, 'upstream.git');
  fs.mkdirSync(upstream);
  git(upstream, 'init', '--bare', '--initial-branch=main');

  colleague = clone(path.join(root, 'colleague'));
  commit(colleague, 'README.md', 'first\n');
  git(colleague, 'push', '-u', 'origin', 'main');

  local = clone(path.join(root, 'local'));
});

afterEach(() => {
  setAutoPull(false);
  cleanupRepos();
});

describe('fetch with auto-pull', () => {
  it('only fetches while auto-pull is off, which is the default', async () => {
    const before = head(local);
    commit(colleague, 'a.txt', 'a\n');
    git(colleague, 'push');

    const result = await fetchWithAutoPull(local);

    expect(result.autoPull).toEqual({ state: 'off' });
    expect(head(local)).toBe(before);
  });

  it('fast-forwards a branch that is purely behind', async () => {
    setAutoPull(true);
    const theirs = commit(colleague, 'a.txt', 'a\n');
    git(colleague, 'push');

    const result = await fetchWithAutoPull(local);

    expect(result.autoPull).toMatchObject({ state: 'pulled', target: 'origin/main' });
    expect(head(local)).toBe(theirs);
    expect(fs.readFileSync(path.join(local, 'a.txt'), 'utf8')).toBe('a\n');
  });

  it('says there was nothing to take when the branch is current', async () => {
    setAutoPull(true);
    expect((await fetchWithAutoPull(local)).autoPull).toEqual({ state: 'current' });
  });

  it('leaves uncommitted work alone and says why', async () => {
    setAutoPull(true);
    const before = head(local);
    writeFile(local, 'README.md', 'my edit\n');
    commit(colleague, 'a.txt', 'a\n');
    git(colleague, 'push');

    const result = await fetchWithAutoPull(local);

    expect(result.autoPull).toEqual({ state: 'blocked', reason: 'There are uncommitted changes.' });
    expect(head(local)).toBe(before);
    expect(fs.readFileSync(path.join(local, 'README.md'), 'utf8')).toBe('my edit\n');
  });

  it('never merges: a branch with commits of its own stays where it is', async () => {
    setAutoPull(true);
    const mine = commit(local, 'mine.txt', 'mine\n');
    commit(colleague, 'a.txt', 'a\n');
    git(colleague, 'push');

    const result = await fetchWithAutoPull(local);

    expect(result.autoPull).toMatchObject({ state: 'blocked' });
    expect(head(local)).toBe(mine);
    expect(git(local, 'rev-list', '--count', 'HEAD')).toBe('2\n');
  });

  it('pulls once when two clients fetch at the same moment', async () => {
    setAutoPull(true);
    const theirs = commit(colleague, 'a.txt', 'a\n');
    git(colleague, 'push');

    const results = await Promise.all([fetchWithAutoPull(local), fetchWithAutoPull(local)]);

    // The second decision is made after the first pull, under the same lock,
    // so it finds nothing left to take.
    expect(results.map((result) => result.autoPull.state).sort()).toEqual(['current', 'pulled']);
    expect(head(local)).toBe(theirs);
  });
});
