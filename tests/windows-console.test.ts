// Quoting a command line the way Windows reads it back.
//
// This matters twice over. It is a correctness question -- `--cd=C:\Program
// Files\repo` must arrive as one argument, and a path ending in a backslash
// must not corrupt everything quoted after it -- and it is the reason the
// launch travels as environment rather than as text inside the bridge script.
// Nothing a user can name reaches a string PowerShell parses.
import { describe, expect, it } from 'vitest';

import {
  CONSOLE_BRIDGE_ENV,
  NEW_CONSOLE_BRIDGE_SCRIPT,
  consoleBridgeEnv,
  parseBridgePid,
  quoteWindowsArgument,
  quoteWindowsCommandLine
} from '../src/server/process/windows-console';

describe('quoteWindowsArgument', () => {
  it('leaves an ordinary argument alone', () => {
    expect(quoteWindowsArgument('--resume')).toBe('--resume');
    expect(quoteWindowsArgument('C:\\Users\\me\\repo')).toBe('C:\\Users\\me\\repo');
  });

  it('quotes an argument containing a space', () => {
    expect(quoteWindowsArgument('has space')).toBe('"has space"');
    expect(quoteWindowsArgument('--cd=C:\\Program Files\\repo')).toBe(
      '"--cd=C:\\Program Files\\repo"'
    );
  });

  it('quotes the empty argument, which would otherwise vanish', () => {
    expect(quoteWindowsArgument('')).toBe('""');
  });

  it('escapes an embedded quote', () => {
    expect(quoteWindowsArgument('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('doubles a trailing backslash run so it cannot escape the closing quote', () => {
    // The case that silently corrupts the argument *after* it: `"C:\dir\"`
    // reads as an unterminated quote, so the next argument joins this one.
    expect(quoteWindowsArgument('C:\\dir with space\\')).toBe('"C:\\dir with space\\\\"');
  });

  it('leaves backslashes that precede no quote exactly as they are', () => {
    expect(quoteWindowsArgument('a\\\\b c')).toBe('"a\\\\b c"');
  });

  it('doubles the run in front of an embedded quote', () => {
    expect(quoteWindowsArgument('a\\"b c')).toBe('"a\\\\\\"b c"');
  });

  it('does not treat shell metacharacters as anything special', () => {
    // No shell is involved: CreateProcess splits on whitespace and quotes, and
    // nothing else. An ampersand is an ordinary character.
    expect(quoteWindowsArgument('a&b|c>d')).toBe('a&b|c>d');
    expect(quoteWindowsArgument('a & b')).toBe('"a & b"');
  });
});

describe('quoteWindowsCommandLine', () => {
  it('joins the arguments with spaces', () => {
    expect(quoteWindowsCommandLine(['-d', 'C:\\work repo', '--'])).toBe(
      '-d "C:\\work repo" --'
    );
  });

  it('is empty for no arguments, so the bridge omits ArgumentList entirely', () => {
    expect(quoteWindowsCommandLine([])).toBe('');
  });
});

describe('the bridge script', () => {
  it('names environment variables and interpolates nothing', () => {
    // The property worth guarding: it is a constant. If a value ever had to be
    // built into it, a folder name or a prompt would become something
    // PowerShell parses.
    for (const name of Object.values(CONSOLE_BRIDGE_ENV)) {
      expect(NEW_CONSOLE_BRIDGE_SCRIPT).toContain(name);
    }

    expect(NEW_CONSOLE_BRIDGE_SCRIPT).toContain('Start-Process');
    expect(NEW_CONSOLE_BRIDGE_SCRIPT).toContain('PassThru');
  });

  it('unsets its own variables before starting anything', () => {
    // Otherwise every launched program inherits them.
    expect(NEW_CONSOLE_BRIDGE_SCRIPT).toMatch(/Remove-Item Env:.*Start-Process/s);
  });

  it('waits with a cmdlet, so a locked-down PowerShell can still do it', () => {
    // Managed Windows fleets commonly run PowerShell in Constrained Language
    // Mode, where property access is allowed and method calls are not. Measured
    // there: Start-Process and $started.Id work, $started.WaitForExit() fails
    // with "Method invocation is supported only on core types in this language
    // mode" -- and with $ErrorActionPreference='Stop' that ends the script, so
    // the bridge exits at once and a merge tool's temporary inputs are deleted
    // while it still has them open. Wait-Process is a cmdlet, so it is allowed.
    expect(NEW_CONSOLE_BRIDGE_SCRIPT).toContain('Wait-Process');
    expect(NEW_CONSOLE_BRIDGE_SCRIPT).not.toContain('WaitForExit');

    // Not `-Wait` on Start-Process either: that holds the id back until the
    // program exits, and the id is what says it started at all.
    expect(NEW_CONSOLE_BRIDGE_SCRIPT).toMatch(/Write-Output.*MG_PID.*Wait-Process/s);
  });
});

describe('consoleBridgeEnv', () => {
  it('carries the launch as values, on top of the caller’s environment', () => {
    const env = consoleBridgeEnv({
      executable: 'winget',
      args: ['install', '--id', 'GitHub.cli', '-e'],
      cwd: 'C:\\Users\\me',
      env: { PATH: 'C:\\Windows', GIT_SSH_COMMAND: 'ssh -i key' }
    });

    expect(env[CONSOLE_BRIDGE_ENV.executable]).toBe('winget');
    expect(env[CONSOLE_BRIDGE_ENV.commandLine]).toBe('install --id GitHub.cli -e');
    expect(env[CONSOLE_BRIDGE_ENV.cwd]).toBe('C:\\Users\\me');
    expect(env[CONSOLE_BRIDGE_ENV.wait]).toBe('0');

    // The environment the launch was meant to carry survives.
    expect(env['PATH']).toBe('C:\\Windows');
    expect(env['GIT_SSH_COMMAND']).toBe('ssh -i key');
  });

  it('asks the bridge to wait only when the caller needs to know it finished', () => {
    const waiting = consoleBridgeEnv({ executable: 'kdiff3', args: [], wait: true });
    expect(waiting[CONSOLE_BRIDGE_ENV.wait]).toBe('1');
  });
});

describe('parseBridgePid', () => {
  it('reads the id the bridge printed', () => {
    expect(parseBridgePid('MG_PID=4242\n')).toBe(4242);
  });

  it('is null when nothing was printed, which means nothing started', () => {
    expect(parseBridgePid('')).toBeNull();
    expect(parseBridgePid('Start-Process : This command cannot be run')).toBeNull();
  });

  it('ignores a line that is not a usable id', () => {
    expect(parseBridgePid('MG_PID=notanumber')).toBeNull();
  });
});
