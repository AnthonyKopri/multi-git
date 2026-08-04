import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CURRENT_CONFIG_VERSION, migrateConfig } from '../src/server/config/migrations';
import { prepareConfig } from '../src/server/config/store';
import {
  isValidSshConfigHost,
  sanitizeEnvOverrides,
  validateAppConfig
} from '../src/server/config/validate';
import { canonicalRepoKey, isSameRepo } from '../src/server/config/repo-identity';

let workspace: string;

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-config-')));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

/**
 * A configuration as version 0 wrote it: no configVersion, repoSettings keyed
 * by whatever path string reached the route.
 */
function version0Fixture(repoPath: string) {
  return {
    recentRepos: [repoPath, 'C:\\Users\\jane\\other-repo'],
    sshProfiles: [
      {
        id: 'profile-work',
        label: 'Work',
        privateKeyPath: 'C:\\Users\\jane\\.ssh\\id_ed25519_work',
        userName: 'Jane Doe',
        userEmail: 'jane@work.example'
      },
      {
        id: 'profile-personal',
        label: 'Personal',
        privateKeyPath: 'C:\\Users\\jane\\.ssh\\id_ed25519'
      }
    ],
    accountRules: [{ id: 'rule-1', match: 'github.com/acme', profileId: 'profile-work' }],
    repoSettings: { [repoPath]: { warnBeforeDelete: false } },
    settings: { manageSshConfig: true },
    sshConfigHosts: { 'github.com': 'C:\\Users\\jane\\.ssh\\id_ed25519_work' }
  };
}

describe('migrating from version 0', () => {
  it('stamps the current version onto an unversioned file', () => {
    const outcome = migrateConfig(version0Fixture(workspace));

    expect(outcome.fromVersion).toBe(0);
    expect(outcome.toVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(outcome.config['configVersion']).toBe(CURRENT_CONFIG_VERSION);
    expect(outcome.applied.length).toBeGreaterThan(0);
  });

  it('keeps every repository, profile, rule, and setting', () => {
    // The whole point of a migration is that nothing a user configured is
    // lost on the way through it.
    const fixture = version0Fixture(workspace);
    const { config } = prepareConfig(fixture);

    expect(config.recentRepos).toEqual(fixture.recentRepos);
    expect(config.sshProfiles).toEqual(fixture.sshProfiles);
    expect(config.accountRules).toEqual(fixture.accountRules);
    expect(config.settings).toEqual({ manageSshConfig: true });
    expect(config.sshConfigHosts).toEqual(fixture.sshConfigHosts);
  });

  it('rekeys repository settings by canonical identity, preserving the value', () => {
    const { config } = prepareConfig(version0Fixture(workspace));

    expect(config.repoSettings[canonicalRepoKey(workspace)]).toEqual({
      warnBeforeDelete: false
    });
  });

  it('merges two spellings of the same repository into one record', () => {
    // A junction and its target, or two casings on NTFS, used to produce two
    // records where the second one silently started from defaults.
    const shouted = process.platform === 'win32' ? workspace.toUpperCase() : workspace;

    const outcome = migrateConfig({
      repoSettings: {
        [workspace]: { warnBeforeDelete: false },
        [`${shouted}${path.sep}`]: { somethingElse: true }
      }
    });

    const settings = outcome.config['repoSettings'] as Record<string, unknown>;
    const keys = Object.keys(settings);

    if (process.platform === 'win32') {
      expect(keys).toEqual([canonicalRepoKey(workspace)]);
      expect(settings[keys[0] as string]).toEqual({
        warnBeforeDelete: false,
        somethingElse: true
      });
    } else {
      // Case matters on ext4, so only the trailing separator collapses.
      expect(keys).toEqual([canonicalRepoKey(workspace)]);
    }
  });

  it('is idempotent, so a crash between migrating and writing is harmless', () => {
    const once = migrateConfig(version0Fixture(workspace)).config;
    const twice = migrateConfig(once).config;

    expect(twice).toEqual(once);
  });
});

describe('migrating from version 1', () => {
  it('leaves an already-current file untouched and applies nothing', () => {
    const current = migrateConfig(version0Fixture(workspace)).config;
    const outcome = migrateConfig(current);

    expect(outcome.fromVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(outcome.applied).toEqual([]);
    expect(outcome.config).toEqual(current);
  });

  it('does not ask the store to write it back', () => {
    const current = migrateConfig(version0Fixture(workspace)).config;

    expect(prepareConfig(current).changed).toBe(false);
  });
});

describe('a file from a newer build', () => {
  const future = {
    configVersion: CURRENT_CONFIG_VERSION + 5,
    recentRepos: ['/repo'],
    sshProfiles: [],
    accountRules: [],
    repoSettings: {},
    somethingFromTheFuture: { enabled: true }
  };

  it('is read without being migrated', () => {
    const outcome = migrateConfig(future);

    expect(outcome.fromFuture).toBe(true);
    expect(outcome.applied).toEqual([]);
    expect(outcome.config['configVersion']).toBe(CURRENT_CONFIG_VERSION + 5);
  });

  it('is never written back, so its unknown sections survive a downgrade', () => {
    expect(prepareConfig(future).changed).toBe(false);
  });

  it('keeps sections this build does not understand', () => {
    const { config } = prepareConfig(future);

    expect(config['somethingFromTheFuture']).toEqual({ enabled: true });
  });
});

describe('upgrading a real user-data file', () => {
  /**
   * Loads the config store against a throwaway home directory.
   *
   * CONFIG_FILE is derived from os.homedir() when the module first loads, and
   * os.homedir() reads USERPROFILE on Windows and HOME elsewhere. Resetting
   * the module registry between cases is what makes each one see its own
   * home rather than the first one's.
   */
  async function storeWithHome(home: string) {
    vi.resetModules();
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('HOME', home);

    return import('../src/server/config/store');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps every record and rewrites the file at the current version', async () => {
    // The end-to-end path a real launch takes: an unversioned file on disk,
    // read through the cache, migrated, and written back.
    const home = fs.mkdtempSync(path.join(workspace, 'home-'));
    const fixture = version0Fixture(workspace);
    const configFile = path.join(home, '.multi-git-client-config.json');
    fs.writeFileSync(configFile, JSON.stringify(fixture, null, 2));

    const store = await storeWithHome(home);
    const config = store.readConfig();

    expect(config.recentRepos).toEqual(fixture.recentRepos);
    expect(config.sshProfiles).toEqual(fixture.sshProfiles);
    expect(config.accountRules).toEqual(fixture.accountRules);
    expect(config.sshConfigHosts).toEqual(fixture.sshConfigHosts);
    expect(config.repoSettings[canonicalRepoKey(workspace)]).toEqual({
      warnBeforeDelete: false
    });

    const onDisk = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(onDisk.configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(onDisk.sshProfiles).toEqual(fixture.sshProfiles);

    // Written through a temp file and renamed, so an interrupted write cannot
    // leave a truncated config behind.
    expect(fs.readdirSync(home)).toEqual(['.multi-git-client-config.json']);
  });

  it('does not migrate the same file twice', async () => {
    const home = fs.mkdtempSync(path.join(workspace, 'home-'));
    const configFile = path.join(home, '.multi-git-client-config.json');
    fs.writeFileSync(configFile, JSON.stringify(version0Fixture(workspace)));

    const store = await storeWithHome(home);
    store.readConfig();
    const afterFirst = fs.readFileSync(configFile, 'utf8');

    store.invalidateConfigCache();
    store.readConfig();

    expect(fs.readFileSync(configFile, 'utf8')).toBe(afterFirst);
  });

  it('starts empty rather than crashing on an unparseable file', async () => {
    const home = fs.mkdtempSync(path.join(workspace, 'home-'));
    const configFile = path.join(home, '.multi-git-client-config.json');
    fs.writeFileSync(configFile, '{ this is not json');

    const store = await storeWithHome(home);
    const config = store.readConfig();

    expect(config.sshProfiles).toEqual([]);
    // Deliberately left alone: the user's profiles are still in that file and
    // overwriting it would destroy the only copy.
    expect(fs.readFileSync(configFile, 'utf8')).toBe('{ this is not json');
  });

  it('round-trips a write without losing a section it does not understand', async () => {
    const home = fs.mkdtempSync(path.join(workspace, 'home-'));
    const configFile = path.join(home, '.multi-git-client-config.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({ ...version0Fixture(workspace), futureSection: { keep: 'me' } })
    );

    const store = await storeWithHome(home);
    const config = store.readConfig();
    config.recentRepos = ['/somewhere/else'];
    expect(store.writeConfig(config)).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(onDisk.futureSection).toEqual({ keep: 'me' });
    expect(onDisk.recentRepos).toEqual(['/somewhere/else']);
  });
});

describe('validateAppConfig', () => {
  it('fills in every collection so callers can index without guarding', () => {
    const { config } = validateAppConfig({});

    expect(config.recentRepos).toEqual([]);
    expect(config.sshProfiles).toEqual([]);
    expect(config.accountRules).toEqual([]);
    expect(config.repoSettings).toEqual({});
  });

  it('survives a document that is not an object at all', () => {
    expect(validateAppConfig(null).config.sshProfiles).toEqual([]);
    expect(validateAppConfig('nonsense').config.sshProfiles).toEqual([]);
    expect(validateAppConfig([1, 2, 3]).config.sshProfiles).toEqual([]);
  });

  it('drops a profile with no id but keeps the ones around it', () => {
    const { config, issues } = validateAppConfig({
      sshProfiles: [
        { id: 'good', label: 'Good', privateKeyPath: '/k' },
        { label: 'No id', privateKeyPath: '/k' },
        { id: 'also-good', label: 'Also', privateKeyPath: '/k2' }
      ]
    });

    expect(config.sshProfiles.map((profile) => profile.id)).toEqual(['good', 'also-good']);
    expect(issues).toHaveLength(1);
  });

  it('drops a duplicate profile id rather than letting it shadow the first', () => {
    const { config } = validateAppConfig({
      sshProfiles: [
        { id: 'dup', label: 'First', privateKeyPath: '/a' },
        { id: 'dup', label: 'Second', privateKeyPath: '/b' }
      ]
    });

    expect(config.sshProfiles).toHaveLength(1);
    expect(config.sshProfiles[0]?.label).toBe('First');
  });

  it('keeps a rule pointing at a profile that no longer exists', () => {
    // Inert, not invalid. Deleting it would throw away a record the user may
    // still want when they recreate the profile.
    const { config } = validateAppConfig({
      sshProfiles: [],
      accountRules: [{ id: 'r', match: 'github.com', profileId: 'long-gone' }]
    });

    expect(config.accountRules).toHaveLength(1);
  });

  it('rejects a host that would break out of its line in ~/.ssh/config', () => {
    // The injection this closes: the host is derived from a repository's
    // origin URL, and it is written verbatim into the managed block.
    const { config, issues } = validateAppConfig({
      sshConfigHosts: {
        'github.com': '/home/jane/.ssh/id_ed25519',
        'evil.example\n  IdentityFile /tmp/attacker': '/tmp/attacker'
      }
    });

    expect(Object.keys(config.sshConfigHosts ?? {})).toEqual(['github.com']);
    expect(issues).toHaveLength(1);
  });

  it('rejects a key path containing a quote or newline', () => {
    const { config } = validateAppConfig({
      sshConfigHosts: { 'github.com': '/k"\n  ProxyCommand evil' }
    });

    expect(config.sshConfigHosts).toEqual({});
  });

  it('de-duplicates recent repositories', () => {
    const { config } = validateAppConfig({ recentRepos: ['/a', '/b', '/a', ''] });

    expect(config.recentRepos).toEqual(['/a', '/b']);
  });
});

describe('isValidSshConfigHost', () => {
  it('accepts ordinary hosts and Host patterns', () => {
    expect(isValidSshConfigHost('github.com')).toBe(true);
    expect(isValidSshConfigHost('git.internal.example')).toBe(true);
    expect(isValidSshConfigHost('192.168.1.10')).toBe(true);
    expect(isValidSshConfigHost('*.example.com')).toBe(true);
  });

  it('rejects anything that could start a new directive', () => {
    expect(isValidSshConfigHost('github.com\nHost *')).toBe(false);
    expect(isValidSshConfigHost('github.com IdentityFile /tmp/x')).toBe(false);
    expect(isValidSshConfigHost('github.com\r')).toBe(false);
    expect(isValidSshConfigHost('"github.com"')).toBe(false);
    expect(isValidSshConfigHost('')).toBe(false);
    expect(isValidSshConfigHost(42)).toBe(false);
  });
});

describe('sanitizeEnvOverrides', () => {
  it('keeps well-formed names', () => {
    expect(sanitizeEnvOverrides({ GIT_SSH_COMMAND: 'ssh -i k', _PRIVATE: 'x' })).toEqual({
      GIT_SSH_COMMAND: 'ssh -i k',
      _PRIVATE: 'x'
    });
  });

  it('drops names that are not environment variables', () => {
    expect(sanitizeEnvOverrides({ 'not a name': 'x', '2START': 'x', 'A=B': 'x' })).toEqual({});
  });

  it('drops the variables that make a process load someone else"s code first', () => {
    const dropped = sanitizeEnvOverrides({
      LD_PRELOAD: '/tmp/evil.so',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      NODE_OPTIONS: '--require /tmp/evil.js',
      ELECTRON_RUN_AS_NODE: '1'
    });

    expect(dropped).toEqual({});
  });

  it('drops non-string and NUL-bearing values', () => {
    expect(sanitizeEnvOverrides({ A: 1, B: null, C: 'has\0nul' })).toEqual({});
  });
});

describe('canonicalRepoKey', () => {
  it('resolves a relative path', () => {
    expect(canonicalRepoKey('.')).toBe(canonicalRepoKey(process.cwd()));
  });

  it('ignores a trailing separator', () => {
    expect(canonicalRepoKey(`${workspace}${path.sep}`)).toBe(canonicalRepoKey(workspace));
  });

  it('handles a path containing spaces and Unicode', () => {
    const awkward = path.join(workspace, 'My Repos', 'café — 中文');
    fs.mkdirSync(awkward, { recursive: true });

    expect(canonicalRepoKey(awkward)).toBe(canonicalRepoKey(`${awkward}${path.sep}`));
    expect(canonicalRepoKey(awkward)).toContain('中文');
  });

  it('returns an empty key for input that names no path', () => {
    expect(canonicalRepoKey('')).toBe('');
    expect(canonicalRepoKey('   ')).toBe('');
  });

  it('treats two casings as one repository where the filesystem does', (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip('case folding only applies on case-insensitive filesystems');
      return;
    }

    expect(isSameRepo(workspace, workspace.toUpperCase())).toBe(true);
  });

  it('resolves a link to the repository it points at', (ctx) => {
    const target = path.join(workspace, 'real-repo');
    const link = path.join(workspace, 'link-to-repo');
    fs.mkdirSync(target);

    try {
      fs.symlinkSync(target, link, 'junction');
    } catch {
      // Creating links needs a privilege that is not granted by default on
      // Windows, and is not something this suite should require.
      ctx.skip('cannot create a directory link in this environment');
      return;
    }

    expect(isSameRepo(link, target)).toBe(true);
  });

  it('does not claim two different repositories are the same', () => {
    expect(isSameRepo(path.join(workspace, 'a'), path.join(workspace, 'b'))).toBe(false);
    expect(isSameRepo('', '')).toBe(false);
  });
});
