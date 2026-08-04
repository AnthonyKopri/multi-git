import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CommandFailedError,
  CommandSpawnError,
  CommandTimeoutError,
  createExecutableRunner,
  describeCommand
} from '../src/server/process/runner';
import { StreamRedactor, redactText } from '../src/server/process/redact';

const runner = createExecutableRunner();

/** Runs a snippet of JavaScript in a child Node process. */
function node(script: string, options = {}) {
  return runner.run(process.execPath, ['-e', script], options);
}

/** Polls until `predicate` holds, or gives up. Returns whether it held. */
async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return predicate();
}

/** True while a pid still names a live process. */
function isAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence check without delivering
    // anything, on Windows as well as POSIX.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let workspace: string;

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-runner-')));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('the executable runner', () => {
  it('captures stdout, the exit code, and a duration', async () => {
    const result = await node('process.stdout.write("hello")');

    expect(result.stdout).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records the executable and argument vector it ran', async () => {
    const result = await node('process.stdout.write("x")');

    expect(result.executable).toBe(process.execPath);
    expect(result.args).toEqual(['-e', 'process.stdout.write("x")']);
  });

  it('rejects with a typed error on a disallowed non-zero exit', async () => {
    const failure = node('process.stderr.write("boom"); process.exit(3)');

    await expect(failure).rejects.toBeInstanceOf(CommandFailedError);
    await failure.catch((error: CommandFailedError) => {
      expect(error.result.exitCode).toBe(3);
      expect(error.result.stderr).toBe('boom');
      // Git and gh put their diagnostics on stderr, so that is what a user
      // should be shown rather than "exited with code 3".
      expect(error.displayMessage).toBe('boom');
    });
  });

  it('accepts an exit code the caller allowed', async () => {
    // The `git diff --quiet` shape: 1 means "there were differences".
    const result = await node('process.exit(1)', { allowNonZero: [1] });

    expect(result.exitCode).toBe(1);
  });

  it('reports a missing executable as a spawn error, not an exit code', async () => {
    await expect(runner.run('definitely-not-a-real-binary-xyz', [])).rejects.toBeInstanceOf(
      CommandSpawnError
    );
  });

  it('rejects with a timeout error carrying the partial output', async () => {
    const failure = node('process.stdout.write("partial"); setTimeout(() => {}, 60000)', {
      timeoutMs: 500
    });

    await expect(failure).rejects.toBeInstanceOf(CommandTimeoutError);
    await failure.catch((error: CommandTimeoutError) => {
      expect(error.statusCode).toBe(504);
      expect(error.result.stdout).toBe('partial');
    });
  });

  it('writes stdin and closes it', async () => {
    const result = await node(
      'let d=""; process.stdin.on("data", c => d += c); process.stdin.on("end", () => process.stdout.write(d.toUpperCase()))',
      { input: 'from the parent' }
    );

    expect(result.stdout).toBe('FROM THE PARENT');
  });

  it('applies the environment and working directory it was given', async () => {
    const result = await node(
      'process.stdout.write(`${process.env.MULTI_GIT_TEST}|${process.cwd()}`)',
      { env: { ...process.env, MULTI_GIT_TEST: 'injected' }, cwd: workspace }
    );

    const [value, cwd] = result.stdout.split('|');
    expect(value).toBe('injected');
    expect((cwd ?? '').toLowerCase()).toBe(workspace.toLowerCase());
  });

  it('never involves a shell, so metacharacters stay literal', async () => {
    const result = await runner.run(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1])',
      '$(whoami) && echo pwned > /tmp/x'
    ]);

    expect(result.stdout).toBe('$(whoami) && echo pwned > /tmp/x');
  });

  it('streams stdout to the progress callback as it arrives', async () => {
    const chunks: string[] = [];
    const result = await node(
      'process.stdout.write("one\\n"); setTimeout(() => process.stdout.write("two\\n"), 50)',
      { onStdout: (chunk: string) => chunks.push(chunk) }
    );

    expect(chunks.join('')).toBe(result.stdout);
    expect(result.stdout).toBe('one\ntwo\n');
  });

  it('decodes multi-byte characters split across chunk boundaries', async () => {
    // Node emits stdout in ~64 KiB chunks, so a long run of 3-byte characters
    // is guaranteed to have one straddling a boundary.
    const count = 200_000;
    const result = await node(`process.stdout.write("\\u4e2d".repeat(${count}))`, {
      timeoutMs: 30_000
    });

    expect(result.stdout).not.toContain('�');
    expect(result.stdout).toBe('中'.repeat(count));
  });

  it('truncates output past the byte cap rather than growing without limit', async () => {
    const result = await node('process.stdout.write("x".repeat(5_000_000))', {
      maxOutputBytes: 64 * 1024,
      timeoutMs: 30_000
    });

    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(5_000_000);
  });
});

describe('cancellation', () => {
  it('resolves with a cancelled result instead of rejecting', async () => {
    const controller = new AbortController();
    const running = node('setTimeout(() => {}, 60000)', { signal: controller.signal });

    setTimeout(() => controller.abort(), 100);
    const result = await running;

    expect(result.cancelled).toBe(true);
    // A cancelled operation is an outcome the user asked for, so it must not
    // surface as a failed command.
    expect(result.exitCode).not.toBe(0);
  });

  it('terminates the whole process tree, not just the direct child', async () => {
    // The shape every real case has: `git push` starts `ssh`, and killing only
    // the direct child leaves the grandchild holding the pipes open.
    const pidFile = path.join(workspace, 'grandchild.pid');
    const script = [
      "const { spawn } = require('child_process');",
      "const fs = require('fs');",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
      'fs.writeFileSync(process.argv[1], String(child.pid));',
      'setTimeout(() => {}, 60000);'
    ].join('\n');

    const controller = new AbortController();
    const running = runner.run(process.execPath, ['-e', script, pidFile], {
      signal: controller.signal
    });

    expect(await waitFor(() => fs.existsSync(pidFile))).toBe(true);
    const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(Number.isInteger(grandchild)).toBe(true);
    expect(isAlive(grandchild)).toBe(true);

    controller.abort();
    const result = await running;

    expect(result.cancelled).toBe(true);
    expect(await waitFor(() => !isAlive(grandchild))).toBe(true);
  });

  it('cancels a run whose signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await node('setTimeout(() => {}, 60000)', { signal: controller.signal });

    expect(result.cancelled).toBe(true);
  });

  it('leaves an already-finished run alone', async () => {
    const controller = new AbortController();
    const result = await node('process.stdout.write("done")', { signal: controller.signal });

    controller.abort();

    expect(result.cancelled).toBe(false);
    expect(result.stdout).toBe('done');
  });
});

describe('redaction', () => {
  const passphrase = 'correct-horse-battery-staple';

  it('removes a secret from stdout', async () => {
    const result = await node(`process.stdout.write("key: ${passphrase}")`, {
      redact: [passphrase]
    });

    expect(result.stdout).not.toContain(passphrase);
    expect(result.stdout).toBe('key: ***');
  });

  it('removes a secret from stderr, where tools put their diagnostics', async () => {
    const failure = node(
      `process.stderr.write("bad passphrase ${passphrase}"); process.exit(1)`,
      { redact: [passphrase] }
    );

    await failure.catch((error: CommandFailedError) => {
      expect(error.result.stderr).not.toContain(passphrase);
      expect(error.displayMessage).not.toContain(passphrase);
    });
    await expect(failure).rejects.toBeInstanceOf(CommandFailedError);
  });

  it('removes a secret from the recorded argument vector', async () => {
    // Logging a CommandResult whole must not be a way to leak an argument.
    const result = await runner.run(
      process.execPath,
      ['-e', 'process.stdout.write("ok")', passphrase],
      { redact: [passphrase] }
    );

    expect(result.args).toEqual(['-e', 'process.stdout.write("ok")', '***']);
    expect(JSON.stringify(result)).not.toContain(passphrase);
  });

  it('removes a secret from the streamed progress chunks', async () => {
    const chunks: string[] = [];
    await node(`process.stdout.write("token=${passphrase}\\n")`, {
      redact: [passphrase],
      onStdout: (chunk: string) => chunks.push(chunk)
    });

    expect(chunks.join('')).not.toContain(passphrase);
  });

  it('describes a command without its secrets', () => {
    expect(describeCommand('ssh-add', ['-q', passphrase], [passphrase])).toBe('ssh-add -q ***');
  });
});

describe('redactText', () => {
  it('replaces every occurrence', () => {
    expect(redactText('a s b s c', ['s'])).toBe('a *** b *** c');
  });

  it('replaces the longest match first, so a nested secret is not split', () => {
    expect(redactText('prefix-secret', ['secret', 'prefix-secret'])).toBe('***');
  });

  it('is idempotent', () => {
    const once = redactText('value=hunter2', ['hunter2']);
    expect(redactText(once, ['hunter2'])).toBe(once);
  });

  it('ignores empty secrets rather than matching everywhere', () => {
    expect(redactText('untouched', [''])).toBe('untouched');
  });

  it('returns the text unchanged when there is nothing to redact', () => {
    expect(redactText('untouched', [])).toBe('untouched');
  });
});

describe('StreamRedactor', () => {
  it('catches a secret split across two chunks', () => {
    // The case a per-chunk replace cannot see: neither half matches alone.
    const redactor = new StreamRedactor(['hunter2']);
    const output = redactor.push('pass=hun') + redactor.push('ter2\n') + redactor.flush();

    expect(output).toBe('pass=***\n');
  });

  it('catches a secret split one character at a time', () => {
    const redactor = new StreamRedactor(['hunter2']);
    const output = [...'x hunter2 y'].map((c) => redactor.push(c)).join('') + redactor.flush();

    expect(output).toBe('x *** y');
  });

  it('never emits a fragment long enough to complete a secret', () => {
    const redactor = new StreamRedactor(['hunter2']);
    const emitted = redactor.push('pass=hun');

    expect(emitted).not.toContain('hun');
  });

  it('passes text through untouched when there are no secrets', () => {
    const redactor = new StreamRedactor([]);

    expect(redactor.push('anything at all')).toBe('anything at all');
    expect(redactor.flush()).toBe('');
  });
});
