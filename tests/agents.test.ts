// What gets spawned when an agent is launched, and what does not.
//
// Nothing in this file starts a process. The launch plan is built and
// inspected instead, because the properties worth guaranteeing — the argument
// vector stays an array, the prompt never becomes part of a command string,
// the environment is an allowlist rather than a copy of ours — are properties
// of the plan, and asserting them against a real process would prove less
// while being far slower.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  INHERITED_ENV_KEYS,
  POWERSHELL_BRIDGE_SCRIPT,
  buildLaunchEnv,
  buildLaunchPlan,
  escapeForWindowsTerminal
} from '../src/server/agents/launch';
import {
  AgentDefinitionError,
  assertUsableDefinition,
  definitionFromDetected,
  resolveExecutable
} from '../src/server/agents/definitions';
import { createDetachedLauncher } from '../src/server/process/runner';
import { FakeRunner } from './helpers/fake-runner';
import { createTempDir, cleanupRepos } from './helpers/temp-repo';
import type { ExternalAgentDefinition } from '../src/shared/config-types';

const isWindows = process.platform === 'win32';

function definition(overrides: Partial<ExternalAgentDefinition> = {}): ExternalAgentDefinition {
  return {
    id: 'claude',
    label: 'Claude Code',
    executable: 'claude',
    args: [],
    terminal: 'direct',
    enabled: true,
    promptMode: 'argument',
    ...overrides
  };
}

afterEach(() => {
  cleanupRepos();
});

describe('building the launch plan', () => {
  it('runs the executable directly with the worktree as cwd', () => {
    const plan = buildLaunchPlan({
      definition: definition({ args: ['--resume'] }),
      worktreePath: '/work/app.worktrees/login',
      parentEnv: {}
    });

    expect(plan.executable).toBe('claude');
    expect(plan.args).toEqual(['--resume']);
    expect(plan.cwd).toBe('/work/app.worktrees/login');
    // An interactive tool with no window is a tool nobody can answer.
    expect(plan.visible).toBe(true);
  });

  it('appends a prompt as one argument, whatever is in it', () => {
    const nasty = 'fix the bug; rm -rf ~ && echo "$(whoami)" | tee /tmp/x\nnewline';

    const plan = buildLaunchPlan({
      definition: definition(),
      worktreePath: '/work/app',
      initialPrompt: nasty,
      parentEnv: {}
    });

    // One element, byte for byte. There is no command line for any of those
    // characters to mean anything in.
    expect(plan.args).toEqual([nasty]);
  });

  it('ignores a prompt for a tool that does not take one', () => {
    const plan = buildLaunchPlan({
      definition: definition({ promptMode: 'none', args: ['--chat'] }),
      worktreePath: '/work/app',
      initialPrompt: 'do the thing',
      parentEnv: {}
    });

    expect(plan.args).toEqual(['--chat']);
  });

  it('never puts the prompt in the preview that gets logged and stored', () => {
    const plan = buildLaunchPlan({
      definition: definition(),
      worktreePath: '/work/app',
      initialPrompt: 'a secret internal design document',
      parentEnv: {}
    });

    expect(plan.preview).not.toContain('secret');
    expect(plan.preview).toBe('claude');
  });

  describe('through Windows Terminal', () => {
    const plan = () =>
      buildLaunchPlan({
        definition: definition({ terminal: 'windows-terminal', args: ['--model', 'opus'] }),
        worktreePath: 'D:\\work\\app.worktrees\\login',
        parentEnv: {}
      });

    it('passes the folder with -d and the tool after --', () => {
      expect(plan().executable).toBe('wt.exe');
      expect(plan().args).toEqual([
        '-d',
        'D:\\work\\app.worktrees\\login',
        '--',
        'claude',
        '--model',
        'opus'
      ]);
    });

    it('escapes a semicolon, which wt reads as a command separator', () => {
      // Unescaped, everything after the `;` would open as a second tab
      // running whatever it happened to say.
      const withSemicolon = buildLaunchPlan({
        definition: definition({ terminal: 'windows-terminal' }),
        worktreePath: 'D:\\work\\app',
        initialPrompt: 'first thing; second thing',
        parentEnv: {}
      });

      expect(withSemicolon.args.at(-1)).toBe('first thing\\; second thing');
    });

    it('leaves everything else in an argument alone', () => {
      expect(escapeForWindowsTerminal('a "quoted" value & more')).toBe('a "quoted" value & more');
      expect(escapeForWindowsTerminal('one;two;three')).toBe('one\\;two\\;three');
    });
  });

  describe('through PowerShell', () => {
    const plan = () =>
      buildLaunchPlan({
        definition: definition({ terminal: 'powershell', args: ['--model', 'opus'] }),
        worktreePath: 'D:\\work\\app',
        initialPrompt: "'; Remove-Item C:\\ -Recurse; '",
        parentEnv: {}
      });

    it('runs a fixed script and never builds a command string', () => {
      // The one mode that needs something PowerShell will parse. What it
      // parses is a constant.
      expect(plan().executable).toBe('powershell.exe');
      expect(plan().args).toEqual(['-NoProfile', '-NoExit', '-Command', POWERSHELL_BRIDGE_SCRIPT]);
      expect(POWERSHELL_BRIDGE_SCRIPT).not.toContain('claude');
    });

    it('carries the executable and arguments in the environment instead', () => {
      const built = plan();

      expect(built.env['MG_LAUNCH_EXE']).toBe('claude');
      expect(JSON.parse(built.env['MG_LAUNCH_ARGS'] as string)).toEqual([
        '--model',
        'opus',
        "'; Remove-Item C:\\ -Recurse; '"
      ]);
    });

    it('keeps the injection attempt out of every argument', () => {
      // The dangerous text exists only as a JSON string in an environment
      // variable, never in anything PowerShell parses as code.
      for (const argument of plan().args) {
        expect(argument).not.toContain('Remove-Item');
      }
    });
  });
});

describe('the environment a launched tool gets', () => {
  const parent: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/jane',
    // Multi-Git's own state, which a coding agent has no business inheriting.
    SSH_ASKPASS: '/tmp/multi-git-askpass/askpass.sh',
    SSH_ASKPASS_REQUIRE: 'force',
    GIT_SSH_COMMAND: 'ssh -i /home/jane/.ssh/id_work',
    GIT_INDEX_FILE: '/tmp/index',
    AWS_SECRET_ACCESS_KEY: 'not-a-listed-variable'
  };

  it('passes through what a program needs to run', () => {
    const env = buildLaunchEnv(parent, undefined);

    expect(env['PATH']).toBe('/usr/bin');
    expect(env['HOME']).toBe('/home/jane');
  });

  it('drops the askpass bridge that answers with a stored passphrase', () => {
    const env = buildLaunchEnv(parent, undefined);

    expect(env['SSH_ASKPASS']).toBeUndefined();
    expect(env['SSH_ASKPASS_REQUIRE']).toBeUndefined();
  });

  it('drops GIT_SSH_COMMAND, because the identity belongs to the folder', () => {
    // The pin lives in the repository's own config, which is what makes a
    // tool authenticate correctly without inheriting anything from us.
    expect(buildLaunchEnv(parent, undefined)['GIT_SSH_COMMAND']).toBeUndefined();
    expect(buildLaunchEnv(parent, undefined)['GIT_INDEX_FILE']).toBeUndefined();
  });

  it('is an allowlist, so an unrelated variable does not travel', () => {
    expect(buildLaunchEnv(parent, undefined)['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    for (const key of Object.keys(buildLaunchEnv(parent, undefined))) {
      expect(INHERITED_ENV_KEYS).toContain(key);
    }
  });

  it('applies per-agent overrides', () => {
    const env = buildLaunchEnv(parent, { MY_TOOL_MODE: 'fast' });
    expect(env['MY_TOOL_MODE']).toBe('fast');
  });

  it('refuses an override that would load code before the program runs', () => {
    const env = buildLaunchEnv(parent, {
      LD_PRELOAD: '/tmp/evil.so',
      NODE_OPTIONS: '--require /tmp/evil.js',
      ELECTRON_RUN_AS_NODE: '1'
    });

    expect(env['LD_PRELOAD']).toBeUndefined();
    expect(env['NODE_OPTIONS']).toBeUndefined();
    expect(env['ELECTRON_RUN_AS_NODE']).toBeUndefined();
  });

  it('refuses an override that would re-add a denied variable', () => {
    const env = buildLaunchEnv(parent, { GIT_SSH_COMMAND: 'ssh -i /tmp/other' });
    expect(env['GIT_SSH_COMMAND']).toBeUndefined();
  });
});

describe('validating a definition', () => {
  it('accepts an ordinary one', () => {
    expect(() => assertUsableDefinition(definition())).not.toThrow();
  });

  it('refuses an empty executable', () => {
    expect(() => assertUsableDefinition(definition({ executable: '   ' }))).toThrow(
      AgentDefinitionError
    );
  });

  it('refuses an executable carrying a newline or a null', () => {
    expect(() => assertUsableDefinition(definition({ executable: 'claude\nrm -rf /' }))).toThrow(
      AgentDefinitionError
    );
    expect(() => assertUsableDefinition(definition({ executable: 'claude\0evil' }))).toThrow(
      AgentDefinitionError
    );
  });

  it('refuses a terminal mode it has no branch for', () => {
    expect(() =>
      assertUsableDefinition(definition({ terminal: 'wsl' as ExternalAgentDefinition['terminal'] }))
    ).toThrow(AgentDefinitionError);
  });

  it('refuses an argument containing a null byte', () => {
    expect(() => assertUsableDefinition(definition({ args: ['ok', 'bad\0'] }))).toThrow(
      AgentDefinitionError
    );
  });

  it('refuses a Windows-only mode on a platform without it', () => {
    const check = () => assertUsableDefinition(definition({ terminal: 'windows-terminal' }));

    if (isWindows) {
      expect(check).not.toThrow();
    } else {
      expect(check).toThrow(/only exists on Windows/i);
    }
  });

  it('names the agent in the message, so the reason is actionable', () => {
    expect(() =>
      assertUsableDefinition(definition({ label: 'My Tool', executable: '' }))
    ).toThrow(/My Tool/);
  });
});

describe('detecting an installed tool', () => {
  const finder = process.platform === 'win32' ? 'where' : 'which';

  it('reports where an executable resolves to', async () => {
    const runner = new FakeRunner().on(
      (executable) => executable === finder,
      { stdout: 'C:\\Program Files\\claude\\claude.exe\nC:\\other\\claude.exe\n' }
    );

    // The first match is the one that would actually run.
    expect(await resolveExecutable('claude', runner)).toBe('C:\\Program Files\\claude\\claude.exe');
  });

  it('reports a missing tool as absent rather than throwing', async () => {
    const runner = new FakeRunner().on(
      (executable) => executable === finder,
      { exitCode: 1, stdout: '' }
    );

    expect(await resolveExecutable('nope', runner)).toBeNull();
  });

  it('treats the finder itself being missing as "not installed"', async () => {
    const runner = new FakeRunner().on(() => true, { spawnError: true });
    expect(await resolveExecutable('claude', runner)).toBeNull();
  });

  it('seeds a definition that takes a prompt and opens a window', () => {
    const seeded = definitionFromDetected({
      id: 'claude',
      label: 'Claude Code',
      executable: 'claude',
      resolvedPath: '/usr/bin/claude',
      configured: false
    });

    expect(seeded).toMatchObject({
      label: 'Claude Code',
      executable: 'claude',
      args: [],
      enabled: true,
      promptMode: 'argument'
    });
    expect(seeded.id).not.toBe('claude');
    expect(seeded.terminal).toBe(isWindows ? 'windows-terminal' : 'direct');
  });
});

describe('the detached launcher', () => {
  it('spawns with no shell, detached, and the given argv', async () => {
    const calls: { executable: string; args: readonly string[]; options: Record<string, unknown> }[] = [];

    const fakeSpawn = ((executable: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ executable, args, options });

      const listeners = new Map<string, (value?: unknown) => void>();
      const child = {
        pid: 4242,
        on(event: string, listener: (value?: unknown) => void) {
          listeners.set(event, listener);
          if (event === 'spawn') {
            // Node emits this once the process exists.
            queueMicrotask(() => listener());
          }
          return child;
        },
        unref() {}
      };
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const launcher = createDetachedLauncher(fakeSpawn);
    const result = await launcher.launch('claude', ['--resume'], {
      cwd: '/work/app',
      env: { PATH: '/usr/bin' },
      visible: true
    });

    expect(result.pid).toBe(4242);
    expect(calls[0]?.executable).toBe('claude');
    expect(calls[0]?.args).toEqual(['--resume']);
    expect(calls[0]?.options).toMatchObject({
      shell: false,
      detached: true,
      stdio: 'ignore',
      cwd: '/work/app',
      // Visible means the console window is not hidden.
      windowsHide: false
    });
    expect(calls[0]?.options['env']).toEqual({ PATH: '/usr/bin' });
  });

  it('rejects when the program does not exist', async () => {
    let exits = 0;
    const fakeSpawn = (() => {
      const child = {
        on(event: string, listener: (value?: unknown) => void) {
          if (event === 'error') {
            queueMicrotask(() => listener(new Error('ENOENT')));
          }
          return child;
        },
        unref() {}
      };
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    await expect(
      createDetachedLauncher(fakeSpawn).launch('nope', [], {
        onExit: () => {
          exits += 1;
        }
      })
    ).rejects.toThrow(/nope/);
    expect(exits).toBe(0);
  });

  it('hides the window when the caller did not ask for one', async () => {
    let seen: Record<string, unknown> = {};

    const fakeSpawn = ((_exe: string, _args: readonly string[], options: Record<string, unknown>) => {
      seen = options;
      const child = {
        pid: 1,
        on(event: string, listener: () => void) {
          if (event === 'spawn') {
            queueMicrotask(listener);
          }
          return child;
        },
        unref() {}
      };
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    await createDetachedLauncher(fakeSpawn).launch('code', ['/work']);
    expect(seen['windowsHide']).toBe(true);
  });

  it('notifies a caller with temporary files after the process exits', async () => {
    const listeners = new Map<string, (value?: unknown) => void>();
    const child = {
      pid: 7,
      on(event: string, listener: (value?: unknown) => void) {
        listeners.set(event, listener);
        if (event === 'spawn') {
          queueMicrotask(() => listener());
        }
        return child;
      },
      unref() {}
    };
    const fakeSpawn = (() => child) as unknown as typeof import('node:child_process').spawn;
    let exits = 0;

    await createDetachedLauncher(fakeSpawn).launch('mergetool', ['file.txt'], {
      onExit: () => {
        exits += 1;
      }
    });

    expect(exits).toBe(0);
    listeners.get('close')?.(0);
    expect(exits).toBe(1);
  });
});

describe('launching, end to end against a fake launcher', () => {
  /** Loads the agent service against a throwaway home directory. */
  async function serviceWithHome(agents: ExternalAgentDefinition[]) {
    const home = createTempDir('multi-git-agent-home-');
    fs.writeFileSync(
      path.join(home, '.multi-git-client-config.json'),
      JSON.stringify({
        configVersion: 2,
        recentRepos: [],
        sshProfiles: [],
        accountRules: [],
        repoSettings: {},
        externalAgents: agents
      })
    );

    vi.resetModules();
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('HOME', home);

    return {
      home,
      service: await import('../src/server/agents/service'),
      definitions: await import('../src/server/agents/definitions')
    };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function launcherRecording(record: { executable?: string; args?: readonly string[]; cwd?: string }) {
    return {
      launch: async (executable: string, args: readonly string[], options: { cwd?: string } = {}) => {
        record.executable = executable;
        record.args = args;
        record.cwd = options.cwd;
        return { pid: 99 };
      }
    };
  }

  it('starts the configured agent in the worktree and records the launch', async () => {
    const worktree = createTempDir('multi-git-agent-wt-');
    const { service, definitions } = await serviceWithHome([definition()]);

    const record: { executable?: string; args?: readonly string[]; cwd?: string } = {};
    const runner = new FakeRunner().otherwise({ stdout: '/usr/bin/claude' });

    const result = await service.launchAgent(
      { repoPath: worktree, worktreePath: worktree, agentId: 'claude', initialPrompt: 'hello' },
      { runner, launcher: launcherRecording(record) }
    );

    expect(result.launched).toBe(true);
    expect(result.processId).toBe(99);
    expect(record.executable).toBe('claude');
    expect(record.args).toEqual(['hello']);
    expect(path.resolve(record.cwd ?? '')).toBe(path.resolve(worktree));

    const [entry] = definitions.listLaunches();
    expect(entry).toMatchObject({ agentLabel: 'Claude Code', ok: true, pid: 99 });
    // The prompt is the most sensitive part of a launch and is not kept.
    expect(JSON.stringify(entry)).not.toContain('hello');
  });

  it('refuses an agent that is not configured', async () => {
    const worktree = createTempDir('multi-git-agent-wt-');
    const { service } = await serviceWithHome([]);

    const result = await service.launchAgent(
      { repoPath: worktree, worktreePath: worktree, agentId: 'ghost' },
      { runner: new FakeRunner(), launcher: launcherRecording({}) }
    );

    expect(result.launched).toBe(false);
    expect(result.error).toMatch(/no longer configured/i);
  });

  it('refuses an agent that has been turned off', async () => {
    const worktree = createTempDir('multi-git-agent-wt-');
    const { service } = await serviceWithHome([definition({ enabled: false })]);

    const result = await service.launchAgent(
      { repoPath: worktree, worktreePath: worktree, agentId: 'claude' },
      { runner: new FakeRunner(), launcher: launcherRecording({}) }
    );

    expect(result.launched).toBe(false);
    expect(result.error).toMatch(/turned off/i);
  });

  it('says the tool is not installed rather than failing obscurely', async () => {
    const worktree = createTempDir('multi-git-agent-wt-');
    const { service } = await serviceWithHome([definition()]);

    const runner = new FakeRunner().otherwise({ exitCode: 1, stdout: '' });

    const result = await service.launchAgent(
      { repoPath: worktree, worktreePath: worktree, agentId: 'claude' },
      { runner, launcher: launcherRecording({}) }
    );

    expect(result.launched).toBe(false);
    expect(result.error).toMatch(/not found on your PATH/i);
  });

  it('refuses a folder that does not exist', async () => {
    const { service } = await serviceWithHome([definition()]);

    const result = await service.launchAgent(
      {
        repoPath: '/nope',
        worktreePath: path.join(os.tmpdir(), 'multi-git-absent-worktree'),
        agentId: 'claude'
      },
      { runner: new FakeRunner(), launcher: launcherRecording({}) }
    );

    expect(result.launched).toBe(false);
    expect(result.error).toMatch(/not a folder that exists/i);
  });

  it('records a failed launch, so the history is not only good news', async () => {
    const worktree = createTempDir('multi-git-agent-wt-');
    const { service, definitions } = await serviceWithHome([definition()]);

    const failing = {
      launch: async () => {
        throw new Error('the terminal refused to start');
      }
    };

    const result = await service.launchAgent(
      { repoPath: worktree, worktreePath: worktree, agentId: 'claude' },
      { runner: new FakeRunner().otherwise({ stdout: '/usr/bin/claude' }), launcher: failing }
    );

    expect(result.launched).toBe(false);
    expect(definitions.listLaunches()[0]).toMatchObject({ ok: false });
    expect(definitions.listLaunches()[0]?.error).toMatch(/refused to start/);
  });
});
