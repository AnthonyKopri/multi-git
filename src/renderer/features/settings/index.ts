// App-wide settings, in one window.
//
// The distinction that decides what belongs here is the same one the
// Repository hub is built on, read the other way round: the hub is everything
// that acts on *one repository*, and this is everything that is true of the
// application whatever repository is open. A per-repository setting in here
// would be a setting that silently changed meaning when you switched folders.
//
// Most of these existed only in ~/.multi-git-client-config.json until now. A
// preference the app stores but offers no way to change is a preference only
// its author knows about, and three of them — window restoration, update
// checks, Safety Net retention — are things a user is entitled to decide
// without closing the app and editing JSON.
//
// Every control writes immediately. There is no Save button, because a
// settings window with one has two states — what is shown and what is stored —
// and no way to tell which is in force.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { el, icon, setHidden } from '../../dom/create';
import { showToast } from '../../ui/toast';
import { update } from '../../state/store';
import { applyConfigSnapshot, onManageSshConfigChanged } from '../accounts';
import { buildMatchSelect, buildStaleRulesForm } from '../maintenance/rules-form';
import { DEFAULT_STALE_RULES } from '../../../shared/maintenance-types';
import type { Elements } from '../../dom/elements';
import type { AppSettings } from '../../../shared/config-types';
import type { StaleRules } from '../../../shared/maintenance-types';

let ui: Elements;
let settings: AppSettings | null = null;
let loadError = '';

export function initSettings(elements: Elements): void {
  ui = elements;

  ui.btnSettings.addEventListener('click', () => void openSettings());
  ui.btnCloseSettings.addEventListener('click', () => closeSettings());

  ui.settingsModal.addEventListener('click', (event) => {
    if (event.target === ui.settingsModal) {
      closeSettings();
    }
  });
}

export function isSettingsOpen(): boolean {
  return !ui.settingsModal.classList.contains('hidden');
}

export async function openSettings(): Promise<void> {
  setHidden(ui.settingsModal, false);
  await refresh();
}

export function closeSettings(): void {
  setHidden(ui.settingsModal, true);
}

// ---------- reading and writing ----------

async function refresh(): Promise<void> {
  try {
    const config = await api.getConfig();
    settings = config.settings;
    loadError = '';

    // The window and the rest of the app read one snapshot, so a setting
    // changed here reaches the toolbar chip that renders from the same state.
    applyConfigSnapshot(config);
  } catch (error) {
    if (isStale(error)) {
      return;
    }
    settings = null;
    loadError = errorMessage(error, 'Could not read the settings.');
  }

  render();
}

/**
 * Writes one setting and redraws from what came back.
 *
 * Redrawn from the server's answer rather than from what was sent, because the
 * two are allowed to differ: a day count is clamped, a malformed rule is
 * repaired, and the window should show what is stored.
 */
async function save(patch: api.AppSettingsInput): Promise<void> {
  try {
    const { config } = await api.saveAppSettings(patch);
    settings = config.settings;
    applyConfigSnapshot(config);

    // Auto-pull has a toolbar chip that renders from the store rather than
    // from the config snapshot, so it is nudged directly.
    if (patch.autoPull !== undefined) {
      update({ autoPull: config.settings.autoPull === true });
    }
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not save that setting.'), 'error', 6000);
    }
  }

  render();
}

// ---------- controls ----------

function toggle(
  label: string,
  description: string,
  checked: boolean,
  onChange: (value: boolean) => void
): HTMLElement {
  const box = el('input', { className: 'branch-select' }) as HTMLInputElement;
  box.type = 'checkbox';
  box.checked = checked;
  box.setAttribute('aria-label', label);
  box.addEventListener('change', () => onChange(box.checked));

  return el('div', {
    className: 'settings-row',
    children: [
      el('label', {
        className: 'checkbox-row',
        children: [box, el('span', { text: label })]
      }),
      el('p', { className: 'modal-desc', text: description })
    ]
  });
}

/**
 * A text or number field that writes when it is committed, not per keystroke.
 *
 * `change` rather than `input`: every one of these round-trips to the server,
 * and a retention of "30" should be one write rather than two.
 */
function field(
  label: string,
  description: string,
  value: string,
  attrs: Record<string, string>,
  onCommit: (value: string) => void
): HTMLElement {
  const input = el('input', { className: 'settings-field', attrs }) as HTMLInputElement;
  input.value = value;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onCommit(input.value.trim()));

  return el('div', {
    className: 'settings-row',
    children: [
      el('div', {
        className: 'settings-field-row',
        children: [el('span', { className: 'settings-label', text: label }), input]
      }),
      el('p', { className: 'modal-desc', text: description })
    ]
  });
}

function section(title: string, children: (Node | null)[]): HTMLElement {
  return el('section', {
    className: 'settings-section',
    children: [
      el('div', { className: 'section-header', children: [el('h4', { text: title })] }),
      ...children.filter((child): child is Node => child !== null)
    ]
  });
}

// ---------- the panel ----------

function buildSync(current: AppSettings): HTMLElement {
  return section('Syncing', [
    toggle(
      'Pull automatically after a fetch',
      'Only ever a fast-forward. Local commits, a dirty tree, a detached HEAD or an operation in progress all hold it back.',
      current.autoPull === true,
      (value) => void save({ autoPull: value })
    ),
    toggle(
      'Keep ~/.ssh/config in sync with the active key',
      'Multi-Git maintains its own block in that file so Git Bash and your IDE use the same key. Turning it off asks whether to remove the block it already wrote.',
      current.manageSshConfig !== false,
      (value) => {
        void onManageSshConfigChanged(value).then(() => refresh());
      }
    )
  ]);
}

function buildStale(current: AppSettings): HTMLElement {
  const rules: StaleRules = { ...DEFAULT_STALE_RULES, ...(current.staleRules ?? {}) };
  const form = { rules, onChange: (next: StaleRules) => void save({ staleRules: next }) };

  return section('What counts as a stale branch', [
    el('p', {
      className: 'modal-desc',
      text: 'Used by the Maintenance tab to decide which worktrees to offer for purging, and by the Branch Maintenance window to mark a branch stale.'
    }),
    el('div', {
      className: 'checkbox-row',
      children: [el('span', { text: 'The ticked rules' }), buildMatchSelect(form)]
    }),
    buildStaleRulesForm(form)
  ]);
}

function buildSafetyNet(current: AppSettings): HTMLElement {
  const retention = current.recoveryRetentionDays;

  return section('Safety Net', [
    field(
      'Keep recovery points for',
      'Days before a recovery point expires. 0 keeps them until you remove them by hand. Nothing expires while an operation is unfinished.',
      retention === undefined ? '' : String(retention),
      { type: 'number', min: '0', max: '3650', placeholder: '14' },
      (value) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          void save({ recoveryRetentionDays: parsed });
        } else {
          // An empty or unreadable box means "leave it alone" rather than
          // "expire everything now", which is what 0 would have meant.
          render();
        }
      }
    )
  ]);
}

function buildWorktrees(current: AppSettings): HTMLElement {
  return section('Worktrees and agents', [
    field(
      'Create worktrees in',
      'Where a new worktree is suggested. Empty means a sibling of the repository named <repo>.worktrees.',
      current.worktreeParentDir ?? '',
      { type: 'text', placeholder: 'D:\\work' },
      (value) => void save({ worktreeParentDir: value })
    ),
    toggle(
      'Keep the text of agent prompts in launch history',
      'Off by default. A prompt is the most sensitive part of a launch, so it is recorded only if you ask for it.',
      current.storeAgentPrompts === true,
      (value) => void save({ storeAgentPrompts: value })
    )
  ]);
}

function buildApplication(current: AppSettings): HTMLElement {
  return section('Application', [
    toggle(
      'Reopen the windows that were open at quit',
      'With nothing recorded, the app opens one window as it always did.',
      current.restoreWindowsOnStartup !== false,
      (value) => void save({ restoreWindowsOnStartup: value })
    ),
    toggle(
      'Check GitHub for a newer version',
      'The only request Multi-Git makes that you did not start. It sends no account and no repository, and nothing is downloaded until you ask for it.',
      current.checkForUpdates !== false,
      (value) => void save({ checkForUpdates: value })
    )
  ]);
}

function render(): void {
  if (loadError !== '') {
    ui.settingsBody.replaceChildren(el('div', { className: 'inline-warning', text: loadError }));
    return;
  }

  const current = settings;
  if (current === null) {
    return;
  }

  ui.settingsBody.replaceChildren(
    el('p', {
      className: 'modal-desc',
      children: [
        icon('info', 14),
        el('span', {
          text: ' These apply to Multi-Git itself, whatever repository is open, and are saved as you change them. Settings for one repository live in the Repository window.'
        })
      ]
    }),
    buildSync(current),
    buildStale(current),
    buildSafetyNet(current),
    buildWorktrees(current),
    buildApplication(current)
  );
}
