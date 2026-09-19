// Installing, upgrading and removing the terminal edition.
//
// Every effect outside the installation folder goes through the environment
// object, so these run against a fake home, a fake PATH and a fake Windows user
// PATH on every platform, and never touch the machine running them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { activatePayload, payloadManifest, removeTerminal, terminalStatus, rollbackTerminal } from '../src/server/terminal/install';
import type { InstallEnvironment } from '../src/server/terminal/install';
import { holdPayloadSession } from '../src/server/terminal/sessions';
import { cleanupRepos, createTempDir } from './helpers/temp-repo';

let home: string;
let packages: string;

function payload(version: string, platform: NodeJS.Platform = 'linux', arch = 'x64'): string {
  const dir = path.join(packages, `${platform}-${arch}-${version}`);
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'runtime', platform === 'win32' ? 'node.exe' : 'node'), 'runtime');
  fs.writeFileSync(path.join(dir, 'scripts', 'multi-git.cjs'), `// ${version}`);
  fs.writeFileSync(
    path.join(dir, 'terminal-manifest.json'),
    JSON.stringify({ schemaVersion: 1, product: 'multi-git-terminal', version, platform, arch })
  );
  return dir;
}

interface FakeMachine extends InstallEnvironment {
  userPath: { value: string; type: string };
  pathDirs: string[];
}

function machine(platform: NodeJS.Platform, overrides: Partial<InstallEnvironment> = {}): FakeMachine {
  const fake: FakeMachine = {
    platform,
    arch: 'x64',
    home,
    root: path.join(home, 'terminal-home'),
    shell: '/bin/bash',
    userPath: { value: 'C:\\Tools;%USERPROFILE%\\bin', type: 'REG_EXPAND_SZ' },
    pathDirs: [path.join(home, 'usr-bin')],
    searchPath: () => [
      ...fake.pathDirs,
      // A new terminal on Windows sees the user PATH as stored.
      ...(platform === 'win32' ? fake.userPath.value.split(';') : [])
    ],
    readUserPath: () => ({ ...fake.userPath }),
    writeUserPath: (value, type) => {
      fake.userPath = { value, type };
    },
    // The staged copy "runs" by reporting the version its script names.
    runVersion: (staged) => fs.readFileSync(path.join(staged, 'scripts', 'multi-git.cjs'), 'utf8').replace('// ', ''),
    ...overrides
  };
  return fake;
}

const read = (file: string): string => fs.readFileSync(file, 'utf8');

beforeEach(() => {
  home = createTempDir('multi-git-terminal-home-');
  packages = createTempDir('multi-git-terminal-packages-');
  fs.mkdirSync(path.join(home, 'usr-bin'), { recursive: true });
});

afterEach(() => {
  cleanupRepos();
});

describe('enabling on macOS and Linux', () => {
  it('installs the version, a launcher and a PATH line for the shell in use only', () => {
    const env = machine('linux');
    fs.writeFileSync(path.join(home, '.bashrc'), 'alias ll="ls -l"\n');

    const status = activatePayload(payload('1.0.0'), env);

    expect(read(path.join(env.root, 'current.txt')).trim()).toBe('1.0.0');
    expect(fs.existsSync(path.join(env.root, 'versions', '1.0.0', 'runtime', 'node'))).toBe(true);
    const launcher = path.join(home, '.local', 'bin', 'multi-git');
    expect(read(launcher)).toContain(path.join(env.root, 'multi-git'));

    // Added to the user's own file, keeping what was there.
    const bashrc = read(path.join(home, '.bashrc'));
    expect(bashrc.startsWith('alias ll="ls -l"\n')).toBe(true);
    expect(bashrc).toContain('# >>> multi-git terminal >>>');
    // A shell the user does not have gets nothing, not a new file.
    expect(fs.existsSync(path.join(home, '.zshrc'))).toBe(false);

    // Until a new terminal reads that line, nothing resolves the command.
    expect(status.state).toBe('reopen-terminal');
    expect(status.installedVersion).toBe('1.0.0');
  });

  it('is ready once a terminal would find the launcher, and touches no startup file when ~/.local/bin is already on PATH', () => {
    const env = machine('linux');
    env.pathDirs.unshift(path.join(home, '.local', 'bin'));

    const status = activatePayload(payload('1.0.0'), env);

    expect(status.state).toBe('ready');
    expect(fs.existsSync(path.join(home, '.bashrc'))).toBe(false);
  });

  it('can be repeated without adding anything twice', () => {
    const env = machine('linux');
    fs.writeFileSync(path.join(home, '.bashrc'), '');
    activatePayload(payload('1.0.0'), env);
    activatePayload(payload('1.0.0'), env);

    expect(read(path.join(home, '.bashrc')).match(/multi-git terminal >>>/g)).toHaveLength(1);
  });

  it('names the planned changes before anything is changed', () => {
    const env = machine('linux');
    fs.writeFileSync(path.join(home, '.zshrc'), '');
    const status = terminalStatus(env);

    expect(status.plannedChanges).toEqual([
      `Copy the terminal edition to ${env.root}`,
      `Write the multi-git command to ${path.join(home, '.local', 'bin', 'multi-git')}`,
      `Add a marked PATH line for ${path.join(home, '.local', 'bin')} to ${path.join(home, '.zshrc')}`,
      `Add a marked PATH line for ${path.join(home, '.local', 'bin')} to ${path.join(home, '.bashrc')}`
    ]);
    expect(fs.existsSync(env.root)).toBe(false);
  });

  it('refuses to overwrite a multi-git command it did not write', () => {
    const env = machine('linux');
    const launcher = path.join(home, '.local', 'bin', 'multi-git');
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, '#!/bin/sh\necho mine\n');

    expect(() => activatePayload(payload('1.0.0'), env)).toThrow('is not Multi-Git');
    expect(read(launcher)).toBe('#!/bin/sh\necho mine\n');
  });

  it('refuses a folder with files it did not put there', () => {
    const env = machine('linux');
    fs.mkdirSync(env.root, { recursive: true });
    fs.writeFileSync(path.join(env.root, 'notes.txt'), 'mine');

    expect(() => activatePayload(payload('1.0.0'), env)).toThrow('did not put there');
    expect(fs.readdirSync(env.root)).toEqual(['notes.txt']);
  });

  it('reports a command that comes first on PATH instead of replacing it', () => {
    const env = machine('linux');
    env.pathDirs.unshift(path.join(home, '.local', 'bin'));
    const other = path.join(home, 'usr-bin', 'multi-git');
    fs.writeFileSync(other, 'someone else');
    env.pathDirs.unshift(path.join(home, 'usr-bin'));

    const status = activatePayload(payload('1.0.0'), env);

    expect(status.state).toBe('shadowed');
    expect(status.resolvedCommand).toBe(other);
    expect(read(other)).toBe('someone else');
  });
});

describe('upgrading', () => {
  it('rolls back atomically to the retained version after a startup check', () => {
    const env = machine('linux');
    activatePayload(payload('1.0.0'), env);
    activatePayload(payload('1.1.0'), env);
    rollbackTerminal(env);
    expect(read(path.join(env.root, 'current.txt')).trim()).toBe('1.0.0');
    expect(read(path.join(env.root, 'previous.txt')).trim()).toBe('1.1.0');
  });
  it('keeps a payload while a session uses it, including on Unix', () => {
    const env = machine('linux');
    activatePayload(payload('1.0.0'), env);
    const old = path.join(env.root, 'versions', '1.0.0');
    const release = holdPayloadSession(old);
    try {
      activatePayload(payload('1.1.0'), env);
      activatePayload(payload('1.2.0'), env);
      expect(fs.existsSync(old)).toBe(true);
    } finally { release(); }
    activatePayload(payload('1.3.0'), env);
    expect(fs.existsSync(old)).toBe(false);
  });

  it('repairs missing runtime files instead of reusing an incomplete version', () => {
    const env = machine('linux');
    const source = payload('1.0.0');
    activatePayload(source, env);
    const runtime = path.join(env.root, 'versions', '1.0.0', 'runtime', 'node');
    fs.unlinkSync(runtime);
    activatePayload(source, env);
    expect(read(runtime)).toBe('runtime');
  });

  it('updates a portable archive without creating launchers or editing shell setup elsewhere', () => {
    const env = machine('linux', { portable: true });
    activatePayload(payload('1.0.0'), env);
    activatePayload(payload('1.1.0'), env);
    expect(read(path.join(env.root, 'current.txt')).trim()).toBe('1.1.0');
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'multi-git'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.bashrc'))).toBe(false);
  });
  it('switches to the newer version, keeps the previous one, and never goes backwards', () => {
    const env = machine('linux');
    activatePayload(payload('1.0.0'), env);
    activatePayload(payload('1.1.0'), env);

    expect(read(path.join(env.root, 'current.txt')).trim()).toBe('1.1.0');
    expect(read(path.join(env.root, 'previous.txt')).trim()).toBe('1.0.0');

    expect(() => activatePayload(payload('1.0.5'), env)).toThrow('newer than 1.0.5');
    expect(read(path.join(env.root, 'current.txt')).trim()).toBe('1.1.0');

    // Only the current and previous versions are kept.
    activatePayload(payload('1.2.0'), env);
    expect(fs.readdirSync(path.join(env.root, 'versions')).sort()).toEqual(['1.1.0', '1.2.0']);
  });

  it('leaves the working version in place when the new one does not start', () => {
    const env = machine('linux');
    activatePayload(payload('1.0.0'), env);
    const broken = payload('1.1.0');
    fs.writeFileSync(path.join(broken, 'scripts', 'multi-git.cjs'), '// 0.0.0-broken');

    expect(() => activatePayload(broken, env)).toThrow('reports version');
    expect(read(path.join(env.root, 'current.txt')).trim()).toBe('1.0.0');
    // No half-copied staging folder left behind.
    expect(fs.readdirSync(path.join(env.root, 'versions'))).toEqual(['1.0.0']);
  });

  it('refuses a package for another system', () => {
    const env = machine('linux');
    expect(() => activatePayload(payload('1.0.0', 'win32'), env)).toThrow('not a Multi-Git terminal edition for this system');
    expect(() => activatePayload(payload('1.0.0', 'linux', 'arm64'), env)).toThrow('for this system');
    // The desktop app's own payload on a Mac is universal.
    expect(payloadManifest(payload('1.0.0', 'darwin', 'universal'), { platform: 'darwin', arch: 'arm64' }).version).toBe('1.0.0');
  });
});

describe('removing', () => {
  it('undoes exactly what enabling did', () => {
    const env = machine('linux');
    fs.writeFileSync(path.join(home, '.bashrc'), 'alias ll="ls -l"\n');
    activatePayload(payload('1.0.0'), env);
    fs.appendFileSync(path.join(home, '.bashrc'), 'export EDITOR=vim\n');

    const status = removeTerminal(env);

    expect(read(path.join(home, '.bashrc'))).toBe('alias ll="ls -l"\nexport EDITOR=vim\n');
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'multi-git'))).toBe(false);
    expect(fs.existsSync(env.root)).toBe(false);
    expect(status.state).toBe('unavailable');
  });

  it('leaves a launcher alone that was changed after it was written', () => {
    const env = machine('linux');
    activatePayload(payload('1.0.0'), env);
    const launcher = path.join(home, '.local', 'bin', 'multi-git');
    fs.writeFileSync(launcher, '#!/bin/sh\necho edited\n');

    removeTerminal(env);
    expect(read(launcher)).toBe('#!/bin/sh\necho edited\n');
  });
});

describe('on Windows', () => {
  it('adds the folder to the user PATH once, keeping its type, and removal takes out only that', () => {
    const env = machine('win32');
    const status = activatePayload(payload('1.0.0', 'win32'), env);

    expect(env.userPath).toEqual({ value: `C:\\Tools;%USERPROFILE%\\bin;${env.root}`, type: 'REG_EXPAND_SZ' });
    expect(fs.existsSync(path.join(env.root, 'multi-git.cmd'))).toBe(true);
    expect(status.state).toBe('ready');
    expect(JSON.parse(status.mcpConfig!)).toEqual({
      mcpServers: { 'multi-git': { command: 'cmd.exe', args: ['/d', '/c', path.join(env.root, 'multi-git.cmd'), 'mcp'] } }
    });

    activatePayload(payload('1.0.0', 'win32'), env);
    expect(env.userPath.value.split(';').filter((entry) => entry === env.root)).toHaveLength(1);

    removeTerminal(env);
    expect(env.userPath).toEqual({ value: 'C:\\Tools;%USERPROFILE%\\bin', type: 'REG_EXPAND_SZ' });
  });

  it('leaves a PATH entry the user added themselves', () => {
    const env = machine('win32');
    env.userPath.value = `C:\\Tools;${env.root}`;
    activatePayload(payload('1.0.0', 'win32'), env);
    removeTerminal(env);

    expect(env.userPath.value).toBe(`C:\\Tools;${env.root}`);
  });
});
