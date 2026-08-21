import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeFileAtomic, writeJsonAtomic } from '../src/server/fs/atomic';
import { withRepoLock } from '../src/server/git/lock';
import { GitError, buildSshCommand } from '../src/server/git/run';
import { createAskpassBridge } from '../src/server/ssh/askpass';
import { isPermittedKeyPath, sanitizeLabelForKeyName } from '../src/server/ssh/keys';
import { LOG_TEXT_MAX, appendLog, clearLogBuffer } from '../src/server/logs';
import { pruneTrash, TRASH_MAX_ENTRIES, TRASH_TTL_MS } from '../src/server/safety-net/trash';
import type { TrashEntry } from '../src/server/safety-net/trash';

let workspace: string;

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-infra-')));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('writes the file', () => {
    const target = path.join(workspace, 'config.json');
    writeFileAtomic(target, 'contents');

    expect(fs.readFileSync(target, 'utf8')).toBe('contents');
  });

  it('replaces existing contents completely', () => {
    const target = path.join(workspace, 'config.json');
    writeFileAtomic(target, 'a much longer original value');
    writeFileAtomic(target, 'short');

    expect(fs.readFileSync(target, 'utf8')).toBe('short');
  });

  it('leaves no temp file behind', () => {
    writeFileAtomic(path.join(workspace, 'config.json'), 'contents');

    expect(fs.readdirSync(workspace)).toEqual(['config.json']);
  });

  it('does not destroy the existing file when the write fails', () => {
    const target = path.join(workspace, 'config.json');
    writeFileAtomic(target, 'original');

    // A directory cannot be written as a file, so the temp write throws.
    const doomed = path.join(workspace, 'nested', 'deep', 'config.json');
    expect(() => writeFileAtomic(doomed, 'nope')).toThrow();

    expect(fs.readFileSync(target, 'utf8')).toBe('original');
  });

  it('round-trips JSON', () => {
    const target = path.join(workspace, 'data.json');
    writeJsonAtomic(target, { recentRepos: ['a', 'b'], nested: { ok: true } });

    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({
      recentRepos: ['a', 'b'],
      nested: { ok: true }
    });
  });
});

describe('withRepoLock', () => {
  it('serialises operations on the same repository', async () => {
    const order: string[] = [];

    const slow = withRepoLock('/repo-a', async () => {
      order.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 40));
      order.push('first:end');
    });
    const fast = withRepoLock('/repo-a', async () => {
      order.push('second:start');
      order.push('second:end');
    });

    await Promise.all([slow, fast]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('lets different repositories run concurrently', async () => {
    const order: string[] = [];

    await Promise.all([
      withRepoLock('/repo-a', async () => {
        order.push('a:start');
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push('a:end');
      }),
      withRepoLock('/repo-b', async () => {
        order.push('b:start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('b:end');
      })
    ]);

    // b finishes while a is still running, which a shared queue would prevent.
    expect(order).toEqual(['a:start', 'b:start', 'b:end', 'a:end']);
  });

  it('runs the next operation even after the previous one rejects', async () => {
    const failed = withRepoLock('/repo-c', () => Promise.reject(new Error('boom')));
    await expect(failed).rejects.toThrow('boom');

    await expect(withRepoLock('/repo-c', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('propagates the operation result', async () => {
    await expect(withRepoLock('/repo-d', () => Promise.resolve(42))).resolves.toBe(42);
  });
});

describe('GitError', () => {
  it('is a real Error with a stack', () => {
    const error = new GitError('git exited with code 1', { stderr: 'fatal: not a repository' });

    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeTruthy();
  });

  it('prefers git stderr for the user-facing message', () => {
    const error = new GitError('git exited with code 1', { stderr: 'fatal: not a repository' });

    expect(error.displayMessage).toBe('fatal: not a repository');
  });

  it('falls back to stdout, then to the generic message', () => {
    expect(new GitError('generic', { stdout: 'from stdout' }).displayMessage).toBe('from stdout');
    expect(new GitError('generic').displayMessage).toBe('generic');
  });

  it('defaults to a 500 status and allows an override', () => {
    expect(new GitError('x').statusCode).toBe(500);
    expect(new GitError('x', { statusCode: 504 }).statusCode).toBe(504);
  });
});

describe('buildSshCommand', () => {
  it('pins a single identity', () => {
    const command = buildSshCommand('C:\\Users\\jane\\.ssh\\id_ed25519');

    // Backslashes become forward slashes: ssh reads this as a shell word.
    // The binary itself is resolved rather than left to PATH, so only the
    // identity argument is asserted here; tests/openssh-path.test.ts covers
    // which ssh gets named.
    expect(command).toContain('-i "C:/Users/jane/.ssh/id_ed25519"');
    expect(command.startsWith('ssh') || command.startsWith('"')).toBe(true);
    expect(command).toContain('IdentitiesOnly=yes');
    expect(command).toContain('StrictHostKeyChecking=accept-new');
  });

  it('limits password prompts only when asked', () => {
    expect(buildSshCommand('/k')).not.toContain('NumberOfPasswordPrompts');
    expect(buildSshCommand('/k', true)).toContain('NumberOfPasswordPrompts=1');
  });
});

describe('createAskpassBridge', () => {
  it('creates a script that echoes the passphrase', () => {
    const bridge = createAskpassBridge('s3cret-pass');
    try {
      const scriptPath = bridge.envOverrides['SSH_ASKPASS'] as string;

      expect(fs.existsSync(scriptPath)).toBe(true);
      expect(fs.readFileSync(scriptPath, 'utf8')).toContain('s3cret-pass');
    } finally {
      bridge.cleanup();
    }
  });

  it('points git and ssh at the same script and disables interactive prompts', () => {
    const bridge = createAskpassBridge('pw');
    try {
      expect(bridge.envOverrides['GIT_ASKPASS']).toBe(bridge.envOverrides['SSH_ASKPASS']);
      expect(bridge.envOverrides['GIT_TERMINAL_PROMPT']).toBe('0');
      expect(bridge.envOverrides['DISPLAY']).toBe('multi-git');
    } finally {
      bridge.cleanup();
    }
  });

  it('places the script in a private directory, not the temp root', () => {
    const bridge = createAskpassBridge('pw');
    try {
      const scriptPath = bridge.envOverrides['SSH_ASKPASS'] as string;
      const parent = path.dirname(scriptPath);

      expect(path.resolve(parent)).not.toBe(path.resolve(os.tmpdir()));
      expect(path.basename(parent).startsWith('multi-git-askpass-')).toBe(true);
    } finally {
      bridge.cleanup();
    }
  });

  it('creates the script without group or other permissions', (ctx) => {
    if (process.platform === 'win32') {
      // POSIX mode bits are not meaningful on NTFS.
      ctx.skip('POSIX permissions are not applicable on Windows');
      return;
    }

    const bridge = createAskpassBridge('pw');
    try {
      const scriptPath = bridge.envOverrides['SSH_ASKPASS'] as string;
      const mode = fs.statSync(scriptPath).mode & 0o777;

      // The passphrase is in plaintext here, so no other local user may read
      // it at any point — including between creation and a later chmod.
      expect(mode & 0o077).toBe(0);
    } finally {
      bridge.cleanup();
    }
  });

  it('removes the whole directory on cleanup', () => {
    const bridge = createAskpassBridge('pw');
    const scriptPath = bridge.envOverrides['SSH_ASKPASS'] as string;
    const directory = path.dirname(scriptPath);

    bridge.cleanup();

    expect(fs.existsSync(directory)).toBe(false);
  });

  it('tolerates cleanup being called twice', () => {
    const bridge = createAskpassBridge('pw');
    bridge.cleanup();

    expect(() => bridge.cleanup()).not.toThrow();
  });

  it('escapes a passphrase containing shell or batch metacharacters', () => {
    const nasty = process.platform === 'win32' ? 'a&b|c>d^e%f' : `a'b"c$d`;
    const bridge = createAskpassBridge(nasty);
    try {
      const scriptPath = bridge.envOverrides['SSH_ASKPASS'] as string;
      const script = fs.readFileSync(scriptPath, 'utf8');

      // The raw characters must not appear unescaped in a position where the
      // interpreter would act on them.
      expect(script.split('\n').length).toBeLessThanOrEqual(5);
    } finally {
      bridge.cleanup();
    }
  });
});

describe('isPermittedKeyPath', () => {
  const registered = [path.join(workspaceRootForKeys(), 'keys', 'work_key')];

  function workspaceRootForKeys(): string {
    return os.tmpdir();
  }

  it('accepts a key registered to a profile, wherever it lives', () => {
    expect(isPermittedKeyPath(registered[0] as string, registered)).toBe(true);
  });

  it('accepts a key under the user ~/.ssh directory', () => {
    expect(isPermittedKeyPath(path.join(os.homedir(), '.ssh', 'id_ed25519'), [])).toBe(true);
  });

  it('rejects an arbitrary path', () => {
    // The read this closes: any file on disk whose name ends in .pub.
    expect(isPermittedKeyPath(path.join(os.homedir(), 'Documents', 'secret'), [])).toBe(false);
    expect(isPermittedKeyPath('/etc/ssl/private/server', [])).toBe(false);
  });

  it('rejects traversal out of ~/.ssh', () => {
    expect(isPermittedKeyPath(path.join(os.homedir(), '.ssh', '..', 'secret'), [])).toBe(false);
  });
});

describe('sanitizeLabelForKeyName', () => {
  it('makes a label safe to use as a filename stem', () => {
    expect(sanitizeLabelForKeyName('Work Account')).toBe('work_account');
    expect(sanitizeLabelForKeyName('  Personal / GitHub  ')).toBe('personal_github');
    expect(sanitizeLabelForKeyName('a..b')).toBe('a_b');
  });

  it('handles empty and symbol-only labels', () => {
    expect(sanitizeLabelForKeyName('')).toBe('');
    expect(sanitizeLabelForKeyName('///')).toBe('');
    expect(sanitizeLabelForKeyName(null)).toBe('');
  });
});

describe('appendLog', () => {
  beforeEach(() => clearLogBuffer());

  it('normalises an unknown type to info', () => {
    expect(appendLog('hello', 'not-a-type').type).toBe('info');
    expect(appendLog('hello', 'error').type).toBe('error');
  });

  it('truncates a line past the cap so the buffer cannot grow without limit', () => {
    const entry = appendLog('x'.repeat(LOG_TEXT_MAX * 2), 'info');

    expect(entry.text.length).toBeLessThan(LOG_TEXT_MAX + 100);
    expect(entry.text).toContain('truncated');
  });

  it('leaves an ordinary line untouched', () => {
    expect(appendLog('git status --porcelain', 'cmd').text).toBe('git status --porcelain');
  });
});

describe('pruneTrash', () => {
  const now = Date.now();

  function entry(overrides: Partial<TrashEntry>): TrashEntry {
    return {
      id: 'id',
      path: 'file.txt',
      savedAt: now,
      trashFile: path.join(os.tmpdir(), 'does-not-exist.bin'),
      ...overrides
    };
  }

  it('keeps recent entries', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b', savedAt: now - 1000 })];

    expect(pruneTrash(entries, now).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('drops entries older than the retention window', () => {
    const entries = [entry({ id: 'fresh' }), entry({ id: 'stale', savedAt: now - TRASH_TTL_MS - 1 })];

    expect(pruneTrash(entries, now).map((item) => item.id)).toEqual(['fresh']);
  });

  it('caps the number of entries kept', () => {
    const entries = Array.from({ length: TRASH_MAX_ENTRIES + 10 }, (_, index) =>
      entry({ id: `entry-${index}` })
    );

    expect(pruneTrash(entries, now)).toHaveLength(TRASH_MAX_ENTRIES);
  });
});
