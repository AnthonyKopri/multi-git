// Telling a program that makes its own window from one that needs a console.
//
// This is what decides whether a visible Windows launch pays for the PowerShell
// bridge, so it is worth being exact about in both directions: a GUI program
// misread as a console one is a needless 0.8s pause, and a console program
// misread as a GUI one is issue #46 back again -- a window that never opens and
// no error to say why. Everything that is not a definite answer therefore has
// to read as `unknown`, which the launcher treats as "use the bridge".
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HEADER_PROBE_BYTES,
  PE_SUBSYSTEM,
  executableCandidates,
  launchTargetKind,
  needsConsoleBridge,
  peSubsystem
} from '../src/server/process/windows-subsystem';
import { cleanupRepos, createTempDir } from './helpers/temp-repo';

/**
 * App execution aliases, by path, and the program each one starts.
 *
 * A real alias is a reparse point that only a Store app's registration writes,
 * so the tests about the logic stand one in: opening it fails, as it does on
 * Windows, and reading it as a link names its program. Every other path goes
 * to the real filesystem untouched. The real aliases are read further down,
 * on a machine that has them.
 */
const aliases = vi.hoisted(() => new Map<string, string>());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...actual,
    open: (file: string, flags?: string) =>
      aliases.has(file)
        ? Promise.reject(Object.assign(new Error(`EACCES: open '${file}'`), { code: 'EACCES' }))
        : actual.open(file, flags),
    readlink: (file: string) => {
      const target = aliases.get(file);
      return target === undefined ? actual.readlink(file) : Promise.resolve(target);
    }
  };
});

afterEach(() => {
  aliases.clear();
  cleanupRepos();
});

/**
 * A PE file with nothing in it but the fields this reads.
 *
 * `peAt` is where the DOS header says the PE header starts. Real linkers put it
 * just past the DOS stub; it is a parameter here so the out-of-range cases can
 * be stated.
 */
function fakePeFile(
  subsystem: number,
  { peAt = 128, magic = 0x20b, size = 512 }: { peAt?: number; magic?: number; size?: number } = {}
): Buffer {
  const file = Buffer.alloc(size);
  file.writeUInt16LE(0x5a4d, 0); // 'MZ'
  file.writeUInt32LE(peAt, 0x3c);

  if (peAt + 96 <= size) {
    file.writeUInt32LE(0x00004550, peAt); // 'PE\0\0'
    file.writeUInt16LE(magic, peAt + 24);
    file.writeUInt16LE(subsystem, peAt + 24 + 68);
  }

  return file;
}

describe('peSubsystem', () => {
  it('reads the subsystem out of a 64-bit executable', () => {
    expect(peSubsystem(fakePeFile(PE_SUBSYSTEM.console))).toBe(3);
    expect(peSubsystem(fakePeFile(PE_SUBSYSTEM.gui))).toBe(2);
  });

  it('reads a 32-bit executable from the same offset', () => {
    // PE32+ widens ImageBase to eight bytes and drops BaseOfData, so the two
    // layouts agree from SectionAlignment onwards -- Subsystem included.
    expect(peSubsystem(fakePeFile(PE_SUBSYSTEM.console, { magic: 0x10b }))).toBe(3);
    expect(peSubsystem(fakePeFile(PE_SUBSYSTEM.gui, { magic: 0x10b }))).toBe(2);
  });

  it('finds the header wherever the DOS stub put it', () => {
    expect(peSubsystem(fakePeFile(PE_SUBSYSTEM.gui, { peAt: 296, size: 1024 }))).toBe(2);
  });

  it('is null for something that is not an executable', () => {
    expect(peSubsystem(Buffer.from('@echo off\r\nnode cli.js %*\r\n'))).toBeNull();
    expect(peSubsystem(Buffer.alloc(0))).toBeNull();
    expect(peSubsystem(Buffer.from('#!/bin/sh\n'))).toBeNull();
  });

  it('is null when the file is cut off before the header', () => {
    expect(peSubsystem(fakePeFile(PE_SUBSYSTEM.gui).subarray(0, 100))).toBeNull();
    expect(peSubsystem(Buffer.from([0x4d, 0x5a]))).toBeNull();
  });

  it('is null, and does not throw, for a header offset that points nowhere', () => {
    // A malformed or hostile file can claim any 32-bit offset it likes. The
    // bounds check has to come before the reads rather than after them.
    const wild = Buffer.alloc(512);
    wild.writeUInt16LE(0x5a4d, 0);
    wild.writeUInt32LE(0xffffffff, 0x3c);
    expect(peSubsystem(wild)).toBeNull();

    const justPast = fakePeFile(PE_SUBSYSTEM.gui, { peAt: 500, size: 512 });
    expect(peSubsystem(justPast)).toBeNull();
  });

  it('is null when the optional header is a kind this does not know', () => {
    // 0x107 is a ROM image. Nothing this launches is one, and guessing at the
    // layout of a header this has never seen is how a wrong answer happens.
    expect(peSubsystem(fakePeFile(PE_SUBSYSTEM.gui, { magic: 0x107 }))).toBeNull();
  });
});

describe('executableCandidates', () => {
  const env = { PATH: 'C:\\Windows;C:\\tools', PATHEXT: '.COM;.EXE;.CMD' };

  it('tries every extension in every directory, in the order Windows would', () => {
    expect(executableCandidates('code', env)).toEqual([
      'C:\\Windows\\code.COM',
      'C:\\Windows\\code.EXE',
      'C:\\Windows\\code.CMD',
      'C:\\tools\\code.COM',
      'C:\\tools\\code.EXE',
      'C:\\tools\\code.CMD'
    ]);
  });

  it('takes a name that already has an extension at its word', () => {
    expect(executableCandidates('wt.exe', env)).toEqual(['C:\\Windows\\wt.exe', 'C:\\tools\\wt.exe']);
  });

  it('does not search PATH for a name with a directory in it', () => {
    expect(executableCandidates('C:\\Program Files\\Git\\git-bash.exe', env)).toEqual([
      'C:\\Program Files\\Git\\git-bash.exe'
    ]);
    expect(executableCandidates('.\\tool.exe', env)).toEqual(['.\\tool.exe']);
  });

  it('ignores the empty entries a trailing semicolon leaves, and quoted ones', () => {
    expect(executableCandidates('git.exe', { PATH: '"C:\\a b";;C:\\c;', PATHEXT: '.EXE' })).toEqual([
      'C:\\a b\\git.exe',
      'C:\\c\\git.exe'
    ]);
  });

  it('reads PATH whichever way this process spells it', () => {
    // Windows folds the case; Node's copy of the environment does not, and
    // which spelling a process carries is not something to depend on.
    expect(executableCandidates('git.exe', { Path: 'C:\\a' })).toEqual(['C:\\a\\git.exe']);
  });

  it('falls back to the default PATHEXT when nothing set one', () => {
    expect(executableCandidates('git', { PATH: 'C:\\a' })).toEqual([
      'C:\\a\\git.COM',
      'C:\\a\\git.EXE',
      'C:\\a\\git.BAT',
      'C:\\a\\git.CMD'
    ]);
  });

  it('has nothing to try for an empty name', () => {
    expect(executableCandidates('', env)).toEqual([]);
  });
});

/** A file of stated content, named by its full path. */
function write(name: string, contents: Buffer | string): string {
  const file = path.join(createTempDir(), name);
  fs.writeFileSync(file, contents);
  return file;
}

// Naming a file by its full path is the half of this that reads the same on
// any host, so it carries the cases that are really about the header. The PATH
// search below cannot be: a PATH entry is joined to a name with a backslash,
// which is right on Windows and is one unopenable filename on Linux.
describe('launchTargetKind, by full path', () => {
  it('reads a program by what its header says it is', async () => {
    expect(await launchTargetKind(write('winmergeu.exe', fakePeFile(PE_SUBSYSTEM.gui)), {})).toBe(
      'gui'
    );
    expect(await launchTargetKind(write('gh.exe', fakePeFile(PE_SUBSYSTEM.console)), {})).toBe(
      'console'
    );
  });

  it('is unknown for a batch shim, which really does need a console', async () => {
    // `code` on Windows is `code.cmd`. It runs under cmd.exe, so it has exactly
    // the problem the bridge exists for, and reading it as unknown is right.
    expect(await launchTargetKind(write('code.cmd', '@echo off\r\nnode cli.js %*\r\n'), {})).toBe(
      'unknown'
    );
  });

  it('is unknown for a name that is not there', async () => {
    expect(await launchTargetKind(path.join(createTempDir(), 'nope.exe'), {})).toBe('unknown');
  });

  it('is unknown for a directory, and does not throw', async () => {
    const directory = path.join(createTempDir(), 'tool.exe');
    fs.mkdirSync(directory);

    expect(await launchTargetKind(directory, {})).toBe('unknown');
  });

  it('is unknown for a file too short to hold a header', async () => {
    expect(await launchTargetKind(write('stub.exe', Buffer.from([0x4d, 0x5a])), {})).toBe('unknown');
  });

  it('reads only the head of a large file', async () => {
    const big = Buffer.concat([
      fakePeFile(PE_SUBSYSTEM.gui),
      Buffer.alloc(HEADER_PROBE_BYTES * 4, 0x41)
    ]);

    expect(await launchTargetKind(write('big.exe', big), {})).toBe('gui');
  });
});

describe('launchTargetKind, through an app execution alias', () => {
  /** An alias named `name` that starts `target`. */
  function alias(name: string, target: string): string {
    const file = path.join(createTempDir(), name);
    aliases.set(file, target);
    return file;
  }

  it('reads the program the alias starts', async () => {
    // Windows Terminal: `wt.exe` on PATH is an alias for a program that makes
    // its own window, and this is the launch that used to pay for the bridge.
    const terminal = write('wt.exe', fakePeFile(PE_SUBSYSTEM.gui));

    expect(await launchTargetKind(alias('wt.exe', terminal), {})).toBe('gui');
    expect(await needsConsoleBridge(alias('wt.exe', terminal), {})).toBe(false);
  });

  it('still reads a console program behind an alias as one', async () => {
    // winget is an alias as well. Reading it as windowed would be the Install
    // button that opened nothing, back again.
    const winget = write('winget.exe', fakePeFile(PE_SUBSYSTEM.console));

    expect(await launchTargetKind(alias('winget.exe', winget), {})).toBe('console');
    expect(await needsConsoleBridge(alias('winget.exe', winget), {})).toBe(true);
  });

  it("does not expect the program to share the alias's name", async () => {
    // `bash.exe` starts WSL's `wsl.exe`. The alias names the file Windows
    // runs, so there is nothing to cross-check the name against.
    const wsl = write('wsl.exe', fakePeFile(PE_SUBSYSTEM.console));

    expect(await launchTargetKind(alias('bash.exe', wsl), {})).toBe('console');
  });

  it('is unknown when the program it starts cannot be read', async () => {
    expect(await launchTargetKind(alias('wt.exe', path.join(createTempDir(), 'gone.exe')), {})).toBe(
      'unknown'
    );
  });

  it.skipIf(process.platform !== 'win32')(
    'stops at an alias on PATH rather than reading past it',
    async () => {
      // The alias is what Windows would run, so a same-named program further
      // down PATH says nothing about this launch.
      const first = createTempDir();
      const second = createTempDir();
      aliases.set(path.join(first, 'tool.exe'), path.join(first, 'gone.exe'));
      fs.writeFileSync(path.join(second, 'tool.exe'), fakePeFile(PE_SUBSYSTEM.gui));

      expect(await launchTargetKind('tool.exe', { PATH: `${first};${second}` })).toBe('unknown');
    }
  );
});

describe('needsConsoleBridge', () => {
  it('is false only for a program confirmed to make its own window', async () => {
    expect(await needsConsoleBridge(write('gui.exe', fakePeFile(PE_SUBSYSTEM.gui)), {})).toBe(false);
    expect(await needsConsoleBridge(write('cli.exe', fakePeFile(PE_SUBSYSTEM.console)), {})).toBe(
      true
    );
    expect(await needsConsoleBridge(path.join(createTempDir(), 'missing.exe'), {})).toBe(true);
  });
});

// Finding a bare name means joining a PATH entry to it the way Windows does,
// so these can only be run where that produces a path the host can open. The
// order they rely on is stated platform-independently in `executableCandidates`
// above; what is left to check here is that the file at the end of it is read.
describe.skipIf(process.platform !== 'win32')('launchTargetKind, through PATH', () => {
  it('finds a bare name on PATH', async () => {
    const directory = createTempDir();
    fs.writeFileSync(path.join(directory, 'winmergeu.exe'), fakePeFile(PE_SUBSYSTEM.gui));

    expect(await launchTargetKind('winmergeu', { PATH: directory, PATHEXT: '.EXE' })).toBe('gui');
    expect(await needsConsoleBridge('winmergeu', { PATH: directory, PATHEXT: '.EXE' })).toBe(false);
  });

  it('takes the extension PATHEXT reaches first', async () => {
    // `code` resolves to `code.cmd` rather than to nothing, and a shim is not
    // something this can read -- which is the answer that keeps it bridged.
    const directory = createTempDir();
    fs.writeFileSync(path.join(directory, 'code.cmd'), '@echo off\r\n');

    expect(await launchTargetKind('code', { PATH: directory, PATHEXT: '.EXE;.CMD' })).toBe(
      'unknown'
    );
  });

  it('stops at the first file that is there, rather than reading past it', async () => {
    // Otherwise a shim early on PATH would be described by a same-named
    // executable further down it, which is not the program that would run.
    const first = createTempDir();
    const second = createTempDir();
    fs.writeFileSync(path.join(first, 'tool.cmd'), '@echo off\r\n');
    fs.writeFileSync(path.join(second, 'tool.exe'), fakePeFile(PE_SUBSYSTEM.gui));

    expect(await launchTargetKind('tool', { PATH: `${first};${second}`, PATHEXT: '.EXE;.CMD' })).toBe(
      'unknown'
    );
  });

  it('is unknown for a name that is not installed', async () => {
    expect(await launchTargetKind('nope.exe', { PATH: createTempDir() })).toBe('unknown');
    expect(await launchTargetKind('nope.exe', { PATH: '' })).toBe('unknown');
  });
});

describe('against the real Windows binaries', () => {
  // The synthetic headers above prove the parser reads what this test wrote.
  // These prove it reads what a linker wrote, which is the claim that matters.
  const onWindows = process.platform === 'win32';

  it.skipIf(!onWindows)('reads powershell.exe as a console program', async () => {
    expect(await launchTargetKind('powershell.exe')).toBe('console');
    expect(await needsConsoleBridge('powershell.exe')).toBe(true);
  });

  it.skipIf(!onWindows)('reads explorer.exe as a windowed program', async () => {
    expect(await launchTargetKind('explorer.exe')).toBe('gui');
    expect(await needsConsoleBridge('explorer.exe')).toBe(false);
  });

  // A Store app's alias, where this machine has one -- a runner image may not.
  // Named by full path, so the answer is about the alias and not about
  // whichever same-named program PATH happens to reach first.
  function storeAlias(name: string): string | null {
    if (!onWindows) {
      return null;
    }

    const file = path.join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'WindowsApps', name);
    try {
      return fs.lstatSync(file).isSymbolicLink() ? file : null;
    } catch {
      return null;
    }
  }

  const terminal = storeAlias('wt.exe');
  const winget = storeAlias('winget.exe');

  it.skipIf(terminal === null)('reads the Windows Terminal alias as a windowed program', async () => {
    expect(await launchTargetKind(terminal ?? '', {})).toBe('gui');
  });

  it.skipIf(winget === null)('reads the winget alias as a console program', async () => {
    expect(await launchTargetKind(winget ?? '', {})).toBe('console');
  });
});
