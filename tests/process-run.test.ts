import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runProcess } from '../src/server/process/run';

/** Runs a snippet of JavaScript in a child Node process. */
function node(script: string, options = {}) {
  return runProcess(process.execPath, ['-e', script], options);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

describe('runProcess', () => {
  it('captures stdout and the exit code', async () => {
    const result = await node('process.stdout.write("hello")');

    expect(result).toMatchObject({ stdout: 'hello', code: 0, timedOut: false, truncated: false });
    expect(result.spawnError).toBeNull();
  });

  it('captures stderr separately and reports a non-zero exit', async () => {
    const result = await node('process.stderr.write("boom"); process.exit(3)');

    expect(result.stderr).toBe('boom');
    expect(result.stdout).toBe('');
    expect(result.code).toBe(3);
  });

  it('reports a spawn failure instead of throwing', async () => {
    const result = await runProcess('definitely-not-a-real-binary-xyz', []);

    expect(result.spawnError).toBeInstanceOf(Error);
    expect(result.code).toBeNull();
  });

  it('kills a process that exceeds its timeout', async () => {
    const result = await node('setTimeout(() => {}, 60000)', { timeoutMs: 300 });

    expect(result.timedOut).toBe(true);
  });

  it('kills descendants on cancellation instead of orphaning credential helpers', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-process-tree-'));
    const pidFile = path.join(directory, 'grandchild.pid');
    const script = [
      "const { spawn } = require('child_process');",
      "const fs = require('fs');",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
      'fs.writeFileSync(process.argv[1], String(child.pid));',
      'setTimeout(() => {}, 60000);'
    ].join('\n');
    const controller = new AbortController();

    try {
      const running = runProcess(process.execPath, ['-e', script, pidFile], {
        signal: controller.signal
      });
      expect(await waitFor(() => fs.existsSync(pidFile))).toBe(true);

      const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
      expect(isAlive(grandchild)).toBe(true);

      controller.abort();
      expect((await running).cancelled).toBe(true);
      expect(await waitFor(() => !isAlive(grandchild))).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('decodes multi-byte characters split across chunk boundaries', async () => {
    // The regression this exists for. Node emits stdout in ~64 KiB chunks, so
    // a long run of 3-byte characters is guaranteed to have one straddling a
    // boundary. Decoding each chunk independently — what `stdout += chunk
    // .toString()` did — yields U+FFFD on both sides of every split.
    const count = 200_000;
    const result = await node(
      `process.stdout.write("\\u4e2d".repeat(${count}))`,
      { timeoutMs: 30_000 }
    );

    expect(result.stdout).toHaveLength(count);
    expect(result.stdout).not.toContain('�');
    expect(result.stdout).toBe('中'.repeat(count));
  });

  it('decodes mixed scripts and characters outside the basic plane', async () => {
    // Emoji are 4 bytes and encode as a surrogate pair, so they exercise both
    // the byte-level and the UTF-16 boundary.
    const unit = 'café — 中文 — 🔑 — ';
    const result = await node(
      `process.stdout.write(${JSON.stringify(unit)}.repeat(20000))`,
      { timeoutMs: 30_000 }
    );

    expect(result.stdout).not.toContain('�');
    expect(result.stdout).toBe(unit.repeat(20000));
  });

  it('truncates output past the byte cap rather than growing without limit', async () => {
    const result = await node('process.stdout.write("x".repeat(5_000_000))', {
      maxOutputBytes: 64 * 1024,
      timeoutMs: 30_000
    });

    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(5_000_000);
  });

  it('passes environment overrides to the child', async () => {
    const result = await node('process.stdout.write(process.env.MULTI_GIT_TEST ?? "unset")', {
      env: { ...process.env, MULTI_GIT_TEST: 'from-parent' }
    });

    expect(result.stdout).toBe('from-parent');
  });

  it('runs in the requested working directory', async () => {
    const result = await node('process.stdout.write(process.cwd())', { cwd: process.cwd() });

    expect(result.stdout.toLowerCase()).toBe(process.cwd().toLowerCase());
  });

  it('does not involve a shell, so metacharacters stay literal', async () => {
    // If a shell were involved this would try to run `whoami` and redirect.
    const result = await runProcess(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1])',
      '$(whoami) && echo pwned > /tmp/x'
    ]);

    expect(result.stdout).toBe('$(whoami) && echo pwned > /tmp/x');
  });
});
