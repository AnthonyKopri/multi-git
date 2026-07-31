// Runs non-git executables, such as the GitHub CLI and ssh-keygen.
//
// Unlike runGitCommand this never throws: a missing binary is an expected,
// recoverable state ("gh is not installed, so the repository stayed local"),
// not an error the request should fail on.
import { runProcess } from '../process/run';

export interface ExternalResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** Human-readable reason the command did not run or did not finish. */
  error: string | null;
}

export interface ExternalOptions {
  cwd?: string | undefined;
  envOverrides?: NodeJS.ProcessEnv | undefined;
  timeoutMs?: number | undefined;
}

export async function runExternalCommand(
  command: string,
  args: readonly string[],
  options: ExternalOptions = {}
): Promise<ExternalResult> {
  const result = await runProcess(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.envOverrides ?? {}) },
    timeoutMs: options.timeoutMs ?? 60_000
  });

  if (result.spawnError) {
    return {
      ok: false,
      code: null,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.spawnError.message
    };
  }

  if (result.timedOut) {
    return {
      ok: false,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      error: `${command} timed out`
    };
  }

  return {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    error: null
  };
}
