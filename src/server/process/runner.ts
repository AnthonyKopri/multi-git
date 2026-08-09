// The one boundary through which this application starts an external program.
//
// Git, `gh`, `ssh-add`, PowerShell, WSL and every provider CLI a later phase
// adds go through here. Two properties are the reason it exists at all:
//
//   * The executable and its arguments stay separate values from the caller
//     down to `spawn`. There is no string to interpolate into, so a branch
//     named `; rm -rf ~` is an argument and nothing else. Shell execution is
//     not an option this exposes.
//
//   * It is an interface, not a function. Services take an `ExecutableRunner`,
//     so a test can assert the exact argv, the stdin written, the environment
//     applied, that cancellation propagated, and that a passphrase never
//     appeared in the result — without git, gh, or an SSH agent installed.
import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import { killProcessTree, TREE_KILLABLE_SPAWN_OPTIONS } from './kill-tree';
import { StreamRedactor, redactArgs, redactText } from './redact';

/** 64 MiB. Larger than any diff a human reads, small enough to stay safe. */
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Exit code reported when the process was terminated by a signal and so never
 * produced one of its own.
 */
export const TERMINATED_EXIT_CODE = -1;

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /** Exit codes to treat as success. `git diff --quiet` answers 1 by design. */
  allowNonZero?: readonly number[];
  /** Values scrubbed from stdout, stderr, the recorded argv, and messages. */
  redact?: readonly string[];
  /** Truncation cap per stream. Defaults to DEFAULT_MAX_OUTPUT_BYTES. */
  maxOutputBytes?: number;
}

export interface CommandResult {
  executable: string;
  /** Already redacted, so logging a result whole cannot leak a secret. */
  args: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True when an AbortSignal ended this. Not an error; see `run`. */
  cancelled: boolean;
  /** True when either stream hit `maxOutputBytes` and was cut short. */
  truncated: boolean;
}

/** The executable could not be started: not installed, or not on PATH. */
export class CommandSpawnError extends Error {
  readonly executable: string;
  readonly statusCode = 500;

  constructor(executable: string, cause: Error) {
    super(`Failed to run ${executable}: ${cause.message}`);
    this.name = 'CommandSpawnError';
    this.executable = executable;
    this.cause = cause;
  }
}

/** The process ran and exited with a code the caller did not allow. */
export class CommandFailedError extends Error {
  readonly result: CommandResult;
  readonly statusCode: number = 500;

  constructor(result: CommandResult, message?: string) {
    super(message ?? `${result.executable} exited with code ${result.exitCode}`);
    this.name = 'CommandFailedError';
    this.result = result;
  }

  /** The message worth showing a user. Tools put diagnostics on stderr. */
  get displayMessage(): string {
    return this.result.stderr.trim() || this.result.stdout.trim() || this.message;
  }
}

export class CommandTimeoutError extends CommandFailedError {
  override readonly statusCode = 504;
  readonly timeoutMs: number;

  constructor(result: CommandResult, timeoutMs: number) {
    super(result, `${result.executable} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'CommandTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface ExecutableRunner {
  /**
   * Runs a command to completion.
   *
   * Resolves on success and on cancellation — a cancelled operation is a state
   * the user asked for, not a failure to report. Rejects with
   * CommandSpawnError, CommandTimeoutError, or CommandFailedError otherwise,
   * so callers are never left inspecting an exit code they forgot to check.
   */
  run(
    executable: string,
    args: readonly string[],
    options?: RunOptions
  ): Promise<CommandResult>;
}

/**
 * Accumulates a stream as text, decoding across chunk boundaries and stopping
 * at a byte cap.
 *
 * Decoding each chunk on its own with `chunk.toString()` splits any multi-byte
 * character that straddles a boundary into two replacement characters, which a
 * file named `café.txt` or a commit message with an em dash hits routinely.
 * StringDecoder holds the partial sequence until the rest arrives.
 */
class OutputCollector {
  private readonly decoder = new StringDecoder('utf8');
  private readonly parts: string[] = [];
  private readonly redactor: StreamRedactor;
  private bytes = 0;
  private capped = false;

  constructor(
    private readonly maxBytes: number,
    secrets: readonly string[],
    private readonly onChunk: ((chunk: string) => void) | undefined
  ) {
    this.redactor = new StreamRedactor(secrets);
  }

  push(chunk: Buffer): void {
    if (this.capped) {
      return;
    }

    this.bytes += chunk.length;

    if (this.bytes > this.maxBytes) {
      this.capped = true;
      this.close();
      return;
    }

    this.emit(this.decoder.write(chunk));
  }

  /** Feeds decoded text through the redactor and emits what it releases. */
  private emit(text: string): void {
    if (text !== '') {
      this.release(this.redactor.push(text));
    }
  }

  /**
   * Drains both buffers. The redactor's tail goes out directly: pushing it
   * back through `emit` would hold the same characters back a second time and
   * lose them.
   */
  private close(): void {
    this.emit(this.decoder.end());
    this.release(this.redactor.flush());
  }

  private release(safe: string): void {
    if (safe === '') {
      return;
    }

    this.parts.push(safe);

    if (this.onChunk) {
      // A listener that throws must not take down the run; it is a progress
      // sink, and the process is still going either way.
      try {
        this.onChunk(safe);
      } catch {
        // Ignored deliberately.
      }
    }
  }

  get truncated(): boolean {
    return this.capped;
  }

  finish(): string {
    if (!this.capped) {
      this.close();
    }
    return this.parts.join('');
  }
}

function writeInput(child: ChildProcess, input: string | Buffer | undefined): void {
  if (!child.stdin) {
    return;
  }

  if (input !== undefined) {
    // EPIPE here means the child exited before reading, which its exit code
    // already describes far better than a write error would.
    child.stdin.on('error', () => {});
    child.stdin.write(input);
  }

  child.stdin.end();
}

/** The runner used in production. Tests substitute their own. */
export function createExecutableRunner(): ExecutableRunner {
  return {
    run(executable, args, options = {}) {
      const secrets = options.redact ?? [];
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      const allowNonZero = options.allowNonZero ?? [];
      const startedAt = Date.now();

      return new Promise<CommandResult>((resolve, reject) => {
        const spawnOptions: SpawnOptions = {
          shell: false,
          windowsHide: true,
          ...TREE_KILLABLE_SPAWN_OPTIONS
        };
        if (options.cwd !== undefined) {
          spawnOptions.cwd = options.cwd;
        }
        if (options.env !== undefined) {
          spawnOptions.env = options.env;
        }

        let child: ChildProcess;
        try {
          child = spawn(executable, [...args], spawnOptions);
        } catch (error) {
          // spawn throws synchronously for an invalid argument vector, such as
          // an argument containing a NUL byte.
          reject(new CommandSpawnError(executable, error as Error));
          return;
        }

        const out = new OutputCollector(maxOutputBytes, secrets, options.onStdout);
        const err = new OutputCollector(maxOutputBytes, secrets, options.onStderr);

        let cancelled = false;
        let timedOut = false;
        let settled = false;
        let cancelEscalation: (() => void) | null = null;

        const terminate = (): void => {
          cancelEscalation?.();
          cancelEscalation = killProcessTree(child);
        };

        const timer = setTimeout(() => {
          timedOut = true;
          terminate();
        }, timeoutMs);

        const onAbort = (): void => {
          cancelled = true;
          terminate();
        };

        if (options.signal) {
          if (options.signal.aborted) {
            // Already cancelled before the process was even spawned. Kill it
            // rather than letting the work run to completion unwatched.
            queueMicrotask(onAbort);
          } else {
            options.signal.addEventListener('abort', onAbort, { once: true });
          }
        }

        const cleanup = (): void => {
          clearTimeout(timer);
          cancelEscalation?.();
          options.signal?.removeEventListener('abort', onAbort);
        };

        const settle = (exitCode: number, spawnError: Error | null): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();

          if (spawnError) {
            reject(new CommandSpawnError(executable, spawnError));
            return;
          }

          const result: CommandResult = {
            executable,
            args: redactArgs(args, secrets),
            exitCode,
            stdout: out.finish(),
            stderr: err.finish(),
            durationMs: Date.now() - startedAt,
            cancelled,
            truncated: out.truncated || err.truncated
          };

          if (cancelled) {
            // The user asked for this. It is an outcome, not an error.
            resolve(result);
            return;
          }

          if (timedOut) {
            reject(new CommandTimeoutError(result, timeoutMs));
            return;
          }

          if (result.exitCode !== 0 && !allowNonZero.includes(result.exitCode)) {
            reject(new CommandFailedError(result));
            return;
          }

          resolve(result);
        };

        child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
        child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));

        child.on('error', (error: Error) => settle(TERMINATED_EXIT_CODE, error));
        child.on('close', (code) => settle(code ?? TERMINATED_EXIT_CODE, null));

        writeInput(child, options.input);
      });
    }
  };
}

/** Shared instance for callers with nothing to inject. */
export const executableRunner: ExecutableRunner = createExecutableRunner();

export interface DetachedLaunchOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Whether the process gets its own visible console window. True for an
   * interactive tool the user is about to type into; false hides it.
   */
  visible?: boolean;
}

export interface DetachedLauncher {
  /**
   * Starts a program that outlives this request, and does not wait for it.
   *
   * Resolves once the process exists, rejects if it could not be started. It
   * deliberately learns nothing else: an editor or a coding agent runs for
   * hours, and `run` above would hold a promise open for all of it and then
   * kill it at the timeout.
   */
  launch(
    executable: string,
    args: readonly string[],
    options?: DetachedLaunchOptions
  ): Promise<{ pid?: number }>;
}

/**
 * The detached launcher used in production.
 *
 * Same discipline as `run`: the executable and its arguments stay separate
 * values, `shell` is false, and the environment is whatever the caller decided
 * rather than an inherited copy. What differs is only the waiting.
 */
export function createDetachedLauncher(spawnFn: typeof spawn = spawn): DetachedLauncher {
  return {
    launch(executable, args, options = {}) {
      return new Promise((resolve, reject) => {
        const spawnOptions: SpawnOptions = {
          shell: false,
          windowsHide: options.visible !== true,
          detached: true,
          // Nothing is going to read these: the process is on its own from
          // here, and an unread pipe would eventually block it.
          stdio: 'ignore'
        };
        if (options.cwd !== undefined) {
          spawnOptions.cwd = options.cwd;
        }
        if (options.env !== undefined) {
          spawnOptions.env = options.env;
        }

        let child: ChildProcess;
        try {
          child = spawnFn(executable, [...args], spawnOptions);
        } catch (error) {
          reject(new CommandSpawnError(executable, error as Error));
          return;
        }

        let settled = false;

        child.on('error', (error: Error) => {
          if (!settled) {
            settled = true;
            reject(new CommandSpawnError(executable, error));
          }
        });

        child.on('spawn', () => {
          if (settled) {
            return;
          }
          settled = true;

          // Released from this process's job control, so quitting Multi-Git
          // does not take the user's editor or agent with it.
          child.unref();
          resolve(child.pid === undefined ? {} : { pid: child.pid });
        });
      });
    }
  };
}

export const detachedLauncher: DetachedLauncher = createDetachedLauncher();

/** Formats a command for the Terminal Log, with secrets already removed. */
export function describeCommand(
  executable: string,
  args: readonly string[],
  secrets: readonly string[] = []
): string {
  return redactText([executable, ...args].join(' '), secrets);
}
