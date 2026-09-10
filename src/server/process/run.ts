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

import { killProcessTree, TREE_KILLABLE_SPAWN_OPTIONS } from './kill-tree';

/** 64 MiB. Larger than any diff a human reads, small enough to stay safe. */
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How long to wait for the streams after the process itself has exited.
 *
 * `close` fires when the child has exited *and* its stdio has ended, and those
 * are not the same event. A child that leaves a detached grandchild holding the
 * inherited pipes -- `gpg` starting `gpg-agent` is the case that prompted this
 * -- exits immediately while the pipes stay open for as long as the grandchild
 * lives. Waiting only for `close` means the promise never settles at all, which
 * makes `timeoutMs` unenforceable: the timer fires, the kill lands on a process
 * that has already gone, and the caller waits forever regardless.
 *
 * So `exit` starts a short grace for the last of the output to arrive, and the
 * result is returned with or without a `close`. Generous enough that an
 * ordinary drain is never cut short, and only ever paid when something really
 * is holding the pipes open.
 */
const STREAM_DRAIN_GRACE_MS = 1000;

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
      windowsHide: true,
      // Killing the direct child is not enough: `git push` spawns `ssh` and
      // `gpg` spawns `gpg-agent`, and a grandchild left holding the pipes is
      // exactly what stops this promise from settling.
      ...TREE_KILLABLE_SPAWN_OPTIONS
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
    let cancelEscalation: (() => void) | null = null;
    let drainTimer: NodeJS.Timeout | null = null;

    const terminate = (): void => {
      cancelEscalation?.();
      cancelEscalation = killProcessTree(child);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
      // The kill lands on the tree, but nothing guarantees a `close` follows:
      // whoever holds the pipes may not be reachable. The deadline the caller
      // asked for has to hold either way.
      startDrainGrace();
    }, timeoutMs);

    const onAbort = (): void => {
      cancelled = true;
      terminate();
      startDrainGrace();
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

    /**
     * Returns what has arrived so far once the streams have had their grace.
     *
     * Started from `exit`, and from a timeout or cancellation that may have
     * killed something already gone. Idempotent: the first of `close` and this
     * settles, and the other finds the promise already resolved.
     */
    function startDrainGrace(): void {
      if (settled || drainTimer !== null) {
        return;
      }

      drainTimer = setTimeout(() => settle(child.exitCode, null), STREAM_DRAIN_GRACE_MS);
      // Nothing should be held open purely to give up on a stream.
      drainTimer.unref?.();
    }

    const settle = (code: number | null, spawnError: Error | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (drainTimer !== null) {
        clearTimeout(drainTimer);
      }
      cancelEscalation?.();
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
    // The process is gone; the pipes may not be. `close` still wins when it
    // arrives, which it does first in every ordinary run.
    child.on('exit', () => startDrainGrace());

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
