// When the desktop app brings the installed terminal edition up to its own
// version, and the setting that turns that off.
import { describe, expect, it } from 'vitest';

import { followDecision } from '../src/server/terminal/follow';
import { validateAppConfig } from '../src/server/config/validate';
import { sanitizeConfigForClient } from '../src/server/config/sanitize';
import type { TerminalInstallationStatus } from '../src/shared/terminal-types';

function status(overrides: Partial<TerminalInstallationStatus>): TerminalInstallationStatus {
  return {
    state: 'ready',
    message: '',
    bundledVersion: '6.0.1',
    installedVersion: '6.0.0',
    canUpgrade: true,
    location: '/home/ada/.multi-git/terminal',
    command: '/home/ada/.local/bin/multi-git',
    resolvedCommand: '/home/ada/.local/bin/multi-git',
    plannedChanges: [],
    setupChoice: 'enabled',
    mcpConfig: null,
    skillsPath: null,
    ...overrides
  };
}

describe('bringing the terminal edition along with the app', () => {
  it('updates an enabled installation that is older than the app', () => {
    expect(followDecision(status({}), true)).toEqual({ follow: true, from: '6.0.0', to: '6.0.1' });
  });

  it('also updates when the command is shadowed or a terminal needs reopening', () => {
    expect(followDecision(status({ state: 'shadowed' }), true).follow).toBe(true);
    expect(followDecision(status({ state: 'reopen-terminal' }), true).follow).toBe(true);
  });

  it('does nothing when it is turned off', () => {
    expect(followDecision(status({}), false)).toEqual({ follow: false, reason: 'turned-off' });
  });

  it('never installs it for someone who did not enable it', () => {
    const never = status({ state: 'not-installed', installedVersion: null, setupChoice: null });
    expect(followDecision(never, true)).toEqual({ follow: false, reason: 'not-installed' });
    const skipped = status({ state: 'not-installed', installedVersion: null, setupChoice: 'skipped' });
    expect(followDecision(skipped, true)).toEqual({ follow: false, reason: 'not-installed' });
  });

  it('leaves a damaged installation for Repair', () => {
    expect(followDecision(status({ state: 'damaged' }), true)).toEqual({ follow: false, reason: 'damaged' });
  });

  it('leaves an installation at or past the app version alone', () => {
    expect(followDecision(status({ installedVersion: '6.0.1', canUpgrade: false }), true)).toEqual({
      follow: false,
      reason: 'up-to-date'
    });
    expect(followDecision(status({ installedVersion: '6.1.0', canUpgrade: false }), true).follow).toBe(false);
  });

  it('does nothing in a build without the terminal edition', () => {
    expect(followDecision(status({ bundledVersion: null, canUpgrade: false }), true)).toEqual({
      follow: false,
      reason: 'unavailable'
    });
  });
});

describe('the setting', () => {
  it('is on unless turned off', () => {
    const { config } = validateAppConfig({ configVersion: 2 });
    expect(sanitizeConfigForClient(config).settings.terminalFollowsApp).toBe(true);
  });

  it('round-trips off, and drops anything that is not a boolean', () => {
    const { config } = validateAppConfig({ configVersion: 2, settings: { manageSshConfig: false, terminalFollowsApp: false } });
    expect(config.settings?.terminalFollowsApp).toBe(false);
    expect(sanitizeConfigForClient(config).settings.terminalFollowsApp).toBe(false);

    const { config: odd } = validateAppConfig({ configVersion: 2, settings: { manageSshConfig: false, terminalFollowsApp: 'no' } });
    expect(odd.settings?.terminalFollowsApp).toBeUndefined();
  });
});
