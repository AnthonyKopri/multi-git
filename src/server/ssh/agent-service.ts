// Inspecting the Windows OpenSSH Authentication Agent service.
//
// Read-only. Changing the start type needs administrator rights, so that lives
// behind an explicit, user-approved elevation prompt in the Electron main
// process (src/main/ssh-agent-elevation.ts); nothing here mutates anything.
//
// `sc.exe` rather than PowerShell, for two reasons: it takes an argument vector
// with no shell involved, and it is present on every Windows install including
// ones where PowerShell execution policy is locked down.
//
// The output is parsed by NUMBER, never by word. `sc.exe` localises its state
// names — a German machine prints `BEENDET`, not `STOPPED` — but the numeric
// codes are the same everywhere.
import { executableRunner } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';

/** The service Windows registers for the native agent. */
export const WINDOWS_AGENT_SERVICE = 'ssh-agent';

/** START_TYPE values from `sc qc`. */
const START_TYPE_DISABLED = 4;

/** STATE values from `sc query`. */
const STATE_RUNNING = 4;

export type ServiceStartType = 'boot' | 'system' | 'automatic' | 'manual' | 'disabled' | 'unknown';

export interface WindowsServiceInfo {
  exists: boolean;
  running: boolean;
  startType: ServiceStartType;
}

function startTypeFromCode(code: number): ServiceStartType {
  switch (code) {
    case 0:
      return 'boot';
    case 1:
      return 'system';
    case 2:
      return 'automatic';
    case 3:
      return 'manual';
    case START_TYPE_DISABLED:
      return 'disabled';
    default:
      return 'unknown';
  }
}

/**
 * Pulls the numeric code out of an `sc.exe` field.
 *
 * The lines look like `        START_TYPE         : 4   DISABLED`, and on a
 * localised install only the trailing word changes.
 */
export function parseScField(output: string, field: string): number | null {
  const pattern = new RegExp(`${field}\\s*:\\s*(\\d+)`, 'i');
  const match = pattern.exec(output);
  return match?.[1] !== undefined ? Number.parseInt(match[1], 10) : null;
}

export function parseServiceQuery(queryOutput: string, configOutput: string): WindowsServiceInfo {
  const state = parseScField(queryOutput, 'STATE');
  const startCode = parseScField(configOutput, 'START_TYPE');

  return {
    exists: state !== null || startCode !== null,
    running: state === STATE_RUNNING,
    startType: startCode === null ? 'unknown' : startTypeFromCode(startCode)
  };
}

/**
 * Reads the agent service's state.
 *
 * Returns `exists: false` rather than throwing when the service is absent:
 * a machine without the OpenSSH client is a normal configuration to report,
 * not a fault to surface as a crash.
 */
export async function readWindowsAgentService(
  runner: ExecutableRunner = executableRunner
): Promise<WindowsServiceInfo> {
  const absent: WindowsServiceInfo = { exists: false, running: false, startType: 'unknown' };

  if (process.platform !== 'win32') {
    return absent;
  }

  try {
    // 1060 is "service does not exist", which sc reports as a non-zero exit.
    const [query, config] = await Promise.all([
      runner.run('sc.exe', ['query', WINDOWS_AGENT_SERVICE], {
        timeoutMs: 10_000,
        allowNonZero: [1060, 1, 5]
      }),
      runner.run('sc.exe', ['qc', WINDOWS_AGENT_SERVICE], {
        timeoutMs: 10_000,
        allowNonZero: [1060, 1, 5]
      })
    ]);

    return parseServiceQuery(query.stdout, config.stdout);
  } catch {
    // sc.exe missing entirely, or a spawn failure. Either way there is nothing
    // to report about a service we cannot see.
    return absent;
  }
}

/**
 * The exact command the elevation prompt runs. Constant, and audited here.
 *
 * It is deliberately not parameterised. An elevated helper that accepts a
 * command from the renderer is an arbitrary-code-execution primitive wearing a
 * UAC prompt; this one can only ever do these two things to this one service.
 *
 * `Automatic` rather than `Manual`: the point is that terminals and external
 * coding agents keep working after a reboot without the user coming back here.
 */
export const AGENT_REPAIR_COMMAND: readonly string[] = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  "Set-Service -Name 'ssh-agent' -StartupType Automatic; Start-Service -Name 'ssh-agent'"
];

/** True when repairing the service would need an administrator prompt. */
export function repairNeedsElevation(info: WindowsServiceInfo): boolean {
  if (process.platform !== 'win32' || !info.exists) {
    return false;
  }

  // Starting a Disabled service always fails, whatever the caller's rights, so
  // the start type has to change first — and that is an admin operation.
  return info.startType === 'disabled' || !info.running;
}
