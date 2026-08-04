// The one place this application asks for administrator rights.
//
// Enabling the OpenSSH Authentication Agent service needs elevation, and there
// is no way around that: a Disabled service cannot be started by any
// unprivileged caller, however the request is phrased.
//
// The design constraint is that a UAC prompt is a trust decision the user
// makes once and then stops reading. So the elevated command must be
// impossible to influence:
//
//   * It is a module-level constant, built from AGENT_REPAIR_COMMAND.
//   * This handler takes no parameters. The preload bridge forwards none, and
//     anything the renderer sends is ignored before it is read.
//   * It runs in the main process only. The server, which is reachable over
//     loopback HTTP, cannot invoke it.
//
// Elevation is requested with `Start-Process -Verb RunAs`, which is what
// raises the UAC dialog. The outer PowerShell is unprivileged; only the inner
// one is elevated, and it runs the constant.
import { spawn } from 'node:child_process';

import { AGENT_REPAIR_COMMAND } from '../server/ssh/agent-service';
import type { SshAgentRepairResult } from '../shared/ssh-agent-types';

/** UAC dialog dismissed or denied. Windows reports this as an exception. */
const CANCELLED_MARKER = 'MULTI_GIT_ELEVATION_CANCELLED';

const REPAIR_TIMEOUT_MS = 120_000;

/**
 * Wraps the constant in a launcher that requests elevation and reports whether
 * the user approved it.
 *
 * The argument list is embedded as a PowerShell array literal of single-quoted
 * strings, with internal quotes doubled — the PowerShell escape. Since
 * AGENT_REPAIR_COMMAND is a constant this is belt and braces, but the encoding
 * has to be correct for the command to run at all, and writing it defensively
 * costs nothing.
 */
function buildLauncherScript(): string {
  const quoted = AGENT_REPAIR_COMMAND.map(
    (argument) => `'${argument.replace(/'/g, "''")}'`
  ).join(', ');

  return [
    '$ErrorActionPreference = "Stop"',
    'try {',
    `  $p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @(${quoted})`,
    '  exit $p.ExitCode',
    '} catch {',
    // The user declining UAC is not a failure to report as one.
    `  Write-Output "${CANCELLED_MARKER}"`,
    '  exit 1223',
    '}'
  ].join('\n');
}

export async function repairSshAgentElevated(): Promise<SshAgentRepairResult> {
  if (process.platform !== 'win32') {
    return {
      success: false,
      cancelled: false,
      message: 'Automatic agent repair is only available on Windows.'
    };
  }

  return new Promise<SshAgentRepairResult>((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', buildLauncherScript()],
      { windowsHide: true, shell: false }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill();
      settle({
        success: false,
        cancelled: false,
        message: 'The repair prompt timed out. Nothing was changed.'
      });
    }, REPAIR_TIMEOUT_MS);

    const settle = (result: SshAgentRepairResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error: Error) => {
      settle({
        success: false,
        cancelled: false,
        message: `Could not start the repair prompt: ${error.message}`
      });
    });

    child.on('close', (code) => {
      if (stdout.includes(CANCELLED_MARKER) || code === 1223) {
        settle({
          success: false,
          cancelled: true,
          message: 'Administrator approval was declined, so the agent service was not changed.'
        });
        return;
      }

      if (code === 0) {
        settle({
          success: true,
          cancelled: false,
          message: 'The OpenSSH Authentication Agent service is now set to Automatic and running.'
        });
        return;
      }

      settle({
        success: false,
        cancelled: false,
        message:
          stderr.trim() ||
          `The repair command exited with code ${code}. The service may be managed by group policy.`
      });
    });
  });
}
