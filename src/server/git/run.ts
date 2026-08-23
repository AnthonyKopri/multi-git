// Runs git, always as an argument vector with no shell involved.
//
// Every invocation is recorded to the Terminal Log from here, which is the one
// place that knows what actually ran. The renderer used to compose those lines
// from intent, so they read like git commands without being any -- elided key
// paths, missing the `-c core.longpaths=true` a Windows rebase really carries,
// and impossible to copy and run. Recording at the point of execution is the
// only way the log can be trusted, which for this application is the point of
// having one.
import { DEFAULT_TIMEOUT_MS, runProcess } from '../process/run';
import { sshCommandPrefix } from '../ssh/openssh-path';
import { gitCommandKind } from './command-kind';
import { appendLog } from '../logs';
import type { LogCommand } from '../logs';

export interface GitResult {
  stdout: string;
  /** Set only when the caller asked for raw bytes. */
  stdoutBuffer?: Buffer | null;
  stderr: string;
}

/**
 * A failed git invocation.
 *
 * The previous code rejected with a bare object literal — `reject({ error,
 * stdout, stderr })` — which is not an Error, carries no stack, and forced
 * every route to write `err.stderr || err.error?.message || '...'` by hand.
 * A real Error subclass lets one error middleware answer them all.
 */
export class GitError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  /** HTTP status the error middleware should use. */
  readonly statusCode: number;

  constructor(
    message: string,
    details: { stdout?: string; stderr?: string; exitCode?: number | null; statusCode?: number } = {}
  ) {
    super(message);
    this.name = 'GitError';
    this.stdout = details.stdout ?? '';
    this.stderr = details.stderr ?? '';
    this.exitCode = details.exitCode ?? null;
    this.statusCode = details.statusCode ?? 500;
  }

  /**
   * The message worth showing a user. Git puts its diagnostics on stderr, so
   * that is preferred over the generic exit-code text.
   */
  get displayMessage(): string {
    return this.stderr.trim() || this.stdout.trim() || this.message;
  }
}

export interface GitCommandOptions {
  /** Overrides merged over `process.env`. */
  envOverrides?: NodeJS.ProcessEnv | undefined;
  /** Replaces GIT_SSH_COMMAND entirely; wins over `sshKeyPath`. */
  customSshCommand?: string | undefined;
  timeoutMs?: number | undefined;
  /** Written to git's stdin. How a patch reaches `git apply`. */
  input?: string | Buffer | undefined;
  /** Kills git when it fires, so a long read can be stopped. */
  signal?: AbortSignal | undefined;
  /** Collects stdout as bytes. For `cat-file blob` and nothing else so far. */
  binaryStdout?: boolean | undefined;
}

/**
 * Builds the GIT_SSH_COMMAND that pins a single identity.
 *
 * IdentitiesOnly stops ssh from offering every key in the agent, which is what
 * makes per-repository account selection work at all.
 */
export function buildSshCommand(sshKeyPath: string, singlePasswordPrompt = false): string {
  const normalized = sshKeyPath.replace(/\\/g, '/');
  const options = [
    // Named rather than left to PATH: on Windows a bare `ssh` often resolves
    // to the MSYS build inside Git for Windows, which cannot see the agent
    // this app loads keys into, and so asks for the passphrase of a key that
    // is already unlocked and sitting in it.
    `${sshCommandPrefix()} -i "${normalized}"`,
    '-o IdentitiesOnly=yes',
    '-o StrictHostKeyChecking=accept-new'
  ];

  if (singlePasswordPrompt) {
    options.push('-o NumberOfPasswordPrompts=1');
  }

  return options.join(' ');
}

/**
 * Environment keys this application sets, and therefore the only ones worth
 * showing back.
 *
 * The inherited environment is the user's own; repeating it would be noise at
 * best. These four are what the app adds on your behalf, and they are exactly
 * what you want to see when authentication misbehaves -- which key was pinned,
 * and whether the askpass bridge was in play.
 */
const LOGGED_ENV_KEYS = ['GIT_SSH_COMMAND', 'SSH_ASKPASS', 'GIT_ASKPASS', 'GIT_TERMINAL_PROMPT'];

/** The environment the app added, if any of it. */
function addedEnv(env: NodeJS.ProcessEnv): Record<string, string> | undefined {
  const added: Record<string, string> = {};

  for (const key of LOGGED_ENV_KEYS) {
    const value = env[key];
    // Only when this run differs from the ambient environment: a GIT_ASKPASS
    // the user exported themselves is not something this application did.
    if (typeof value === 'string' && value !== '' && value !== process.env[key]) {
      added[key] = value;
    }
  }

  return Object.keys(added).length === 0 ? undefined : added;
}

/**
 * Writes one invocation to the log.
 *
 * Never throws and never awaits: logging must not fail, delay, or change the
 * command it describes.
 */
function recordCommand(
  repoPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  outcome: { durationMs: number; exitCode?: number }
): void {
  try {
    const command: LogCommand = {
      argv: ['git', ...args],
      cwd: repoPath,
      kind: gitCommandKind(args),
      ...outcome
    };

    const added = addedEnv(env);
    if (added) {
      command.env = added;
    }

    appendLog({
      // The text is the readable form; `command` carries the parts a reader
      // needs to copy or filter by.
      text: `git ${args.join(' ')}`,
      type: outcome.exitCode === 0 ? 'cmd' : 'error',
      repoPath,
      command
    });
  } catch {
    // A log that cannot be written is not a reason for a git command to fail.
  }
}


/** Runs a git command, rejecting with a GitError on any non-zero exit. */
export async function runGitCommand(
  repoPath: string,
  args: readonly string[],
  sshKeyPath: string | null = null,
  options: GitCommandOptions = {}
): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(options.envOverrides ?? {}) };

  if (options.customSshCommand) {
    env['GIT_SSH_COMMAND'] = options.customSshCommand;
  } else if (sshKeyPath) {
    env['GIT_SSH_COMMAND'] = buildSshCommand(sshKeyPath);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const subcommand = args[0] ?? 'git';
  const startedAt = Date.now();

  const result = await runProcess('git', args, {
    cwd: repoPath,
    env,
    timeoutMs,
    input: options.input,
    signal: options.signal,
    binaryStdout: options.binaryStdout
  });

  recordCommand(repoPath, args, env, {
    durationMs: Date.now() - startedAt,
    ...(result.code === null ? {} : { exitCode: result.code })
  });

  if (result.spawnError) {
    // The overwhelmingly common cause is git not being installed or not on the
    // PATH that desktop applications inherit.
    throw new GitError(`Failed to run git: ${result.spawnError.message}`, {
      stdout: result.stdout,
      stderr: result.stderr
    });
  }

  if (result.cancelled) {
    // The user asked for this. It is an outcome, not a fault, and it is
    // distinguished from a timeout so the UI does not apologise for it.
    throw new GitError('The operation was cancelled.', {
      stdout: result.stdout,
      stderr: result.stderr,
      statusCode: 499
    });
  }

  if (result.timedOut) {
    const seconds = Math.round(timeoutMs / 1000);
    const message = `git ${subcommand} timed out after ${seconds}s`;
    throw new GitError(message, {
      stdout: result.stdout,
      stderr: result.stderr || message,
      statusCode: 504
    });
  }

  if (result.code !== 0) {
    throw new GitError(`git exited with code ${result.code}`, {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code
    });
  }

  return { stdout: result.stdout, stdoutBuffer: result.stdoutBuffer, stderr: result.stderr };
}

/**
 * Runs a git command and resolves to null instead of throwing.
 * For queries whose failure is a normal state, such as asking for the origin
 * URL in a repository that has no remote.
 */
export async function tryGitCommand(
  repoPath: string,
  args: readonly string[]
): Promise<GitResult | null> {
  try {
    return await runGitCommand(repoPath, args);
  } catch {
    return null;
  }
}
