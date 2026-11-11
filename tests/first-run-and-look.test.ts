// The 5.4 additions that are rules rather than pixels: which commit types are
// valid, when a background fetch may run, what the first-run guide says, and
// how an SSH agent is started where there is no service to switch on.
import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_COMMIT_TYPES,
  MAX_CUSTOM_COMMIT_TYPES,
  isThemeChoice,
  normalizeCommitType,
  sanitizeCustomCommitTypes
} from '../src/shared/commit-types';
import {
  allCommitTypes,
  applyCommitType,
  commitTypeStyle
} from '../src/renderer/features/commit/conventional';
import { resolveTheme } from '../src/renderer/ui/appearance';
import { quietFetchBlocker } from '../src/renderer/features/sync/quiet-fetch';
import type { QuietFetchInput } from '../src/renderer/features/sync/quiet-fetch';
import {
  agentIsStartable,
  describeAgentForSetup,
  describeValidation
} from '../src/renderer/features/setup/wizard-text';
import { parseAgentEnvironment, resetSessionAgent, startSessionAgent } from '../src/server/ssh/session-agent';
import { validateAppConfig } from '../src/server/config/validate';
import { sanitizeConfigForClient } from '../src/server/config/sanitize';
import { QUIET_FETCH_OPTIONS } from '../src/server/workflows/sync';
import { gitCommandKind } from '../src/server/git/command-kind';
import { FakeRunner } from './helpers/fake-runner';

describe('commit types of your own', () => {
  it('tidies what someone who has seen the format would type', () => {
    expect(normalizeCommitType(' Art: ')).toBe('art');
    expect(normalizeCommitType('release()')).toBe('release');
    expect(normalizeCommitType('BUILD!')).toBe('build');
  });

  it('refuses what could not be read back as a prefix', () => {
    // The prefix is recognised with [a-z]+, so anything else would stack.
    for (const bad of ['', 'a', 'hot-fix', 'v2', 'two words', 'x'.repeat(17), 'émoji']) {
      expect(normalizeCommitType(bad)).toBeNull();
    }
  });

  it('stores a list with no built-ins, no repeats and a cap', () => {
    expect(sanitizeCustomCommitTypes(['art', 'feat', 'ART', 12, 'bad one', 'release'])).toEqual(['art', 'release']);
    expect(sanitizeCustomCommitTypes('art')).toBeUndefined();

    const many = Array.from({ length: 40 }, (_, index) => `t${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}`);
    expect(sanitizeCustomCommitTypes(many)).toHaveLength(MAX_CUSTOM_COMMIT_TYPES);
  });

  it('draws the built-ins first and each type the same way every time', () => {
    expect(allCommitTypes(['art', 'fix'])).toEqual([...BUILT_IN_COMMIT_TYPES, 'art']);
    expect(commitTypeStyle('fix')).toEqual({ icon: 'bug_report', tint: 'pink' });
    expect(commitTypeStyle('art')).toEqual(commitTypeStyle('art'));
    expect(commitTypeStyle('art').icon).toBe('label');
  });

  it('swaps a custom prefix for another instead of stacking them', () => {
    expect(applyCommitType('art: redraw the logo', 'fix', '')).toBe('fix: redraw the logo');
    expect(applyCommitType('fix: redraw the logo', 'art', 'ui')).toBe('art(ui): redraw the logo');
  });
});

describe('the look settings', () => {
  it('accepts the three theme choices and nothing else', () => {
    expect(['dark', 'light', 'system'].every(isThemeChoice)).toBe(true);
    expect(isThemeChoice('sepia')).toBe(false);
    expect(isThemeChoice(undefined)).toBe(false);
  });

  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('round-trips through the configuration file, dropping nonsense', () => {
    const { config } = validateAppConfig({
      configVersion: 2,
      settings: {
        manageSshConfig: false,
        theme: 'light',
        simpleMode: true,
        experienceChosen: true,
        keepAgentPrompts: false,
        customCommitTypes: ['art', 'feat', 'not valid']
      }
    });

    expect(config.settings).toMatchObject({
      theme: 'light',
      simpleMode: true,
      experienceChosen: true,
      keepAgentPrompts: false,
      customCommitTypes: ['art']
    });

    const { config: odd } = validateAppConfig({ configVersion: 2, settings: { manageSshConfig: false, theme: 'neon', simpleMode: 'yes' } });
    expect(odd.settings?.theme).toBeUndefined();
    expect(odd.settings?.simpleMode).toBeUndefined();
  });

  it('gives the page a default for each of them', () => {
    const { config } = validateAppConfig({ configVersion: 2 });
    const client = sanitizeConfigForClient(config);

    expect(client.settings).toMatchObject({
      theme: 'dark',
      simpleMode: false,
      experienceChosen: false,
      keepAgentPrompts: true,
      customCommitTypes: []
    });
  });
});

describe('when a background fetch may run', () => {
  const ready: QuietFetchInput = {
    autoPull: true,
    activeRepo: 'D:/work/app',
    status: { tracking: 'origin/main' },
    visible: true,
    syncing: false,
    profile: { selected: false, usableWithoutPrompt: true },
    sinceLast: 10 * 60_000,
    minGap: 5 * 60_000
  };

  it('runs when nothing stands in the way', () => {
    expect(quietFetchBlocker(ready)).toBeNull();
  });

  it.each([
    ['off', { autoPull: false }],
    ['no-repo', { activeRepo: null }],
    ['no-upstream', { status: { tracking: '' } }],
    ['no-upstream', { status: null }],
    ['hidden', { visible: false }],
    ['busy', { syncing: true }],
    ['locked', { profile: { selected: true, usableWithoutPrompt: false } }],
    ['recent', { sinceLast: 60_000 }]
  ] as const)('holds back when %s', (reason, change) => {
    expect(quietFetchBlocker({ ...ready, ...change })).toBe(reason);
  });

  it('runs for a selected key that needs nothing typed', () => {
    expect(quietFetchBlocker({ ...ready, profile: { selected: true, usableWithoutPrompt: true } })).toBeNull();
  });

  it('tells the credential helper not to ask, and is still read as a fetch', () => {
    expect(QUIET_FETCH_OPTIONS).toEqual(['-c', 'credential.interactive=never']);
    expect(gitCommandKind([...QUIET_FETCH_OPTIONS, 'fetch', '--prune', 'origin'])).toBe(
      gitCommandKind(['fetch', '--prune', 'origin'])
    );
  });
});

describe('what the first-run guide says about the SSH agent', () => {
  it('offers one click on Windows when the service is off, in the desktop app', () => {
    for (const availability of ['stopped', 'disabled'] as const) {
      const text = describeAgentForSetup({ platform: 'win32', availability }, true);
      expect(text.action).toBe('Turn it on');
      expect(text.detail).toMatch(/permission/);
    }
  });

  it('does not offer a button that cannot work in a browser', () => {
    const text = describeAgentForSetup({ platform: 'win32', availability: 'stopped' }, false);
    expect(text.action).toBeUndefined();
    expect(text.detail).toMatch(/desktop app/);
  });

  it('offers to start one elsewhere, with no password', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const text = describeAgentForSetup({ platform, availability: 'unreachable' }, false);
      expect(text.action).toBe('Start it');
      expect(text.detail).toMatch(/No password/);
    }
  });

  it('says how to get OpenSSH where it is missing, and offers no button', () => {
    expect(describeAgentForSetup({ platform: 'win32', availability: 'missing' }, true)).toMatchObject({
      tone: 'optional',
      detail: expect.stringMatching(/Optional features/)
    });
    expect(describeAgentForSetup({ platform: 'linux', availability: 'missing' }, true).action).toBeUndefined();
  });

  it('never suggests typing a command', () => {
    const states = [
      ['win32', 'ready'], ['win32', 'stopped'], ['win32', 'disabled'], ['win32', 'missing'], ['win32', 'unreachable'],
      ['linux', 'ready'], ['linux', 'missing'], ['linux', 'unreachable'], ['darwin', 'unreachable']
    ] as const;

    for (const [platform, availability] of states) {
      const { detail } = describeAgentForSetup({ platform, availability }, true);
      expect(detail).not.toMatch(/eval|Start-Service|\$\(|sudo/);
    }
    expect(describeAgentForSetup(null, true).detail).toMatch(/carry on/);
  });

  it('agrees with the accounts menu about what one press can fix', () => {
    expect(agentIsStartable({ platform: 'win32', availability: 'unreachable' })).toBe(false);
    expect(agentIsStartable({ platform: 'linux', availability: 'stopped' })).toBe(false);
    expect(agentIsStartable({ platform: 'darwin', availability: 'unreachable' })).toBe(true);
  });
});

describe('what Validate key says', () => {
  const check = { account: null, expected: null, mismatch: false, message: 'ssh said no' };

  it('names the account the host greeted', () => {
    expect(describeValidation({ ...check, ok: true, account: 'octocat' }, 'github.com')).toEqual({
      ok: true,
      message: 'Validated as octocat on github.com. You are ready to go.'
    });
  });

  it('still counts a host that accepted the key without naming anyone', () => {
    expect(describeValidation({ ...check, ok: true }, 'git.example.com').message).toMatch(/accepted this key/);
  });

  it('says what to do next for each way it can fail', () => {
    expect(describeValidation({ ...check, ok: false, reason: 'refused' }, 'github.com').message).toMatch(/does not know this key/);
    expect(describeValidation({ ...check, ok: false, reason: 'timeout' }, 'github.com').message).toMatch(/internet connection/);
    expect(describeValidation({ ...check, ok: false, reason: 'prompted' }, 'github.com').message).toMatch(/passphrase/);
    expect(describeValidation({ ...check, ok: false }, 'github.com')).toEqual({ ok: false, message: 'Not validated: ssh said no' });
  });
});

describe('starting an SSH agent for the session', () => {
  it('reads where the new agent can be reached', () => {
    expect(
      parseAgentEnvironment('SSH_AUTH_SOCK=/tmp/ssh-AbC/agent.412; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=413; export SSH_AGENT_PID;\necho Agent pid 413;\n')
    ).toEqual({ socket: '/tmp/ssh-AbC/agent.412', pid: 413 });
    expect(parseAgentEnvironment('usage: ssh-agent')).toBeNull();
  });

  it('is not what Windows uses', async () => {
    const runner = new FakeRunner();
    const result = await startSessionAgent(runner, 'win32');

    expect(result.started).toBe(false);
    expect(runner.calls).toHaveLength(0);
  });

  it('reports a machine without ssh-agent instead of throwing', async () => {
    resetSessionAgent();
    const runner = new FakeRunner().otherwise({ spawnError: true });

    const result = await startSessionAgent(runner, 'linux');

    expect(result.started).toBe(false);
    expect(result.message).toMatch(/OpenSSH/);
  });
});
