// An SSH agent of Multi-Git's own, for macOS and Linux.
//
// Windows has one agent, a service, and turning it on is a single elevated
// command (see agent-service.ts). Everywhere else there is no such switch: the
// agent might belong to launchd, systemd, a desktop session or a shell profile,
// and this application has no business reconfiguring any of them.
//
// What it can do without touching anything is start an agent for itself.
// `ssh-agent -s` needs no administrator, changes no system setting, and lives
// exactly as long as this process lets it. Its socket is put in this process's
// environment, so every `ssh-add`, every Git operation, and every terminal or
// tool opened from Multi-Git afterwards finds it. A terminal opened some other
// way does not, and the message returned says so.
import type { ExecutableRunner } from '../process/runner';
import { executableRunner } from '../process/runner';

export interface SessionAgentResult {
  started: boolean;
  /** One sentence for the person who pressed the button. */
  message: string;
}

/** The agent this process started, so it can be ended with it. */
let ownedAgentPid: number | null = null;

/** Reads the two assignments `ssh-agent -s` prints. */
export function parseAgentEnvironment(output: string): { socket: string; pid: number } | null {
  const socket = /SSH_AUTH_SOCK=([^;\n]+);/.exec(output)?.[1]?.trim();
  const pid = Number(/SSH_AGENT_PID=(\d+);/.exec(output)?.[1]);

  if (!socket || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  return { socket, pid };
}

function endOwnedAgent(): void {
  if (ownedAgentPid === null) {
    return;
  }
  try {
    process.kill(ownedAgentPid);
  } catch {
    // Already gone.
  }
  ownedAgentPid = null;
}

/**
 * Starts an agent for this session, unless this is Windows or one was started.
 *
 * Deliberately does not check whether some other agent is reachable first: the
 * caller only offers this when none is, and asking again here would be a
 * second `ssh-add -l` to learn what the button being on screen already says.
 */
export async function startSessionAgent(
  runner: ExecutableRunner = executableRunner,
  platform: NodeJS.Platform = process.platform
): Promise<SessionAgentResult> {
  if (platform === 'win32') {
    return {
      started: false,
      message: 'On Windows the SSH agent is a system service. Use "Turn it on" instead.'
    };
  }

  if (ownedAgentPid !== null) {
    return { started: true, message: 'The SSH agent Multi-Git started is already running.' };
  }

  let output: string;
  try {
    output = (await runner.run('ssh-agent', ['-s'], { timeoutMs: 10_000 })).stdout;
  } catch {
    return {
      started: false,
      message: 'ssh-agent could not be run. Install the OpenSSH client, then check again.'
    };
  }

  const agent = parseAgentEnvironment(output);
  if (!agent) {
    return { started: false, message: 'ssh-agent started but did not say where to reach it.' };
  }

  process.env['SSH_AUTH_SOCK'] = agent.socket;
  process.env['SSH_AGENT_PID'] = String(agent.pid);

  if (ownedAgentPid === null) {
    // It was started for this session and holds nothing worth keeping after it.
    process.once('exit', endOwnedAgent);
  }
  ownedAgentPid = agent.pid;

  return {
    started: true,
    message:
      'Started an SSH agent for Multi-Git. Terminals and tools opened from here use it; ones opened elsewhere do not.'
  };
}

/** For tests: forget the agent without signalling anything. */
export function resetSessionAgent(): void {
  ownedAgentPid = null;
}
