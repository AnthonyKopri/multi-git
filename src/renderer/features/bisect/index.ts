// The Bisect tab.
//
// Two ways through: mark each step by hand, or let a saved command decide. The
// automated run is desktop-only — it starts a program, and that capability is
// not on the HTTP API at all — so in browser mode the button is absent rather
// than present and failing.
import * as api from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { el, icon } from '../../dom/create';
import { getState } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import { registerHubTab } from '../repo-hub';
import type { BisectSession, BisectVerdict } from '../../../shared/bisect-types';
import type { BisectCommandDefinition } from '../../../shared/config-types';

let session: BisectSession = { state: 'none' };
let commands: BisectCommandDefinition[] = [];
let refreshAll: () => Promise<void> = async () => {};

export function initBisect(hooks: { refreshAll: () => Promise<void> }): void {
  refreshAll = hooks.refreshAll;
  registerHubTab('bisect', { render: renderPanel });
}

/** True when a program can be started at all. */
function canRunCommands(): boolean {
  return typeof window.desktopApi?.runBisect === 'function';
}

async function renderPanel(panel: HTMLElement): Promise<void> {
  try {
    const state = await api.getBisect();
    session = state.session;
    commands = state.commands;
  } catch (error) {
    showToast(errorMessage(error), 'error');
    session = { state: 'none' };
  }

  panel.replaceChildren(
    el('p', {
      className: 'modal-desc',
      text: 'Bisect finds the commit that introduced something by checking out the middle of a range and asking whether it is good or bad. The session lives in the repository, so it survives closing the app — and has to be reset rather than abandoned.'
    }),
    session.state === 'none' ? buildStart() : buildSession(),
    ...(canRunCommands() ? [buildCommands()] : [buildDesktopOnlyNote()])
  );
}

function buildStart(): HTMLElement {
  const good = el('input', {
    attrs: { type: 'text', placeholder: 'A commit or tag known to be fine' }
  }) as HTMLInputElement;
  const bad = el('input', {
    attrs: { type: 'text', placeholder: 'A commit known to be broken' }
  }) as HTMLInputElement;
  bad.value = getState().status?.branch ?? 'HEAD';

  const start = el('button', {
    className: 'btn btn-primary',
    children: [icon('play_arrow', 16), el('span', { text: 'Start bisect' })]
  }) as HTMLButtonElement;

  start.addEventListener('click', () => {
    void withButtonBusy(start, async () => {
      try {
        session = (await api.startBisect(good.value.trim(), bad.value.trim())).session;
        showToast('Bisect started', 'success');
        await refreshAll();
        await refreshPanel();
      } catch (error) {
        showToast(errorMessage(error), 'error');
      }
    });
  });

  return el('section', {
    children: [
      el('div', { className: 'section-header', children: [el('h4', { text: 'Start' })] }),
      el('div', {
        className: 'worktree-form',
        children: [
          el('div', {
            className: 'form-row',
            children: [el('label', { text: 'Known good' }), good]
          }),
          el('div', { className: 'form-row', children: [el('label', { text: 'Known bad' }), bad] })
        ]
      }),
      el('div', { className: 'btn-group', children: [start] })
    ]
  });
}

function buildSession(): HTMLElement {
  if (session.state === 'complete') {
    return el('section', {
      children: [
        el('div', { className: 'section-header', children: [el('h4', { text: 'Result' })] }),
        el('div', {
          className: 'inline-feedback success',
          children: [
            el('p', { text: `First bad commit: ${session.firstBadOid ?? 'unknown'}` }),
            ...(session.firstBadSubject ? [el('p', { text: session.firstBadSubject })] : [])
          ]
        }),
        el('div', { className: 'btn-group', children: [resetButton()] })
      ]
    });
  }

  const verdicts = (['good', 'bad', 'skip'] as const).map((verdict) => {
    const button = el('button', {
      className: `btn btn-sm ${verdict === 'bad' ? 'btn-danger' : 'btn-secondary'}`,
      title:
        verdict === 'skip'
          ? 'This commit cannot be judged — it does not build, or the test cannot run here'
          : `Mark the current commit as ${verdict}`,
      text: verdict
    }) as HTMLButtonElement;

    button.addEventListener('click', () => {
      void withButtonBusy(button, () => mark(verdict));
    });

    return button;
  });

  const progress =
    session.stepsRemaining !== undefined
      ? `About ${session.stepsRemaining} more step(s), ${session.remaining ?? '?'} commit(s) left in the range.`
      : '';

  return el('section', {
    children: [
      el('div', { className: 'section-header', children: [el('h4', { text: 'In progress' })] }),
      el('div', {
        className: 'worktree-item',
        children: [
          el('div', {
            className: 'worktree-main',
            children: [
              el('span', {
                className: 'worktree-name',
                text: session.currentSubject ?? session.currentOid ?? 'unknown commit'
              }),
              el('span', { className: 'worktree-meta', text: session.currentOid ?? '' })
            ]
          })
        ]
      }),
      ...(progress ? [el('p', { className: 'modal-desc', text: progress })] : []),
      el('div', { className: 'btn-group', children: [...verdicts, resetButton()] })
    ]
  });
}

function resetButton(): HTMLButtonElement {
  const button = el('button', {
    className: 'btn btn-text btn-sm',
    title: 'End the bisect and go back to where it started',
    text: 'Reset'
  }) as HTMLButtonElement;

  button.addEventListener('click', () => {
    void withButtonBusy(button, async () => {
      session = (await api.resetBisect()).session;
      showToast('Bisect reset', 'success');
      await refreshAll();
      await refreshPanel();
    });
  });

  return button;
}

async function mark(verdict: BisectVerdict): Promise<void> {
  try {
    session = (await api.markBisect(verdict)).session;
    await refreshAll();
    await refreshPanel();
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
}

function buildDesktopOnlyNote(): HTMLElement {
  return el('div', {
    className: 'inline-warning',
    children: [
      el('p', {
        text: 'Running a test command automatically is only available in the desktop app. Starting a program is not something the local web server offers.'
      })
    ]
  });
}

function buildCommands(): HTMLElement {
  const list = el('ul', {
    className: 'worktree-list',
    children:
      commands.length === 0
        ? [el('li', { className: 'empty-state', text: 'No test commands saved' })]
        : commands.map((definition) => buildCommandRow(definition))
  });

  const label = el('input', {
    attrs: { type: 'text', placeholder: 'Unit tests' }
  }) as HTMLInputElement;
  const executable = el('input', {
    attrs: { type: 'text', placeholder: 'npm' }
  }) as HTMLInputElement;
  const args = el('input', {
    attrs: { type: 'text', placeholder: 'test' }
  }) as HTMLInputElement;

  const save = el('button', {
    className: 'btn btn-secondary btn-sm',
    children: [icon('save', 16), el('span', { text: 'Save command' })]
  }) as HTMLButtonElement;

  save.addEventListener('click', () => {
    void withButtonBusy(save, async () => {
      try {
        commands = (
          await api.saveBisectCommand({
            label: label.value.trim() || executable.value.trim(),
            executable: executable.value.trim(),
            // Split on whitespace into an argument vector. Never a command
            // line: the arguments stay separate all the way to spawn.
            args: args.value.split(/\s+/).filter((value) => value !== '')
          })
        ).commands;

        showToast('Command saved', 'success');
        await refreshPanel();
      } catch (error) {
        showToast(errorMessage(error), 'error');
      }
    });
  });

  return el('section', {
    children: [
      el('div', {
        className: 'section-header',
        children: [el('h4', { text: 'Automated runs' })]
      }),
      el('p', {
        className: 'modal-desc',
        text: 'Exit code 0 marks the commit good, 125 skips it, anything else marks it bad. The command runs argv-only with no shell, and you see it before it starts.'
      }),
      list,
      el('div', {
        className: 'worktree-form',
        children: [
          el('div', { className: 'form-row', children: [el('label', { text: 'Name' }), label] }),
          el('div', {
            className: 'form-row',
            children: [el('label', { text: 'Executable' }), executable]
          }),
          el('div', { className: 'form-row', children: [el('label', { text: 'Arguments' }), args] })
        ]
      }),
      el('div', { className: 'btn-group', children: [save] })
    ]
  });
}

function buildCommandRow(definition: BisectCommandDefinition): HTMLLIElement {
  const run = el('button', {
    className: 'btn btn-icon btn-sm',
    title: `Run ${definition.label} at each step`,
    children: [icon('play_arrow', 14)]
  }) as HTMLButtonElement;

  run.disabled = session.state !== 'active';
  run.addEventListener('click', () => void confirmRun(definition, run));

  return el('li', {
    className: 'worktree-item',
    children: [
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', { className: 'worktree-name', text: definition.label }),
          el('span', {
            className: 'worktree-meta',
            // The exact command, so what will run is visible before it does.
            text: [definition.executable, ...definition.args].join(' ')
          })
        ]
      }),
      el('span', { className: 'worktree-actions', children: [run] })
    ]
  }) as HTMLLIElement;
}

async function confirmRun(
  definition: BisectCommandDefinition,
  button: HTMLButtonElement
): Promise<void> {
  const commandLine = [definition.executable, ...definition.args].join(' ');

  // Confirmed once per run, showing the exact command. It is the user's
  // machine and their command, but starting a program should never be a
  // surprise.
  const { confirmed } = await confirmDialog(
    `This will run the following at each bisect step, in this repository:\n\n${commandLine}\n\nExit code 0 means good, 125 means skip, anything else means bad.`,
    { title: 'Run a test command', confirmLabel: 'Run' }
  );

  if (!confirmed) {
    return;
  }

  await withButtonBusy(button, async () => {
    try {
      const outcome = await window.desktopApi?.runBisect?.({
        repoPath: getState().activeRepo ?? '',
        commandId: definition.id
      });

      if (!outcome) {
        showToast('The desktop bridge is unavailable.', 'error');
        return;
      }

      session = outcome.session;

      for (const step of outcome.steps) {
        logToTerminal(
          `bisect ${step.verdict} (exit ${step.exitCode}) ${step.oid.slice(0, 8)} ${step.subject ?? ''}`,
          step.verdict === 'bad' ? 'error' : 'info'
        );
      }

      showToast(
        outcome.cancelled
          ? `Cancelled after ${outcome.steps.length} step(s)`
          : session.state === 'complete'
            ? `Found it: ${session.firstBadOid?.slice(0, 8) ?? 'unknown'}`
            : `${outcome.steps.length} step(s) judged`,
        outcome.cancelled ? 'info' : 'success'
      );

      await refreshAll();
      await refreshPanel();
    } catch (error) {
      showToast(errorMessage(error), 'error', 8000);
    }
  });
}

async function refreshPanel(): Promise<void> {
  const panel = document.getElementById('hub-panel-bisect');
  if (panel) {
    await renderPanel(panel);
  }
}
