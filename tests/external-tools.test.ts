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
import fs from 'node:fs';
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
import {
  cleanupRepos,
  createEmptyRepo,
  git,
  writeFile
} from './helpers/temp-repo';
import type { DetachedLauncher } from '../src/server/process/runner';
import type { ExternalToolDefinition } from '../src/shared/config-types';

const app: Express = createApp();

/** A launcher that records instead of spawning. */
function recordingLauncher(): DetachedLauncher & {
  calls: {
    executable: string;
    args: readonly string[];
    cwd?: string;
    onExit?: () => void;
  }[];
} {
  const calls: {
    executable: string;
    args: readonly string[];
    cwd?: string;
    onExit?: () => void;
  }[] = [];

  return {
    calls,
    launch(executable, args, options = {}) {
      calls.push({
        executable,
        args,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.onExit ? { onExit: options.onExit } : {})
      });
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
  cleanupRepos();
});

function expectMergeConflict(repo: string, branch: string): void {
  try {
    git(repo, 'merge', branch);
  } catch {
    // A conflicted merge exits non-zero by design.
  }

  if (git(repo, 'ls-files', '--unmerged').trim() === '') {
    throw new Error('The test fixture did not produce an unmerged index.');
  }
}

function binaryConflictRepo(): {
  repo: string;
  base: Buffer;
  local: Buffer;
  remote: Buffer;
} {
  const repo = createEmptyRepo();
  const base = Buffer.from([0x00, 0xff, 0x01, 0x02]);
  const local = Buffer.from([0x00, 0xfe, 0x10, 0x11]);
  const remote = Buffer.from([0x00, 0xfd, 0x20, 0x21]);
  const file = path.join(repo, 'asset.bin');

  fs.writeFileSync(file, base);
  git(repo, 'add', 'asset.bin');
  git(repo, 'commit', '-m', 'base');

  git(repo, 'checkout', '-b', 'side');
  fs.writeFileSync(file, remote);
  git(repo, 'commit', '-am', 'remote');

  git(repo, 'checkout', 'main');
  fs.writeFileSync(file, local);
  git(repo, 'commit', '-am', 'local');
  expectMergeConflict(repo, 'side');

  return { repo, base, local, remote };
}

function mergePlaceholders(filePath: string): {
  base: string;
  local: string;
  remote: string;
  merged: string;
  path: string;
} {
  return {
    base: `${filePath}.BASE`,
    local: `${filePath}.LOCAL`,
    remote: `${filePath}.REMOTE`,
    merged: filePath,
    path: filePath
  };
}

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

  it('materializes the base, local and remote index stages as exact bytes', async () => {
    const { repo, base, local, remote } = binaryConflictRepo();
    saveToolDefinition(
      tool({
        kind: 'merge',
        label: 'Test merge tool',
        executable: 'mergetool',
        args: ['{base}', '{local}', '{remote}', '-o', '{merged}']
      })
    );
    const launcher = recordingLauncher();
    const placeholders = mergePlaceholders('asset.bin');

    await launchTool({ repoPath: repo, kind: 'merge', placeholders }, launcher);

    expect(fs.readFileSync(path.join(repo, placeholders.base))).toEqual(base);
    expect(fs.readFileSync(path.join(repo, placeholders.local))).toEqual(local);
    expect(fs.readFileSync(path.join(repo, placeholders.remote))).toEqual(remote);
    expect(launcher.calls[0]?.args).toEqual([
      path.join(repo, placeholders.base),
      path.join(repo, placeholders.local),
      path.join(repo, placeholders.remote),
      '-o',
      path.join(repo, placeholders.merged)
    ]);

    // Detected merge tools wait in the launched process. Once that process
    // exits, their temporary inputs are removed but the merge result remains.
    launcher.calls[0]?.onExit?.();
    expect(fs.existsSync(path.join(repo, placeholders.base))).toBe(false);
    expect(fs.existsSync(path.join(repo, placeholders.local))).toBe(false);
    expect(fs.existsSync(path.join(repo, placeholders.remote))).toBe(false);
    expect(fs.existsSync(path.join(repo, placeholders.merged))).toBe(true);
  });

  it('uses an empty base for an add/add conflict with no stage 1', async () => {
    const repo = createEmptyRepo();
    writeFile(repo, 'seed.txt', 'seed\n');
    git(repo, 'add', 'seed.txt');
    git(repo, 'commit', '-m', 'seed');

    git(repo, 'checkout', '-b', 'side');
    writeFile(repo, 'added.txt', 'remote\n');
    git(repo, 'add', 'added.txt');
    git(repo, 'commit', '-m', 'remote add');

    git(repo, 'checkout', 'main');
    writeFile(repo, 'added.txt', 'local\n');
    git(repo, 'add', 'added.txt');
    git(repo, 'commit', '-m', 'local add');
    expectMergeConflict(repo, 'side');

    saveToolDefinition(
      tool({
        kind: 'merge',
        executable: 'mergetool',
        args: ['{base}', '{local}', '{remote}', '{merged}']
      })
    );
    const launcher = recordingLauncher();
    const placeholders = mergePlaceholders('added.txt');

    await launchTool({ repoPath: repo, kind: 'merge', placeholders }, launcher);

    expect(fs.readFileSync(path.join(repo, placeholders.base))).toEqual(Buffer.alloc(0));
    expect(fs.readFileSync(path.join(repo, placeholders.local), 'utf8')).toBe('local\n');
    expect(fs.readFileSync(path.join(repo, placeholders.remote), 'utf8')).toBe('remote\n');
    launcher.calls[0]?.onExit?.();
  });

  it('never overwrites a sidecar and rolls back inputs it already created', async () => {
    const { repo } = binaryConflictRepo();
    const placeholders = mergePlaceholders('asset.bin');
    writeFile(repo, placeholders.local, 'belongs to the repository owner');
    saveToolDefinition(
      tool({
        kind: 'merge',
        executable: 'mergetool',
        args: ['{base}', '{local}', '{remote}', '{merged}']
      })
    );
    const launcher = recordingLauncher();

    await expect(
      launchTool({ repoPath: repo, kind: 'merge', placeholders }, launcher)
    ).rejects.toThrow(/already exists.*left untouched/i);

    expect(fs.readFileSync(path.join(repo, placeholders.local), 'utf8')).toBe(
      'belongs to the repository owner'
    );
    expect(fs.existsSync(path.join(repo, placeholders.base))).toBe(false);
    expect(fs.existsSync(path.join(repo, placeholders.remote))).toBe(false);
    expect(launcher.calls).toEqual([]);
  });

  it('removes every sidecar when the merge tool cannot be started', async () => {
    const { repo } = binaryConflictRepo();
    const placeholders = mergePlaceholders('asset.bin');
    saveToolDefinition(
      tool({
        kind: 'merge',
        executable: 'missing-mergetool',
        args: ['{base}', '{local}', '{remote}', '{merged}']
      })
    );
    const launcher: DetachedLauncher = {
      launch: () => Promise.reject(new Error('ENOENT'))
    };

    await expect(
      launchTool({ repoPath: repo, kind: 'merge', placeholders }, launcher)
    ).rejects.toThrow(/ENOENT/);

    expect(fs.existsSync(path.join(repo, placeholders.base))).toBe(false);
    expect(fs.existsSync(path.join(repo, placeholders.local))).toBe(false);
    expect(fs.existsSync(path.join(repo, placeholders.remote))).toBe(false);
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
  /*
   * `resolveExecutable` asks `where` on Windows and `which` everywhere else, so
   * a rule hard-coded to one of them matches nothing on the other platform and
   * detection silently finds zero tools. The finder is read from the platform
   * for the same reason the product does.
   */
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const resolvedPath = process.platform === 'win32' ? 'C:\\Program Files\\code.exe' : '/usr/bin/code';

  it('offers a definition for each tool that is on PATH', async () => {
    const runner = new FakeRunner()
      .otherwise({ exitCode: 1 })
      .on(command(finder, 'code'), { stdout: `${resolvedPath}\n` });

    const detected = await detectTools(runner);

    expect(detected.length).toBeGreaterThan(0);
    expect(detected.every((entry) => entry.executable === 'code')).toBe(true);
    expect(detected[0]?.resolvedPath).toBe(resolvedPath);
  });

  it('looks each executable up once even when several definitions share it', async () => {
    const runner = new FakeRunner()
      .otherwise({ exitCode: 1 })
      .on(command(finder, 'code'), { stdout: `${resolvedPath}\n` });

    const detected = await detectTools(runner);

    // `code` seeds a diff, a merge and an editor definition; three PATH lookups
    // for one program would be three processes for no reason. Asserted against
    // the definitions it produced, so the count means something.
    expect(detected.length).toBeGreaterThan(1);
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
