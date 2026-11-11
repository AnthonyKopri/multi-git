// The Agents panel: every agent sent out from here, what it was asked to do,
// and a way to stop it.
//
// It answers three questions and no more. Which agents did I start, what did I
// tell each one, and is its program still there. "Running" means exactly that
// last thing — the process the launch started still exists — and never that
// the agent is making progress: nothing here reads what a tool is doing.
//
// Stopping is desktop-only, like launching, and for the same reason: it acts
// on a program. The page names a history entry; the backend decides which
// process that is and checks it is still the same one before ending it.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { el, fragment, icon, setHidden } from '../../dom/create';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { formatRelativeTime } from '../../ui/format';
import { focusFirst } from '../../ui/focus';
import { countRunning, describeState, folderName } from './run-text';
import type { AgentLaunchView } from '../../../shared/agent-types';

let ui: Elements;
/** False until the page has been wired up, which a launch can beat in a test. */
let ready = false;
let runs: AgentLaunchView[] = [];

/** Tasks the reader opened in full, by launch id, so a redraw keeps them open. */
const expanded = new Set<string>();

let pollTimer: number | null = null;

/** How often the list is re-read while the panel is on screen. */
const POLL_MS = 4000;

/** Longer than this and the task is folded behind "Show all". */
const LONG_TASK_CHARS = 260;

export function initAgentsPanel(elements: Elements): void {
  ui = elements;
  ready = true;
}

function canStop(): boolean {
  return typeof window.desktopApi?.stopAgent === 'function';
}

function isOpen(): boolean {
  return ready && !ui.agentsPanel.classList.contains('hidden');
}

function taskBlock(run: AgentLaunchView): HTMLElement {
  if (run.prompt === undefined || run.prompt === '') {
    return el('p', {
      className: 'agent-run-task agent-run-task-empty',
      text: run.ok ? 'Started without a task, to work with directly.' : 'No task was typed.'
    });
  }

  const id = run.id ?? run.at;
  const long = run.prompt.length > LONG_TASK_CHARS;
  const open = expanded.has(id);

  return el('div', {
    className: 'agent-run-task-wrap',
    children: [
      el('p', {
        className: long && !open ? 'agent-run-task is-clamped' : 'agent-run-task',
        text: run.prompt
      }),
      long
        ? el('button', {
            className: 'btn btn-text btn-sm',
            text: open ? 'Show less' : 'Show all',
            attrs: { type: 'button', 'aria-expanded': String(open) },
            data: { toggleTask: id }
          })
        : null
    ]
  });
}

function runCard(run: AgentLaunchView, now: number): HTMLElement {
  const status = describeState(run, now);
  const stoppable = run.state === 'running' && run.id !== undefined && canStop();

  return el('li', {
    className: 'agent-run',
    data: { state: run.state },
    children: [
      el('div', {
        className: 'agent-run-head',
        children: [
          el('span', {
            className: 'agent-run-status',
            children: [el('span', { className: 'agent-run-dot' }), el('span', { text: status.label })]
          }),
          el('span', { className: 'agent-run-time', text: formatRelativeTime(Date.parse(run.at)) })
        ]
      }),
      el('div', {
        className: 'agent-run-title',
        children: [
          el('span', { text: run.agentLabel || 'Agent' }),
          run.modelLabel === undefined ? null : el('span', { className: 'agent-tag', text: run.modelLabel })
        ]
      }),
      el('div', {
        className: 'agent-run-folder',
        title: run.worktreePath,
        children: [icon('folder', 15), el('span', { text: folderName(run.worktreePath) })]
      }),
      taskBlock(run),
      status.note === undefined ? null : el('p', { className: 'agent-run-note', text: status.note }),
      el('div', {
        className: 'agent-run-actions',
        children: [
          stoppable
            ? el('button', {
                className: 'btn btn-danger btn-sm',
                attrs: { type: 'button' },
                data: { stopLaunch: run.id ?? '' },
                children: [icon('stop_circle', 16), el('span', { text: 'Stop' })]
              })
            : null,
          run.prompt
            ? el('button', {
                className: 'btn btn-secondary btn-sm',
                attrs: { type: 'button' },
                data: { copyTask: run.id ?? run.at },
                children: [icon('content_copy', 15), el('span', { text: 'Copy task' })]
              })
            : null
        ]
      })
    ]
  });
}

function render(): void {
  const now = Date.now();
  const running = countRunning(runs);

  // The side panel's Agents row carries the count, so it is worth a glance
  // without opening anything.
  ui.agentsRunningCount.textContent = String(running);
  setHidden(ui.agentsRunningCount, running === 0);

  ui.agentsPanelSummary.textContent =
    running === 0 ? 'Nothing running right now' : `${running} running right now`;

  ui.agentsPanelList.replaceChildren(
    runs.length === 0
      ? el('li', {
          className: 'agent-run-empty',
          children: [
            icon('smart_toy', 28),
            el('strong', { text: 'No agents sent out yet' }),
            el('span', {
              text: 'Start one with New agent. It shows up here with the task you gave it, and a Stop button while it runs.'
            })
          ]
        })
      : fragment(runs.map((run) => runCard(run, now)))
  );

  (ui.btnAgentsPanelClear as HTMLButtonElement).disabled = !runs.some(
    (run) => run.state !== 'running' && run.state !== 'untracked'
  );
}

/** Re-reads the launches and what is still running. Safe to call at any time. */
export async function refreshAgentRuns(): Promise<void> {
  if (!ready) {
    return;
  }

  try {
    const result = await api.getAgentLaunches();
    runs = result.launches;
    render();
  } catch (error) {
    // A missed poll is not worth a toast: the next one is seconds away.
    if (!isStale(error) && isOpen()) {
      ui.agentsPanelSummary.textContent = 'Could not read the list just now';
    }
  }
}

/**
 * Looks again shortly after a launch.
 *
 * The backend needs a few seconds to find the new process, so one read straight
 * away would show "Starting" and then never correct itself while the panel is
 * closed, leaving the count on the side panel a step behind.
 */
export function noteAgentLaunched(): void {
  void refreshAgentRuns();
  for (const delay of [3000, 8000, 14_000]) {
    window.setTimeout(() => void refreshAgentRuns(), delay);
  }
}

export function openAgentsPanel(): void {
  setHidden(ui.agentsPanel, false);
  setHidden(ui.agentsPanelNote, canStop());
  focusFirst(ui.agentsPanel);
  void refreshAgentRuns();

  if (pollTimer === null) {
    pollTimer = window.setInterval(() => {
      if (isOpen()) {
        void refreshAgentRuns();
      } else {
        // Closed by Escape or the backdrop, neither of which comes through here.
        stopPolling();
      }
    }, POLL_MS);
  }
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function closeAgentsPanel(): void {
  setHidden(ui.agentsPanel, true);
  stopPolling();
}

async function stopRun(id: string): Promise<void> {
  const run = runs.find((candidate) => candidate.id === id);
  if (!run) {
    return;
  }

  const { confirmed } = await confirmDialog(
    `Stop ${run.agentLabel || 'this agent'} in ${folderName(run.worktreePath)}?\n\n` +
      'Its program is ended straight away, without a chance to finish what it was in the middle of. ' +
      'Files it has already changed stay as they are in the folder.',
    { title: 'Stop this agent', confirmLabel: 'Stop it', danger: true }
  );
  if (!confirmed) {
    return;
  }

  try {
    const result = await window.desktopApi?.stopAgent?.(id);

    if (result?.stopped) {
      showToast(`${run.agentLabel || 'Agent'} stopped.`, 'success');
    } else {
      showToast(result?.error ?? 'The agent could not be stopped.', 'warn', 8000);
    }
  } catch (error) {
    showToast(errorMessage(error, 'The agent could not be stopped.'), 'error', 8000);
  }

  await refreshAgentRuns();
}

async function copyTask(id: string): Promise<void> {
  const run = runs.find((candidate) => (candidate.id ?? candidate.at) === id);
  if (!run?.prompt) {
    return;
  }

  try {
    await navigator.clipboard.writeText(run.prompt);
    showToast('Task copied.', 'success');
  } catch {
    showToast('The task could not be copied.', 'warn');
  }
}

/** Removes everything that is over. Running agents keep their entries. */
export async function clearFinishedRuns(): Promise<void> {
  const running = countRunning(runs);
  const { confirmed } = await confirmDialog(
    running === 0
      ? 'Clear the list? The tasks you typed are removed with it.'
      : `Clear everything that has finished? The ${running} still running ${running === 1 ? 'stays' : 'stay'} in the list.`,
    { title: 'Clear finished agents', confirmLabel: 'Clear' }
  );
  if (!confirmed) {
    return;
  }

  try {
    await api.clearAgentLaunches();
    expanded.clear();
  } catch (error) {
    showToast(errorMessage(error, 'The list could not be cleared.'), 'error', 6000);
  }

  await refreshAgentRuns();
}

/** One listener for the whole list: Stop, Copy task, and Show all. */
export function handleAgentsPanelClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-stop-launch], [data-copy-task], [data-toggle-task]'
  );
  if (!target) {
    return;
  }

  const { stopLaunch, copyTask: copyId, toggleTask } = target.dataset;

  if (stopLaunch !== undefined) {
    void stopRun(stopLaunch);
  } else if (copyId !== undefined) {
    void copyTask(copyId);
  } else if (toggleTask !== undefined) {
    if (expanded.has(toggleTask)) {
      expanded.delete(toggleTask);
    } else {
      expanded.add(toggleTask);
    }
    render();
  }
}
