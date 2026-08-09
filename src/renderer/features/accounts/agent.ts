// The native SSH agent, in the accounts dropdown.
//
// One line of status and at most one button. The states worth distinguishing
// to a person are narrower than the ones the server reports:
//
//   * the selected key is in the agent — nothing to do;
//   * the agent works but the key is not loaded — selecting the profile loads
//     it, so still nothing to press;
//   * the agent is stopped or disabled — one button, and it says what it will
//     do before asking for administrator rights;
//   * there is no agent at all — a sentence explaining why, and no button that
//     would not help.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { asButton } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { getState } from '../../state/store';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import type { SshAgentState } from '../../../shared/ssh-agent-types';

let ui: Elements;
let latest: SshAgentState | null = null;

/**
 * Coalesces refreshes.
 *
 * Opening a repository triggers a profile restore, a config load and a status
 * refresh in quick succession, and three overlapping agent probes would each
 * shell out to ssh-add for the same answer.
 */
let pending: Promise<void> | null = null;

/** Ignore a focus re-check that lands within this of the previous one. */
const RECHECK_INTERVAL_MS = 5_000;
let lastCheckedAt = 0;

export function initAgentPanel(elements: Elements): void {
  ui = elements;

  ui.btnRepairAgent.addEventListener('click', () => void repair());
  ui.btnUnloadKey.addEventListener('click', () => void unload());
  // Imported lazily to keep this module free of a cycle: unlock.ts needs the
  // state this file exposes.
  ui.btnUnlockKey.addEventListener('click', () => {
    void import('./unlock').then(({ unlockSelectedKey }) => unlockSelectedKey());
  });

  // The agent is machine state, and the machine keeps running while this
  // window is in the background: a service can be stopped, a key removed by
  // `ssh-add -d` in a terminal, or the whole box suspended and resumed. Coming
  // back to the window is the moment a stale panel would be believed.
  window.addEventListener('focus', () => void recheck());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void recheck();
    }
  });

  render(null);
}

/** A refresh that rate-limits itself, for triggers that can fire in bursts. */
function recheck(): Promise<void> {
  if (Date.now() - lastCheckedAt < RECHECK_INTERVAL_MS) {
    return Promise.resolve();
  }
  return refreshAgent();
}

export function agentState(): SshAgentState | null {
  return latest;
}

/** Re-reads agent state. Safe to call from several places at once. */
export function refreshAgent(): Promise<void> {
  if (pending) {
    return pending;
  }

  pending = (async () => {
    try {
      const { activeRepo, activeProfileId } = getState();
      const response = await api.getSshAgentStatus(activeRepo ?? undefined, activeProfileId);
      latest = response.agent;
      render(response.agent);
    } catch (error) {
      if (!isStale(error)) {
        latest = null;
        render(null);
      }
    } finally {
      lastCheckedAt = Date.now();
      pending = null;
    }
  })();

  return pending;
}

/**
 * Loads the selected profile's key into the agent.
 *
 * Called when the user picks a profile. A failure is reported but never
 * blocks: in-app Git still works through the per-command fallback, so a
 * degraded agent must not stop someone pushing.
 */
export async function loadSelectedKey(profileId: string): Promise<void> {
  const { activeRepo } = getState();

  try {
    const result = await api.loadSshAgentKey(activeRepo, profileId);
    latest = result.agent;
    render(result.agent);

    if (result.routingChanged) {
      logToTerminal(
        'Pinned this repository to the selected key, so terminals and external tools use it too.'
      );
    }

    if (!result.success && result.error) {
      logToTerminal(`SSH agent: ${result.error}`, 'error');

      // Only the repairable case is worth interrupting for. The rest are
      // visible in the dropdown for anyone who goes looking.
      if (result.code === 'REPAIR_REQUIRED' || result.code === 'VAULT_LOCKED') {
        showToast(result.error, 'warn', 6000);
      }
    }
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not reach the SSH agent: ${errorMessage(error)}`, 'error');
    }
  }
}

async function repair(): Promise<void> {
  if (!window.desktopApi?.repairSshAgent) {
    showToast(
      'Starting the agent service needs the desktop app. In a browser, start it yourself with: Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent',
      'warn',
      9000
    );
    return;
  }

  const button = asButton(ui.btnRepairAgent);
  button.disabled = true;

  try {
    const result = await window.desktopApi.repairSshAgent();

    if (result.cancelled) {
      // Declining the UAC prompt is a choice, not a failure.
      logToTerminal('SSH agent repair was cancelled.');
      return;
    }

    logToTerminal(result.message, result.success ? 'success' : 'error');
    showToast(result.message, result.success ? 'success' : 'error', 6000);

    if (result.success) {
      await refreshAgent();
      const { activeProfileId } = getState();
      if (activeProfileId) {
        await loadSelectedKey(activeProfileId);
      }
    }
  } finally {
    button.disabled = false;
    await refreshAgent();
  }
}

async function unload(): Promise<void> {
  const { activeProfileId } = getState();
  if (!activeProfileId) {
    return;
  }

  try {
    const result = await api.unloadSshAgentKey(activeProfileId);
    latest = result.agent;
    render(result.agent);

    if (result.success) {
      showToast('Key removed from the SSH agent.', 'success');
    } else if (result.error) {
      showToast(result.error, 'warn', 6000);
    }
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not unload the key.'), 'error');
    }
  }
}

function render(state: SshAgentState | null): void {
  const chip = ui.agentStatusChip;

  if (!state) {
    chip.textContent = 'Agent: —';
    chip.className = 'agent-chip';
    setHidden(ui.btnRepairAgent, true);
    setHidden(ui.btnUnlockKey, true);
    setHidden(ui.btnUnloadKey, true);
    setHidden(ui.agentDiagnostic, true);
    return;
  }

  const { label, tone } = describe(state);
  chip.textContent = `Agent: ${label}`;
  chip.className = `agent-chip agent-${tone}`;

  // Only offered when it would actually help: a running agent has nothing to
  // repair, and on a platform this cannot mutate the button would be a lie.
  const repairable =
    state.platform === 'win32' &&
    (state.availability === 'stopped' || state.availability === 'disabled');
  setHidden(ui.btnRepairAgent, !repairable);

  // Offered exactly when it can work: a profile is selected, the agent is
  // reachable, and its key is not in there yet. That is the state a window
  // reopens in when the key is passphrase-protected, and the state a user who
  // declined the prompt earlier needs a way back from.
  setHidden(
    ui.btnUnlockKey,
    !(state.availability === 'ready' && Boolean(state.selectedProfileId) && !state.selectedKeyLoaded)
  );

  setHidden(ui.btnUnloadKey, !state.selectedKeyLoaded);

  if (state.diagnostic) {
    ui.agentDiagnostic.textContent = state.diagnostic;
    setHidden(ui.agentDiagnostic, false);
  } else {
    setHidden(ui.agentDiagnostic, true);
  }
}

function describe(state: SshAgentState): { label: string; tone: 'ok' | 'warn' | 'off' } {
  if (state.availability !== 'ready') {
    return {
      label:
        state.availability === 'disabled'
          ? 'disabled'
          : state.availability === 'stopped'
            ? 'not running'
            : state.availability === 'missing'
              ? 'not installed'
              : 'unreachable',
      tone: 'off'
    };
  }

  if (!state.selectedProfileId) {
    return { label: `ready · ${state.keys.length} key(s)`, tone: 'ok' };
  }

  return state.selectedKeyLoaded
    ? { label: 'key loaded', tone: 'ok' }
    : { label: 'key not loaded', tone: 'warn' };
}
