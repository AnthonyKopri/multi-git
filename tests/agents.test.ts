// What gets spawned when an agent is launched, and what does not.
//
// Nothing in this file starts a process. The launch plan is built and
// inspected instead, because the properties worth guaranteeing — the argument
// vector stays an array, the prompt never becomes part of a command string,
// the environment is an allowlist rather than a copy of ours — are properties
// of the plan, and asserting them against a real process would prove less
// while being far slower.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AGENT_PROVIDER_ENV_KEYS,
  INHERITED_ENV_KEYS,
  MACOS_BRIDGE_SCRIPT,
  POWERSHELL_BRIDGE_SCRIPT,
  buildLaunchEnv,
  buildLaunchPlan,
  buildLaunchPlans,
  escapeForWindowsTerminal,
  linuxAgentTerminalPlans,
  writeMacosBridge
} from '../src/server/agents/launch';
import {
  AgentDefinitionError,
  assertUsableDefinition,
  definitionFromDetected,
  detectAgents,
  resolveExecutable
} from '../src/server/agents/definitions';
import { AGENT_CATALOGUE, findModelPreset } from '../src/shared/agent-catalogue';
import type { AgentCatalogueEntry } from '../src/shared/agent-catalogue';
import type { DetectedAgent } from '../src/shared/agent-types';
import { createDetachedLauncher } from '../src/server/process/runner';
import { NEW_CONSOLE_BRIDGE_SCRIPT } from '../src/server/process/windows-console';
import { FakeRunner } from './helpers/fake-runner';
import { withPlatform } from './helpers/platform';
import { createTempDir, cleanupRepos } from './helpers/temp-repo';
import type { ExternalAgentDefinition } from '../src/shared/config-types';

const isWindows = process.platform === 'win32';

/** A child with the pipes the console bridge reads, and nothing else. */
class FakeBridgeChild extends EventEmitter {
  readonly pid = 1234;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  unref(): void {}
}

/**
 * A directory holding one executable of a stated kind, and the PATH to find it
 * on.
 *
 * Which branch a visible Windows launch takes now depends on what the target
 * file says it is, so a test that means "a console program" has to put one
 * somewhere rather than name something and hope the runner does not have it.
 * See windows-subsystem.test.ts for the header being written here.
 */
function pathWith(name: string, subsystem: 2 | 3 | 'not-an-exe'): string {
  const directory = createTempDir();

  if (subsystem === 'not-an-exe') {
    fs.writeFileSync(path.join(directory, name), '@echo off\r\n');
    return directory;
  }

  const file = Buffer.alloc(512);
  file.writeUInt16LE(0x5a4d, 0); // 'MZ'
  file.writeUInt32LE(128, 0x3c);
  file.writeUInt32LE(0x00004550, 128); // 'PE\0\0'
  file.writeUInt16LE(0x20b, 128 + 24);
  file.writeUInt16LE(subsystem, 128 + 24 + 68);
  fs.writeFileSync(path.join(directory, name), file);

  return directory;
}

/** A catalogue entry as detection would report it, installed. */
function detected(id: string): DetectedAgent {
  const entry = AGENT_CATALOGUE.find((candidate) => candidate.id === id) as AgentCatalogueEntry;

  return {
    id: entry.id,
    label: entry.label,
    vendor: entry.vendor,
    summary: entry.summary,
    homepage: entry.homepage,
    executable: entry.executable,
    resolvedPath: `/usr/bin/${entry.executable}`,
    installed: true,
    configured: false,
    hasModels: (entry.models ?? []).length > 0
  };
}

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

describe('a prompt that needs a flag in front of it', () => {
  const gemini = definition({
    id: 'gemini',
    label: 'Gemini CLI',
    executable: 'gemini',
    promptMode: 'flag',
    promptArgs: ['-i'],
    catalogueId: 'gemini'
  });

  it('puts the flag before the prompt, as one argument each', () => {
    const plan = buildLaunchPlan({
      definition: gemini,
      worktreePath: '/work/app',
      initialPrompt: 'rename the module',
      parentEnv: {}
    });

    expect(plan.args).toEqual(['-i', 'rename the module']);
  });

  it('sends neither when there is no prompt', () => {
    // `gemini -i` with nothing after it is a command line the tool refuses,
    // so a flag with no value is never sent.
    const plan = buildLaunchPlan({ definition: gemini, worktreePath: '/work/app', parentEnv: {} });

    expect(plan.args).toEqual([]);
  });

  it('keeps the prompt out of the preview, the same as every other mode', () => {
    const plan = buildLaunchPlan({
      definition: gemini,
      worktreePath: '/work/app',
      initialPrompt: 'a secret internal design document',
      parentEnv: {}
    });

    expect(plan.preview).toBe('gemini');
  });
});

describe('launching against a particular model', () => {
  const claude = definition({ catalogueId: 'claude' });

  it('appends the preset arguments after the definition\'s own', () => {
    const plan = buildLaunchPlan({
      definition: definition({ catalogueId: 'claude', args: ['--resume'] }),
      worktreePath: '/work/app',
      modelPreset: findModelPreset('claude', 'opus'),
      initialPrompt: 'go',
      parentEnv: {}
    });

    // The model flag never swallows the prompt as its value, because the
    // prompt is last.
    expect(plan.args).toEqual(['--resume', '--model', 'opus', 'go']);
  });

  it('puts a preset base URL in the environment, not on the command line', () => {
    const preset = findModelPreset('claude', 'deepseek');
    const plan = buildLaunchPlan({
      definition: claude,
      worktreePath: '/work/app',
      modelPreset: preset,
      parentEnv: {}
    });

    expect(plan.args).toEqual([]);
    expect(plan.env['ANTHROPIC_BASE_URL']).toBe('https://api.deepseek.com/anthropic');
  });

  it('names the key it needs without ever holding one', () => {
    const preset = findModelPreset('claude', 'kimi-k2');

    expect(preset?.requiresEnv).toEqual(['ANTHROPIC_AUTH_TOKEN']);
    expect(JSON.stringify(preset?.env)).not.toContain('ANTHROPIC_AUTH_TOKEN');
  });

  it('lets a definition\'s own environment be overridden by the preset', () => {
    const plan = buildLaunchPlan({
      definition: definition({
        catalogueId: 'claude',
        env: { ANTHROPIC_BASE_URL: 'https://example.invalid', MY_TOOL_MODE: 'fast' }
      }),
      worktreePath: '/work/app',
      modelPreset: findModelPreset('claude', 'glm'),
      parentEnv: {}
    });

    expect(plan.env['ANTHROPIC_BASE_URL']).toBe('https://api.z.ai/api/anthropic');
    expect(plan.env['MY_TOOL_MODE']).toBe('fast');
  });

  it('records the preset in the preview, because it changed what runs', () => {
    const plan = buildLaunchPlan({
      definition: claude,
      worktreePath: '/work/app',
      modelPreset: findModelPreset('claude', 'sonnet'),
      parentEnv: {}
    });

    expect(plan.preview).toBe('claude --model sonnet');
  });

  it('is ignored when the id names no preset the entry has', () => {
    expect(findModelPreset('claude', 'not-a-model')).toBeNull();
    expect(findModelPreset(undefined, 'opus')).toBeNull();
  });
});

describe('the platform terminal mode', () => {
  const agent = definition({ terminal: 'system-terminal', args: ['--resume'] });

  it('offers every Linux emulator, running the tool in the worktree', async () => {
    await withPlatform('linux', async () => {
      const plans = buildLaunchPlans({
        definition: agent,
        worktreePath: '/work/app',
        initialPrompt: 'go',
        parentEnv: {}
      });

      // A list, because no terminal emulator ships on every distribution.
      expect(plans.length).toBeGreaterThan(5);

      const gnome = plans.find((plan) => plan.executable === 'gnome-terminal');
      expect(gnome?.args).toEqual([
        '--working-directory=/work/app',
        '--',
        'claude',
        '--resume',
        'go'
      ]);
      expect(gnome?.cwd).toBe('/work/app');

      // Every candidate spawns the tool as separate argv elements; none
      // assembles a command line for the terminal to split again.
      for (const plan of plans) {
        expect(plan.args).toContain('claude');
        expect(plan.args.join('|')).not.toContain('claude --resume');
      }
    });
  });

  it('lets TERMINAL name the emulator, when it names one this build knows', async () => {
    await withPlatform('linux', async () => {
      const [first] = linuxAgentTerminalPlans('/work/app', ['claude'], {}, { TERMINAL: 'konsole' });
      expect(first?.executable).toBe('konsole');

      // One carrying arguments is skipped rather than split, since splitting
      // it would mean parsing a command line.
      const [other] = linuxAgentTerminalPlans('/work/app', ['claude'], {}, {
        TERMINAL: 'konsole --profile work'
      });
      expect(other?.executable).toBe('gnome-terminal');
    });
  });

  it('falls back from Windows Terminal to PowerShell, which every Windows has', async () => {
    await withPlatform('win32', async () => {
      const plans = buildLaunchPlans({
        definition: agent,
        worktreePath: 'D:\\work\\app',
        parentEnv: {}
      });

      expect(plans.map((plan) => plan.executable)).toEqual(['wt.exe', 'powershell.exe']);
    });
  });

  it('opens Terminal.app through a bridge that parses nothing', async () => {
    await withPlatform('darwin', async () => {
      const plan = buildLaunchPlan({
        definition: agent,
        worktreePath: '/work/app',
        initialPrompt: 'fix it; rm -rf ~',
        parentEnv: {}
      });

      expect(plan.executable).toBe('open');
      expect(plan.args.slice(0, 2)).toEqual(['-a', 'Terminal']);
      // Nothing of the launch is in the script, and the script is what runs.
      expect(MACOS_BRIDGE_SCRIPT).not.toContain('claude');
      expect(MACOS_BRIDGE_SCRIPT).not.toContain('rm -rf');
      expect(plan.preview).not.toContain('rm -rf');
    });
  });

  it('writes nothing until the plan is prepared, so describing one is free', async () => {
    await withPlatform('darwin', async () => {
      const plan = buildLaunchPlan({
        definition: agent,
        worktreePath: '/work/app',
        parentEnv: {}
      });

      // A candidate list of a dozen terminals must not leave a dozen
      // directories behind, and a test that inspects a plan must not write one.
      expect(fs.existsSync(plan.args[2] as string)).toBe(false);
    });
  });

  it('hands the bridge its arguments as NUL-separated records', () => {
    const root = createTempDir();
    const script = path.join(root, 'launch', 'launch.command');
    const nasty = 'fix the bug;\nthen "quote" it';

    writeMacosBridge(script, '/work/app', 'claude', ['--resume', nasty], { MY_TOOL_MODE: 'fast' });

    const argv = fs.readFileSync(path.join(path.dirname(script), 'argv'), 'utf8');
    expect(argv.split('\0').slice(0, -1)).toEqual(['/work/app', 'claude', '--resume', nasty]);

    const env = fs.readFileSync(path.join(path.dirname(script), 'env'), 'utf8');
    expect(env.split('\0').slice(0, -1)).toEqual(['MY_TOOL_MODE=fast']);

    // The script Terminal runs is the constant, byte for byte.
    expect(fs.readFileSync(script, 'utf8')).toBe(MACOS_BRIDGE_SCRIPT);
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

  it('carries a model provider\'s key only when the launch is an agent', () => {
    const withKeys = { ...parent, GEMINI_API_KEY: 'g-1', HTTPS_PROXY: 'http://proxy:3128' };

    // A terminal, an editor and a file manager have no model to reach.
    expect(buildLaunchEnv(withKeys, undefined)['GEMINI_API_KEY']).toBeUndefined();

    const agentEnv = buildLaunchEnv(withKeys, undefined, true);
    expect(agentEnv['GEMINI_API_KEY']).toBe('g-1');
    // Useless without it on a network that requires one.
    expect(agentEnv['HTTPS_PROXY']).toBe('http://proxy:3128');
  });

  it('never re-admits a denied variable by widening the allowlist', () => {
    const env = buildLaunchEnv({ ...parent, GH_TOKEN: 'ghp_x' }, undefined, true);

    expect(env['SSH_ASKPASS']).toBeUndefined();
    expect(env['GIT_SSH_COMMAND']).toBeUndefined();
    // A key that addresses a git host is not a key that addresses a model,
    // and which account a push is attributed to is the folder's to decide.
    expect(env['GH_TOKEN']).toBeUndefined();

    for (const key of Object.keys(env)) {
      expect([...INHERITED_ENV_KEYS, ...AGENT_PROVIDER_ENV_KEYS]).toContain(key);
    }
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
    const seeded = definitionFromDetected(detected('claude'));

    expect(seeded).toMatchObject({
      label: 'Claude Code',
      executable: 'claude',
      args: [],
      enabled: true,
      promptMode: 'argument',
      catalogueId: 'claude'
    });
    expect(seeded.id).not.toBe('claude');
    // A detached spawn on macOS or Linux has no console at all, so an
    // interactive agent seeded there gets the platform's terminal instead.
    expect(seeded.terminal).toBe(isWindows ? 'windows-terminal' : 'system-terminal');
  });

  it('takes the prompt mode from the catalogue rather than assuming one', () => {
    // The old default said every tool reads its prompt as a bare first
    // argument. Gemini wants `-i` in front of it, and a tool that takes no
    // interactive prompt at all must not be handed one.
    expect(definitionFromDetected(detected('gemini'))).toMatchObject({
      promptMode: 'flag',
      promptArgs: ['-i']
    });
    expect(definitionFromDetected(detected('aider'))).toMatchObject({ promptMode: 'none' });
  });

  it('reports every known tool, installed or not', async () => {
    const runner = new FakeRunner()
      .otherwise({ exitCode: 1, stdout: '' })
      .on((executable, args) => executable === finder && args[0] === 'claude', {
        stdout: '/usr/bin/claude\n'
      });

    const all = await detectAgents(runner);

    expect(all).toHaveLength(AGENT_CATALOGUE.length);
    expect(all.find((entry) => entry.id === 'claude')).toMatchObject({
      installed: true,
      resolvedPath: '/usr/bin/claude',
      hasModels: true
    });
    // An uninstalled tool is still reported: "not installed, here is where it
    // lives" answers a question that leaving the row out only raises.
    expect(all.find((entry) => entry.id === 'gemini')).toMatchObject({
      installed: false,
      resolvedPath: ''
    });
  });
});

describe('the known-agent catalogue', () => {
  it('has a unique id and a reachable-looking home for every entry', () => {
    const ids = AGENT_CATALOGUE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of AGENT_CATALOGUE) {
      expect(entry.executable, entry.id).toMatch(/^[\w.-]+$/);
      expect(entry.homepage, entry.id).toMatch(/^https:\/\//);
      expect(entry.summary.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('gives a flag to every tool whose prompt needs one, and to no other', () => {
    for (const entry of AGENT_CATALOGUE) {
      if (entry.promptMode === 'flag') {
        expect((entry.promptArgs ?? []).length, entry.id).toBeGreaterThan(0);
      } else {
        expect(entry.promptArgs, entry.id).toBeUndefined();
      }
    }
  });

  it('never stores a credential in a preset, only the variable to read it from', () => {
    for (const entry of AGENT_CATALOGUE) {
      for (const preset of entry.models ?? []) {
        for (const [key, value] of Object.entries(preset.env ?? {})) {
          expect(`${key}=${value}`, `${entry.id}/${preset.id}`).not.toMatch(
            /(KEY|TOKEN|SECRET)=\S/i
          );
        }
        // A key is named so the user knows what to export, never collected.
        for (const name of preset.requiresEnv ?? []) {
          expect(AGENT_PROVIDER_ENV_KEYS, `${entry.id}/${preset.id}`).toContain(name);
        }
      }
    }
  });

  it('keeps every preset id unique within its entry', () => {
    for (const entry of AGENT_CATALOGUE) {
      const ids = (entry.models ?? []).map((preset) => preset.id);
      expect(new Set(ids).size, entry.id).toBe(ids.length);
    }
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
      visible: false
    });

    expect(result.pid).toBe(4242);
    expect(calls[0]?.executable).toBe('claude');
    expect(calls[0]?.args).toEqual(['--resume']);
    expect(calls[0]?.options).toMatchObject({
      shell: false,
      detached: true,
      stdio: 'ignore',
      cwd: '/work/app',
      windowsHide: true
    });
    expect(calls[0]?.options['env']).toEqual({ PATH: '/usr/bin' });
  });

  it('leaves a visible launch detached where a detached spawn gets a window', async () => {
    // Everywhere except Windows, that is: `detached` there means
    // DETACHED_PROCESS, which is the opposite of what a visible launch needs.
    const calls: { executable: string; options: Record<string, unknown> }[] = [];
    const fakeSpawn = ((executable: string, _args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ executable, options });
      const child = {
        pid: 9,
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

    await withPlatform('linux', () =>
      createDetachedLauncher(fakeSpawn).launch('claude', ['--resume'], { visible: true })
    );

    expect(calls[0]?.executable).toBe('claude');
    expect(calls[0]?.options).toMatchObject({ detached: true, windowsHide: false });
  });

  it('gives a visible Windows launch a console of its own, through the bridge', async () => {
    // The defect behind issue #46. `detached: true` on Windows is
    // DETACHED_PROCESS: a console program started that way is given no console
    // and exits without running, so "Installing GitHub CLI in a terminal
    // window" opened no terminal and installed nothing. The bridge asks
    // PowerShell to Start-Process it instead, which does create one.
    const calls: { executable: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
    let bridge: FakeBridgeChild | null = null;

    const fakeSpawn = ((executable: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ executable, args, options });
      bridge = new FakeBridgeChild();
      // The bridge prints the launched program's own id.
      queueMicrotask(() => bridge?.stdout.emit('data', Buffer.from('MG_PID=4242\n')));
      return bridge;
    }) as unknown as typeof import('node:child_process').spawn;

    const bin = pathWith('powershell.exe', 3);
    const result = await withPlatform('win32', () =>
      createDetachedLauncher(fakeSpawn).launch(
        'powershell.exe',
        ['-NoProfile', '-NoExit', '-Command', 'winget install --id GitHub.cli -e --source winget'],
        { cwd: 'C:\\Users\\me', env: { PATH: bin }, visible: true }
      )
    );

    // The id reported is the program's, not the bridge's.
    expect(result.pid).toBe(4242);

    expect(calls[0]?.executable).toBe('powershell.exe');
    expect(calls[0]?.args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      NEW_CONSOLE_BRIDGE_SCRIPT
    ]);
    // Not detached: that is the flag that denies PowerShell a console too.
    expect(calls[0]?.options).toMatchObject({ shell: false, detached: false, windowsHide: true });

    // Nothing about the launch is interpolated into the script; it travels as
    // environment, and the command line is quoted for the C runtime.
    const env = calls[0]?.options['env'] as Record<string, string>;
    expect(env['MG_CONSOLE_EXE']).toBe('powershell.exe');
    expect(env['MG_CONSOLE_ARGS']).toContain('"winget install --id GitHub.cli -e --source winget"');
    expect(env['MG_CONSOLE_CWD']).toBe('C:\\Users\\me');
    expect(env['PATH']).toBe(bin);
    expect(NEW_CONSOLE_BRIDGE_SCRIPT).not.toContain('winget');
  });

  it('reports what Start-Process said when the program will not start', async () => {
    const fakeSpawn = (() => {
      const child = new FakeBridgeChild();
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('This command cannot be run: nope.exe'));
        child.emit('close', 1);
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    await expect(
      withPlatform('win32', () =>
        createDetachedLauncher(fakeSpawn).launch('nope.exe', [], {
          // Nothing of that name anywhere, which is how it reads as unknown --
          // and unknown still goes through the bridge, so Start-Process is the
          // thing that gets to say it could not be started.
          env: { PATH: createTempDir() },
          visible: true
        })
      )
    ).rejects.toThrow(/cannot be run/);
  });

  it('falls back to a plain spawn when there is no PowerShell to bridge through', async () => {
    // A program that makes its own window still worked on the old path, so a
    // machine without PowerShell should keep that rather than lose the launch.
    const executables: string[] = [];
    const fakeSpawn = ((executable: string) => {
      executables.push(executable);

      if (executable === 'powershell.exe') {
        const child = new FakeBridgeChild();
        queueMicrotask(() => child.emit('error', new Error('ENOENT')));
        return child;
      }

      const child = {
        pid: 11,
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

    const result = await withPlatform('win32', () =>
      createDetachedLauncher(fakeSpawn).launch('wt.exe', ['-d', '.'], {
        // Nothing called wt.exe on this PATH, so it reads as unknown and takes
        // the bridge -- whether or not the runner has Windows Terminal.
        env: { PATH: createTempDir() },
        visible: true
      })
    );

    expect(executables).toEqual(['powershell.exe', 'wt.exe']);
    expect(result.pid).toBe(11);
  });

  it('skips the bridge for a program that makes its own window', async () => {
    // The cost the bridge adds is about 0.8s of PowerShell startup, and a
    // windowed program never had the bug it exists for. git-bash.exe, WinMerge
    // and every other GUI tool should therefore still be spawned directly --
    // which is also what keeps `onExit` tied to the tool closing rather than to
    // a PowerShell that may not be allowed to wait for it.
    const executables: string[] = [];
    const fakeSpawn = ((executable: string) => {
      executables.push(executable);
      const child = {
        pid: 77,
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

    const bin = pathWith('git-bash.exe', 2);
    const result = await withPlatform('win32', () =>
      createDetachedLauncher(fakeSpawn).launch(path.join(bin, 'git-bash.exe'), ['--cd=C:\\repo'], {
        env: { PATH: bin },
        visible: true
      })
    );

    // No PowerShell at all: one spawn, and it is the program itself.
    expect(executables).toEqual([path.join(bin, 'git-bash.exe')]);
    expect(result.pid).toBe(77);
  });

  it('still bridges a console program that only differs by its header', async () => {
    // The same launch, same name, same everything except the subsystem byte.
    // That byte is the whole decision, so it is worth stating on its own.
    const executables: string[] = [];
    const fakeSpawn = ((executable: string) => {
      executables.push(executable);
      const child = new FakeBridgeChild();
      queueMicrotask(() => child.stdout.emit('data', Buffer.from('MG_PID=4242\n')));
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const bin = pathWith('git-bash.exe', 3);
    const result = await withPlatform('win32', () =>
      createDetachedLauncher(fakeSpawn).launch(path.join(bin, 'git-bash.exe'), ['--cd=C:\\repo'], {
        env: { PATH: bin },
        visible: true
      })
    );

    expect(executables).toEqual(['powershell.exe']);
    expect(result.pid).toBe(4242);
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

  it('resolves the model preset itself, from an id and nothing else', async () => {
    const worktree = createTempDir('multi-git-agent-wt-');
    const record: { executable?: string; args?: readonly string[] } = {};
    const { service, definitions } = await serviceWithHome([
      definition({ catalogueId: 'claude' })
    ]);

    const result = await service.launchAgent(
      {
        repoPath: worktree,
        worktreePath: worktree,
        agentId: 'claude',
        modelId: 'sonnet'
      },
      {
        runner: new FakeRunner().otherwise({ stdout: '/usr/bin/claude' }),
        launcher: launcherRecording(record)
      }
    );

    expect(result.launched).toBe(true);
    expect(record.args).toEqual(['--model', 'sonnet']);
    // Worth recording: it changed what ran.
    expect(definitions.listLaunches()[0]).toMatchObject({
      ok: true,
      modelId: 'sonnet',
      modelLabel: 'Claude Sonnet'
    });
  });

  it('ignores a model id the definition\'s entry does not have', async () => {
    const worktree = createTempDir('multi-git-agent-wt-');
    const record: { args?: readonly string[] } = {};
    const { service } = await serviceWithHome([definition({ catalogueId: 'claude' })]);

    const result = await service.launchAgent(
      { repoPath: worktree, worktreePath: worktree, agentId: 'claude', modelId: '--evil' },
      {
        runner: new FakeRunner().otherwise({ stdout: '/usr/bin/claude' }),
        launcher: launcherRecording(record)
      }
    );

    // The tool's own default is always a valid thing to launch, and nothing a
    // page sends becomes an argument.
    expect(result.launched).toBe(true);
    expect(record.args).toEqual([]);
  });

  it('says no terminal is installed rather than naming a program nobody has', async () => {
    const worktree = createTempDir('multi-git-agent-wt-');
    const { service, definitions } = await serviceWithHome([
      definition({ terminal: 'system-terminal' })
    ]);

    const result = await withPlatform('linux', () =>
      service.launchAgent(
        { repoPath: worktree, worktreePath: worktree, agentId: 'claude' },
        {
          runner: new FakeRunner()
            .otherwise({ exitCode: 1, stdout: '' })
            .on((_executable, args) => args[0] === 'claude', { stdout: '/usr/bin/claude' }),
          launcher: launcherRecording({})
        }
      )
    );

    expect(result.launched).toBe(false);
    expect(result.error).toMatch(/No terminal window could be opened/);
    expect(result.error).toMatch(/gnome-terminal/);
    // Recorded like any other failure, against the command it would have run.
    expect(definitions.listLaunches()[0]?.ok).toBe(false);
    expect(definitions.listLaunches()[0]?.commandPreview).toContain('claude');
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
