// Finding the process a launch started, and stopping it.
//
// A launch hands a program to a terminal and lets go. What comes back is the
// id of whatever was spawned, and that is usually not the agent: `wt.exe` and
// `open -a Terminal` are stubs that pass the command to a terminal already
// running and exit, so the id they leave behind names nothing a second later.
//
// So after a launch the process table is read, and the process the launch
// produced is picked out of it by three facts together: it did not exist before
// the launch, it is the configured executable (or a script host running it),
// and it is the oldest such process. That id is stored with the moment the
// process was created.
//
// The creation time is what makes Stop safe. Process ids are reused, on Windows
// within minutes, so an id alone would eventually name somebody else's program.
// An id and a creation time together name one process for ever: Stop reads the
// table again and does nothing unless both still match.
import path from 'node:path';

import { runProcess } from '../process/run';

export interface ProcessInfo {
  pid: number;
  /** When the process was created, in milliseconds since the epoch. */
  startedAt: number;
  /** The image name: `claude.exe`, `node`, `bash`. */
  name: string;
  commandLine: string;
}

/** A process as a launch record remembers it. */
export interface TrackedProcess {
  pid: number;
  startedAt: number;
}

export interface ProcessProbe {
  /** The processes with these ids, or every process when none are given. */
  list(pids?: readonly number[]): Promise<ProcessInfo[]>;
  /** Ends a process and everything it started. */
  kill(pid: number): Promise<void>;
}

/**
 * How far two readings of one creation time may differ and still be the same
 * process. `ps` reports whole seconds and Windows reports microseconds, so the
 * same process read twice can be most of a second apart.
 */
export const START_TOLERANCE_MS = 2000;

/** How far before the launch a process may have been created and still be its. */
const LAUNCH_SLACK_MS = 1500;

/**
 * Lists processes on Windows.
 *
 * A constant, like every other script this application hands to PowerShell:
 * the ids arrive in an environment variable and are parsed as integers, so
 * nothing from a record is ever part of the text PowerShell parses.
 */
export const WINDOWS_PROCESS_LIST_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  "$ids = @($env:MG_PIDS -split ',' | Where-Object { $_ -match '^[0-9]+$' } | ForEach-Object { [int]$_ })",
  "$all = if ($ids.Count -gt 0) { Get-CimInstance Win32_Process -Filter (($ids | ForEach-Object { 'ProcessId=' + $_ }) -join ' OR ') } else { Get-CimInstance Win32_Process }",
  'foreach ($p in $all) { if ($p.CreationDate) {',
  "  $line = if ($p.CommandLine) { $p.CommandLine -replace '[\\r\\n\\t]+', ' ' } else { '' }",
  '  "{0}`t{1}`t{2}`t{3}" -f $p.ProcessId, ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds(), $p.Name, $line',
  '} }'
].join('\n');

/** Reads the tab-separated lines {@link WINDOWS_PROCESS_LIST_SCRIPT} prints. */
export function parseWindowsProcessList(output: string): ProcessInfo[] {
  const found: ProcessInfo[] = [];

  for (const line of output.split(/\r?\n/)) {
    const [pid, startedAt, name, ...rest] = line.split('\t');
    const id = Number(pid);
    const started = Number(startedAt);

    if (Number.isInteger(id) && id > 0 && Number.isFinite(started) && started > 0 && name) {
      found.push({ pid: id, startedAt: started, name, commandLine: rest.join('\t') });
    }
  }

  return found;
}

/** `Tue Nov 10 12:00:00 2026`, the fixed shape `ps -o lstart` prints under LC_ALL=C. */
const PS_LINE = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/;

/** Reads `ps -o pid=,lstart=,args=`. */
export function parsePsProcessList(output: string): ProcessInfo[] {
  const found: ProcessInfo[] = [];

  for (const line of output.split('\n')) {
    const match = PS_LINE.exec(line);
    if (!match) {
      continue;
    }

    const startedAt = Date.parse(match[2] as string);
    const commandLine = (match[3] as string).trim();
    if (!Number.isFinite(startedAt) || commandLine === '') {
      continue;
    }

    found.push({
      pid: Number(match[1]),
      startedAt,
      name: path.basename(commandLine.split(/\s+/)[0] as string),
      commandLine
    });
  }

  return found;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else, which is still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function signalTree(pid: number, signal: NodeJS.Signals): void {
  try {
    // A process started detached leads its own group, and the group is the
    // whole tree. One that a terminal started does not, so fall back to it.
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone, which is the outcome that was wanted.
    }
  }
}

/** The probe used in production. Quiet: none of this belongs in the Terminal Log. */
export const systemProcessProbe: ProcessProbe = {
  async list(pids = []) {
    if (process.platform === 'win32') {
      const result = await runProcess(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_LIST_SCRIPT],
        { env: { ...process.env, MG_PIDS: pids.join(',') }, timeoutMs: 20_000 }
      );
      return parseWindowsProcessList(result.stdout);
    }

    const result = await runProcess(
      'ps',
      pids.length > 0
        ? ['-o', 'pid=,lstart=,args=', '-p', pids.join(',')]
        : ['-eo', 'pid=,lstart=,args='],
      // The month and weekday names are parsed, so they have to be English.
      { env: { ...process.env, LC_ALL: 'C' }, timeoutMs: 20_000 }
    );
    return parsePsProcessList(result.stdout);
  },

  async kill(pid) {
    if (process.platform === 'win32') {
      // /T takes the children with it; /F because a console program has no
      // message loop to receive the polite request.
      await runProcess('taskkill', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 15_000 });
      return;
    }

    signalTree(pid, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (isAlive(pid)) {
      signalTree(pid, 'SIGKILL');
    }
  }
};

/** Programs that run another program named on their command line. */
const SCRIPT_HOSTS = new Set([
  'cmd',
  'node',
  'nodejs',
  'bun',
  'deno',
  'python',
  'python3',
  'bash',
  'sh',
  'zsh',
  'pwsh',
  'powershell',
  'uv'
]);

/** `claude.exe` → `claude`. Lowercased, because Windows names are caseless. */
function stem(name: string): string {
  return path
    .basename(name.replace(/\\/g, '/'))
    .replace(/\.(exe|cmd|bat|com|ps1|sh|js|mjs|cjs|py)$/i, '')
    .toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface PickInput {
  /** The executable the definition names. */
  executable: string;
  /** Just before the launch, in milliseconds since the epoch. */
  since: number;
  /** What the launcher returned, when it returned anything. */
  launcherPid?: number;
}

/**
 * Picks the process a launch started out of a process list.
 *
 * The executable itself is preferred over a script host that mentions it, and
 * the oldest wins either way: an agent starts helpers named after itself, and
 * the one that was there first is the one the rest hang from.
 *
 * `allowLauncher` is the fallback for a tool whose process bears no resemblance
 * to its configured name. It is only safe once the hand-off stubs have had time
 * to exit, which is why the caller asks for it on the last look and not before.
 */
export function pickLaunchedProcess(
  processes: readonly ProcessInfo[],
  input: PickInput,
  allowLauncher = false
): ProcessInfo | null {
  const needle = stem(input.executable);
  if (needle === '') {
    return null;
  }

  const mentions = new RegExp(`(^|[\\\\/\\s"'])${escapeRegExp(needle)}(\\.[a-z0-9]{1,4})?(["'\\s]|$)`, 'i');
  const fresh = processes
    .filter((candidate) => candidate.startedAt >= input.since - LAUNCH_SLACK_MS)
    .sort((a, b) => a.startedAt - b.startedAt || a.pid - b.pid);

  const exact = fresh.find((candidate) => stem(candidate.name) === needle);
  if (exact) {
    return exact;
  }

  const hosted = fresh.find(
    (candidate) => SCRIPT_HOSTS.has(stem(candidate.name)) && mentions.test(candidate.commandLine)
  );
  if (hosted) {
    return hosted;
  }

  if (allowLauncher && input.launcherPid !== undefined) {
    return fresh.find((candidate) => candidate.pid === input.launcherPid) ?? null;
  }

  return null;
}

/** When to look, in milliseconds after the previous look. */
export const TRACKING_DELAYS_MS: readonly number[] = [1200, 1800, 3000];

/**
 * Looks for the process a launch started, a few times, and gives up quietly.
 *
 * A terminal takes a moment to open and run what it was given, so the first
 * look is not immediate and a miss is retried. Never throws: failing to find
 * the process costs the Stop button for that launch and nothing else.
 */
export async function findLaunchedProcess(
  input: PickInput,
  probe: ProcessProbe = systemProcessProbe,
  delays: readonly number[] = TRACKING_DELAYS_MS
): Promise<TrackedProcess | null> {
  for (const [index, delay] of delays.entries()) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const found = pickLaunchedProcess(await probe.list(), input, index === delays.length - 1);
      if (found) {
        return { pid: found.pid, startedAt: found.startedAt };
      }
    } catch {
      // A process table that cannot be read is retried, then given up on.
    }
  }

  return null;
}

/** Which of these tracked processes still exist as the processes they were. */
export async function stillRunning(
  tracked: readonly TrackedProcess[],
  probe: ProcessProbe = systemProcessProbe
): Promise<Set<number>> {
  if (tracked.length === 0) {
    return new Set();
  }

  const live = await probe.list(tracked.map((entry) => entry.pid));
  const running = new Set<number>();

  for (const entry of tracked) {
    const match = live.find((candidate) => candidate.pid === entry.pid);
    if (match && Math.abs(match.startedAt - entry.startedAt) <= START_TOLERANCE_MS) {
      running.add(entry.pid);
    }
  }

  return running;
}
