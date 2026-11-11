// What the first-run guide says. Words only, no DOM.
//
// Apart from wizard.ts because these sentences are the feature: someone meeting
// an SSH agent or a public key for the first time has only these to go on, and
// each state deserves a test that it says something a beginner can act on.
import type { SshAgentState, SshIdentityCheck } from '../../../shared/ssh-agent-types';

/**
 * Whether one press can make the agent usable from here.
 *
 * On Windows that is the service being off, which one elevated command fixes.
 * Elsewhere it is nothing answering at all, which Multi-Git fixes by starting
 * an agent of its own. A machine with no OpenSSH has nothing to switch on.
 */
export function agentIsStartable(state: Pick<SshAgentState, 'platform' | 'availability'>): boolean {
  return state.platform === 'win32'
    ? state.availability === 'stopped' || state.availability === 'disabled'
    : state.availability === 'unreachable';
}

export interface AgentRowText {
  tone: 'ok' | 'warn' | 'optional';
  icon: string;
  name: string;
  detail: string;
  /** The label of the one button, when one press can fix it. */
  action?: string;
}

/**
 * What to say about the SSH agent, in words for someone who has not met one.
 *
 * "Key helper" is the name used on this screen, with the real one beside it so
 * it can be searched for. It is never a reason to stop: Git inside Multi-Git
 * works without the agent, which only decides whether a key has to be unlocked
 * once or every time.
 */
export function describeAgentForSetup(
  state: Pick<SshAgentState, 'platform' | 'availability'> | null,
  canElevate: boolean
): AgentRowText {
  const name = 'Key helper (SSH agent)';

  if (state === null) {
    return { tone: 'optional', icon: 'help', name, detail: 'Could not check it just now. You can carry on.' };
  }

  if (state.availability === 'ready') {
    return {
      tone: 'ok',
      icon: 'check_circle',
      name,
      detail: 'Running. It remembers your key, so you are not asked for it every time.'
    };
  }

  if (agentIsStartable(state)) {
    if (state.platform === 'win32') {
      return canElevate
        ? {
            tone: 'warn',
            icon: 'warning',
            name,
            detail: 'Windows has it switched off. Turning it on takes one click, and Windows will ask for your permission.',
            action: 'Turn it on'
          }
        : {
            tone: 'warn',
            icon: 'warning',
            name,
            detail: 'Windows has it switched off. Open the desktop app to turn it on with one click.'
          };
    }

    return {
      tone: 'warn',
      icon: 'warning',
      name,
      detail: 'Not running yet. Multi-Git can start one for itself. No password needed.',
      action: 'Start it'
    };
  }

  if (state.availability === 'missing') {
    return {
      tone: 'optional',
      icon: 'help',
      name,
      detail:
        state.platform === 'win32'
          ? 'OpenSSH is not installed. Add "OpenSSH Client" under Settings › System › Optional features, then press Check again.'
          : 'OpenSSH is not installed. Install the OpenSSH client with your system’s package manager, then press Check again.'
    };
  }

  return {
    tone: 'optional',
    icon: 'help',
    name,
    detail: 'Not answering right now. You can carry on, and Multi-Git will ask for your key when it needs it.'
  };
}

/** What to tell someone about a check, in one or two plain sentences. */
export function describeValidation(check: SshIdentityCheck, host: string): { ok: boolean; message: string } {
  if (check.ok) {
    return {
      ok: true,
      message: check.account
        ? `Validated as ${check.account} on ${host}. You are ready to go.`
        : `${host} accepted this key. You are ready to go.`
    };
  }

  if (check.reason === 'refused') {
    return {
      ok: false,
      message: `Not validated yet: ${host} does not know this key. Add it with the steps above, then try again.`
    };
  }
  if (check.reason === 'timeout') {
    return { ok: false, message: `Not validated: ${host} did not answer. Check your internet connection and try again.` };
  }
  if (check.reason === 'prompted') {
    return {
      ok: false,
      message: `Not validated: ${host} needs something this screen cannot answer, usually a passphrase. Open the key manager to unlock the key.`
    };
  }

  return { ok: false, message: `Not validated: ${check.message}` };
}
