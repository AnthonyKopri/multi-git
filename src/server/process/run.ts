// One place where this application starts a child process and reads its
// output. Everything is spawned with `shell: false` and an argument vector.
//
// Two things the four hand-rolled copies of this logic got wrong:
//
//   * `stdout += chunk.toString()` decodes each chunk independently. A UTF-8
//     character split across a chunk boundary — routine for a file named
//     "café.txt" or a commit message with an em dash — decodes to a
//     replacement character on both sides. StringDecoder holds the partial
//     sequence until the rest arrives.
//
//   * Repeated string concatenation is quadratic. Large diffs are exactly the
//     case where it hurts, so chunks are collected and joined once.
//
// A byte cap is also enforced, because none of the callers had one and a
// pathological repository could otherwise exhaust memory.
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

/** 64 MiB. Larger than any diff a human reads, small enough to stay safe. */
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface RunOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  timeoutMs?: number | undefined;
  maxOutputBytes?: number | undefined;
  /**
   * Written to the child's stdin, which is then closed.
   *
   * This is how a patch reaches `git apply`. Passing one as an argument would
   * mean building a command line out of file contents, which is exactly what
   * this module exists to make impossible.
   */
  input?: string | Buffer | undefined;
  /**
   * Kills the child when it fires.
   *
   * What makes a long read — a diff of a very large file, a search across a
   * long history — something the user can stop rather than wait out.
   */
  signal?: AbortSignal | undefined;
  /**
   * Collects stdout as raw bytes instead of decoding it.
   *
   * Needed for `git cat-file blob`: an image decoded as UTF-8 comes back with
   * every invalid sequence replaced, which is not the file any more.
   */
  binaryStdout?: boolean | undefined;
}

export interface RunResult {
  stdout: string;
  /** Populated instead of `stdout` when `binaryStdout` was set. */
  stdoutBuffer: Buffer | null;
  stderr: string;
  code: number | null;
  /** Set when the process was killed for exceeding `timeoutMs`. */
  timedOut: boolean;
  /** Set when the caller's AbortSignal ended it. Not a failure. */
  cancelled: boolean;
  /** Set when either stream exceeded `maxOutputBytes` and was truncated. */
  truncated: boolean;
  /** Spawn-level failure, such as the executable not being on PATH. */
  spawnError: Error | null;
}

/**
 * Accumulates a stream as text, decoding across chunk boundaries and stopping
 * at a byte cap.
 */
class OutputCollector {
  private readonly decoder = new StringDecoder('utf8');
  private readonly parts: string[] = [];
  private bytes = 0;
  private capped = false;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    if (this.capped) {
      return;
    }

    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      this.capped = true;
      this.parts.push(this.decoder.end());
      return;
    }

    this.parts.push(this.decoder.write(chunk));
  }

  get truncated(): boolean {
    return this.capped;
  }

  finish(): string {
    if (!this.capped) {
      this.parts.push(this.decoder.end());
    }
    return this.parts.join('');
  }
}

/**
 * Runs a command to completion. Never rejects: the result carries the exit
 * code, a spawn error, and the timeout and truncation flags, and callers
 * decide what counts as failure.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      shell: false,
      windowsHide: true
    };
    if (options.cwd !== undefined) {
      spawnOptions.cwd = options.cwd;
    }
    if (options.env !== undefined) {
      spawnOptions.env = options.env;
    }

    const child = spawn(command, [...args], spawnOptions);

    const out = new OutputCollector(maxOutputBytes);
    const err = new OutputCollector(maxOutputBytes);
    const rawChunks: Buffer[] = [];
    let rawBytes = 0;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const onAbort = (): void => {
      cancelled = true;
      child.kill();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        // Already cancelled before the process was spawned. Kill it rather
        // than letting the work run to completion unwatched.
        queueMicrotask(onAbort);
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const settle = (code: number | null, spawnError: Error | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);

      resolve({
        stdout: options.binaryStdout === true ? '' : out.finish(),
        stdoutBuffer: options.binaryStdout === true ? Buffer.concat(rawChunks) : null,
        stderr: err.finish(),
        code,
        timedOut,
        cancelled,
        truncated: out.truncated || err.truncated || rawBytes > maxOutputBytes,
        spawnError
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (options.binaryStdout === true) {
        rawBytes += chunk.length;
        if (rawBytes <= maxOutputBytes) {
          rawChunks.push(chunk);
        }
        return;
      }
      out.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));

    child.on('error', (error: Error) => settle(null, error));
    child.on('close', (code) => settle(code, null));

    if (child.stdin) {
      if (options.input !== undefined) {
        // EPIPE here means the child exited before reading it all, which its
        // exit code already describes better than a write error would.
        child.stdin.on('error', () => {});
        child.stdin.write(options.input);
      }
      child.stdin.end();
    }
  });
}
