// First run: is anything missing that this application needs?
//
// Multi-Git shells out to git for everything, so on a machine without git it is
// a window with nothing behind it. That used to be discovered at the first
// click, as a raw spawn error from a failed process -- which tells a user
// nothing they can act on and makes the app look broken rather than
// incomplete.
//
// So the welcome screen asks once, and says three different things depending on
// what it finds:
//
//   * Git missing -- the three starting buttons are disabled, because every one
//     of them would fail. This is the only case that blocks.
//   * Git Bash missing -- a note, not a button of its own: it arrives with Git
//     for Windows, and offering an "install" for it would be offering the same
//     download twice.
//   * GitHub CLI missing -- optional, with the features it costs named plainly.
//     Those features are disabled elsewhere rather than left to fail.
//
// Once everything required is present this never appears again.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { el, icon, setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { showToast } from '../../ui/toast';
import { withButtonBusy } from '../../ui/busy';
import { update } from '../../state/store';
import type { PrerequisiteReport, PrerequisiteState } from '../../../shared/prerequisite-types';

let ui: Elements;
let report: PrerequisiteReport | null = null;

/** The last answer, for anything that needs to know whether `gh` is usable. */
export function prerequisites(): PrerequisiteReport | null {
  return report;
}

/** Whether the GitHub CLI is installed and signed in. */
export function githubReady(): boolean {
  return report?.tools.find((tool) => tool.id === 'gh')?.signedIn === true;
}

export function initSetup(elements: Elements): void {
  ui = elements;

  ui.btnSetupRecheck.addEventListener('click', () => {
    void withButtonBusy(ui.btnSetupRecheck, () => refreshPrerequisites());
  });
}

/**
 * Asks what is installed and redraws.
 *
 * Called at startup and whenever the user says they have finished installing
 * something -- the app cannot know when a winget window has done its work, so
 * re-checking is a button rather than a guess.
 */
export async function refreshPrerequisites(): Promise<void> {
  try {
    report = (await api.getPrerequisites()).prerequisites;
  } catch (error) {
    if (isStale(error)) {
      return;
    }
    // Not being able to ask is not the same as something being missing, and
    // guessing "missing" would block a working machine.
    showToast(errorMessage(error, 'Could not check what is installed.'), 'warn', 6000);
    return;
  }

  // Anything that gates on `gh` reads this from the store rather than calling
  // back here, so a feature does not have to know where the answer came from.
  update({ githubReady: githubReady() });

  render();
}

function statusIcon(tool: PrerequisiteState): HTMLElement {
  if (!tool.installed) {
    return icon(tool.id === 'gh' ? 'help' : 'error', 20);
  }
  // Installed but unusable is its own state, and only `gh` has it.
  return icon(tool.signedIn === false ? 'warning' : 'check_circle', 20);
}

function statusClass(tool: PrerequisiteState): string {
  if (!tool.installed) {
    return tool.id === 'gh' ? 'setup-item-optional' : 'setup-item-missing';
  }
  return tool.signedIn === false ? 'setup-item-warn' : 'setup-item-ok';
}

/** The button for one row, or null where there is nothing to press. */
function actionFor(tool: PrerequisiteState): HTMLElement | null {
  // Git Bash comes with Git for Windows. Once git is here and Git Bash is not,
  // the install is broken rather than absent, and a second download button
  // would not fix it.
  if (tool.id === 'git-bash' || (tool.installed && tool.signedIn !== false)) {
    return null;
  }

  if (tool.installed && tool.signedIn === false) {
    // Nothing to install: they need to sign in, which is theirs to do in a
    // terminal. The button opens one in the right place.
    const button = el('button', {
      className: 'btn btn-secondary btn-sm',
      text: 'Sign in',
      attrs: { type: 'button', title: 'Opens a terminal to run gh auth login' }
    });

    button.addEventListener('click', () => {
      void openSignIn();
    });
    return button;
  }

  const label = report?.canInstall === true ? 'Install' : 'Download';
  const button = el('button', {
    className: tool.id === 'gh' ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm',
    text: label,
    attrs: { type: 'button' }
  });

  button.addEventListener('click', () => {
    void withButtonBusy(button, () => install(tool));
  });

  return button;
}

async function install(tool: PrerequisiteState): Promise<void> {
  const desktop = window.desktopApi;
  if (!desktop?.installPrerequisite) {
    showToast(
      'Installing needs the desktop app. In a browser, install it yourself and press Check again.',
      'warn',
      8000
    );
    return;
  }

  try {
    const outcome = await desktop.installPrerequisite(tool.id);

    showToast(
      outcome.started
        ? `Installing ${tool.label} in a terminal window. Press Check again when it finishes.`
        : `Opened the ${tool.label} download page. Press Check again once it is installed.`,
      'info',
      9000
    );
  } catch (error) {
    showToast(errorMessage(error, `Could not start installing ${tool.label}.`), 'error', 8000);
  }
}

async function openSignIn(): Promise<void> {
  // `gh auth login` is interactive, so it needs a real terminal rather than
  // something this application drives.
  showToast('Run "gh auth login" in the terminal that opens, then press Check again.', 'info', 9000);

  try {
    await window.desktopApi?.openShell?.(
      // No repository is needed to sign in, and the home directory is a
      // sensible place to land.
      '',
      'terminal'
    );
  } catch {
    showToast('Open a terminal and run "gh auth login".', 'info', 8000);
  }
}

function row(tool: PrerequisiteState): HTMLLIElement {
  const action = actionFor(tool);

  return el('li', {
    className: `setup-item ${statusClass(tool)}`,
    children: [
      statusIcon(tool),
      el('div', {
        className: 'setup-item-text',
        children: [
          el('span', {
            className: 'setup-item-name',
            text: tool.version ? `${tool.label} — ${tool.version}` : tool.label
          }),
          el('span', { className: 'setup-item-detail', text: tool.detail })
        ]
      }),
      action
    ]
  }) as HTMLLIElement;
}

function render(): void {
  if (report === null) {
    return;
  }

  const missing = report.tools.filter((tool) => !tool.installed || tool.signedIn === false);

  // Nothing to say once everything required is here and gh is either working or
  // deliberately absent.
  const worthShowing = report.blocked || missing.length > 0;
  setHidden(ui.setupPanel, !worthShowing);

  if (!worthShowing) {
    return;
  }

  ui.setupTitle.textContent = report.blocked ? 'Git is required' : 'Finish setting up';
  ui.setupSummary.textContent = report.blocked
    ? 'Multi-Git runs Git for everything it does. Install it to continue.'
    : 'Everything required is here. These are optional.';

  ui.setupList.replaceChildren(...report.tools.map(row));

  // Opening, creating or cloning would each fail at the first command, so they
  // are shut rather than left to disappoint.
  for (const button of [ui.btnOverlayOpen, ui.btnOverlayCreate, ui.btnOverlayClone]) {
    (button as HTMLButtonElement).disabled = report.blocked;
    button.title = report.blocked ? 'Install Git first' : '';
  }
}
