// A guard on the test environment itself.
//
// The configuration, the passphrase vault and `~/.ssh` are all resolved from
// `os.homedir()` when their module is first imported. Without `setupFiles`
// redirecting that, every worker in a parallel run shares one of each — which
// made any test that writes configuration fail only when another file happened
// to write configuration at the same moment, and meant the suite wrote to the
// developer's own files on every run.
//
// Those are both silent failures: the first looks like an unrelated feature
// being broken, and the second looks like nothing at all. This turns them into
// a named failing test instead.
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CONFIG_FILE } from '../src/server/config/store';
import { SECRETS_FILE } from '../src/server/vault/vault';
import { cleanupRepos, createEmptyRepo, git } from './helpers/temp-repo';

/** Whether `child` is inside `parent`, comparing resolved paths. */
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

describe('the suite runs against a home directory of its own', () => {
  it('puts the home directory in the system temp folder', () => {
    expect(isInside(os.homedir(), os.tmpdir())).toBe(true);
  });

  it('resolves the configuration file inside it', () => {
    // Read at import time, which is why the redirect has to happen in a setup
    // file rather than in a hook.
    expect(isInside(CONFIG_FILE, os.homedir())).toBe(true);
  });

  it('resolves the passphrase vault inside it', () => {
    expect(isInside(SECRETS_FILE, os.homedir())).toBe(true);
  });
});

/**
 * The same guard for git's own configuration.
 *
 * `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` cover the two config *files*,
 * but git also reads configuration straight out of the environment through
 * `GIT_CONFIG_COUNT` and a `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` pair per
 * entry, and those win over both files. A container or workstation that sets
 * `url.<base>.insteadOf` there changes what git reports back for a remote, so
 * a fixture built on an SSH remote read as HTTPS and the assertion failed on
 * that machine only.
 */
describe('fixture repositories ignore git configuration from the environment', () => {
  afterEach(() => {
    delete process.env['GIT_CONFIG_COUNT'];
    delete process.env['GIT_CONFIG_KEY_0'];
    delete process.env['GIT_CONFIG_VALUE_0'];
    cleanupRepos();
  });

  it('reports the remote URL as written, not as an insteadOf rule rewrites it', () => {
    process.env['GIT_CONFIG_COUNT'] = '1';
    process.env['GIT_CONFIG_KEY_0'] = 'url.https://github.com/.insteadOf';
    process.env['GIT_CONFIG_VALUE_0'] = 'git@github.com:';

    const repo = createEmptyRepo();
    git(repo, 'remote', 'add', 'origin', 'git@github.com:owner/repo.git');

    expect(git(repo, 'remote', 'get-url', 'origin').trim()).toBe('git@github.com:owner/repo.git');
  });
});
