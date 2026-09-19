import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanupRepos, createTempDir } from './helpers/temp-repo';
import { generateSshKeyPair, validateSshKeyPair } from '../src/server/ssh/keys';
import * as external from '../src/server/external/run';

afterEach(() => { vi.restoreAllMocks(); cleanupRepos(); });

it('keeps nonempty key passphrases out of process arguments and removes its askpass bridge', async () => {
  const scripts: string[] = [];
  const secret = 'secret with % and &';
  const run = vi.spyOn(external, 'runExternalCommand').mockImplementation(async (_command, args, options) => {
    expect(args).not.toContain(secret);
    expect(options?.envOverrides?.['SSH_ASKPASS_REQUIRE']).toBe('force');
    const script = options!.envOverrides!['SSH_ASKPASS']!;
    expect(fs.existsSync(script)).toBe(true);
    scripts.push(script);
    return { ok: true, code: 0, stdout: '', stderr: '', error: null };
  });
  await generateSshKeyPair({ privateKeyPath: '/test/key', passphrase: secret });
  expect((await validateSshKeyPair('/test/key', secret)).valid).toBe(true);
  expect(run).toHaveBeenCalledTimes(2);
  for (const script of scripts) expect(fs.existsSync(script)).toBe(false);
});

it.skipIf(spawnSync('ssh-keygen', ['-?'], { windowsHide: true }).error !== undefined)('generates and unlocks a real encrypted key through askpass', async () => {
  const key = path.join(createTempDir('terminal-key-'), 'test-key');
  await generateSshKeyPair({ privateKeyPath: key, passphrase: 'terminal-secret-123' });
  expect((await validateSshKeyPair(key, 'terminal-secret-123')).valid).toBe(true);
  expect((await validateSshKeyPair(key, '')).valid).toBe(false);
}, 60_000);
