// Finding the process a launch started, and stopping only that.
//
// The danger this guards against is specific: process ids are reused, and a
// launcher's id usually names a stub that has already exited. A Stop button
// that trusted either would, sooner or later, end a program the user never
// started from here. So the picking and the checking are tested as rules.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  findLaunchedProcess,
  parsePsProcessList,
  parseWindowsProcessList,
  pickLaunchedProcess,
  stillRunning
} from '../src/server/agents/tracking';
import type { ProcessInfo, ProcessProbe } from '../src/server/agents/tracking';
import { countRunning, describeState, folderName } from '../src/renderer/features/agents/run-text';
import type { AgentLaunchView } from '../src/shared/agent-types';
import type { AgentLaunchRecord } from '../src/shared/config-types';
import { validateAppConfig, MAX_AGENT_PROMPT_CHARS } from '../src/server/config/validate';
import { createTempDir } from './helpers/temp-repo';

const SINCE = 1_800_000_000_000;

function proc(pid: number, name: string, startedAt: number, commandLine = name): ProcessInfo {
  return { pid, name, startedAt, commandLine };
}

describe('reading a process list', () => {
  it('reads the Windows lines, including a command line with tabs in it', () => {
    const output = [
      '4120\t1800000000123\tclaude.exe\tclaude --model opus "fix\tthis"',
      '8\t1800000000000\tSystem\t',
      'not a line',
      ''
    ].join('\r\n');

    expect(parseWindowsProcessList(output)).toEqual([
      { pid: 4120, startedAt: 1800000000123, name: 'claude.exe', commandLine: 'claude --model opus "fix\tthis"' },
      { pid: 8, startedAt: 1800000000000, name: 'System', commandLine: '' }
    ]);
  });

  it('reads ps lines and names a process after its first word', () => {
    const [first, second] = parsePsProcessList(
      ['  812 Tue Nov 10 12:00:00 2026 /usr/bin/node /usr/local/bin/claude --resume', ' 4001 Mon Nov  9 08:05:09 2026 bash', 'garbage'].join('\n')
    );

    expect(first).toMatchObject({ pid: 812, name: 'node', commandLine: '/usr/bin/node /usr/local/bin/claude --resume' });
    expect(first?.startedAt).toBe(new Date(2026, 10, 10, 12, 0, 0).getTime());
    expect(second).toMatchObject({ pid: 4001, name: 'bash' });
  });
});

describe('picking the process a launch started', () => {
  const input = { executable: 'claude', since: SINCE };

  it('takes the executable itself, by name, whatever its extension or case', () => {
    const found = pickLaunchedProcess(
      [proc(10, 'WindowsTerminal.exe', SINCE + 100, 'wt -d C:\\work -- claude'), proc(11, 'Claude.EXE', SINCE + 400)],
      input
    );

    // Not the terminal, though its command line names the tool: ending that
    // would close every tab the user has open in it.
    expect(found?.pid).toBe(11);
  });

  it('never takes a process that was already running before the launch', () => {
    const found = pickLaunchedProcess(
      [proc(5, 'claude.exe', SINCE - 60_000), proc(6, 'claude.exe', SINCE + 900)],
      input
    );

    expect(found?.pid).toBe(6);
    expect(pickLaunchedProcess([proc(5, 'claude.exe', SINCE - 60_000)], input)).toBeNull();
  });

  it('takes the oldest of several, which is the one the rest hang from', () => {
    const found = pickLaunchedProcess(
      [proc(30, 'claude.exe', SINCE + 2000), proc(20, 'claude.exe', SINCE + 300), proc(40, 'claude.exe', SINCE + 2500)],
      input
    );

    expect(found?.pid).toBe(20);
  });

  it('accepts a script host running the tool when the tool has no process of its own', () => {
    const found = pickLaunchedProcess(
      [
        proc(50, 'cmd.exe', SINCE + 200, 'cmd.exe /d /s /c "C:\\npm\\claude.cmd" "tidy the docs"'),
        proc(51, 'node.exe', SINCE + 600, 'node C:\\npm\\node_modules\\claude\\cli.js'),
        proc(52, 'node.exe', SINCE + 100, 'node C:\\other\\server.js')
      ],
      input
    );

    expect(found?.pid).toBe(50);
  });

  it('does not mistake a longer name for the tool', () => {
    expect(
      pickLaunchedProcess([proc(60, 'node.exe', SINCE + 100, 'node claude-helper-daemon.js')], input)
    ).toBeNull();
  });

  it('falls back to the launcher only when asked, and only if it is still there', () => {
    const list = [proc(70, 'mystery-tool', SINCE + 100)];
    const withLauncher = { ...input, launcherPid: 70 };

    expect(pickLaunchedProcess(list, withLauncher)).toBeNull();
    expect(pickLaunchedProcess(list, withLauncher, true)?.pid).toBe(70);
    expect(pickLaunchedProcess([], withLauncher, true)).toBeNull();
  });

  it('looks again when the first look finds nothing', async () => {
    const lists: ProcessInfo[][] = [[], [proc(80, 'claude', SINCE + 1500)]];
    const probe: ProcessProbe = { list: async () => lists.shift() ?? [], kill: async () => {} };

    await expect(findLaunchedProcess(input, probe, [0, 0, 0])).resolves.toEqual({ pid: 80, startedAt: SINCE + 1500 });
  });

  it('gives up quietly when the process table cannot be read', async () => {
    const probe: ProcessProbe = {
      list: async () => {
        throw new Error('access denied');
      },
      kill: async () => {}
    };

    await expect(findLaunchedProcess(input, probe, [0, 0])).resolves.toBeNull();
  });
});

describe('whether a tracked process is still the same process', () => {
  it('requires the creation time to match, not just the id', async () => {
    const probe: ProcessProbe = {
      // The id has been handed to something else since.
      list: async () => [proc(900, 'chrome.exe', SINCE + 86_400_000), proc(901, 'claude.exe', SINCE + 500)],
      kill: async () => {}
    };

    const running = await stillRunning(
      [
        { pid: 900, startedAt: SINCE },
        { pid: 901, startedAt: SINCE },
        { pid: 902, startedAt: SINCE }
      ],
      probe
    );

    expect([...running]).toEqual([901]);
  });

  it('asks nothing when there is nothing to ask about', async () => {
    const list = vi.fn(async () => []);
    await stillRunning([], { list, kill: async () => {} });
    expect(list).not.toHaveBeenCalled();
  });
});

describe('the launch history on disk', () => {
  it('keeps the new fields and caps the task', () => {
    const { config } = validateAppConfig({
      configVersion: 2,
      agentLaunches: [
        {
          id: 'run-1',
          at: '2026-11-10T10:00:00.000Z',
          worktreePath: 'D:/work/app',
          ok: true,
          prompt: 'x'.repeat(MAX_AGENT_PROMPT_CHARS + 50),
          tracked: { pid: 4120, startedAt: SINCE },
          endedAt: '2026-11-10T11:00:00.000Z',
          stopped: true
        },
        // A hand-edited record must not turn into a process to end.
        { at: '2026-11-10T09:00:00.000Z', worktreePath: 'D:/work/app', ok: true, tracked: { pid: -4, startedAt: 'soon' } }
      ]
    });

    const [first, second] = config.agentLaunches ?? [];
    expect(first).toMatchObject({ id: 'run-1', tracked: { pid: 4120, startedAt: SINCE }, stopped: true });
    expect(first?.prompt).toHaveLength(MAX_AGENT_PROMPT_CHARS);
    expect(second?.tracked).toBeUndefined();
  });
});

describe('reading states and stopping, against a throwaway home', () => {
  async function serviceWith(launches: AgentLaunchRecord[]) {
    const home = createTempDir('multi-git-agent-track-');
    fs.writeFileSync(
      path.join(home, '.multi-git-client-config.json'),
      JSON.stringify({ configVersion: 2, recentRepos: [], sshProfiles: [], accountRules: [], repoSettings: {}, agentLaunches: launches })
    );

    vi.resetModules();
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('HOME', home);

    return {
      service: await import('../src/server/agents/service'),
      definitions: await import('../src/server/agents/definitions')
    };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const base = { agentId: 'claude', agentLabel: 'Claude Code', worktreePath: 'D:/work/app', commandPreview: 'claude' };
  const now = new Date().toISOString();

  /** A machine on which exactly these processes exist. */
  function machine(alive: ProcessInfo[]): ProcessProbe & { killed: number[] } {
    const killed: number[] = [];
    return {
      killed,
      list: async (pids = []) => alive.filter((entry) => pids.length === 0 || pids.includes(entry.pid)),
      kill: async (pid) => {
        killed.push(pid);
        const index = alive.findIndex((entry) => entry.pid === pid);
        if (index >= 0) {
          alive.splice(index, 1);
        }
      }
    };
  }

  it('reports each launch and writes down the ones that have gone', async () => {
    const { service, definitions } = await serviceWith([
      { ...base, id: 'alive', at: now, ok: true, tracked: { pid: 1, startedAt: SINCE } },
      { ...base, id: 'gone', at: now, ok: true, tracked: { pid: 2, startedAt: SINCE } },
      { ...base, id: 'lost', at: now, ok: true },
      { ...base, id: 'broke', at: now, ok: false, error: 'not found' },
      { ...base, id: 'killed', at: now, ok: true, tracked: { pid: 3, startedAt: SINCE }, endedAt: now, stopped: true }
    ]);

    const states = await service.readLaunchStates(machine([proc(1, 'claude', SINCE + 300)]));

    expect(Object.fromEntries(states.map((entry) => [entry.id, entry.state]))).toEqual({
      alive: 'running',
      gone: 'finished',
      lost: 'untracked',
      broke: 'failed',
      killed: 'stopped'
    });
    // Recorded, so it is never looked up again.
    expect(definitions.listLaunches().find((entry) => entry.id === 'gone')?.endedAt).toBeTruthy();
    expect(definitions.listLaunches().find((entry) => entry.id === 'alive')?.endedAt).toBeUndefined();
  });

  it('marks nothing as finished when the process table cannot be read', async () => {
    const { service, definitions } = await serviceWith([
      { ...base, id: 'alive', at: now, ok: true, tracked: { pid: 1, startedAt: SINCE } }
    ]);

    const [entry] = await service.readLaunchStates({
      list: async () => {
        throw new Error('no');
      },
      kill: async () => {}
    });

    expect(entry?.state).toBe('running');
    expect(definitions.listLaunches()[0]?.endedAt).toBeUndefined();
  });

  it('stops the process it tracked and records that it was stopped', async () => {
    const { service, definitions } = await serviceWith([
      { ...base, id: 'alive', at: now, ok: true, tracked: { pid: 1, startedAt: SINCE } }
    ]);
    const probe = machine([proc(1, 'claude', SINCE)]);

    await expect(service.stopLaunch('alive', probe)).resolves.toEqual({ stopped: true });
    expect(probe.killed).toEqual([1]);
    expect(definitions.listLaunches()[0]).toMatchObject({ stopped: true });
  });

  it('ends nothing when the id now belongs to a different process', async () => {
    const { service } = await serviceWith([
      { ...base, id: 'alive', at: now, ok: true, tracked: { pid: 1, startedAt: SINCE } }
    ]);
    const probe = machine([proc(1, 'explorer.exe', SINCE + 3_600_000)]);

    const result = await service.stopLaunch('alive', probe);

    expect(result.stopped).toBe(false);
    expect(result.error).toMatch(/already finished/);
    expect(probe.killed).toEqual([]);
  });

  it('refuses a launch it does not know, or never found a process for', async () => {
    const { service } = await serviceWith([{ ...base, id: 'lost', at: now, ok: true }]);
    const probe = machine([]);

    expect((await service.stopLaunch('nope', probe)).stopped).toBe(false);
    expect((await service.stopLaunch('lost', probe)).error).toMatch(/Close its window/);
    expect(probe.killed).toEqual([]);
  });

  it('says so when the process survives', async () => {
    const { service, definitions } = await serviceWith([
      { ...base, id: 'alive', at: now, ok: true, tracked: { pid: 1, startedAt: SINCE } }
    ]);
    const stubborn: ProcessProbe = { list: async () => [proc(1, 'claude', SINCE)], kill: async () => {} };

    const result = await service.stopLaunch('alive', stubborn);

    expect(result).toMatchObject({ stopped: false });
    expect(definitions.listLaunches()[0]?.stopped).toBeUndefined();
  });

  it('clears what is over and keeps what is still running', async () => {
    const { service, definitions } = await serviceWith([
      { ...base, id: 'alive', at: now, ok: true, tracked: { pid: 1, startedAt: SINCE } },
      { ...base, id: 'gone', at: now, ok: true, tracked: { pid: 2, startedAt: SINCE } },
      { ...base, id: 'old', at: '2026-01-01T00:00:00.000Z', ok: true },
      { ...base, id: 'broke', at: now, ok: false }
    ]);

    await service.clearFinishedLaunches(machine([proc(1, 'claude', SINCE)]));

    expect(definitions.listLaunches().map((entry) => entry.id)).toEqual(['alive']);
  });

  it('tracks a launch when told where to look', async () => {
    const worktree = createTempDir('multi-git-agent-wt-');
    const { service, definitions } = await serviceWith([]);
    const { readConfig, writeConfig } = await import('../src/server/config/store');
    const config = readConfig();
    config.externalAgents = [
      { id: 'claude', label: 'Claude Code', executable: 'claude', args: [], terminal: 'direct', enabled: true, promptMode: 'none' }
    ] as typeof config.externalAgents;
    writeConfig(config);

    const { FakeRunner } = await import('./helpers/fake-runner');
    let lists = 0;
    const probe: ProcessProbe = {
      list: async () => {
        lists += 1;
        return [proc(4242, 'claude', Date.now())];
      },
      kill: async () => {}
    };

    vi.useFakeTimers();
    try {
      const result = await service.launchAgent(
        { repoPath: worktree, worktreePath: worktree, agentId: 'claude' },
        {
          runner: new FakeRunner().otherwise({ stdout: '/usr/bin/claude' }),
          launcher: { launch: async () => ({ pid: 77 }) },
          probe
        }
      );
      expect(result.launched).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);
    } finally {
      vi.useRealTimers();
    }

    expect(lists).toBe(1);
    expect(definitions.listLaunches()[0]?.tracked?.pid).toBe(4242);
  });
});

describe('what the Agents panel says', () => {
  const view = (extra: Partial<AgentLaunchView>): AgentLaunchView => ({
    id: 'r',
    at: new Date(SINCE).toISOString(),
    agentId: 'claude',
    agentLabel: 'Claude Code',
    worktreePath: 'D:\\work\\api-login',
    ok: true,
    commandPreview: 'claude',
    state: 'running',
    ...extra
  });

  it('names a folder by its last part, either way the slashes lean', () => {
    expect(folderName('D:\\work\\api-login')).toBe('api-login');
    expect(folderName('/home/ada/work/api-login/')).toBe('api-login');
  });

  it('counts only what is known to be running', () => {
    expect(countRunning([view({}), view({ state: 'untracked' }), view({ state: 'finished' })])).toBe(1);
  });

  it('says a new launch is starting, then admits when it lost track of it', () => {
    const run = view({ state: 'untracked' });

    expect(describeState(run, SINCE + 3000).label).toBe('Starting');
    const later = describeState(run, SINCE + 60_000);
    expect(later.label).toBe('Started');
    expect(later.note).toMatch(/close its window/);
  });

  it('shows why a launch did not start', () => {
    expect(describeState(view({ state: 'failed', ok: false, error: 'claude was not found' }), SINCE)).toEqual({
      label: 'Did not start',
      note: 'claude was not found'
    });
  });
});
