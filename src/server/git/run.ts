// Runs git, always as an argument vector with no shell involved.
import { DEFAULT_TIMEOUT_MS, runProcess } from '../process/run';
import { sshCommandPrefix } from '../ssh/openssh-path';

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

  const result = await runProcess('git', args, {
    cwd: repoPath,
    env,
    timeoutMs,
    input: options.input,
    signal: options.signal,
    binaryStdout: options.binaryStdout
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
