import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { buildSshCommand } from '../src/server/git/run';
import { buildRepoSshCommand } from '../src/server/ssh/repo-routing';
import { quoteShellArgument } from '../src/server/process/shell-quote';

const posixIt = process.platform === 'win32' ? it.skip : it;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Runs one generated command through the shell Git uses, with ssh replaced by a recorder. */
function sshIdentityArgument(command: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'multi-git-ssh-quote-'));
  temporaryDirectories.push(directory);

  const bin = path.join(directory, 'bin');
  const capture = path.join(directory, 'arguments.txt');
  const ssh = path.join(bin, 'ssh');

  // mkdir is intentionally kept inside the test rather than the shell command:
  // only the value produced by the application is interpreted by /bin/sh.
  mkdirSync(bin);
  writeFileSync(ssh, '#!/bin/sh\nprintf "%s\\n" "$@" > "$MG_SSH_CAPTURE"\n', 'utf8');
  chmodSync(ssh, 0o700);

  const result = spawnSync('/bin/sh', ['-c', command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      MG_SSH_CAPTURE: capture,
      MULTI_GIT_KEY_TRAP: 'expanded-by-the-shell'
    }
  });

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const args = readFileSync(capture, 'utf8').trim().split('\n');
  expect(args[0]).toBe('-i');
  return args[1] as string;
}

describe('SSH identity shell quoting', () => {
  const keyPath = '/Users/jane/$MULTI_GIT_KEY_TRAP/it\'s a key';

  it('suppresses POSIX expansion and preserves an embedded apostrophe', () => {
    expect(quoteShellArgument(keyPath, 'darwin')).toBe(
      `'/Users/jane/$MULTI_GIT_KEY_TRAP/it'"'"'s a key'`
    );
  });

  posixIt('passes a GIT_SSH_COMMAND identity path literally', () => {
    expect(sshIdentityArgument(buildSshCommand(keyPath))).toBe(keyPath);
  });

  posixIt('passes a repository core.sshCommand identity path literally', () => {
    expect(sshIdentityArgument(buildRepoSshCommand(keyPath))).toBe(keyPath);
  });
});
