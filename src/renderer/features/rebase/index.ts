// The interactive rebase planner, and the panel that drives a running one.
//
// Two states in one modal, because they are two halves of one job: before a
// rebase you arrange the plan, and during one you answer for whatever git
// stopped on. Which half is showing is decided by git, not by the UI — a
// rebase left running by a previous session opens straight into the second.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { asInput } from '../../dom/elements';
import { el, fragment, icon, setHidden } from '../../dom/create';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import type { RebaseAction, RebasePlan, RebaseTodoItem } from '../../../shared/rebase-types';

const ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

/** What each action does, in the words the planner shows on hover. */
const ACTION_HELP: Record<RebaseAction, string> = {
  pick: 'Keep this commit as it is',
  reword: 'Keep the changes, change the message',
  edit: 'Stop here so the commit can be amended or split',
  squash: 'Fold into the commit above, keeping both messages',
  fixup: 'Fold into the commit above, discarding this message',
  drop: 'Remove this commit entirely'
};

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};

let plan: RebasePlan | null = null;

export function initRebase(elements: Elements, onChanged: () => Promise<void>): void {
  ui = elements;
  refreshAll = onChanged;
}

function planRow(item: RebaseTodoItem, index: number, total: number): HTMLLIElement {
  const select = el('select', { className: 'rebase-action', data: { index: String(index) } });
  select.setAttribute('aria-label', `Action for ${item.subject}`);

  for (const action of ACTIONS) {
    const option = el('option', { text: action, title: ACTION_HELP[action] });
    (option as HTMLOptionElement).value = action;
    (option as HTMLOptionElement).selected = action === item.action;
    select.appendChild(option);
  }

  const move = (direction: 'up' | 'down', disabled: boolean): HTMLButtonElement => {
    const button = el('button', {
      className: 'btn btn-icon btn-sm',
      title: direction === 'up' ? 'Move earlier' : 'Move later',
      data: { action: `move-${direction}`, index: String(index) },
      children: [icon(direction === 'up' ? 'arrow_upward' : 'arrow_downward', 14)]
    });
    (button as HTMLButtonElement).disabled = disabled;
    return button;
  };

  const meta = [
    item.oid.substring(0, 8),
    item.author,
    item.message === undefined ? '' : `→ ${item.message}`,
    item.autosquashedInto === undefined ? '' : `autosquashed into "${item.autosquashedInto}"`
  ]
    .filter((part) => part !== '')
    .join(' · ');

  return el('li', {
    className: `recovery-item${item.action === 'drop' ? ' rebase-dropped' : ''}`,
    data: { index: String(index) },
    children: [
      select,
      el('div', {
        className: 'recovery-item-main',
        children: [
          el('span', { className: 'recovery-label', text: item.subject }),
          el('span', { className: 'recovery-meta', text: meta })
        ]
      }),
      el('span', {
        className: 'recovery-actions',
        children: [
          move('up', index === 0),
          move('down', index === total - 1),
          el('button', {
            className: 'btn btn-icon btn-sm',
            title: 'Set the message this commit should get',
            data: { action: 'message', index: String(index) },
            children: [icon('edit_note', 14)]
          })
        ]
      })
    ]
  });
}

function renderPlan(): void {
  if (plan === null || plan.items.length === 0) {
    ui.rebasePlanList.replaceChildren(
      el('li', { className: 'empty-state', text: 'No commits between that base and HEAD' })
    );
    (ui.btnRebaseStart as HTMLButtonElement).disabled = true;
    return;
  }

  ui.rebasePlanList.replaceChildren(
    fragment(plan.items.map((item, index) => planRow(item, index, (plan as RebasePlan).items.length)))
  );
  (ui.btnRebaseStart as HTMLButtonElement).disabled = false;
}

function showValidation(messages: readonly string[]): void {
  setHidden(ui.rebaseValidation, messages.length === 0);
  ui.rebaseValidation.textContent = messages.join(' ');
}

async function loadPlan(): Promise<void> {
  const onto = asInput(ui.rebaseOnto).value.trim();
  if (onto === '') {
    showValidation(['Give a base commit — the one all of this should sit on top of.']);
    return;
  }

  showValidation([]);

  try {
    const result = await api.getRebasePlan(onto, asInput(ui.rebaseAutosquash).checked);
    plan = result.plan;
    renderPlan();

    const warning = result.warning;
    const published = warning.publishedCommits > 0;
    setHidden(ui.rebasePublishedWarning, !published);
    if (published) {
      ui.rebasePublishedWarning.textContent =
        `${warning.branch} tracks ${warning.upstream}, and ${warning.publishedCommits} of these commits are already on it. ` +
        'Rewriting them means anyone who has pulled will have to reconcile. The push afterwards will need --force-with-lease.';
    }
  } catch (error) {
    if (!isStale(error)) {
      showValidation([errorMessage(error, 'Could not read the commits for that base.')]);
    }
  }
}

/** Shows the planner or the progress panel, whichever git's state calls for. */
async function refreshState(): Promise<boolean> {
  try {
    const { status, remainder } = await api.getRebaseStatus();

    setHidden(ui.rebasePlanner, status.inProgress);
    setHidden(ui.rebaseProgress, !status.inProgress);

    if (!status.inProgress) {
      return false;
    }

    const parts = [
      `Step ${status.step} of ${status.totalSteps}.`,
      status.stoppedSubject === null ? '' : `Stopped at "${status.stoppedSubject}".`,
      status.conflictedFiles.length > 0
        ? `${status.conflictedFiles.length} file(s) still conflicted — resolve them, stage them, then continue.`
        : status.splitInProgress
          ? `Splitting: ${remainder?.staged ?? 0} staged, ${remainder?.unstaged ?? 0} not yet. Commit each part, then continue.`
          : 'Stopped for editing. Amend the commit, split it, or continue.'
    ];

    ui.rebaseProgressSummary.textContent = parts.filter((part) => part !== '').join(' ');

    ui.rebaseConflictList.replaceChildren(
      status.conflictedFiles.length === 0
        ? el('li', { className: 'empty-state', text: 'Nothing conflicted' })
        : fragment(
            status.conflictedFiles.map((file) =>
              el('li', {
                className: 'recovery-item',
                children: [
                  el('div', {
                    className: 'recovery-item-main',
                    children: [el('span', { className: 'recovery-label', text: file })]
                  })
                ]
              })
            )
          )
    );

    (ui.btnRebaseSplit as HTMLButtonElement).disabled = !status.canSplit || status.splitInProgress;
    return true;
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read the rebase state: ${errorMessage(error)}`, 'error');
    }
    return false;
  }
}

export async function openRebase(defaultOnto = ''): Promise<void> {
  setHidden(ui.rebaseModal, false);
  setHidden(ui.rebasePublishedWarning, true);
  showValidation([]);

  const running = await refreshState();
  if (running) {
    return;
  }

  if (defaultOnto !== '') {
    asInput(ui.rebaseOnto).value = defaultOnto;
    await loadPlan();
  }
}

export function closeRebase(): void {
  setHidden(ui.rebaseModal, true);
}

/** Opens straight into the progress panel when a rebase is already running. */
export async function openIfRebasing(): Promise<void> {
  const { status } = await api.getRebaseStatus();
  if (status.inProgress) {
    await openRebase();
  }
}

async function startRebase(): Promise<void> {
  if (plan === null) {
    return;
  }

  const dropped = plan.items.filter((item) => item.action === 'drop').length;
  const rewritten = plan.items.length - dropped;

  const { confirmed } = await confirmDialog(
    `Rewrite ${rewritten} ${rewritten === 1 ? 'commit' : 'commits'}${dropped > 0 ? ` and drop ${dropped}` : ''}?\n\n` +
      'Every commit from here up gets a new object name. A recovery point is recorded first.',
    { title: 'Start interactive rebase', confirmLabel: 'Rebase', danger: true }
  );
  if (!confirmed) {
    return;
  }

  try {
    const result = await api.startRebase(plan);
    logToTerminal(`git rebase -i ${plan.onto.substring(0, 8)}`, 'cmd');

    if (result.stopped) {
      showToast('Rebase stopped — see what it is waiting for.', 'info', 6000);
    } else {
      showToast('Rebase finished.', 'success');
      closeRebase();
    }

    await refreshAll();
    await refreshState();
  } catch (error) {
    if (!isStale(error)) {
      const text = errorMessage(error, 'The rebase could not be started.');
      showValidation([text]);
      logToTerminal(text, 'error');
    }
  }
}

async function step(which: 'continue' | 'skip' | 'abort'): Promise<void> {
  if (which === 'abort') {
    const { confirmed } = await confirmDialog(
      'Abort the rebase and put the branch back where it started?',
      { title: 'Abort rebase', confirmLabel: 'Abort', danger: true }
    );
    if (!confirmed) {
      return;
    }
  }

  try {
    const result = await api.stepRebase(which);
    logToTerminal(`git rebase --${which}`, 'cmd');

    if (!result.status.inProgress) {
      showToast(which === 'abort' ? 'Rebase aborted.' : 'Rebase finished.', 'success');
      closeRebase();
    }

    await refreshAll();
    await refreshState();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, `Could not ${which} the rebase.`), 'error', 8000);
    }
  }
}

async function split(): Promise<void> {
  const { confirmed } = await confirmDialog(
    'Undo this commit, keeping its changes in the working tree?\n\nStage and commit each part in turn, then continue the rebase.',
    { title: 'Split commit', confirmLabel: 'Split' }
  );
  if (!confirmed) {
    return;
  }

  try {
    await api.splitRebaseCommit();
    logToTerminal('git reset HEAD^', 'cmd');
    showToast('Commit reset. Stage and commit each part, then continue.', 'info', 7000);

    await refreshAll();
    await refreshState();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not split the commit.'), 'error', 8000);
    }
  }
}

export function wireRebase(): void {
  ui.btnCloseRebaseModal.addEventListener('click', () => closeRebase());
  ui.btnRebaseReload.addEventListener('click', () => void loadPlan());
  ui.rebaseAutosquash.addEventListener('change', () => void loadPlan());
  ui.btnRebaseStart.addEventListener('click', () => void startRebase());

  ui.btnRebaseContinue.addEventListener('click', () => void step('continue'));
  ui.btnRebaseSkip.addEventListener('click', () => void step('skip'));
  ui.btnRebaseAbort.addEventListener('click', () => void step('abort'));
  ui.btnRebaseSplit.addEventListener('click', () => void split());

  ui.rebaseOnto.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      void loadPlan();
    }
  });

  ui.rebasePlanList.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || plan === null) {
      return;
    }

    const index = Number.parseInt(select.dataset['index'] ?? '', 10);
    const item = plan.items[index];
    if (item) {
      item.action = select.value as RebaseAction;
      renderPlan();
    }
  });

  ui.rebasePlanList.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!button || plan === null) {
      return;
    }

    const index = Number.parseInt(button.dataset['index'] ?? '', 10);
    const items = plan.items;

    switch (button.dataset['action']) {
      case 'move-up':
        if (index > 0) {
          [items[index - 1], items[index]] = [items[index] as RebaseTodoItem, items[index - 1] as RebaseTodoItem];
          renderPlan();
        }
        return;
      case 'move-down':
        if (index < items.length - 1) {
          [items[index], items[index + 1]] = [items[index + 1] as RebaseTodoItem, items[index] as RebaseTodoItem];
          renderPlan();
        }
        return;
      case 'message':
        void (async () => {
          const item = items[index];
          if (!item) {
            return;
          }

          const message = await promptDialog({
            title: 'New commit message',
            label: item.subject,
            type: 'text'
          });
          if (message === null) {
            return;
          }

          item.message = message.trim();
          // Asking for a message is asking for a reword; saying so beats
          // silently recording one that a `pick` would ignore.
          if (item.message !== '' && item.action === 'pick') {
            item.action = 'reword';
          }
          renderPlan();
        })();
    }
  });
}
