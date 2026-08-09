// The operations bar.
//
// The server side of this landed in Phase 0 and has had callers since Phase 2,
// but nothing ever showed it: a long fetch was a spinner, and the only way out
// of one against an unreachable host was the five-minute timeout. This is the
// missing half.
//
// It does not make the app non-blocking. The busy overlay still covers the main
// body while an operation runs; the bar sits outside that body precisely so its
// Cancel button stays reachable while it does.
import { cancelOperation, subscribeToOperations } from '../../api/operations';
import { el, fragment, icon, setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { isTerminalOperationState } from '../../../shared/operation-types';
import type { OperationProgress } from '../../../shared/operation-types';

let ui: Elements;
let expanded = false;
let latest: OperationProgress[] = [];

/**
 * When each operation was first seen, so a duration can be shown.
 *
 * The registry does not send a start time, and adding one would change a shared
 * type for a purely presentational need. First sight is close enough for a
 * number whose job is to say "this is taking a while".
 */
const firstSeen = new Map<string, number>();
let ticker: ReturnType<typeof setInterval> | null = null;

export function initOperations(elements: Elements): void {
  ui = elements;

  ui.operationsSummary.addEventListener('click', () => {
    expanded = !expanded;
    render(latest);
  });

  // One delegated listener: rows are rebuilt on every event, and a closure per
  // row would be rebuilt with them.
  ui.operationsList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-operation-id]');
    const id = button?.dataset['operationId'];
    const what = button?.dataset['action'];

    if (!id || !what) {
      return;
    }
    if (what === 'cancel') {
      void requestCancel(id);
    }
    if (what === 'copy') {
      void copyDiagnostics(id);
    }
  });

  subscribeToOperations(render);
}

async function requestCancel(id: string): Promise<void> {
  const stopped = await cancelOperation(id);

  showToast(
    stopped
      ? 'Asked it to stop. Anything already sent to a remote has been sent.'
      : 'That one had already finished.',
    stopped ? 'info' : 'success'
  );
}

/**
 * Copies what is known about an operation.
 *
 * Only fields the registry publishes, which are already redacted — the runner
 * scrubs secrets from stdout, stderr and the recorded argv before anything
 * reaches here, so there is no separate redaction step to forget.
 */
async function copyDiagnostics(id: string): Promise<void> {
  const operation = latest.find((entry) => entry.id === id);
  if (!operation) {
    return;
  }

  const lines = [
    `id: ${operation.id}`,
    `kind: ${operation.kind}`,
    `state: ${operation.state}`,
    ...(operation.repoPath ? [`repository: ${operation.repoPath}`] : []),
    ...(operation.message ? [`message: ${operation.message}`] : []),
    ...(operation.total !== undefined
      ? [`progress: ${operation.completed ?? 0}/${operation.total}`]
      : []),
    `duration: ${elapsedText(operation.id)}`
  ];

  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    showToast('Diagnostics copied', 'success');
  } catch {
    // Clipboard access can be refused; the log window is always available.
    logToTerminal(lines.join('\n'), 'info');
    showToast('Clipboard unavailable — written to the Terminal Log instead', 'info');
  }
}

function elapsedText(id: string): string {
  const started = firstSeen.get(id);
  if (started === undefined) {
    return '—';
  }

  const seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function active(operations: readonly OperationProgress[]): OperationProgress[] {
  return operations.filter((operation) => !isTerminalOperationState(operation.state));
}

function render(operations: OperationProgress[]): void {
  latest = operations;

  const now = Date.now();
  for (const operation of operations) {
    if (!firstSeen.has(operation.id)) {
      firstSeen.set(operation.id, now);
    }
  }

  const running = active(operations);
  renderSummary(running);
  renderList(operations);

  setHidden(ui.operationsPanel, !expanded);
  ui.operationsSummary.setAttribute('aria-expanded', String(expanded));

  // The elapsed time only needs a ticker while something is running.
  if (running.length > 0 && ticker === null) {
    ticker = setInterval(() => render(latest), 1000);
  } else if (running.length === 0 && ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

function renderSummary(running: readonly OperationProgress[]): void {
  const bar = ui.operationsBar;
  const first = running[0];

  if (!first) {
    bar.dataset['state'] = 'idle';
    ui.operationsHeadline.textContent = 'Nothing running';
    ui.operationsElapsed.textContent = '';
    setHidden(ui.operationsCount, true);
    return;
  }

  bar.dataset['state'] = 'running';
  ui.operationsHeadline.textContent = first.message ?? first.kind;
  ui.operationsElapsed.textContent = elapsedText(first.id);

  // A count only when there is more than one, so the common case stays quiet.
  const more = running.length - 1;
  ui.operationsCount.textContent = more > 0 ? `+${more}` : '';
  setHidden(ui.operationsCount, more <= 0);
}

function renderList(operations: readonly OperationProgress[]): void {
  if (operations.length === 0) {
    ui.operationsList.replaceChildren(
      el('li', { className: 'empty-state', text: 'Nothing has run yet' })
    );
    return;
  }

  // Running first, then the most recently finished: the ones still going are
  // the ones with actions attached.
  const ordered = [...operations].sort((a, b) => {
    const aRunning = isTerminalOperationState(a.state) ? 1 : 0;
    const bRunning = isTerminalOperationState(b.state) ? 1 : 0;
    return aRunning - bRunning;
  });

  ui.operationsList.replaceChildren(fragment(ordered.map((operation) => buildRow(operation))));
}

function buildRow(operation: OperationProgress): HTMLLIElement {
  const running = !isTerminalOperationState(operation.state);

  const actions = el('span', { className: 'worktree-actions' });

  if (running && operation.cancellable) {
    actions.appendChild(
      rowButton('cancel', operation.id, 'stop_circle', 'Cancel this operation', true)
    );
  }
  actions.appendChild(
    rowButton('copy', operation.id, 'content_copy', 'Copy redacted diagnostics')
  );

  const detail: string[] = [operation.kind];
  if (operation.total !== undefined) {
    detail.push(`${operation.completed ?? 0}/${operation.total}`);
  }
  if (operation.repoPath) {
    detail.push(operation.repoPath);
  }

  return el('li', {
    className: `worktree-item operation-row operation-${operation.state}`,
    children: [
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', {
            className: 'worktree-name',
            text: operation.message ?? operation.kind,
            title: operation.message ?? operation.kind
          }),
          el('span', { className: 'worktree-meta', text: detail.join(' · ') })
        ]
      }),
      el('span', { className: 'operation-state', text: `${operation.state} · ${elapsedText(operation.id)}` }),
      actions
    ]
  }) as HTMLLIElement;
}

function rowButton(
  action: string,
  id: string,
  glyph: string,
  title: string,
  danger = false
): HTMLButtonElement {
  return el('button', {
    className: `btn btn-icon btn-sm${danger ? ' btn-text-danger' : ''}`,
    title,
    data: { action, operationId: id },
    children: [icon(glyph, 14)]
  }) as HTMLButtonElement;
}
