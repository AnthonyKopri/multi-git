// The Terminal panel: what this application did, where you are working.
//
// The log used to live in a pop-out window you summoned from a menu, showing
// lines the renderer had composed from intent -- so they read like git commands
// without being any, and could not be copied and run. The server now records
// every invocation where it happens, with the argument vector that actually
// ran; this shows that record next to the repository it describes.
//
// Two things keep it readable rather than a wall of text. A single refresh runs
// upwards of forty git commands and nearly all are questions, so reads are
// classified server-side and hidden unless asked for. And several windows share
// one buffer, so lines are filtered to this window's repository unless asked
// otherwise.
import { el, setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { asInput } from '../../dom/elements';
import { getState, subscribeTo } from '../../state/store';
import { showToast } from '../../ui/toast';
import { openLogWindow } from '../../ui/log';
import type { LogEntry } from '../../../shared/log-types';

let ui: Elements;

/** Everything received this session, before filtering. */
let entries: LogEntry[] = [];
/** Entries arriving while collapsed, so the header can say there is something. */
let unseen = 0;

const MAX_RENDERED = 2000;

function isCollapsed(): boolean {
  return ui.terminalPanel.classList.contains('is-collapsed');
}

/**
 * Whether an entry belongs on screen.
 *
 * A read is still recorded and still reachable; it is only off the first
 * screen, because forty `rev-parse` lines per refresh would bury the one
 * command the user came to look at.
 */
function isVisible(entry: LogEntry): boolean {
  if (entry.command?.kind === 'read' && !asInput(ui.terminalShowReads).checked) {
    return false;
  }

  if (!asInput(ui.terminalAllRepos).checked) {
    const active = getState().activeRepo;
    // Lines with no repository -- application-level notices -- always belong.
    if (entry.repoPath !== undefined && active !== null && entry.repoPath !== active) {
      return false;
    }
  }

  const needle = asInput(ui.terminalFind).value.trim().toLowerCase();
  return needle === '' || entry.text.toLowerCase().includes(needle);
}

function row(entry: LogEntry): HTMLElement {
  const line = el('div', { className: `terminal-line terminal-line-${entry.type}` });

  if (entry.command) {
    // The prompt marks a real invocation, and the text beside it is exactly
    // what ran -- which is the whole reason this was moved to the server.
    line.append(
      el('span', { className: 'terminal-prompt', text: '$' }),
      el('span', { className: 'terminal-command', text: entry.text })
    );

    const exit = entry.command.exitCode;
    if (exit !== undefined && exit !== 0) {
      line.append(el('span', { className: 'terminal-exit', text: `exit ${exit}` }));
    }

    const duration = entry.command.durationMs;
    if (duration !== undefined && duration >= 1000) {
      // Only when it is worth remarking on. Milliseconds on every line is noise.
      line.append(
        el('span', { className: 'terminal-duration', text: `${(duration / 1000).toFixed(1)}s` })
      );
    }

    // The environment this application added, which is what people are looking
    // for when a push authenticates as the wrong account.
    for (const [key, value] of Object.entries(entry.command.env ?? {})) {
      line.append(el('span', { className: 'terminal-env', text: `${key}=${value}` }));
    }

    const copy = el('button', {
      className: 'terminal-copy',
      text: 'Copy',
      attrs: { type: 'button', title: 'Copy this command' }
    });
    copy.addEventListener('click', () => void copyCommand(entry));
    line.append(copy);

    return line;
  }

  line.textContent = entry.text;
  return line;
}

async function copyCommand(entry: LogEntry): Promise<void> {
  // The argv joined, not the display text: this is meant to be pasted into a
  // shell and run.
  const text = entry.command ? entry.command.argv.join(' ') : entry.text;

  try {
    await navigator.clipboard.writeText(text);
    showToast('Command copied.', 'success');
  } catch {
    showToast('Clipboard unavailable.', 'info');
  }
}

function render(): void {
  const visible = entries.filter(isVisible).slice(-MAX_RENDERED);

  ui.terminalBody.replaceChildren(
    visible.length === 0
      ? el('div', {
          className: 'terminal-empty',
          text: entries.length === 0
            ? 'Nothing yet. Everything this application runs will appear here.'
            : 'Nothing matches. Try Reads, All repos, or clearing the filter.'
        })
      : el('div', { children: visible.map(row) })
  );

  ui.terminalBody.scrollTop = ui.terminalBody.scrollHeight;
}

function markUnseen(): void {
  if (!isCollapsed()) {
    return;
  }

  unseen++;
  ui.terminalCount.textContent = String(unseen);
  setHidden(ui.terminalCount, false);
}

function setCollapsed(collapsed: boolean): void {
  ui.terminalPanel.classList.toggle('is-collapsed', collapsed);
  ui.btnTerminalToggle.setAttribute('aria-expanded', String(!collapsed));

  if (!collapsed) {
    unseen = 0;
    setHidden(ui.terminalCount, true);
    render();
  }
}

/**
 * Offers the shells this machine actually has.
 *
 * Asked rather than assumed: Git Bash is not installed everywhere, and in
 * browser mode there is no bridge to launch anything at all.
 */
async function wireShellButtons(): Promise<void> {
  const desktop = window.desktopApi;
  if (!desktop?.openShell || !desktop.availableShells) {
    return;
  }

  ui.btnOpenGitBash.addEventListener('click', () => void openShell('git-bash'));
  ui.btnOpenShell.addEventListener('click', () => void openShell('terminal'));

  setHidden(ui.btnOpenShell, false);

  try {
    const { gitBash } = await desktop.availableShells();
    setHidden(ui.btnOpenGitBash, !gitBash);
  } catch {
    // Not knowing means not offering, which is the honest default.
  }
}

async function openShell(kind: 'git-bash' | 'terminal'): Promise<void> {
  const repoPath = getState().activeRepo;
  if (repoPath === null) {
    showToast('Open a repository first.', 'warn');
    return;
  }

  try {
    await window.desktopApi?.openShell?.(repoPath, kind);
  } catch (error) {
    showToast((error as Error).message || 'Could not open a shell here.', 'error', 8000);
  }
}

export function initTerminal(elements: Elements): void {
  ui = elements;

  ui.btnTerminalToggle.addEventListener('click', () => setCollapsed(!isCollapsed()));
  ui.btnTerminalClear.addEventListener('click', () => {
    // The view only. The server keeps the history, and saying so stops this
    // reading as destructive.
    entries = [];
    render();
    showToast('View cleared. The server still has the history.', 'info');
  });
  ui.btnTerminalPopout.addEventListener('click', () => openLogWindow());

  for (const control of [ui.terminalShowReads, ui.terminalAllRepos]) {
    control.addEventListener('change', render);
  }
  ui.terminalFind.addEventListener('input', render);

  // Switching repositories changes what belongs on screen.
  subscribeTo(['activeRepo'], render);

  void wireShellButtons();
  connect();
}

function connect(): void {
  const source = new EventSource('/api/logs/stream');

  source.addEventListener('backlog', (event) => {
    entries = JSON.parse((event as MessageEvent<string>).data) as LogEntry[];
    render();
  });

  source.onmessage = (event) => {
    entries.push(JSON.parse((event as MessageEvent<string>).data) as LogEntry);

    // Bounded: a long session must not grow this without limit.
    if (entries.length > MAX_RENDERED * 2) {
      entries = entries.slice(-MAX_RENDERED);
    }

    if (isCollapsed()) {
      markUnseen();
      return;
    }
    render();
  };
}
