// The terminal edition, from the desktop: offered once on the welcome screen,
// and managed from Settings afterwards.
//
// The desktop build carries the terminal edition. Enabling it copies it to a
// per-user folder and puts `multi-git` on PATH; the main process does all of
// that (src/server/terminal/install.ts), and this only asks and shows. Every
// call is a no-argument IPC channel, so nothing on this page names a path.
//
// None of it blocks the desktop app. A browser session, a development build
// without the bundled payload, and a user who skipped it all just see less.
import { el, icon, setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { showToast } from '../../ui/toast';
import { withButtonBusy } from '../../ui/busy';
import { settingGroup, settingItem, settingNote } from '../../ui/setting-rows';
import { errorMessage } from '../../api/client';
import { confirmDialog } from '../../ui/dialogs';
import type { TerminalInstallationStatus, TerminalState } from '../../../shared/terminal-types';

let ui: Elements;
let status: TerminalInstallationStatus | null = null;

/** Whether this window can manage the terminal edition at all. */
export function isAvailable(): boolean {
  return typeof window.desktopApi?.terminalStatus === 'function';
}

export function initTerminalEdition(elements: Elements): void {
  ui = elements;

  ui.btnTerminalSetupEnable.addEventListener('click', () => {
    void withButtonBusy(ui.btnTerminalSetupEnable, async () => {
      await enable();
      renderSetupCard();
    });
  });

  ui.btnTerminalSetupSkip.addEventListener('click', () => {
    void withButtonBusy(ui.btnTerminalSetupSkip, async () => {
      try {
        status = (await window.desktopApi?.skipTerminalSetup()) ?? status;
        showToast('Skipped. You can enable the multi-git command later in Settings.', 'info', 6000);
      } catch (error) {
        showToast(errorMessage(error, 'Could not save that choice.'), 'error', 6000);
      }
      renderSetupCard();
    });
  });
}

/** Asks the main process for the current state, and redraws the welcome card. */
export async function refreshTerminalStatus(): Promise<TerminalInstallationStatus | null> {
  if (!isAvailable()) {
    return null;
  }
  try {
    status = await window.desktopApi!.terminalStatus();
  } catch {
    // Not knowing is not a reason to show anything, or to block anything.
    status = null;
  }
  renderSetupCard();
  return status;
}

/** The toast for a status just reached, in the words the status carries. */
function announce(next: TerminalInstallationStatus): void {
  const tone = next.state === 'ready' ? 'success' : next.state === 'shadowed' || next.state === 'damaged' ? 'warn' : 'info';
  showToast(next.message, tone, 9000);
}

async function enable(): Promise<void> {
  try {
    status = await window.desktopApi!.enableTerminal();
    announce(status);
  } catch (error) {
    showToast(errorMessage(error, 'Could not enable the terminal edition.'), 'error', 9000);
  }
}

// ---------- the welcome card ----------

function renderSetupCard(): void {
  const offer = status !== null && status.state === 'not-installed' && status.setupChoice === null;
  setHidden(ui.terminalSetupPanel, !offer);
  if (!offer || status === null) {
    return;
  }
  ui.terminalSetupChanges.replaceChildren(
    ...status.plannedChanges.map((change) => el('li', { text: change }))
  );
}

// ---------- Settings ----------

const BADGES: Record<TerminalState, { text: string; icon: string; ok: boolean }> = {
  unavailable: { text: 'Not included', icon: 'block', ok: false },
  'not-installed': { text: 'Not enabled', icon: 'radio_button_unchecked', ok: false },
  ready: { text: 'Ready', icon: 'check_circle', ok: true },
  'reopen-terminal': { text: 'Open a new terminal', icon: 'restart_alt', ok: true },
  shadowed: { text: 'Another multi-git comes first', icon: 'warning', ok: false },
  damaged: { text: 'Needs repair', icon: 'error', ok: false }
};

function button(label: string, iconName: string, primary = false): HTMLButtonElement {
  return el('button', {
    className: `btn ${primary ? 'btn-primary' : 'btn-secondary'}`,
    attrs: { type: 'button' },
    children: [icon(iconName, 16), el('span', { text: label })]
  }) as HTMLButtonElement;
}

function copyText(text: string, what: string): void {
  void navigator.clipboard.writeText(text).then(
    () => showToast(`${what} copied.`, 'success'),
    () => showToast(`Could not copy the ${what.toLowerCase()}.`, 'error')
  );
}

/**
 * The Terminal & agents rows for Settings. `rerender` redraws the settings
 * window after anything here changes the installation.
 */
export function buildTerminalSettings(rerender: () => void): HTMLElement[] {
  if (!isAvailable()) {
    return [
      settingGroup([
        settingNote('info', 'The terminal edition is managed from the desktop app. In a browser, download it from the releases page.')
      ])
    ];
  }
  if (status === null) {
    return [settingGroup([settingNote('hourglass_empty', 'Checking the terminal edition…')])];
  }

  const current = status;
  const badge = BADGES[current.state];
  const installed = current.installedVersion !== null;

  const act = (control: HTMLButtonElement, work: () => Promise<TerminalInstallationStatus | void>): void => {
    control.addEventListener('click', () => {
      void withButtonBusy(control, async () => {
        try {
          const next = await work();
          if (next) {
            status = next;
            announce(next);
          }
        } catch (error) {
          showToast(errorMessage(error, 'That did not work.'), 'error', 9000);
        }
        renderSetupCard();
        rerender();
      });
    });
  };

  const actions: HTMLButtonElement[] = [];
  if (current.state !== 'unavailable') {
    const label = !installed ? 'Enable' : current.state === 'damaged' ? 'Repair' : current.canUpgrade ? `Update to ${current.bundledVersion}` : 'Repair';
    const primary = !installed || current.state === 'damaged' || current.canUpgrade;
    const enableButton = button(label, installed ? 'build' : 'terminal', primary);
    act(enableButton, () => window.desktopApi!.enableTerminal());
    actions.push(enableButton);
  }
  const recheck = button('Check again', 'refresh');
  act(recheck, () => window.desktopApi!.terminalStatus());
  actions.push(recheck);

  if (installed) {
    const open = button('Open terminal UI', 'open_in_new');
    act(open, async () => {
      await window.desktopApi!.openTerminalUi();
    });
    actions.unshift(open);

    const remove = button('Remove', 'delete');
    act(remove, async () => {
      const { confirmed } = await confirmDialog(
        'This removes the multi-git command, the terminal edition and the PATH changes it made. Your repositories, settings and saved passphrases are not affected.',
        { title: 'Remove the terminal edition?', confirmLabel: 'Remove', danger: true }
      );
      return confirmed ? window.desktopApi!.removeTerminal() : undefined;
    });
    actions.push(remove);
  }

  const rows: HTMLElement[] = [
    settingItem({
      label: 'The multi-git command',
      description: current.message,
      control: el('span', {
        className: `setup-badge ${badge.ok ? 'setup-badge-ok' : 'setup-badge-missing'}`,
        children: [icon(badge.icon, 14), el('span', { text: badge.text })]
      })
    }),
    settingItem({
      label: 'Versions',
      description:
        `Included with this app: ${current.bundledVersion ?? 'none'}. Installed: ${current.installedVersion ?? 'none'}. ` +
        'The installed copy updates separately, with "multi-git update", and is never replaced by an older one.',
      control: null
    }),
    settingItem({
      label: 'Location',
      description: `${current.location}${current.resolvedCommand ? `. "multi-git" runs ${current.resolvedCommand}` : ''}`,
      control: null
    }),
    settingItem({
      label: 'Actions',
      description: installed ? 'Repairing reinstalls it without touching your settings.' : 'Nothing is changed until you choose Enable.',
      control: el('div', { className: 'settings-input-row settings-button-row', children: actions }),
      stacked: true
    })
  ];

  if (!installed && current.state !== 'unavailable') {
    rows.push(
      settingItem({
        label: 'What enabling changes',
        description: current.plannedChanges.join(' · '),
        control: null,
        stacked: true
      })
    );
  }

  const agentRows: HTMLElement[] = [];
  if (current.mcpConfig) {
    const copyMcp = button('Copy', 'content_copy');
    copyMcp.addEventListener('click', () => copyText(current.mcpConfig!, 'MCP configuration'));
    agentRows.push(
      settingItem({
        label: 'MCP server for AI agents',
        description:
          'Paste this into your agent\'s MCP configuration. It is read-only; add "--allow-write" to its arguments to let the agent stage, commit, pull and push. Nothing is added to any agent for you.',
        control: copyMcp
      })
    );
  }
  if (current.skillsPath) {
    const reveal = button('Show', 'folder_open');
    reveal.addEventListener('click', () => {
      void window.desktopApi!.revealTerminalSkills().catch((error: unknown) =>
        showToast(errorMessage(error, 'Could not open the skills folder.'), 'error')
      );
    });
    agentRows.push(
      settingItem({
        label: 'Agent skills',
        description: `${current.skillsPath}: how an agent should use the CLI, the MCP server and the desktop app.`,
        control: reveal
      })
    );
  }

  return [settingGroup(rows), ...(agentRows.length > 0 ? [settingGroup(agentRows)] : [])];
}
