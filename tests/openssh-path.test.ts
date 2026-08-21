// Which OpenSSH build the app runs.
//
// Windows has two, they do not share an agent, and both are called `ssh`. See
// src/server/ssh/openssh-path.ts for why that matters.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { opensshBinary, resetOpensshPathCache, sshCommandPrefix } from '../src/server/ssh/openssh-path';
import { buildSshCommand } from '../src/server/git/run';

const isWindows = process.platform === 'win32';

let fakeRoot = '';
const previousSystemRoot = process.env['SystemRoot'];

/** A SystemRoot whose System32\OpenSSH holds the tools named. */
function systemRootWith(tools: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-sysroot-'));
  const openssh = path.join(root, 'System32', 'OpenSSH');
  fs.mkdirSync(openssh, { recursive: true });

  for (const tool of tools) {
    fs.writeFileSync(path.join(openssh, `${tool}.exe`), '', 'utf8');
  }

  return root;
}

beforeEach(() => {
  resetOpensshPathCache();
});

afterEach(() => {
  resetOpensshPathCache();
  if (previousSystemRoot === undefined) {
    delete process.env['SystemRoot'];
  } else {
    process.env['SystemRoot'] = previousSystemRoot;
  }
  if (fakeRoot) {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
    fakeRoot = '';
  }
});

describe.runIf(isWindows)('on Windows', () => {
  it('names the System32 OpenSSH build, which is the one that reaches the agent', () => {
    fakeRoot = systemRootWith(['ssh', 'ssh-add']);
    process.env['SystemRoot'] = fakeRoot;
    resetOpensshPathCache();

    expect(opensshBinary('ssh')).toBe(path.join(fakeRoot, 'System32', 'OpenSSH', 'ssh.exe'));
    expect(opensshBinary('ssh-add')).toBe(
      path.join(fakeRoot, 'System32', 'OpenSSH', 'ssh-add.exe')
    );
  });

  it('falls back to PATH when that build is not installed', () => {
    // Better a bare name than an absolute path to something that is not there.
    fakeRoot = systemRootWith([]);
    process.env['SystemRoot'] = fakeRoot;
    resetOpensshPathCache();

    expect(opensshBinary('ssh')).toBe('ssh');
  });

  it('falls back to PATH when the environment does not say where Windows is', () => {
    delete process.env['SystemRoot'];
    delete process.env['windir'];
    resetOpensshPathCache();

    expect(opensshBinary('ssh')).toBe('ssh');
  });

  it('quotes the path for GIT_SSH_COMMAND, which git splits shell-style', () => {
    fakeRoot = systemRootWith(['ssh']);
    process.env['SystemRoot'] = fakeRoot;
    resetOpensshPathCache();

    const prefix = sshCommandPrefix();

    expect(prefix.startsWith('"')).toBe(true);
    expect(prefix.endsWith('"')).toBe(true);
    // Forward slashes: git's splitter treats a backslash as an escape.
    expect(prefix).not.toContain('\\');
  });
});

describe('the bare name', () => {
  it('is used when there is no Windows OpenSSH to name', () => {
    if (isWindows) {
      delete process.env['SystemRoot'];
      delete process.env['windir'];
      resetOpensshPathCache();
    }

    expect(opensshBinary('ssh')).toBe('ssh');
    expect(sshCommandPrefix()).toBe('ssh');
  });
});

describe('buildSshCommand', () => {
  it('pins the identity and keeps the options that make per-repo accounts work', () => {
    const command = buildSshCommand('C:\\Users\\me\\.ssh\\id_ed25519');

    expect(command).toContain('-i "C:/Users/me/.ssh/id_ed25519"');
    // IdentitiesOnly is what stops ssh offering every key in the agent, which
    // is what makes per-repository account selection work at all.
    expect(command).toContain('-o IdentitiesOnly=yes');
    expect(command).toContain('-o StrictHostKeyChecking=accept-new');
    expect(command).not.toContain('-o NumberOfPasswordPrompts=1');
  });

  it('limits the prompt when asked, for the askpass path', () => {
    expect(buildSshCommand('/home/me/.ssh/id_ed25519', true)).toContain(
      '-o NumberOfPasswordPrompts=1'
    );
  });

  it('starts with the resolved ssh binary rather than a bare name on Windows', () => {
    if (isWindows) {
      fakeRoot = systemRootWith(['ssh']);
      process.env['SystemRoot'] = fakeRoot;
      resetOpensshPathCache();

      expect(buildSshCommand('/k')).toContain('System32/OpenSSH/ssh.exe');
    } else {
      expect(buildSshCommand('/k').startsWith('ssh ')).toBe(true);
    }
  });
});
