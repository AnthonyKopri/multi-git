// Per-profile Host aliases, and the separation of "this repository's account"
// from "this machine's default account".
//
// The defect these tests pin down: `applySshConfigForActiveProfile` ran on
// every profile selection and wrote that repository's key into the catch-all
// `Host github.com` entry. So the machine-wide default silently became
// whichever repository was opened last, and a push from any unpinned folder
// went out as that account.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { aliasFor, aliasHostsFor, canonicalHost } from '../src/server/ssh/host-alias';
import { renderManagedBlock } from '../src/server/ssh/config-block';
import type { SshProfile } from '../src/shared/config-types';

const MAIN: SshProfile = {
  id: '1',
  label: 'main_acc',
  privateKeyPath: '/home/jane/.ssh/id_ed25519_main_acc',
  userName: 'Anthony',
  userEmail: 'a@example.com'
};

const FAMILIARA: SshProfile = {
  id: '2',
  label: 'familiara',
  privateKeyPath: '/home/jane/.ssh/id_ed25519_familiara',
  userName: 'Anthony',
  userEmail: 'a@familiara.de'
};

const PROFILES = [MAIN, FAMILIARA];

let workspace: string;

/**
 * Loads config-sync against a throwaway home, so ~/.ssh/config and the config
 * file are the fixture's rather than the developer's own.
 */
async function syncWithConfig(config: Record<string, unknown>) {
  const home = fs.mkdtempSync(path.join(workspace, 'home-'));
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.multi-git-client-config.json'),
    JSON.stringify({
      configVersion: 1,
      recentRepos: [],
      accountRules: [],
      repoSettings: {},
      ...config
    })
  );

  vi.resetModules();
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('HOME', home);

  const module = await import('../src/server/ssh/config-sync');
  return { module, sshConfig: () => fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8') };
}

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-alias-')));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('aliases', () => {
  it('names one entry per profile', () => {
    expect(aliasFor('github.com', 'familiara')).toBe('github.com-familiara');
    // The same sanitiser the key filenames use, so the two agree.
    expect(aliasFor('github.com', 'Work Account!')).toBe('github.com-work_account');
  });

  it('refuses a label with nothing usable in it', () => {
    expect(aliasFor('github.com', '!!!')).toBeNull();
  });

  it('maps every profile onto its own host', () => {
    expect(aliasHostsFor('github.com', PROFILES)).toEqual({
      'github.com-main_acc': MAIN.privateKeyPath,
      'github.com-familiara': FAMILIARA.privateKeyPath
    });
  });
});

describe('canonicalHost', () => {
  it('turns an alias back into the host it connects to', () => {
    // Needed because the app never writes an alias remote, but a user may
    // paste one — and everything that reasons about where a repository lives
    // would otherwise see a host that does not exist.
    expect(canonicalHost('github.com-familiara', PROFILES)).toBe('github.com');
  });

  it('leaves a real host alone, including one that looks like an alias', () => {
    expect(canonicalHost('github.com', PROFILES)).toBe('github.com');
    // Indistinguishable from an alias by shape alone, which is why this is
    // matched against the configured labels rather than guessed at.
    expect(canonicalHost('git.internal-tools', PROFILES)).toBe('git.internal-tools');
  });

  it('passes nothing through as nothing', () => {
    expect(canonicalHost(null, PROFILES)).toBeNull();
    expect(canonicalHost('', PROFILES)).toBeNull();
  });
});

describe('renderManagedBlock', () => {
  it('points an alias at the real host and a catch-all at itself', () => {
    const block = renderManagedBlock(
      {
        defaults: { 'github.com': MAIN.privateKeyPath },
        aliases: aliasHostsFor('github.com', PROFILES)
      },
      (host) => canonicalHost(host, PROFILES) ?? host
    );

    expect(block).toContain('Host github.com-familiara');
    // Without HostName the alias would be resolved as a DNS name and fail.
    expect(block).toMatch(/Host github\.com-familiara\r?\n {2}HostName github\.com/);
    expect(block).toMatch(/Host github\.com\r?\n {2}HostName github\.com/);
    expect(block).toContain(FAMILIARA.privateKeyPath);
  });

  it('still accepts the plain map older callers passed', () => {
    expect(renderManagedBlock({ 'github.com': MAIN.privateKeyPath })).toContain('Host github.com');
  });
});

describe('who writes the catch-all', () => {
  it('does not touch the default when a repository picks a profile', async () => {
    // The defect, stated as a test: selecting familiara for one repository must
    // not make familiara the answer for every unpinned folder on the machine.
    const { module, sshConfig } = await syncWithConfig({
      sshProfiles: PROFILES,
      defaultAccountProfileId: MAIN.id,
      sshConfigHosts: { 'github.com': MAIN.privateKeyPath }
    });

    module.syncSshAliases('github.com');

    expect(sshConfig()).toMatch(
      /Host github\.com\r?\n {2}HostName github\.com\r?\n {2}IdentityFile "[^"]*id_ed25519_main_acc"/
    );
  });

  it('adds an alias for every profile while doing so', async () => {
    const { module, sshConfig } = await syncWithConfig({
      sshProfiles: PROFILES,
      defaultAccountProfileId: MAIN.id,
      sshConfigHosts: { 'github.com': MAIN.privateKeyPath }
    });

    module.syncSshAliases('github.com');

    expect(sshConfig()).toContain('Host github.com-familiara');
    expect(sshConfig()).toContain('Host github.com-main_acc');
  });

  it('changes the default only when asked to', async () => {
    const { module, sshConfig } = await syncWithConfig({
      sshProfiles: PROFILES,
      defaultAccountProfileId: MAIN.id,
      sshConfigHosts: { 'github.com': MAIN.privateKeyPath }
    });

    module.setDefaultAccount(FAMILIARA.id);

    expect(sshConfig()).toMatch(
      /Host github\.com\r?\n {2}HostName github\.com\r?\n {2}IdentityFile "[^"]*id_ed25519_familiara"/
    );
  });

  it('leaves no account privileged when the default is cleared', async () => {
    const { module, sshConfig } = await syncWithConfig({
      sshProfiles: PROFILES,
      defaultAccountProfileId: MAIN.id,
      sshConfigHosts: { 'github.com': MAIN.privateKeyPath }
    });

    module.setDefaultAccount(null);
    const written = sshConfig();

    // Aliases survive; the entry that made one profile the machine-wide answer
    // does not.
    expect(written).toContain('Host github.com-familiara');
    expect(written).not.toMatch(/Host github\.com\r?\n/);
  });

  it('keeps behaving as it did for a config written before this existed', async () => {
    // No recorded choice, only whatever the last profile switch happened to
    // write. Inferring it means the machine keeps doing what it did, instead of
    // silently changing account at upgrade time.
    const { module } = await syncWithConfig({
      sshProfiles: PROFILES,
      sshConfigHosts: { 'github.com': FAMILIARA.privateKeyPath }
    });

    const { readConfig } = await import('../src/server/config/store');

    expect(module.resolveDefaultAccount(readConfig())?.id).toBe(FAMILIARA.id);
  });

  it('notices when more than one account could serve a host', async () => {
    const { module } = await syncWithConfig({ sshProfiles: PROFILES });
    const { readConfig } = await import('../src/server/config/store');

    expect(module.hasCompetingAccounts(readConfig())).toBe(true);
  });
});
