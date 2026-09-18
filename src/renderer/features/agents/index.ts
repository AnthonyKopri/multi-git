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
//
// The launch window is built around one question the old one left unanswered:
// what is actually about to run. A tool, a model and a prompt each change the
// command line, so the command line is shown, assembled from the same pieces
// the launcher will use. The prompt is still never stored — it is left out of
// the preview for the same reason it is left out of the history.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { asInput, asSelect, asTextArea } from '../../dom/elements';
import { el, fragment, icon, setHidden } from '../../dom/create';
import { getState, activeProfile } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { formatRelativeTime } from '../../ui/format';
import { withButtonBusy } from '../../ui/busy';
import { isWindowsHost } from '../../ui/platform';
import { createSectionNav } from '../../ui/section-nav';
import type { SectionNav } from '../../ui/section-nav';
import { ensureKeyUsable } from '../accounts/unlock';
import type { AgentLaunchRecord, ExternalAgentDefinition } from '../../../shared/config-types';
import type { AgentCatalogueEntry, AgentModelPreset } from '../../../shared/agent-catalogue';
import type { DetectedAgent } from '../../../shared/agent-types';
import { focusFirst } from '../../ui/focus';
import { warnNoRepo } from '../../ui/no-repo';

let ui: Elements;
let nav: SectionNav;

let agents: ExternalAgentDefinition[] = [];
let launches: AgentLaunchRecord[] = [];
let catalogue: AgentCatalogueEntry[] = [];
let installed: DetectedAgent[] = [];

/** The worktree the launch dialog is about. */
let launchTarget = '';
/** The agent the launch dialog has selected. */
let launchAgentId = '';
/** The model preset id the launch dialog has selected. '' is the tool's own. */
let launchModelId = '';

const SECTIONS = [
  { key: 'configured', icon: 'smart_toy', title: 'Your agents' },
  { key: 'catalogue', icon: 'apps', title: 'Known tools' },
  { key: 'editor', icon: 'edit_note', title: 'Add or edit' },
  { key: 'history', icon: 'history', title: 'Launch history' }
];

export function initAgents(elements: Elements): void {
  ui = elements;
  nav = createSectionNav({ nav: ui.agentsNav, body: ui.agentsBody });

  // Windows Terminal and PowerShell are Windows launch modes, and the server
  // refuses them anywhere else. Hidden rather than removed, so a definition
  // written on Windows still shows what it was set to when opened here.
  if (!isWindowsHost()) {
    for (const option of asSelect(ui.agentTerminalSelect).options) {
      if (option.value === 'windows-terminal' || option.value === 'powershell') {
        option.hidden = true;
        option.disabled = true;
      }
    }
  }
}

export function canLaunch(): boolean {
  return typeof window.desktopApi?.launchAgent === 'function';
}

export async function refreshAgents(): Promise<void> {
  try {
    const result = await api.getAgents();
    agents = result.agents;
    launches = result.launches;
    catalogue = result.catalogue ?? [];

    renderDefinitions();
    renderCatalogue();
    renderHistory();

    // The section list is drawn before the lists have anything in them, so
    // every section starts a few pixels apart and the scroll spy picks the
    // wrong one. Re-read once the heights are real.
    nav.markActive();
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read agent definitions: ${errorMessage(error)}`, 'info');
    }
  }
}

/**
 * Asks the machine which known tools are installed.
 *
 * Separate from {@link refreshAgents} because it is the slow half — one `which`
 * per catalogue entry — and the lists it feeds are useful before it answers.
 */
async function refreshInstalled(): Promise<void> {
  try {
    installed = (await api.detectAgents()).detected;
    renderCatalogue();
    nav.markActive();
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not look for installed agents: ${errorMessage(error)}`, 'info');
    }
  }
}

function catalogueEntry(agent: ExternalAgentDefinition): AgentCatalogueEntry | null {
  return catalogue.find((entry) => entry.id === agent.catalogueId) ?? null;
}

function modelsFor(agent: ExternalAgentDefinition | undefined): readonly AgentModelPreset[] {
  return agent ? (catalogueEntry(agent)?.models ?? []) : [];
}

function terminalLabel(mode: ExternalAgentDefinition['terminal']): string {
  switch (mode) {
    case 'windows-terminal':
      return 'Windows Terminal';
    case 'powershell':
      return 'a PowerShell window';
    case 'system-terminal':
      return 'your terminal';
    default:
      return 'a window of its own';
  }
}

function promptLabel(agent: ExternalAgentDefinition): string {
  switch (agent.promptMode) {
    case 'argument':
      return 'takes a starting prompt';
    case 'flag':
      return `takes a prompt after ${(agent.promptArgs ?? []).join(' ') || 'a flag'}`;
    default:
      return 'no prompt';
  }
}

// ---------- the manager ----------

function renderDefinitions(): void {
  const rows = agents.map((agent) =>
    el('li', {
      className: `agent-item${agent.enabled ? '' : ' agent-disabled'}`,
      data: { agentId: agent.id },
      children: [
        el('div', {
          className: 'agent-main',
          children: [
            el('span', {
              className: 'agent-label',
              children: [
                el('span', { text: agent.label }),
                agent.enabled
                  ? null
                  : el('span', { className: 'agent-tag agent-tag-off', text: 'off' })
              ]
            }),
            el('span', {
              className: 'agent-meta',
              text: [agent.executable, ...agent.args].join(' ')
            }),
            el('span', {
              className: 'agent-sub',
              text: [`opens in ${terminalLabel(agent.terminal)}`, promptLabel(agent)].join(' · ')
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
              attrs: { type: 'button' },
              children: [icon(agent.enabled ? 'toggle_on' : 'toggle_off', 14)]
            }),
            el('button', {
              className: 'btn btn-icon btn-sm',
              title: 'Edit this agent',
              data: { action: 'edit' },
              attrs: { type: 'button' },
              children: [icon('edit', 14)]
            }),
            el('button', {
              className: 'btn btn-icon btn-sm',
              title: 'Copy this agent, to point the copy at another model',
              data: { action: 'duplicate' },
              attrs: { type: 'button' },
              children: [icon('content_copy', 14)]
            }),
            el('button', {
              className: 'btn btn-icon btn-sm btn-text-danger',
              title: 'Remove this agent',
              data: { action: 'delete' },
              attrs: { type: 'button' },
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
          text: 'No agents configured — add one from the known tools below, or any executable by hand'
        })
      : fragment(rows)
  );
}

/** The known-tool browser: everything in the catalogue, marked with what is here. */
function renderCatalogue(): void {
  const filter = asInput(ui.agentCatalogueFilter).value.trim().toLowerCase();

  // Before detection answers, every entry is shown as "checking" rather than
  // as "not installed": claiming a tool is missing on the strength of a lookup
  // that has not run yet is the one wrong answer here.
  const checking = installed.length === 0;
  const state = new Map(installed.map((entry) => [entry.id, entry]));

  const rows = catalogue
    .filter(
      (entry) =>
        filter === '' ||
        `${entry.label} ${entry.vendor} ${entry.executable}`.toLowerCase().includes(filter)
    )
    // What this machine has comes first. Ordering answers "show me only what I
    // have" without a control to turn on: fourteen rows sorted usefully beat
    // fourteen rows plus a switch for reading them.
    .sort((left, right) =>
      Number(state.get(right.id)?.installed ?? false) -
      Number(state.get(left.id)?.installed ?? false)
    )
    .map((entry) => {
      const found = state.get(entry.id);
      const models = entry.models ?? [];

      return el('li', {
        className: 'agent-item agent-catalogue-item',
        data: { catalogueId: entry.id },
        children: [
          el('div', {
            className: 'agent-main',
            children: [
              el('span', {
                className: 'agent-label',
                children: [
                  el('span', { text: entry.label }),
                  el('span', { className: 'agent-tag', text: entry.vendor }),
                  found?.configured
                    ? el('span', { className: 'agent-tag agent-tag-added', text: 'added' })
                    : null
                ]
              }),
              el('span', { className: 'agent-sub', text: entry.summary }),
              el('span', {
                className: 'agent-meta',
                text: [
                  entry.executable,
                  checking
                    ? 'checking…'
                    : found?.installed
                      ? 'installed'
                      : 'not installed',
                  models.length > 1 ? `${models.length} models` : ''
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
                title: `Open ${entry.homepage}`,
                data: { action: 'homepage' },
                attrs: { type: 'button' },
                children: [icon('open_in_new', 14)]
              }),
              el('button', {
                className: 'btn btn-secondary btn-sm',
                title: found?.installed
                  ? `Add ${entry.label}`
                  : `Add ${entry.label} anyway — it is not on your PATH yet`,
                data: { action: 'add' },
                attrs: { type: 'button' },
                children: [icon('add', 14), el('span', { text: 'Add' })]
              })
            ]
          })
        ]
      });
    });

  ui.agentCatalogueList.replaceChildren(
    rows.length === 0
      ? el('li', { className: 'empty-state', text: 'Nothing matches that filter' })
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
              children: [
                el('span', { text: launch.agentLabel }),
                launch.modelLabel === undefined
                  ? null
                  : el('span', { className: 'agent-tag', text: launch.modelLabel })
              ]
            }),
            el('span', { className: 'agent-sub', text: launch.worktreePath }),
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

export function openAgentManager(): void {
  setHidden(ui.agentsModal, false);
  nav.render(SECTIONS);
  ui.agentsBody.scrollTop = 0;
  focusFirst(ui.agentsModal);
  resetAgentForm();

  setHidden(ui.agentDesktopOnlyNote, canLaunch());

  void refreshAgents().then(() => refreshInstalled());
}

export function closeAgentManager(): void {
  setHidden(ui.agentsModal, true);
}

export function filterCatalogue(): void {
  renderCatalogue();
}

// ---------- the add-or-edit form ----------

export function resetAgentForm(): void {
  ui.agentForm.dataset['agentId'] = '';
  ui.agentForm.dataset['catalogueId'] = '';
  setHidden(ui.agentFormEditing, true);
  asInput(ui.agentLabelInput).value = '';
  asInput(ui.agentExecutableInput).value = '';
  asInput(ui.agentArgsInput).value = '';
  asInput(ui.agentPromptArgsInput).value = '';
  asSelect(ui.agentTerminalSelect).value = isWindowsHost() ? 'windows-terminal' : 'system-terminal';
  asSelect(ui.agentPromptModeSelect).value = 'none';
  onPromptModeChanged();
}

function loadIntoForm(agent: ExternalAgentDefinition): void {
  ui.agentForm.dataset['agentId'] = agent.id;
  ui.agentForm.dataset['catalogueId'] = agent.catalogueId ?? '';
  ui.agentFormEditing.textContent = `Editing “${agent.label}”.`;
  setHidden(ui.agentFormEditing, false);
  asInput(ui.agentLabelInput).value = agent.label;
  asInput(ui.agentExecutableInput).value = agent.executable;
  // Space-separated for editing, but each value is kept as its own argument
  // all the way to spawn; this field is a convenience, not a command line.
  asInput(ui.agentArgsInput).value = agent.args.join(' ');
  asInput(ui.agentPromptArgsInput).value = (agent.promptArgs ?? []).join(' ');
  asSelect(ui.agentTerminalSelect).value = agent.terminal;
  asSelect(ui.agentPromptModeSelect).value = agent.promptMode ?? 'none';
  onPromptModeChanged();

  nav.jumpTo('editor');
  asInput(ui.agentLabelInput).focus();
}

/** Hides the flag field for a prompt mode that has nothing in front of it. */
export function onPromptModeChanged(): void {
  setHidden(ui.agentPromptArgsRow, asSelect(ui.agentPromptModeSelect).value !== 'flag');
}

/** Splits a space-separated field into arguments, dropping the empty ones. */
function splitArgs(value: string): string[] {
  const trimmed = value.trim();
  return trimmed === '' ? [] : trimmed.split(/\s+/);
}

export async function submitAgentForm(): Promise<void> {
  const executable = asInput(ui.agentExecutableInput).value.trim();
  if (executable === '') {
    showToast('Enter the executable to run.', 'warn');
    return;
  }

  const promptMode = asSelect(ui.agentPromptModeSelect).value as ExternalAgentDefinition['promptMode'];
  const promptArgs = splitArgs(asInput(ui.agentPromptArgsInput).value);

  if (promptMode === 'flag' && promptArgs.length === 0) {
    showToast('A prompt after a flag needs the flag. Gemini and Qwen use -i.', 'warn', 6000);
    return;
  }

  await withButtonBusy(ui.btnSaveAgent, async () => {
    try {
      await api.saveAgent({
        ...(ui.agentForm.dataset['agentId'] ? { id: ui.agentForm.dataset['agentId'] } : {}),
        ...(ui.agentForm.dataset['catalogueId']
          ? { catalogueId: ui.agentForm.dataset['catalogueId'] }
          : {}),
        label: asInput(ui.agentLabelInput).value.trim() || executable,
        executable,
        args: splitArgs(asInput(ui.agentArgsInput).value),
        terminal: asSelect(ui.agentTerminalSelect).value as ExternalAgentDefinition['terminal'],
        enabled: true,
        ...(promptMode ? { promptMode } : {}),
        ...(promptMode === 'flag' ? { promptArgs } : {})
      });

      resetAgentForm();
      await refreshAgents();
      await refreshInstalled();
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
      await refreshInstalled();

      showToast(
        added.length === 0
          ? 'Nothing new was found on your PATH. Add one by hand if it lives somewhere else.'
          : `Added ${added.map((agent) => agent.label).join(', ')}.`,
        added.length === 0 ? 'info' : 'success',
        6000
      );
    } catch (error) {
      showToast(errorMessage(error, 'Detection failed.'), 'error', 6000);
    }
  });
}

/** Adds one catalogue entry, installed or not, and opens it for editing. */
async function addFromCatalogue(entry: AgentCatalogueEntry): Promise<void> {
  try {
    const { agent } = await api.saveAgent({
      label: entry.label,
      executable: entry.executable,
      args: [...(entry.args ?? [])],
      terminal: isWindowsHost() ? 'windows-terminal' : 'system-terminal',
      enabled: true,
      promptMode: entry.promptMode,
      ...(entry.promptArgs ? { promptArgs: [...entry.promptArgs] } : {}),
      catalogueId: entry.id
    });

    await refreshAgents();
    await refreshInstalled();
    showToast(`${agent.label} added.`, 'success');
  } catch (error) {
    showToast(errorMessage(error, 'Could not add that agent.'), 'error', 6000);
  }
}

async function toggleAgent(agent: ExternalAgentDefinition): Promise<void> {
  try {
    await api.saveAgent({ ...agent, enabled: !agent.enabled });
    await refreshAgents();
  } catch (error) {
    showToast(errorMessage(error, 'Could not change the agent.'), 'error');
  }
}

/**
 * Copies a definition.
 *
 * The point of it is one tool configured several ways — the same CLI pinned to
 * a different model, or with a different set of arguments — without retyping
 * the parts that do not change. The copy is saved turned on and opened in the
 * form, because a copy nobody edits is a duplicate.
 */
async function duplicateAgent(agent: ExternalAgentDefinition): Promise<void> {
  try {
    const { id: _ignored, ...rest } = agent;
    const { agent: copy } = await api.saveAgent({ ...rest, label: `${agent.label} copy` });

    await refreshAgents();
    loadIntoForm(copy);
    showToast('Copied. Edit the copy and save it.', 'success');
  } catch (error) {
    showToast(errorMessage(error, 'Could not copy the agent.'), 'error');
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
    await refreshInstalled();
  } catch (error) {
    showToast(errorMessage(error, 'Could not remove the agent.'), 'error');
  }
}

export async function clearLaunchHistory(): Promise<void> {
  if (launches.length === 0) {
    return;
  }

  const { confirmed } = await confirmDialog(
    'Clear the launch history?\n\nIt records what was started and where, and nothing else — no prompt text was ever kept.',
    { title: 'Clear launch history', confirmLabel: 'Clear' }
  );

  if (!confirmed) {
    return;
  }

  try {
    await api.clearAgentLaunches();
    await refreshAgents();
  } catch (error) {
    showToast(errorMessage(error, 'Could not clear the history.'), 'error');
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
    case 'duplicate':
      void duplicateAgent(agent);
      return;
    case 'delete':
      void deleteAgent(agent);
  }
}

export function handleCatalogueAction(target: HTMLElement, event: MouseEvent): void {
  const row = target.closest<HTMLElement>('[data-catalogue-id]');
  const entry = catalogue.find((candidate) => candidate.id === row?.dataset['catalogueId']);
  if (!entry) {
    return;
  }

  switch ((event.target as Element).closest<HTMLElement>('[data-action]')?.dataset['action']) {
    case 'add':
      void addFromCatalogue(entry);
      return;
    case 'homepage':
      window.open(entry.homepage, '_blank', 'noopener,noreferrer');
  }
}

// ---------- launching ----------

/** The agents the launch dialog can offer. */
function launchable(): ExternalAgentDefinition[] {
  return agents.filter((agent) => agent.enabled);
}

/**
 * The agent to start the dialog on.
 *
 * The last one that actually started, because the tool someone reached for an
 * hour ago is overwhelmingly the one they are reaching for now. Falls back to
 * the top of the list, which is the order the manager lets them set.
 */
function preselectedAgent(usable: readonly ExternalAgentDefinition[]): ExternalAgentDefinition {
  const recent = launches.find(
    (launch) => launch.ok && usable.some((agent) => agent.id === launch.agentId)
  );

  return (
    usable.find((agent) => agent.id === recent?.agentId) ?? (usable[0] as ExternalAgentDefinition)
  );
}

/** The model that agent was last launched with, when it still exists. */
function preselectedModel(agent: ExternalAgentDefinition): string {
  const recent = launches.find((launch) => launch.ok && launch.agentId === agent.id);
  const presets = modelsFor(agent);

  return presets.some((preset) => preset.id === recent?.modelId) ? (recent?.modelId ?? '') : '';
}

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

  const usable = launchable();
  if (usable.length === 0) {
    showToast('No agents are configured yet. Add one in the agent settings first.', 'warn', 7000);
    openAgentManager();
    return;
  }

  launchTarget = worktreePath;

  const { status } = getState();
  ui.agentLaunchBranch.textContent = status?.branch ? `On ${status.branch}` : 'Working folder';
  ui.agentLaunchTarget.textContent = worktreePath;

  // Read from the state the header already shows rather than asked for again:
  // this is the account the folder is set to push as, and the launch itself
  // re-checks it and reports anything that would stop a push.
  const profile = activeProfile();
  ui.agentLaunchAccount.textContent = profile ? profile.label : 'System SSH';

  const selected = preselectedAgent(usable);
  launchAgentId = selected.id;
  launchModelId = preselectedModel(selected);

  asTextArea(ui.agentLaunchPrompt).value = '';
  renderLaunchPicker();

  setHidden(ui.agentLaunchModal, false);
  focusFirst(ui.agentLaunchModal);
}

function renderLaunchPicker(): void {
  const usable = launchable();

  ui.agentLaunchPicker.replaceChildren(
    fragment(
      usable.map((agent) => {
        const entry = catalogueEntry(agent);
        const chosen = agent.id === launchAgentId;

        return el('button', {
          className: `agent-card${chosen ? ' agent-card-selected' : ''}`,
          data: { agentId: agent.id },
          attrs: {
            type: 'button',
            role: 'radio',
            'aria-checked': chosen ? 'true' : 'false'
          },
          children: [
            el('span', {
              className: 'agent-card-head',
              children: [
                el('span', { className: 'agent-card-label', text: agent.label }),
                entry === null
                  ? null
                  : el('span', { className: 'agent-tag', text: entry.vendor })
              ]
            }),
            el('span', {
              className: 'agent-card-summary',
              text: entry?.summary ?? `${agent.executable} · opens in ${terminalLabel(agent.terminal)}`
            })
          ]
        });
      })
    )
  );

  renderLaunchModels();
}

function renderLaunchModels(): void {
  const agent = launchable().find((candidate) => candidate.id === launchAgentId);
  const presets = modelsFor(agent);
  const select = asSelect(ui.agentLaunchModel);

  setHidden(ui.agentLaunchModelRow, presets.length < 2);

  if (presets.length >= 2) {
    select.replaceChildren(
      fragment(
        presets.map((preset) => {
          const option = document.createElement('option');
          option.value = preset.id;
          option.textContent =
            preset.vendor === '' ? preset.label : `${preset.label} — ${preset.vendor}`;
          return option;
        })
      )
    );
    select.value = launchModelId || (presets[0]?.id ?? '');
    launchModelId = select.value;
  }

  const preset = presets.find((candidate) => candidate.id === launchModelId);
  const requires = preset?.requiresEnv ?? [];
  const note = [
    preset?.note ?? '',
    requires.length === 0
      ? ''
      : `Set ${requires.join(' and ')} in your environment first — Multi-Git never stores a key.`
  ]
    .filter((part) => part !== '')
    .join(' ');

  ui.agentLaunchModelNote.textContent = note;
  setHidden(ui.agentLaunchModelNote, note === '');

  // A tool that takes no prompt gets no prompt box, so the field never implies
  // something that would be silently dropped.
  setHidden(ui.agentLaunchPromptRow, agent?.promptMode === undefined || agent.promptMode === 'none');

  renderCommandPreview(agent, preset);
}

/**
 * The command line, as the launcher will build it.
 *
 * Deliberately stops before the prompt. The prompt is passed as one argument
 * and is never written to the log or the history, and a preview that showed it
 * would be the one place it appeared — which is exactly the promise this
 * feature makes.
 *
 * One line is always on screen and the rest is behind a disclosure. Seeing
 * what will run is worth a line of the dialog; the environment it runs with
 * and the window it opens in are worth a click, and a boxed block of all three
 * was three lines of small print above the Launch button.
 */
function renderCommandPreview(
  agent: ExternalAgentDefinition | undefined,
  preset: AgentModelPreset | undefined
): void {
  if (!agent) {
    ui.agentLaunchCommand.textContent = '';
    ui.agentLaunchPreview.textContent = '';
    return;
  }

  const argv = [agent.executable, ...agent.args, ...(preset?.args ?? [])];
  const takesPrompt = agent.promptMode === 'argument' || agent.promptMode === 'flag';
  const prompt = asTextArea(ui.agentLaunchPrompt).value.trim();

  if (takesPrompt && prompt !== '') {
    if (agent.promptMode === 'flag') {
      argv.push(...(agent.promptArgs ?? []));
    }
    argv.push('<your prompt>');
  }

  const env = Object.keys({ ...(agent.env ?? {}), ...(preset?.env ?? {}) });
  const command = argv.join(' ');

  ui.agentLaunchCommand.textContent = command;
  ui.agentLaunchPreview.textContent = [
    command,
    env.length === 0 ? '' : `with ${env.join(', ')}`,
    `in ${terminalLabel(agent.terminal)}`
  ]
    .filter((part) => part !== '')
    .join('\n');
}

export function handleLaunchPickerClick(target: HTMLElement): void {
  const agentId = target.closest<HTMLElement>('[data-agent-id]')?.dataset['agentId'];
  if (agentId === undefined || agentId === launchAgentId) {
    return;
  }

  launchAgentId = agentId;
  launchModelId = '';
  renderLaunchPicker();
}

export function onLaunchModelChanged(): void {
  launchModelId = asSelect(ui.agentLaunchModel).value;
  renderLaunchModels();
}

/** Keeps the preview honest as the prompt is typed. */
export function onLaunchPromptChanged(): void {
  const agent = launchable().find((candidate) => candidate.id === launchAgentId);
  const preset = modelsFor(agent).find((candidate) => candidate.id === launchModelId);
  renderCommandPreview(agent, preset);
}

export function closeLaunchDialog(): void {
  setHidden(ui.agentLaunchModal, true);
}

export async function submitLaunch(): Promise<void> {
  const prompt = asTextArea(ui.agentLaunchPrompt).value;

  if (!launchAgentId || launchTarget === '') {
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
        agentId: launchAgentId,
        ...(prompt.trim() === '' ? {} : { initialPrompt: prompt.trim() }),
        ...(launchModelId === '' ? {} : { modelId: launchModelId })
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
        result.sshWarning ? `Launched, but ${result.sshWarning}` : 'Agent launched.',
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
    warnNoRepo('launch an agent here');
    return;
  }

  await launchAgentFor(activeRepo);
}
