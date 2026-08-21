// Finding and running a command on Windows, where `gh` is not a file.
//
// The case worth protecting is the batch shim: `spawn('gh', args)` cannot run
// a `gh.cmd` by bare name, and the obvious fix — `shell: true` — would hand
// every argument to cmd.exe to re-parse. So the last test here runs a real
// shim and asserts the arguments arrive exactly as they were sent, `&` and
// spaces included.
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface SpawnSpec {
  file: string;
  args: string[];
  options: { windowsVerbatimArguments?: boolean };
}

interface CommandPathApi {
  findExecutable(command: string, options?: { pathValue?: string }): string | null;
  escapeArgument(argument: string, doubleEscape?: boolean): string;
  spawnSpec(command: string, args?: string[]): SpawnSpec;
}

const require = createRequire(import.meta.url);
const commandPath = require('../scripts/command-path.js') as CommandPathApi;

const isWindows = process.platform === 'win32';
const previousPath = process.env['PATH'];
let scratch = '';

afterEach(() => {
  process.env['PATH'] = previousPath;
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
    scratch = '';
  }
});

/** A directory holding the files named, returned as a PATH entry. */
function directoryWith(files: Record<string, string>): string {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-cmdpath-'));

  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(scratch, name), contents, 'utf8');
  }

  return scratch;
}

describe('findExecutable', () => {
  it('finds a file named exactly, on any platform', () => {
    const directory = directoryWith({ plaintool: '' });

    expect(commandPath.findExecutable('plaintool', { pathValue: directory })).toBe(
      path.join(directory, 'plaintool')
    );
  });

  it('answers null for something that is not on the path given', () => {
    expect(
      commandPath.findExecutable('definitely-not-installed', { pathValue: directoryWith({}) })
    ).toBeNull();
  });

  it('takes a path as given rather than searching for it', () => {
    const directory = directoryWith({ tool: '' });
    const full = path.join(directory, 'tool');

    expect(commandPath.findExecutable(full, { pathValue: '' })).toBe(full);
    expect(commandPath.findExecutable(path.join(directory, 'absent'), { pathValue: '' })).toBeNull();
  });

  it.runIf(isWindows)('tries the PATHEXT extensions, which is how gh.exe is found', () => {
    const directory = directoryWith({ 'gh.exe': '' });

    expect(commandPath.findExecutable('gh', { pathValue: directory })).toBe(
      path.join(directory, 'gh.exe')
    );
  });

  it.runIf(isWindows)('finds a .cmd shim, which is how scoop and npm install a CLI', () => {
    const directory = directoryWith({ 'gh.cmd': '' });

    expect(commandPath.findExecutable('gh', { pathValue: directory })).toBe(
      path.join(directory, 'gh.cmd')
    );
  });
});

describe('spawnSpec', () => {
  it('hands back the resolved file and the arguments untouched', () => {
    const directory = directoryWith({ plaintool: '' });
    process.env['PATH'] = directory;

    const spec = commandPath.spawnSpec('plaintool', ['--flag', 'value']);

    expect(spec.file).toBe(path.join(directory, 'plaintool'));
    expect(spec.args).toEqual(['--flag', 'value']);
    expect(spec.options.windowsVerbatimArguments).toBeUndefined();
  });

  it('keeps the original name when nothing is found, so the error names it', () => {
    process.env['PATH'] = directoryWith({});

    const spec = commandPath.spawnSpec('gh', ['release', 'view']);

    // A spawn of 'gh' fails with an ENOENT saying 'gh', which is the useful
    // message. Substituting something else here would hide what is missing.
    expect(spec.file).toBe('gh');
    expect(spec.args).toEqual(['release', 'view']);
  });

  it.runIf(isWindows)('runs a batch shim through cmd, never through a shell', () => {
    const directory = directoryWith({ 'gh.cmd': '@echo off\n' });
    process.env['PATH'] = directory;

    const spec = commandPath.spawnSpec('gh', ['release', 'view']);

    expect(path.basename(spec.file).toLowerCase()).toBe('cmd.exe');
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(spec.options.windowsVerbatimArguments).toBe(true);
  });
});

describe('escapeArgument', () => {
  it('wraps the value so the receiving program sees one argument', () => {
    // The quotes and the space are escaped for cmd, which is the point: cmd
    // passes them through and the program's own parser rebuilds "a b".
    expect(commandPath.escapeArgument('a b')).toBe('^"a^ b^"');
  });

  it('protects the characters cmd would otherwise treat as syntax', () => {
    for (const meta of ['&', '|', '<', '>', '^', '(', ')']) {
      expect(commandPath.escapeArgument(`x${meta}y`)).toContain(`^${meta}`);
    }
  });
});

describe.runIf(isWindows)('running a real batch shim', () => {
  it('delivers every argument exactly as it was sent', () => {
    // Shaped like the shims npm and scoop write: a .cmd that forwards to node.
    const directory = directoryWith({
      'mytool.js': 'console.log(JSON.stringify(process.argv.slice(2)));\n',
      'mytool.cmd': '@echo off\r\nnode "%~dp0mytool.js" %*\r\n'
    });
    process.env['PATH'] = `${directory}${path.delimiter}${previousPath ?? ''}`;

    // The arguments that break a naive `shell: true`: a space, an ampersand
    // that would otherwise start a second command, and a label with brackets
    // like the ones the release upload attaches to its assets.
    const sent = ['plain', 'two words', 'a&b', 'Windows installer (recommended)'];
    const spec = commandPath.spawnSpec('mytool', sent);

    // `windowsVerbatimArguments` is missing from ExecFileSyncOptions in the
    // Node types but is honoured at runtime, and it is the whole point here:
    // without it Node would re-quote the line the escaping just built.
    const stdout = execFileSync(spec.file, spec.args, {
      encoding: 'utf8',
      windowsVerbatimArguments: spec.options.windowsVerbatimArguments ?? false
    } as Parameters<typeof execFileSync>[2]);

    expect(JSON.parse(String(stdout).trim())).toEqual(sent);
  });
});
