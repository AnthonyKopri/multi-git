// Reading git configuration values the way git itself reads them.
//
// The case that prompted this: `[commit] gpgsign`, written with no `=`, is true
// to git, but `git config --get` prints an empty line for it, exactly as it
// does for `gpgsign =`, which is false. Reading `--get` therefore called a
// repository that signs every commit one that signs none.
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { parseGitBoolean } from '../src/shared/git-config';
import { readConfigValues } from '../src/server/git/config-values';
import { cleanupRepos, createRepoWithHistory, git } from './helpers/temp-repo';

afterAll(() => cleanupRepos());

describe('reading a boolean the way git does', () => {
  it('reads a key written with no value as true', () => {
    expect(parseGitBoolean(null)).toBe(true);
  });

  it('reads an empty value as false', () => {
    expect(parseGitBoolean('')).toBe(false);
  });

  it('agrees with git config --type=bool on every spelling', () => {
    const repo = createRepoWithHistory();

    for (const value of ['true', 'TRUE', 'yes', 'On', 'false', 'No', 'off', '1', '0', '2', '-1', '1k', '0g']) {
      git(repo, 'config', 'test.flag', value);
      const gitSays = git(repo, 'config', '--type=bool', '--get', 'test.flag').trim();

      expect(parseGitBoolean(value), value).toBe(gitSays === 'true');
    }
  });

  it('says when a value is not a boolean at all', () => {
    // Git refuses these outright; the caller decides what that means.
    expect(parseGitBoolean('maybe')).toBeNull();
    expect(parseGitBoolean('merges')).toBeNull();
  });
});

describe('reading several values in one git run', () => {
  it('keeps a key with no value apart from an empty one and an unset one', async () => {
    const repo = createRepoWithHistory();
    fs.appendFileSync(path.join(repo, '.git', 'config'), '[test]\n\tbare\n\tempty =\n');

    const values = await readConfigValues(repo, ['test.bare', 'test.empty', 'test.unset']);

    expect(values.get('test.bare')).toBeNull();
    expect(values.get('test.empty')).toBe('');
    expect(values.has('test.unset')).toBe(false);
  });

  it('takes the last value of a key set more than once', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'config', 'test.many', 'first');
    git(repo, 'config', '--add', 'test.many', 'second');

    expect((await readConfigValues(repo, ['test.many'])).get('test.many')).toBe('second');
  });

  it('reads only the keys asked for, not ones that merely start the same', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'config', 'test.keyword', 'not this');

    const values = await readConfigValues(repo, ['test.key']);

    expect(values.size).toBe(0);
  });
});
