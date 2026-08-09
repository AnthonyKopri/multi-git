import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CURRENT_CONFIG_VERSION, migrateConfig } from '../src/server/config/migrations';
import { prepareConfig } from '../src/server/config/store';
import {
  MAX_AGENT_LAUNCHES,
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

/**
 * A configuration as version 1 wrote it: repository settings already keyed by
 * canonical identity, and none of the Phase 3 sections.
 */
function version1Fixture(repoPath: string) {
  return {
    ...version0Fixture(repoPath),
    configVersion: 1,
    repoSettings: { [canonicalRepoKey(repoPath)]: { warnBeforeDelete: false } }
  };
}

describe('migrating from version 1', () => {
  it('adds the worktree, window, group and agent sections', () => {
    const outcome = migrateConfig(version1Fixture(workspace));

    expect(outcome.fromVersion).toBe(1);
    expect(outcome.config['configVersion']).toBe(CURRENT_CONFIG_VERSION);
    expect(outcome.config['repoGroups']).toEqual([]);
    expect(outcome.config['externalAgents']).toEqual([]);
    expect(outcome.config['agentLaunches']).toEqual([]);
    expect(outcome.config['windowState']).toEqual({ windows: [] });
  });

  it('keeps every record version 1 held', () => {
    const fixture = version1Fixture(workspace);
    const { config } = prepareConfig(fixture);

    expect(config.sshProfiles).toHaveLength(2);
    expect(config.accountRules).toHaveLength(1);
    expect(config.recentRepos).toEqual(fixture.recentRepos);
    expect(config.repoSettings[canonicalRepoKey(workspace)]).toEqual({ warnBeforeDelete: false });
  });

  it('does not overwrite a section that is already there', () => {
    // The downgrade-and-upgrade case: a newer build wrote these, this one must
    // not empty them on the way back up.
    const withSections = {
      ...version1Fixture(workspace),
      repoGroups: [{ id: 'g1', label: 'Work', order: 0, repos: [] }],
      externalAgents: [
        { id: 'a1', label: 'Claude', executable: 'claude', args: [], terminal: 'direct', enabled: true }
      ]
    };

    const outcome = migrateConfig(withSections);

    expect(outcome.config['repoGroups']).toHaveLength(1);
    expect(outcome.config['externalAgents']).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = migrateConfig(version1Fixture(workspace)).config;
    expect(migrateConfig(once).config).toEqual(once);
  });

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

/**
 * A configuration as version 2 wrote it: the Phase 3 sections present, and
 * none of the Phase 4 ones.
 */
function version2Fixture(repoPath: string) {
  return {
    ...version1Fixture(repoPath),
    configVersion: 2,
    repoGroups: [{ id: 'g1', label: 'Work', order: 0, repos: [repoPath] }],
    externalAgents: [
      { id: 'a1', label: 'Claude', executable: 'claude', args: [], terminal: 'direct', enabled: true }
    ],
    agentLaunches: [],
    windowState: { windows: [{ repoPath }] }
  };
}

describe('migrating from version 2', () => {
  it('adds the external tool, bisect, shell integration and LFS sections', () => {
    const outcome = migrateConfig(version2Fixture(workspace));

    expect(outcome.fromVersion).toBe(2);
    expect(outcome.config['configVersion']).toBe(CURRENT_CONFIG_VERSION);
    expect(outcome.config['externalTools']).toEqual([]);
    expect(outcome.config['bisectCommands']).toEqual([]);
    expect(outcome.config['toolsConfirmed']).toEqual({});
    expect(outcome.config['lfs']).toEqual({});
  });

  it('starts with the Explorer entries recorded as not installed', () => {
    // The value is a claim about the user's registry. An upgrade has written
    // nothing there, so anything but false would make the settings screen
    // offer to remove entries that do not exist.
    const outcome = migrateConfig(version2Fixture(workspace));

    expect(outcome.config['shellIntegration']).toEqual({ contextMenuInstalled: false });
  });

  it('keeps every record version 2 held', () => {
    const fixture = version2Fixture(workspace);
    const { config } = prepareConfig(fixture);

    expect(config.sshProfiles).toHaveLength(2);
    expect(config.accountRules).toHaveLength(1);
    expect(config.recentRepos).toEqual(fixture.recentRepos);
    expect(config.repoGroups).toHaveLength(1);
    expect(config.externalAgents).toHaveLength(1);
    expect(config.windowState).toEqual({ windows: [{ repoPath: workspace }] });
    expect(config.repoSettings[canonicalRepoKey(workspace)]).toEqual({ warnBeforeDelete: false });
  });

  it('does not overwrite Phase 4 sections a newer build already wrote', () => {
    const withSections = {
      ...version2Fixture(workspace),
      externalTools: [
        { id: 't1', kind: 'diff', label: 'VS Code', executable: 'code', args: ['--diff', '{local}', '{remote}'], enabled: true }
      ],
      bisectCommands: [{ id: 'b1', label: 'Unit tests', executable: 'npm', args: ['test'] }],
      shellIntegration: { contextMenuInstalled: true },
      toolsConfirmed: { diff: true }
    };

    const outcome = migrateConfig(withSections);

    expect(outcome.config['externalTools']).toHaveLength(1);
    expect(outcome.config['bisectCommands']).toHaveLength(1);
    expect(outcome.config['shellIntegration']).toEqual({ contextMenuInstalled: true });
    expect(outcome.config['toolsConfirmed']).toEqual({ diff: true });
  });

  it('is idempotent', () => {
    const once = migrateConfig(version2Fixture(workspace)).config;
    expect(migrateConfig(once).config).toEqual(once);
  });
});

describe('validating the Phase 3 sections', () => {
  function withAgents(agents: unknown[]) {
    return validateAppConfig({ configVersion: 2, externalAgents: agents });
  }

  it('accepts a well-formed agent definition', () => {
    const { config, issues } = withAgents([
      {
        id: 'a1',
        label: 'Claude Code',
        executable: 'claude',
        args: ['--resume'],
        terminal: 'direct',
        enabled: true,
        promptMode: 'argument'
      }
    ]);

    expect(issues).toEqual([]);
    expect(config.externalAgents).toHaveLength(1);
  });

  it('drops an agent with an unknown terminal mode', () => {
    // It would reach a switch with no matching branch, so it is refused at the
    // boundary rather than being run through a guessed default.
    const { config, issues } = withAgents([
      { id: 'a1', executable: 'claude', args: [], terminal: 'wsl', enabled: true }
    ]);

    expect(config.externalAgents).toEqual([]);
    expect(issues[0]?.message).toMatch(/unknown terminal mode/i);
  });

  it('drops an agent whose arguments are not all text', () => {
    // One bad argument invalidates the vector: silently dropping it would run
    // a different command than the one that was configured.
    const { config, issues } = withAgents([
      { id: 'a1', executable: 'claude', args: ['ok', 42], terminal: 'direct', enabled: true }
    ]);

    expect(config.externalAgents).toEqual([]);
    expect(issues[0]?.message).toMatch(/arguments/i);
  });

  it('drops an agent with no executable, and keeps the good ones around it', () => {
    const { config } = withAgents([
      { id: 'bad', args: [], terminal: 'direct', enabled: true },
      { id: 'good', executable: 'codex', args: [], terminal: 'direct', enabled: true }
    ]);

    expect(config.externalAgents?.map((agent) => agent.id)).toEqual(['good']);
  });

  it('strips an agent environment override that would preload code', () => {
    const { config } = withAgents([
      {
        id: 'a1',
        executable: 'claude',
        args: [],
        terminal: 'direct',
        enabled: true,
        env: { LD_PRELOAD: '/tmp/evil.so', MY_FLAG: 'ok' }
      }
    ]);

    expect(config.externalAgents?.[0]?.env).toEqual({ MY_FLAG: 'ok' });
  });

  it('re-keys group members to canonical identity', () => {
    // A group written before a repository was reopened from a junction would
    // otherwise never match it again.
    const { config } = validateAppConfig({
      configVersion: 2,
      repoGroups: [{ id: 'g1', label: 'Work', order: 0, repos: [workspace, `${workspace}${path.sep}`] }]
    });

    expect(config.repoGroups?.[0]?.repos).toEqual([canonicalRepoKey(workspace)]);
  });

  it('refuses a group colour that is not a plain hex value', () => {
    const { config } = validateAppConfig({
      configVersion: 2,
      repoGroups: [
        { id: 'g1', label: 'Work', order: 0, repos: [], color: 'url(javascript:alert(1))' },
        { id: 'g2', label: 'Home', order: 1, repos: [], color: '#ff8800' }
      ]
    });

    expect(config.repoGroups?.[0]?.color).toBeUndefined();
    expect(config.repoGroups?.[1]?.color).toBe('#ff8800');
  });

  it('drops a duplicate group id rather than keeping two', () => {
    const { config, issues } = validateAppConfig({
      configVersion: 2,
      repoGroups: [
        { id: 'g1', label: 'One', order: 0, repos: [] },
        { id: 'g1', label: 'Two', order: 1, repos: [] }
      ]
    });

    expect(config.repoGroups).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/duplicate/i);
  });

  it('keeps only window records that name a path', () => {
    const { config } = validateAppConfig({
      configVersion: 2,
      windowState: {
        windows: [
          { repoPath: 'D:\\work\\app', bounds: { x: 1, y: 2, width: 3, height: 4 }, maximized: true },
          { bounds: { x: 0, y: 0, width: 10, height: 10 } },
          { repoPath: 'D:\\work\\other', bounds: { x: 'nope' } }
        ]
      }
    });

    expect(config.windowState?.windows).toHaveLength(2);
    expect(config.windowState?.windows[0]).toEqual({
      repoPath: 'D:\\work\\app',
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      maximized: true
    });
    // Unusable bounds are dropped; the window itself still reopens.
    expect(config.windowState?.windows[1]?.bounds).toBeUndefined();
  });

  it('caps the launch history so the file cannot grow without bound', () => {
    const launches = Array.from({ length: 120 }, (_, index) => ({
      at: new Date().toISOString(),
      agentId: 'a1',
      agentLabel: 'Claude',
      worktreePath: `D:\\work\\wt-${index}`,
      ok: true,
      commandPreview: 'claude'
    }));

    const { config } = validateAppConfig({ configVersion: 2, agentLaunches: launches });

    expect(config.agentLaunches).toHaveLength(MAX_AGENT_LAUNCHES);
  });

  it('accepts the new settings and ignores nonsense in them', () => {
    const { config } = validateAppConfig({
      configVersion: 2,
      settings: {
        manageSshConfig: true,
        restoreWindowsOnStartup: false,
        storeAgentPrompts: true,
        worktreeParentDir: 'D:\\trees'
      }
    });

    expect(config.settings).toMatchObject({
      restoreWindowsOnStartup: false,
      storeAgentPrompts: true,
      worktreeParentDir: 'D:\\trees'
    });

    const { config: rejected } = validateAppConfig({
      configVersion: 2,
      settings: { worktreeParentDir: 'D:\\trees\nHost evil' }
    });

    // It becomes a folder that gets created, so a newline in it is refused.
    expect(rejected.settings?.worktreeParentDir).toBeUndefined();
  });
});

describe('validating the Phase 4 sections', () => {
  function withTools(tools: unknown[]) {
    return validateAppConfig({ configVersion: 3, externalTools: tools });
  }

  const vscodeDiff = {
    id: 't1',
    kind: 'diff',
    label: 'VS Code',
    executable: 'code',
    args: ['--diff', '{local}', '{remote}'],
    enabled: true
  };

  it('accepts a well-formed tool definition', () => {
    const { config, issues } = withTools([vscodeDiff]);

    expect(issues).toEqual([]);
    expect(config.externalTools).toHaveLength(1);
    expect(config.externalTools?.[0]?.args).toEqual(['--diff', '{local}', '{remote}']);
  });

  it('drops a tool with an unknown kind', () => {
    const { config, issues } = withTools([{ ...vscodeDiff, kind: 'debugger' }]);

    expect(config.externalTools).toEqual([]);
    expect(issues[0]?.message).toMatch(/unknown tool kind/i);
  });

  it('drops a tool whose template uses a placeholder this build cannot expand', () => {
    // Passing it through as literal text would hand the tool the word
    // "{theirs}" where a file path belonged, and the diff would open on a file
    // that does not exist.
    const { config, issues } = withTools([{ ...vscodeDiff, args: ['--diff', '{local}', '{theirs}'] }]);

    expect(config.externalTools).toEqual([]);
    expect(issues[0]?.message).toMatch(/unknown placeholder \{theirs\}/i);
  });

  it('reports every unknown placeholder in the definition, not just the first', () => {
    const { issues } = withTools([{ ...vscodeDiff, args: ['{mine}', '{theirs}'] }]);

    expect(issues[0]?.message).toContain('{mine}');
    expect(issues[0]?.message).toContain('{theirs}');
  });

  it('refuses an executable that is a command line rather than a program', () => {
    const { config, issues } = withTools([{ ...vscodeDiff, executable: '' }]);

    expect(config.externalTools).toEqual([]);
    expect(issues[0]?.message).toMatch(/executable/i);
  });

  it('drops the whole vector when any argument is not text', () => {
    // Keeping the rest would run a different command than the one configured.
    const { config } = withTools([{ ...vscodeDiff, args: ['--diff', 42, '{remote}'] }]);

    expect(config.externalTools).toEqual([]);
  });

  it('keeps a valid tool beside a broken one', () => {
    const { config, issues } = withTools([
      { ...vscodeDiff, kind: 'nonsense' },
      { ...vscodeDiff, id: 't2' }
    ]);

    expect(config.externalTools).toHaveLength(1);
    expect(config.externalTools?.[0]?.id).toBe('t2');
    expect(issues).toHaveLength(1);
  });

  it('accepts a bisect command and its skip code', () => {
    const { config, issues } = validateAppConfig({
      configVersion: 3,
      bisectCommands: [{ id: 'b1', label: 'Unit tests', executable: 'npm', args: ['test'], skipExitCode: 125 }]
    });

    expect(issues).toEqual([]);
    expect(config.bisectCommands?.[0]?.skipExitCode).toBe(125);
  });

  it('ignores a skip code that is not an exit code', () => {
    const { config } = validateAppConfig({
      configVersion: 3,
      bisectCommands: [{ id: 'b1', executable: 'npm', args: ['test'], skipExitCode: 900 }]
    });

    expect(config.bisectCommands?.[0]?.skipExitCode).toBeUndefined();
  });

  it('treats anything but an explicit true as unconfirmed', () => {
    const { config } = validateAppConfig({
      configVersion: 3,
      toolsConfirmed: { diff: true, merge: 'yes', editor: 1, nonsense: true }
    });

    expect(config.toolsConfirmed).toEqual({ diff: true });
  });

  it('treats anything but an explicit true as "the Explorer entries are not installed"', () => {
    // A corrupt value must not convince the app that registry keys exist: the
    // uninstall path would then report success having deleted nothing.
    for (const value of ['true', 1, null, {}]) {
      const { config } = validateAppConfig({
        configVersion: 3,
        shellIntegration: { contextMenuInstalled: value }
      });

      expect(config.shellIntegration?.contextMenuInstalled).toBe(false);
    }
  });

  it('defaults LFS previews to not downloading anything', () => {
    const { config } = validateAppConfig({ configVersion: 3, lfs: {} });

    expect(config.lfs?.autoDownloadPreviews).toBe(false);
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

  it('keeps the SSH profile a repository is bound to', () => {
    // This used to be dropped. The binding is written when a repository is
    // pointed at an account, so losing it here reverted every repository to
    // the System profile the next time the file was read from disk.
    const { config } = validateAppConfig({
      repoSettings: { '/repo': { sshProfileId: 'work', warnBeforeDelete: false } }
    });

    expect(config.repoSettings[canonicalRepoKey('/repo')]).toEqual({
      sshProfileId: 'work',
      warnBeforeDelete: false
    });
  });

  it('keeps pinned branches and de-duplicates them', () => {
    const { config } = validateAppConfig({
      repoSettings: { '/repo': { pinnedBranches: ['main', 'main', 'release', ''] } }
    });

    expect(config.repoSettings[canonicalRepoKey('/repo')]?.pinnedBranches).toEqual([
      'main',
      'release'
    ]);
  });

  it('ignores a pinned-branches value that is not a list', () => {
    const { config } = validateAppConfig({
      repoSettings: { '/repo': { pinnedBranches: 'main' } }
    });

    expect(config.repoSettings[canonicalRepoKey('/repo')]?.pinnedBranches).toBeUndefined();
  });

  it('accepts a whole number of retention days and rejects anything else', () => {
    expect(validateAppConfig({ settings: { recoveryRetentionDays: 30 } }).config.settings).toEqual({
      recoveryRetentionDays: 30
    });
    expect(validateAppConfig({ settings: { recoveryRetentionDays: 0 } }).config.settings).toEqual({
      recoveryRetentionDays: 0
    });
    expect(validateAppConfig({ settings: { recoveryRetentionDays: -5 } }).config.settings).toEqual({});
    expect(validateAppConfig({ settings: { recoveryRetentionDays: 1.5 } }).config.settings).toEqual({});
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
