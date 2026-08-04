// A scripted ExecutableRunner, so SSH tests need no agent, no keys, and no
// network — and can assert on the exact argv and environment that would have
// been used.
import {
  CommandFailedError,
  CommandSpawnError
} from '../../src/server/process/runner';
import type { CommandResult, ExecutableRunner, RunOptions } from '../../src/server/process/runner';

export interface RecordedCall {
  executable: string;
  args: string[];
  options: RunOptions;
}

export interface ScriptedResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** Simulates the executable not being installed. */
  spawnError?: boolean;
}

type Matcher = (executable: string, args: readonly string[]) => boolean;

interface Rule {
  matches: Matcher;
  respond: ScriptedResponse | ((call: RecordedCall) => ScriptedResponse);
}

/**
 * Matches on the executable plus a subsequence of its arguments, so a rule
 * stays readable and does not break when an unrelated flag is added.
 */
export function command(executable: string, ...argContains: string[]): Matcher {
  return (candidate, args) =>
    candidate.endsWith(executable) && argContains.every((needle) => args.includes(needle));
}

export class FakeRunner implements ExecutableRunner {
  readonly calls: RecordedCall[] = [];
  private readonly rules: Rule[] = [];
  private fallback: ScriptedResponse = { exitCode: 0 };

  /** Adds a rule. Later rules win, so a test can override a shared default. */
  on(matches: Matcher, respond: Rule['respond']): this {
    this.rules.unshift({ matches, respond });
    return this;
  }

  otherwise(respond: ScriptedResponse): this {
    this.fallback = respond;
    return this;
  }

  /** Every call made to `executable`, in order. */
  callsTo(executable: string): RecordedCall[] {
    return this.calls.filter((call) => call.executable.endsWith(executable));
  }

  /**
   * Everything that would actually reach a child process, flattened.
   *
   * Deliberately excludes `redact`: that option is the list of secrets the
   * runner scrubs *with*, so of course it contains them. Including it here
   * would make a leak assertion fail on the very mechanism that prevents
   * leaks.
   */
  everythingSeen(): string {
    return JSON.stringify(
      this.calls.map((call) => ({
        executable: call.executable,
        args: call.args,
        cwd: call.options.cwd,
        env: call.options.env,
        input: call.options.input
      }))
    );
  }

  async run(
    executable: string,
    args: readonly string[],
    options: RunOptions = {}
  ): Promise<CommandResult> {
    const call: RecordedCall = { executable, args: [...args], options };
    this.calls.push(call);

    const rule = this.rules.find((candidate) => candidate.matches(executable, args));
    const scripted = rule
      ? typeof rule.respond === 'function'
        ? rule.respond(call)
        : rule.respond
      : this.fallback;

    if (scripted.spawnError) {
      throw new CommandSpawnError(executable, new Error('ENOENT'));
    }

    const result: CommandResult = {
      executable,
      args: [...args],
      exitCode: scripted.exitCode ?? 0,
      stdout: scripted.stdout ?? '',
      stderr: scripted.stderr ?? '',
      durationMs: 1,
      cancelled: false,
      truncated: false
    };

    // Mirrors the real runner: a disallowed non-zero exit rejects, so callers
    // are exercised against the same contract in tests as in production.
    const allowed = options.allowNonZero ?? [];
    if (result.exitCode !== 0 && !allowed.includes(result.exitCode)) {
      throw new CommandFailedError(result);
    }

    return result;
  }
}
