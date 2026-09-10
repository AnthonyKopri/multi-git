// Noticing a tool installed after this application started.
//
// Issue #46, second half: the GitHub CLI was installed with winget, which
// succeeded, and "Check again" went on reporting it missing. Nothing was wrong
// with the detection -- a process inherits its environment once, and the
// installer's change to PATH lives in the registry and reaches only programs
// started afterwards.
import { describe, expect, it } from 'vitest';

import {
  expandEnvironmentStrings,
  parsePathFromRegistry,
  readRegistryPath,
  refreshPathFromRegistry
} from '../src/server/os/windows-path';
import { detectPrerequisites } from '../src/server/tools/prerequisites';
import { FakeRunner, command } from './helpers/fake-runner';
import { withPlatform } from './helpers/platform';

const USER_KEY = 'HKCU\\Environment';
const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';

/** `reg query` output, as reg.exe actually formats it. */
function regOutput(key: string, value: string): string {
  return `\r\n${key}\r\n    Path    REG_EXPAND_SZ    ${value}\r\n\r\n`;
}

describe('parsePathFromRegistry', () => {
  it('reads the value, spaces and all', () => {
    const output = regOutput(USER_KEY, 'C:\\Program Files\\GitHub CLI;C:\\tools');

    expect(parsePathFromRegistry(output)).toBe('C:\\Program Files\\GitHub CLI;C:\\tools');
  });

  it('reads a plain REG_SZ as well as an expandable one', () => {
    expect(parsePathFromRegistry('    Path    REG_SZ    C:\\tools')).toBe('C:\\tools');
  });

  it('is null when the value is not there', () => {
    expect(parsePathFromRegistry('ERROR: The system was unable to find the specified value.')).toBeNull();
    expect(parsePathFromRegistry('')).toBeNull();
  });
});

describe('expandEnvironmentStrings', () => {
  it('expands the names the registry stores unexpanded', () => {
    const expanded = expandEnvironmentStrings('%SystemRoot%\\system32;%ProgramFiles%\\Git\\cmd', {
      SystemRoot: 'C:\\Windows',
      ProgramFiles: 'C:\\Program Files'
    });

    expect(expanded).toBe('C:\\Windows\\system32;C:\\Program Files\\Git\\cmd');
  });

  it('matches a name whatever case it was written in', () => {
    // Windows treats these as one variable; Node's env object does not.
    expect(expandEnvironmentStrings('%SYSTEMROOT%\\x', { SystemRoot: 'C:\\Windows' })).toBe(
      'C:\\Windows\\x'
    );
  });

  it('leaves a name with nothing behind it exactly as written', () => {
    // Inventing an empty string here would quietly turn a real directory into
    // a broken one.
    expect(expandEnvironmentStrings('%NOT_SET%\\bin', {})).toBe('%NOT_SET%\\bin');
  });
});

describe('readRegistryPath', () => {
  it('reads both hives, machine first', async () => {
    const runner = new FakeRunner()
      .on(command('reg.exe', MACHINE_KEY), { stdout: regOutput(MACHINE_KEY, 'C:\\Windows') })
      .on(command('reg.exe', USER_KEY), { stdout: regOutput(USER_KEY, 'C:\\Users\\me\\bin') });

    const path = await withPlatform('win32', () => readRegistryPath(runner, {}));

    expect(path).toBe('C:\\Windows;C:\\Users\\me\\bin');
    expect(runner.callsTo('reg.exe')).toHaveLength(2);
  });

  it('carries on when one hive cannot be read', async () => {
    const runner = new FakeRunner()
      .on(command('reg.exe', MACHINE_KEY), { exitCode: 1 })
      .on(command('reg.exe', USER_KEY), { stdout: regOutput(USER_KEY, 'C:\\Users\\me\\bin') });

    expect(await withPlatform('win32', () => readRegistryPath(runner, {}))).toBe('C:\\Users\\me\\bin');
  });

  it('asks nothing at all off Windows', async () => {
    const runner = new FakeRunner();

    expect(await withPlatform('linux', () => readRegistryPath(runner, {}))).toBeNull();
    expect(runner.calls).toEqual([]);
  });
});

describe('refreshPathFromRegistry', () => {
  it('adds the directory a fresh install put on PATH', async () => {
    // Exactly the reported case: winget installed gh to Program Files and put
    // it on PATH, and this process, started earlier, had never heard of it.
    const runner = new FakeRunner()
      .on(command('reg.exe', MACHINE_KEY), {
        stdout: regOutput(MACHINE_KEY, 'C:\\Windows;C:\\Program Files\\GitHub CLI')
      })
      .on(command('reg.exe', USER_KEY), { stdout: regOutput(USER_KEY, '') });

    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' };
    const refresh = await withPlatform('win32', () => refreshPathFromRegistry(runner, env));

    expect(refresh.added).toEqual(['C:\\Program Files\\GitHub CLI']);
    expect(env['PATH']).toBe('C:\\Windows;C:\\Program Files\\GitHub CLI');
  });

  it('adds nothing when the registry says what the process already knows', async () => {
    const runner = new FakeRunner()
      .on(command('reg.exe', MACHINE_KEY), { stdout: regOutput(MACHINE_KEY, 'C:\\Windows') })
      .on(command('reg.exe', USER_KEY), { stdout: regOutput(USER_KEY, 'C:\\Windows\\') });

    const env: NodeJS.ProcessEnv = { PATH: 'C:\\windows' };
    const refresh = await withPlatform('win32', () => refreshPathFromRegistry(runner, env));

    // Same directory, differently cased and with a trailing separator.
    expect(refresh.added).toEqual([]);
    expect(env['PATH']).toBe('C:\\windows');
  });

  it('keeps entries this process has that the registry does not', async () => {
    // Replacing PATH wholesale would trade one stale environment for another.
    const runner = new FakeRunner()
      .on(command('reg.exe', MACHINE_KEY), { stdout: regOutput(MACHINE_KEY, 'C:\\Windows') })
      .on(command('reg.exe', USER_KEY), { stdout: regOutput(USER_KEY, '') });

    const env: NodeJS.ProcessEnv = { PATH: 'C:\\app-only;C:\\Windows' };
    await withPlatform('win32', () => refreshPathFromRegistry(runner, env));

    expect(env['PATH']).toContain('C:\\app-only');
  });

  it('leaves the environment alone off Windows', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const refresh = await withPlatform('linux', () => refreshPathFromRegistry(new FakeRunner(), env));

    expect(refresh).toEqual({ added: [], path: '/usr/bin' });
    expect(env['PATH']).toBe('/usr/bin');
  });
});

describe('detectPrerequisites', () => {
  it('looks again at PATH before deciding a tool is missing', async () => {
    // The whole point of the "Check again" button: it has to be able to reach a
    // different answer from the one it gave a moment ago.
    const runner = new FakeRunner()
      .on(command('reg.exe'), { stdout: regOutput(USER_KEY, 'C:\\Program Files\\GitHub CLI') })
      .on(command('git'), { stdout: 'git version 2.52.0' })
      .on(command('gh'), { stdout: 'gh version 2.63.2' })
      .on(command('winget'), { stdout: 'v1.9.0' });

    const report = await withPlatform('win32', () => detectPrerequisites(runner));

    expect(runner.callsTo('reg.exe').length).toBeGreaterThan(0);
    expect(report.tools.find((tool) => tool.id === 'git')?.installed).toBe(true);
  });
});
