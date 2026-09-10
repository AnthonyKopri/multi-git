// Deciding whether a Windows launch actually needs a console of its own.
//
// windows-console.ts explains why a visible launch goes through a hidden
// PowerShell: a console program spawned with `detached: true` is given no
// console and exits before it can write anything. What that fix did not
// distinguish is *which* programs have that problem.
//
// Only console-subsystem programs do. `wt.exe`, `git-bash.exe`, WinMerge and
// every other windowed program create their own window and were never affected;
// routing them through the bridge too costs about 0.8s of PowerShell startup on
// a launch that used to take 4ms, which is a visible pause on a button that had
// no bug to fix. Measured on Windows 11, starting `cmd.exe /c exit`:
//
//   direct detached spawn   8, 4, 4, 3, 3 ms           -> median 4ms
//   through the bridge      825, 803, 777, 779, 786 ms -> median 786ms
//
// Which kind a program is, is written in the file. Every Windows executable
// carries a PE header whose Subsystem field says whether Windows should give it
// a console (IMAGE_SUBSYSTEM_WINDOWS_CUI) or not (IMAGE_SUBSYSTEM_WINDOWS_GUI),
// and it is two bytes at a fixed place. So the question is answered by reading
// the target rather than by guessing from its name.
//
// The rule is deliberately one-sided: the fast path is taken only for a file
// this can open, parse, and see is a GUI program. Anything else -- a name that
// resolves to nothing, a `.cmd` shim, a Store execution alias that cannot be
// opened at all, a header this does not understand -- is unknown, and unknown
// keeps the bridge. Being slow for a program that did not need it is a pause;
// being direct for a program that did need it is the bug this all exists for.
import { open } from 'node:fs/promises';
import path from 'node:path';

/** The two Subsystem values that matter here, from the PE specification. */
export const PE_SUBSYSTEM = {
  gui: 2,
  console: 3
} as const;

/**
 * How much of the file to read.
 *
 * The header lives at an offset the file names in its first 64 bytes, and every
 * linker in practice puts it just past the DOS stub -- 120 to 300 bytes in the
 * binaries on a normal Windows install. 4 KiB is one page, covers that with
 * room to spare, and a file that puts it further away simply reads as unknown.
 */
export const HEADER_PROBE_BYTES = 4096;

const DOS_SIGNATURE = 0x5a4d; // 'MZ'
const PE_SIGNATURE = 0x00004550; // 'PE\0\0'
/** Where the DOS header records the offset of the PE header. */
const PE_OFFSET_FIELD = 0x3c;
/** The PE signature plus the 20-byte COFF file header, then the optional one. */
const OPTIONAL_HEADER_AT = 24;
/** Subsystem, from the start of the optional header. */
const SUBSYSTEM_AT = 68;
const PE32_MAGIC = 0x10b;
const PE32PLUS_MAGIC = 0x20b;

/**
 * The Subsystem field, or null when this is not a PE file worth trusting.
 *
 * Subsystem sits at the same place in both optional header layouts: PE32+
 * widens ImageBase to eight bytes but drops BaseOfData, so everything from
 * SectionAlignment onwards is where PE32 has it. Verified against
 * powershell.exe, cmd.exe, gh.exe, git.exe, node.exe and ssh.exe (all 3) and
 * notepad.exe, explorer.exe and git-bash.exe (all 2).
 */
export function peSubsystem(head: Buffer): number | null {
  if (head.length < PE_OFFSET_FIELD + 4 || head.readUInt16LE(0) !== DOS_SIGNATURE) {
    return null;
  }

  const peAt = head.readUInt32LE(PE_OFFSET_FIELD);
  const subsystemAt = peAt + OPTIONAL_HEADER_AT + SUBSYSTEM_AT;

  // Bounds first: `peAt` is whatever the file claims, and every read below is
  // inside the span this checks.
  if (subsystemAt + 2 > head.length) {
    return null;
  }

  if (head.readUInt32LE(peAt) !== PE_SIGNATURE) {
    return null;
  }

  const magic = head.readUInt16LE(peAt + OPTIONAL_HEADER_AT);
  if (magic !== PE32_MAGIC && magic !== PE32PLUS_MAGIC) {
    return null;
  }

  return head.readUInt16LE(subsystemAt);
}

/** Windows semantics wherever this runs, so a Linux test run agrees. */
const win = path.win32;

/** What PATHEXT holds when nothing has set it. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function splitList(value: string): string[] {
  return value
    .split(';')
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry !== '');
}

/** Windows resolves variable names case-insensitively; Node's copy does not. */
function lookup(env: NodeJS.ProcessEnv, name: string): string {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return (key === undefined ? undefined : env[key]) ?? '';
}

/**
 * The files a name could mean, in the order Windows would try them.
 *
 * A name with a directory in it means that file and nothing else. A bare name
 * is looked for in each PATH directory in turn, and within a directory each
 * PATHEXT extension in turn -- which is how `Start-Process` finds `code.cmd`
 * for `code`, and therefore what this has to agree with to describe the program
 * that would really run.
 */
export function executableCandidates(
  executable: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (executable === '') {
    return [];
  }

  const named = /[\\/]/.test(executable) || /^[A-Za-z]:/.test(executable);
  const extensions =
    win.extname(executable) !== '' ? [''] : splitList(lookup(env, 'PATHEXT') || DEFAULT_PATHEXT);

  const bases = named
    ? [executable]
    : splitList(lookup(env, 'PATH')).map((directory) => win.join(directory, executable));

  return bases.flatMap((base) => extensions.map((extension) => base + extension));
}

/** The head of a file, or null when it cannot be read at all. */
async function readHead(file: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch {
    // Not there, or there and unreadable. Windows reports an app execution
    // alias -- the zero-byte reparse point PATH holds for a Store app such as
    // `wt.exe` -- as ENOENT through one Node entry point and EACCES through
    // another, so the code is not something to draw a conclusion from. Both
    // mean the same thing here: this file cannot say what it is.
    return null;
  }

  try {
    const buffer = Buffer.alloc(HEADER_PROBE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_PROBE_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

export type LaunchTargetKind = 'console' | 'gui' | 'unknown';

/**
 * What kind of program this name would start.
 *
 * `unknown` is a real answer, and the common one for anything that is not a
 * plain executable: a batch shim, a Store alias, a name that is not installed.
 * Callers have to read it as "assume it needs a console".
 */
export async function launchTargetKind(
  executable: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<LaunchTargetKind> {
  for (const candidate of executableCandidates(executable, env)) {
    const head = await readHead(candidate);
    if (head === null) {
      continue;
    }

    const subsystem = peSubsystem(head);
    if (subsystem === null) {
      // Something is there and it is not a PE this understands. Stop rather
      // than read on: this is what would run, and the next candidate would
      // describe a different program.
      return 'unknown';
    }

    return subsystem === PE_SUBSYSTEM.gui ? 'gui' : 'console';
  }

  return 'unknown';
}

/**
 * Whether a visible launch of this program has to go through the console
 * bridge.
 *
 * True for everything except a program confirmed to make its own window. Not
 * cached: the read is one page out of a file the OS has in its cache anyway,
 * and an answer that goes stale when the user reinstalls a tool is worth more
 * to avoid than the microseconds.
 */
export async function needsConsoleBridge(
  executable: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  return (await launchTargetKind(executable, env)) !== 'gui';
}
