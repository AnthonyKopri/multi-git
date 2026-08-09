// Launching a configured coding agent, and managing the definitions.
//
// What this feature will not do is as much a part of it as what it will. It
// starts a program the user configured and records that the launch happened.
// It does not watch the tool, report what it is doing, or claim a session is
// "running" — nothing here can know that, and a status that is guessed is worse
// than no status at all.
//
// Launching is available only in the desktop app. The server deliberately has
// no route for it: a loopback port is reachable by anything on the machine, and
// "start this program" does not belong behind one.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { asInput, asSelect } from '../../dom/elements';
import { el, fragment, icon, setHidden } from '../../dom/create';
import { getState } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { formatRelativeTime } from '../../ui/format';
import { withButtonBusy } from '../../ui/busy';
import { ensureKeyUsable } from '../accounts/unlock';
import type { AgentLaunchRecord, ExternalAgentDefinition } from '../../../shared/config-types';

let ui: Elements;

let agents: ExternalAgentDefinition[] = [];
let launches: AgentLaunchRecord[] = [];

/** The worktree the launch dialog is about. */
let launchTarget = '';

export function initAgents(elements: Elements): void {
  ui = elements;
}

export function canLaunch(): boolean {
  return typeof window.desktopApi?.launchAgent === 'function';
}

export async function refreshAgents(): Promise<void> {
  try {
    const result = await api.getAgents();
    agents = result.agents;
    launches = result.launches;

    renderDefinitions();
    renderHistory();
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read agent definitions: ${errorMessage(error)}`, 'info');
    }
  }
}

function terminalLabel(mode: ExternalAgentDefinition['terminal']): string {
  switch (mode) {
    case 'windows-terminal':
      return 'Windows Terminal';
    case 'powershell':
      return 'PowerShell window';
    default:
      return 'its own window';
  }
}

function renderDefinitions(): void {
  const rows = agents.map((agent) =>
    el('li', {
      className: `agent-item${agent.enabled ? '' : ' agent-disabled'}`,
      data: { agentId: agent.id },
      children: [
        el('div', {
          className: 'agent-main',
          children: [
            el('span', { className: 'agent-label', text: agent.label }),
            el('span', {
              className: 'agent-meta',
              text: [
                [agent.executable, ...agent.args].join(' '),
                `opens in ${terminalLabel(agent.terminal)}`,
                agent.promptMode === 'argument' ? 'takes a starting prompt' : 'no prompt',
                agent.enabled ? '' : 'disabled'
              ]
                .filter((part) => part !== '')
                .join(' · ')
            })
          ]
        }),
        el('span', {
          className: 'agent-actions',
          children: [
            el('button', {
              className: 'btn btn-icon btn-sm',
              title: agent.enabled ? 'Turn this agent off' : 'Turn this agent on',
              data: { action: 'toggle' },
              children: [icon(agent.enabled ? 'toggle_on' : 'toggle_off', 14)]
            }),
            el('button', {
              className: 'btn btn-icon btn-sm',
              title: 'Edit this agent',
              data: { action: 'edit' },
              children: [icon('edit', 14)]
            }),
            el('button', {
              className: 'btn btn-icon btn-sm btn-text-danger',
              title: 'Remove this agent',
              data: { action: 'delete' },
              children: [icon('delete', 14)]
            })
          ]
        })
      ]
    })
  );

  ui.agentList.replaceChildren(
    rows.length === 0
      ? el('li', {
          className: 'empty-state',
          text: 'No agents configured — detect the ones you have installed, or add any executable'
        })
      : fragment(rows)
  );
}

function renderHistory(): void {
  const rows = launches.map((launch) =>
    el('li', {
      className: `agent-launch${launch.ok ? '' : ' agent-launch-failed'}`,
      children: [
        icon(launch.ok ? 'check_circle' : 'error', 14),
        el('div', {
          className: 'agent-main',
          children: [
            el('span', {
              className: 'agent-label',
              text: `${launch.agentLabel} — ${launch.worktreePath}`
            }),
            el('span', {
              className: 'agent-meta',
              text: [
                formatRelativeTime(Date.parse(launch.at)),
                launch.commandPreview,
                launch.pid === undefined ? '' : `pid ${launch.pid}`,
                launch.error ?? ''
              ]
                .filter((part) => part !== '')
                .join(' · ')
            })
          ]
        })
      ]
    })
  );

  ui.agentHistoryList.replaceChildren(
    rows.length === 0
      ? el('li', { className: 'empty-state', text: 'Nothing launched yet' })
      : fragment(rows)
  );
}

// ---------- the manager ----------

export function openAgentManager(): void {
  setHidden(ui.agentsModal, false);
  resetAgentForm();
  void refreshAgents();

  setHidden(ui.agentDesktopOnlyNote, canLaunch());
}

export function closeAgentManager(): void {
  setHidden(ui.agentsModal, true);
}

function resetAgentForm(): void {
  ui.agentForm.dataset['agentId'] = '';
  asInput(ui.agentLabelInput).value = '';
  asInput(ui.agentExecutableInput).value = '';
  asInput(ui.agentArgsInput).value = '';
  asSelect(ui.agentTerminalSelect).value =
    navigator.userAgent.includes('Windows') ? 'windows-terminal' : 'direct';
  asInput(ui.agentPromptModeCheckbox).checked = true;
}

function loadIntoForm(agent: ExternalAgentDefinition): void {
  ui.agentForm.dataset['agentId'] = agent.id;
  asInput(ui.agentLabelInput).value = agent.label;
  asInput(ui.agentExecutableInput).value = agent.executable;
  // Space-separated for editing, but each value is kept as its own argument
  // all the way to spawn; this field is a convenience, not a command line.
  asInput(ui.agentArgsInput).value = agent.args.join(' ');
  asSelect(ui.agentTerminalSelect).value = agent.terminal;
  asInput(ui.agentPromptModeCheckbox).checked = agent.promptMode === 'argument';
}

export async function submitAgentForm(): Promise<void> {
  const executable = asInput(ui.agentExecutableInput).value.trim();
  if (executable === '') {
    showToast('Enter the executable to run.', 'warn');
    return;
  }

  const rawArgs = asInput(ui.agentArgsInput).value.trim();

  await withButtonBusy(ui.btnSaveAgent, async () => {
    try {
      await api.saveAgent({
        ...(ui.agentForm.dataset['agentId'] ? { id: ui.agentForm.dataset['agentId'] } : {}),
        label: asInput(ui.agentLabelInput).value.trim() || executable,
        executable,
        args: rawArgs === '' ? [] : rawArgs.split(/\s+/),
        terminal: asSelect(ui.agentTerminalSelect).value as ExternalAgentDefinition['terminal'],
        enabled: true,
        promptMode: asInput(ui.agentPromptModeCheckbox).checked ? 'argument' : 'none'
      });

      resetAgentForm();
      await refreshAgents();
      showToast('Agent saved.', 'success');
    } catch (error) {
      const message = errorMessage(error, 'Could not save the agent.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  });
}

export async function detectInstalledAgents(): Promise<void> {
  await withButtonBusy(ui.btnDetectAgents, async () => {
    try {
      const { added } = await api.addDetectedAgents();
      await refreshAgents();

      showToast(
        added.length === 0
          ? 'No new tools found on your PATH. Add one by hand if it lives somewhere else.'
          : `Added ${added.map((agent) => agent.label).join(', ')}.`,
        added.length === 0 ? 'info' : 'success',
        6000
      );
    } catch (error) {
      showToast(errorMessage(error, 'Detection failed.'), 'error', 6000);
    }
  });
}

async function toggleAgent(agent: ExternalAgentDefinition): Promise<void> {
  try {
    await api.saveAgent({ ...agent, enabled: !agent.enabled });
    await refreshAgents();
  } catch (error) {
    showToast(errorMessage(error, 'Could not change the agent.'), 'error');
  }
}

async function deleteAgent(agent: ExternalAgentDefinition): Promise<void> {
  const { confirmed } = await confirmDialog(
    `Remove "${agent.label}" from Multi-Git?\n\nThe tool itself is not uninstalled; only this launch configuration goes.`,
    { title: 'Remove agent', confirmLabel: 'Remove' }
  );

  if (!confirmed) {
    return;
  }

  try {
    await api.deleteAgent(agent.id);
    await refreshAgents();
  } catch (error) {
    showToast(errorMessage(error, 'Could not remove the agent.'), 'error');
  }
}

export function handleAgentAction(target: HTMLElement, event: MouseEvent): void {
  const row = target.closest<HTMLElement>('[data-agent-id]');
  const agent = agents.find((candidate) => candidate.id === row?.dataset['agentId']);
  if (!agent) {
    return;
  }

  switch ((event.target as Element).closest<HTMLElement>('[data-action]')?.dataset['action']) {
    case 'toggle':
      void toggleAgent(agent);
      return;
    case 'edit':
      loadIntoForm(agent);
      return;
    case 'delete':
      void deleteAgent(agent);
  }
}

// ---------- launching ----------

/**
 * Opens the launch dialog for a worktree.
 *
 * The SSH identity is prepared first, and a locked key is asked about here
 * rather than discovered by the agent an hour later when its first push fails.
 */
export async function launchAgentFor(worktreePath: string): Promise<void> {
  if (!canLaunch()) {
    showToast(
      'Launching a coding agent needs the desktop app. In a browser, open a terminal in the folder yourself.',
      'warn',
      8000
    );
    return;
  }

  await refreshAgents();

  const usable = agents.filter((agent) => agent.enabled);
  if (usable.length === 0) {
    showToast('No agents are configured yet. Add one in the agent settings first.', 'warn', 7000);
    openAgentManager();
    return;
  }

  launchTarget = worktreePath;

  ui.agentLaunchTarget.textContent = worktreePath;

  const select = asSelect(ui.agentLaunchSelect);
  select.replaceChildren(
    fragment(
      usable.map((agent) => {
        const option = document.createElement('option');
        option.value = agent.id;
        option.textContent = agent.label;
        return option;
      })
    )
  );

  asInput(ui.agentLaunchPrompt).value = '';
  onLaunchAgentChanged();

  setHidden(ui.agentLaunchModal, false);
}

/** Hides the prompt box for a tool that does not take one. */
export function onLaunchAgentChanged(): void {
  const agent = agents.find((candidate) => candidate.id === asSelect(ui.agentLaunchSelect).value);
  setHidden(ui.agentLaunchPromptRow, agent?.promptMode !== 'argument');
}

export function closeLaunchDialog(): void {
  setHidden(ui.agentLaunchModal, true);
}

export async function submitLaunch(): Promise<void> {
  const agentId = asSelect(ui.agentLaunchSelect).value;
  const prompt = asInput(ui.agentLaunchPrompt).value;

  if (!agentId || launchTarget === '') {
    return;
  }

  // Asked before the tool starts, not after: an agent handed a folder whose
  // key is locked cannot push, and finding that out later wastes the session.
  if (getState().activeProfileId) {
    await ensureKeyUsable({ reason: 'agent-launch' });
  }

  await withButtonBusy(ui.btnLaunchAgent, async () => {
    try {
      const result = await window.desktopApi?.launchAgent?.({
        repoPath: launchTarget,
        worktreePath: launchTarget,
        agentId,
        ...(prompt.trim() === '' ? {} : { initialPrompt: prompt.trim() })
      });

      if (!result) {
        return;
      }

      if (!result.launched) {
        logToTerminal(`Agent launch failed: ${result.error ?? 'unknown error'}`, 'error');
        showToast(result.error ?? 'The agent could not be launched.', 'error', 8000);
        return;
      }

      logToTerminal(result.commandPreview, 'cmd');
      closeLaunchDialog();

      showToast(
        result.sshWarning
          ? `Launched, but ${result.sshWarning}`
          : 'Agent launched.',
        result.sshWarning ? 'warn' : 'success',
        result.sshWarning ? 10_000 : 4000
      );

      await refreshAgents();
    } catch (error) {
      const message = errorMessage(error, 'The agent could not be launched.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 8000);
    }
  });
}

/** Opens the launch dialog for whichever repository is currently open. */
export async function launchAgentForActiveRepo(): Promise<void> {
  const { activeRepo } = getState();

  if (!activeRepo) {
    showToast('Open a repository first.', 'warn');
    return;
  }

  await launchAgentFor(activeRepo);
}
