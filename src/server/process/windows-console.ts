// Giving a Windows launch a console window of its own.
//
// The bug this exists for looked like nothing happening at all. Clicking
// "Install" on the setup screen reported "Installing GitHub CLI in a terminal
// window", and no terminal window ever appeared -- because Node's
// `detached: true` becomes `DETACHED_PROCESS` on Windows, and a console
// program started that way inherits no console and is given none. PowerShell,
// cmd, gh and every agent CLI simply exit. There is no error to report: the
// spawn succeeds, the process starts, and it is gone before it has anywhere to
// write.
//
// The three candidates, measured rather than assumed:
//
//   * `detached: true`             -- the program never runs at all.
//   * `detached: false`            -- it runs, with no console, so still
//                                     invisible from a windowless parent, which
//                                     is what an Electron main process is.
//   * `Start-Process` from a short
//     hidden PowerShell            -- a real console window, and a process that
//                                     outlives the shell that started it.
//
// So a visible launch that needs a console goes through a PowerShell that does
// nothing but call `Start-Process` and exit. Which launches those are is
// windows-subsystem.ts's question: a program that makes its own window never
// had this problem and does not come through here at all.
//
// The script below is a constant. It names four
// environment variables and interpolates nothing, so no executable path, no
// argument, no folder name and no prompt is ever part of a string PowerShell
// parses -- the same discipline as the launch bridge in agents/launch.ts, and
// for the same reason.
//
// The arguments are handed over as one pre-quoted command line rather than as
// an array. `Start-Process -ArgumentList` in Windows PowerShell 5.1 joins an
// array with spaces and quotes nothing, so `--cd=C:\Program Files\repo`
// arrives as two arguments and a path ending in a backslash corrupts the
// quoting after it. A command line built here with the rules the C runtime
// actually parses survives all of it.

/** The environment variables the bridge reads, and then removes. */
export const CONSOLE_BRIDGE_ENV = {
  executable: 'MG_CONSOLE_EXE',
  commandLine: 'MG_CONSOLE_ARGS',
  cwd: 'MG_CONSOLE_CWD',
  wait: 'MG_CONSOLE_WAIT'
} as const;

/** Printed by the bridge so the caller learns the real process id. */
export const CONSOLE_BRIDGE_PID_PREFIX = 'MG_PID=';

/**
 * The bridge itself: read four variables, unset them so they do not leak into
 * the launched program's environment, start it, say what its id is, and get out
 * of the way -- or wait, when the caller needs to know that it finished.
 *
 * The wait is `Wait-Process` rather than `$started.WaitForExit()` because
 * managed Windows fleets commonly run PowerShell in Constrained Language Mode,
 * where property access is allowed but method calls are not. Measured there:
 * `Start-Process` and `$started.Id` both work, `WaitForExit()` fails with
 * "Method invocation is supported only on core types in this language mode" --
 * which, with `$ErrorActionPreference='Stop'`, ends the script, so the bridge
 * exits immediately and the caller's `onExit` deletes a merge tool's temporary
 * inputs while it is still open. `Wait-Process` is a cmdlet, so it is allowed,
 * and it is a no-op when the process has already gone.
 *
 * Not `Start-Process -Wait`: that would hold the pid back until the program
 * exits, and the pid is what tells the caller it started at all.
 */
export const NEW_CONSOLE_BRIDGE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$exe=$env:MG_CONSOLE_EXE',
  '$line=$env:MG_CONSOLE_ARGS',
  '$dir=$env:MG_CONSOLE_CWD',
  '$wait=$env:MG_CONSOLE_WAIT',
  'Remove-Item Env:MG_CONSOLE_EXE,Env:MG_CONSOLE_ARGS,Env:MG_CONSOLE_CWD,Env:MG_CONSOLE_WAIT -ErrorAction SilentlyContinue',
  '$options=@{FilePath=$exe;PassThru=$true}',
  'if($line){$options.ArgumentList=$line}',
  'if($dir){$options.WorkingDirectory=$dir}',
  '$started=Start-Process @options',
  "Write-Output ('MG_PID=' + $started.Id)",
  "if($wait -eq '1'){Wait-Process -Id $started.Id -ErrorAction SilentlyContinue}"
].join(';');

/**
 * One argument, quoted the way `CommandLineToArgvW` reads it back.
 *
 * The rule that is easy to get wrong: a backslash is only an escape character
 * when it precedes a quote. So a run of backslashes is doubled before a quote
 * and before the closing quote, and left alone everywhere else -- which is why
 * `C:\Users\me\` needs care and `C:\Users\me` does not.
 */
export function quoteWindowsArgument(value: string): string {
  // Only a space, a tab or a quote can change how the argument is parsed.
  if (value !== '' && !/[ \t"]/.test(value)) {
    return value;
  }

  let quoted = '"';
  let backslashes = 0;

  for (const character of value) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }

    if (character === '"') {
      // Escape the run, then the quote itself.
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }

    quoted += '\\'.repeat(backslashes) + character;
    backslashes = 0;
  }

  // A trailing run would otherwise escape the closing quote.
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}

/** An argument vector as a command line the C runtime parses back unchanged. */
export function quoteWindowsCommandLine(args: readonly string[]): string {
  return args.map(quoteWindowsArgument).join(' ');
}

export interface ConsoleBridgeInput {
  executable: string;
  args: readonly string[];
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  /** Whether the bridge should stay alive until the program exits. */
  wait?: boolean | undefined;
}

/** The environment the bridge is spawned with. */
export function consoleBridgeEnv(input: ConsoleBridgeInput): NodeJS.ProcessEnv {
  return {
    ...(input.env ?? process.env),
    [CONSOLE_BRIDGE_ENV.executable]: input.executable,
    [CONSOLE_BRIDGE_ENV.commandLine]: quoteWindowsCommandLine(input.args),
    [CONSOLE_BRIDGE_ENV.cwd]: input.cwd ?? '',
    [CONSOLE_BRIDGE_ENV.wait]: input.wait === true ? '1' : '0'
  };
}

/** The process id the bridge reported, or null when it never got that far. */
export function parseBridgePid(output: string): number | null {
  const match = new RegExp(`${CONSOLE_BRIDGE_PID_PREFIX}(\\d+)`).exec(output);
  if (!match) {
    return null;
  }

  const pid = Number.parseInt(match[1] as string, 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}
