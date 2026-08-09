// External tools and the Explorer entries, against a scripted runner.
//
// Two things are being protected here, and neither would fail loudly if it
// broke.
//
// The first is that expansion happens *within* an argument and never across
// one. `--diff={local}` is one argument with a path substituted into it; a path
// containing a space must not become two arguments. That is the whole reason
// the template is an array rather than a command line, and it is why no code in
// this feature quotes anything.
//
// The second is that the Explorer integration touches exactly two registry keys
// under HKCU and nothing else. A test that only checked "install succeeded"
// would pass just as happily if it had written to HKLM.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { expandTemplate, launchTool } from '../src/server/tools/launch';
import {
  ToolDefinitionError,
  assertUsableTool,
  detectTools,
  saveToolDefinition
} from '../src/server/tools/definitions';
import { CONTEXT_MENU_KEYS, install, readStatus, remove } from '../src/main/shell-integration';
import { readConfig, writeConfig } from '../src/server/config/store';
import { FakeRunner, command } from './helpers/fake-runner';
import type { DetachedLauncher } from '../src/server/process/runner';
import type { ExternalToolDefinition } from '../src/shared/config-types';

const app: Express = createApp();

/** A launcher that records instead of spawning. */
function recordingLauncher(): DetachedLauncher & {
  calls: { executable: string; args: readonly string[]; cwd?: string }[];
} {
  const calls: { executable: string; args: readonly string[]; cwd?: string }[] = [];

  return {
    calls,
    launch(executable, args, options = {}) {
      calls.push({ executable, args, ...(options.cwd ? { cwd: options.cwd } : {}) });
      return Promise.resolve({ pid: 1234 });
    }
  };
}

function tool(overrides: Partial<ExternalToolDefinition> = {}): ExternalToolDefinition {
  return {
    id: 't1',
    kind: 'diff',
    label: 'Test diff tool',
    executable: 'difftool',
    args: ['--diff', '{local}', '{remote}'],
    enabled: true,
    ...overrides
  };
}

let savedConfig: ReturnType<typeof readConfig>;

beforeEach(() => {
  savedConfig = readConfig();
});

afterEach(() => {
  // These tests write real definitions into the real configuration, so it is
  // put back exactly as it was.
  writeConfig(savedConfig);
});

describe('expanding an argument template', () => {
  it('substitutes within an argument, not across it', () => {
    const expanded = expandTemplate(['--diff={local}', '{remote}'], {
      local: 'C:\\Program Files\\a.txt',
      remote: 'C:\\Program Files\\b.txt'
    });

    // Two arguments in, two arguments out — the spaces in the paths change
    // nothing, because nothing here builds a command line.
    expect(expanded).toEqual([
      '--diff=C:\\Program Files\\a.txt',
      'C:\\Program Files\\b.txt'
    ]);
  });

  it('fills several placeholders in one argument', () => {
    expect(expandTemplate(['{local}:{remote}'], { local: 'a', remote: 'b' })).toEqual(['a:b']);
  });

  it('refuses a placeholder with no value rather than emptying it', () => {
    // An empty argument in the middle of a diff tool's command line makes it
    // open something unintended, which is worse than refusing to start.
    expect(() => expandTemplate(['{base}'], { local: 'a' })).toThrow(ToolDefinitionError);
  });

  it('leaves an argument with no placeholders alone', () => {
    expect(expandTemplate(['--wait', '-u'], {})).toEqual(['--wait', '-u']);
  });
});

describe('validating a definition', () => {
  it('accepts a well-formed one', () => {
    expect(() => assertUsableTool(tool())).not.toThrow();
  });

  it('refuses a placeholder this build cannot fill in', () => {
    expect(() => assertUsableTool(tool({ args: ['{theirs}'] }))).toThrow(/\{theirs\}/);
  });

  it('refuses an executable with a newline in it', () => {
    // It would have to become part of a program name, which nothing can be.
    expect(() => assertUsableTool(tool({ executable: 'a\nb' }))).toThrow(ToolDefinitionError);
  });

  it('refuses an empty executable', () => {
    expect(() => assertUsableTool(tool({ executable: '   ' }))).toThrow(ToolDefinitionError);
  });

  it('refuses an unknown kind', () => {
    expect(() =>
      assertUsableTool(tool({ kind: 'debugger' as ExternalToolDefinition['kind'] }))
    ).toThrow(ToolDefinitionError);
  });

  it('refuses one at the point it is saved, so it never reaches the file', () => {
    expect(() =>
      saveToolDefinition({ kind: 'diff', executable: 'x', args: ['{nonsense}'] })
    ).toThrow(ToolDefinitionError);

    expect((readConfig().externalTools ?? []).some((entry) => entry.executable === 'x')).toBe(false);
  });
});

describe('launching a tool', () => {
  const repoPath = process.cwd();

  it('spawns the executable with the expanded vector, in the repository', async () => {
    saveToolDefinition(tool({ args: ['--diff', '{local}', '{remote}'] }));
    const launcher = recordingLauncher();

    await launchTool(
      {
        repoPath,
        kind: 'diff',
        placeholders: { local: 'package.json', remote: 'tsconfig.json' }
      },
      launcher
    );

    const call = launcher.calls[0];
    expect(call?.executable).toBe('difftool');
    expect(call?.args[0]).toBe('--diff');
    // Resolved to absolute paths inside the repository.
    expect(call?.args[1]).toBe(path.resolve(repoPath, 'package.json'));
    expect(call?.cwd).toBe(path.resolve(repoPath));
  });

  it('refuses a file outside the repository', async () => {
    saveToolDefinition(tool());
    const launcher = recordingLauncher();

    await expect(
      launchTool(
        {
          repoPath,
          kind: 'diff',
          placeholders: { local: '../../../etc/passwd', remote: 'package.json' }
        },
        launcher
      )
    ).rejects.toThrow(/outside this repository/i);

    // Refused before anything was started.
    expect(launcher.calls).toEqual([]);
  });

  it('says which kind is missing rather than starting something else', async () => {
    const launcher = recordingLauncher();

    await expect(
      launchTool({ repoPath, kind: 'merge', placeholders: {} }, launcher)
    ).rejects.toThrow(/no merge tool is configured/i);
  });

  it('re-checks the definition at launch, not only when it was saved', async () => {
    // The configuration is ordinary JSON in the user's home directory, which a
    // sync client or a text editor can change between the two moments.
    const config = readConfig();
    writeConfig({
      ...config,
      externalTools: [tool({ args: ['{theirs}'] })]
    });

    const launcher = recordingLauncher();
    await expect(
      launchTool({ repoPath, kind: 'diff', placeholders: { local: 'a' } }, launcher)
    ).rejects.toThrow(ToolDefinitionError);
    expect(launcher.calls).toEqual([]);
  });
});

describe('detection', () => {
  it('offers a definition for each tool that is on PATH', async () => {
    const runner = new FakeRunner()
      .otherwise({ exitCode: 1 })
      .on(command('where', 'code'), { stdout: 'C:\\Program Files\\code.exe\n' });

    const detected = await detectTools(runner);

    expect(detected.length).toBeGreaterThan(0);
    expect(detected.every((entry) => entry.executable === 'code')).toBe(true);
    expect(detected[0]?.resolvedPath).toContain('code.exe');
  });

  it('looks each executable up once even when several definitions share it', async () => {
    const runner = new FakeRunner()
      .otherwise({ exitCode: 1 })
      .on(command('where', 'code'), { stdout: 'C:\\code.exe\n' });

    await detectTools(runner);

    // `code` seeds a diff, a merge and an editor definition; three PATH lookups
    // for one program would be three processes for no reason.
    expect(runner.calls.filter((call) => call.args.includes('code'))).toHaveLength(1);
  });

  it('finds nothing when nothing is installed, without failing', async () => {
    const runner = new FakeRunner().otherwise({ exitCode: 1 });

    expect(await detectTools(runner)).toEqual([]);
  });
});

describe('the Explorer entries', () => {
  const windowsOnly = process.platform === 'win32' ? it : it.skip;

  it('names exactly two keys, both under the current user', () => {
    // No HKLM, so no administrator rights and nothing changed for other
    // accounts on the machine.
    for (const key of Object.values(CONTEXT_MENU_KEYS)) {
      expect(key.startsWith('HKCU\\')).toBe(true);
      expect(key).toContain('MultiGit');
    }
    expect(Object.values(CONTEXT_MENU_KEYS)).toHaveLength(2);
  });

  windowsOnly('reports them as not installed when the key is absent', async () => {
    const runner = new FakeRunner().otherwise({ exitCode: 1 });

    const status = await readStatus(runner);

    expect(status.supported).toBe(true);
    expect(status.installed).toBe(false);
    // Listed before anything is written, so the user can see what will change.
    expect(status.keys).toHaveLength(2);
  });

  windowsOnly('writes only the two keys, and only under HKCU', async () => {
    const runner = new FakeRunner().otherwise({ exitCode: 0 });

    await install('C:\\Apps\\multi-git.exe', runner);

    const written = runner.calls.filter((call) => call.args[0] === 'add').map((call) => call.args[1]);

    expect(written.every((key) => String(key).startsWith('HKCU\\Software\\Classes\\Directory'))).toBe(
      true
    );
    expect(runner.everythingSeen()).not.toContain('HKLM');
  });

  windowsOnly('passes the folder as %V, which is right for both menu locations', async () => {
    const runner = new FakeRunner().otherwise({ exitCode: 0 });

    await install('C:\\Apps\\multi-git.exe', runner);

    const commandValue = runner.calls
      .filter((call) => String(call.args[1]).endsWith('\\command'))
      .map((call) => call.args[call.args.indexOf('/d') + 1]);

    // %1 would be wrong for a right-click on a folder's background.
    expect(commandValue.every((value) => String(value).includes('%V'))).toBe(true);
  });

  windowsOnly('deletes exactly what it wrote', async () => {
    const runner = new FakeRunner().otherwise({ exitCode: 0 });

    await remove(runner);

    const deleted = runner.calls
      .filter((call) => call.args[0] === 'delete')
      .map((call) => call.args[1]);

    expect(deleted).toEqual([CONTEXT_MENU_KEYS.directory, CONTEXT_MENU_KEYS.background]);
  });

  windowsOnly('treats an already-absent key as removed rather than as an error', async () => {
    const runner = new FakeRunner().otherwise({ exitCode: 1 });

    const status = await remove(runner);

    expect(status.installed).toBe(false);
  });

  windowsOnly('refuses to write when the application path is unknown', async () => {
    const runner = new FakeRunner().otherwise({ exitCode: 0 });

    await expect(install('   ', runner)).rejects.toThrow(/could not be determined/i);
    expect(runner.calls).toEqual([]);
  });
});

describe('the HTTP surface', () => {
  const post = (url: string) => request(app).post(url).set('Host', '127.0.0.1');

  /*
   * An unrouted path under /api answers 400, not 404: `syncRouter` is mounted
   * with `use(requireRepoPath)` and no path prefix, so anything that falls
   * through reaches it and is refused for having no repository header. What
   * matters for these two is only that nothing handles them, so the assertion
   * is "not a success" rather than a particular failure code.
   */
  it('offers no route that launches a tool', async () => {
    // Starting a program lives behind the Electron IPC bridge, exactly as agent
    // launch and bisect runs do.
    const response = await post('/api/tools/launch').send({ kind: 'diff' });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('offers no route that writes to the registry', async () => {
    const response = await post('/api/tools/shell-integration').send({});

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses a definition with an unknown kind', async () => {
    await request(app)
      .post('/api/tools')
      .set('Host', '127.0.0.1')
      .send({ kind: 'debugger', executable: 'x', args: [] })
      .expect(400);
  });

  it('refuses a definition with an unknown placeholder', async () => {
    const response = await request(app)
      .post('/api/tools')
      .set('Host', '127.0.0.1')
      .send({ kind: 'diff', executable: 'x', args: ['{theirs}'] })
      .expect(400);

    expect(response.body.error).toMatch(/\{theirs\}/);
  });
});
