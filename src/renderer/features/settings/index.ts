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
import { withButtonBusy } from '../../ui/busy';
import * as updates from '../updates';
import { prerequisites, refreshPrerequisites } from '../setup';
import { update } from '../../state/store';
import { applyConfigSnapshot, onManageSshConfigChanged } from '../accounts';
import { buildMatchSelect, buildStaleRulesForm } from '../maintenance/rules-form';
import { DEFAULT_STALE_RULES } from '../../../shared/maintenance-types';
import type { Elements } from '../../dom/elements';
import type { AppSettings } from '../../../shared/config-types';
import type { StaleRules } from '../../../shared/maintenance-types';
import { sectionHeading, settingGroup, settingItem, settingNote, switchInput } from '../../ui/setting-rows';
import { createSectionNav } from '../../ui/section-nav';
import type { SectionNav } from '../../ui/section-nav';

let ui: Elements;
let settings: AppSettings | null = null;
let loadError = '';
let nav: SectionNav;

export function initSettings(elements: Elements): void {
  ui = elements;

  ui.btnSettings.addEventListener('click', () => void openSettings());
  ui.btnCloseSettings.addEventListener('click', () => closeSettings());

  ui.settingsModal.addEventListener('click', (event) => {
    if (event.target === ui.settingsModal) {
      closeSettings();
    }
  });

  nav = createSectionNav({ nav: ui.settingsNav, body: ui.settingsBody });
}

export async function openSettings(): Promise<void> {
  setHidden(ui.settingsModal, false);
  ui.settingsBody.scrollTop = 0;
  ui.btnCloseSettings.focus();
  await refresh();

  // The section list rather than the first field: the first field is a
  // read-only address, and a focus ring on it reads as "edit this".
  ui.settingsNav.querySelector<HTMLElement>('.settings-nav-item.active')?.focus({ preventScroll: true });
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
  return settingItem({ label, description, control: switchInput(label, checked, onChange) });
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
  onCommit: (value: string) => void,
  suffix?: string
): HTMLElement {
  const input = el('input', { className: 'settings-field', attrs }) as HTMLInputElement;
  input.value = value;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onCommit(input.value.trim()));

  const isNumber = attrs['type'] === 'number';
  const control = suffix === undefined
    ? input
    : el('div', {
        className: 'settings-input-suffix',
        children: [input, el('span', { text: suffix })]
      });

  return settingItem({ label, description, control, stacked: !isNumber });
}

interface SectionInfo {
  key: string;
  icon: string;
  title: string;
  subtitle: string;
}

const SECTIONS = {
  integrations: { key: 'integrations', icon: 'hub', title: 'Git and GitHub', subtitle: 'The tools Multi-Git runs, and how agents reach it.' },
  sync: { key: 'sync', icon: 'sync', title: 'Syncing', subtitle: 'What happens after a fetch, and which key your other tools use.' },
  stale: { key: 'stale', icon: 'auto_delete', title: 'Stale branches', subtitle: 'Used by the Maintenance tab to offer worktrees for purging, and by Branch Maintenance to mark a branch stale.' },
  safety: { key: 'safety', icon: 'shield', title: 'Safety Net', subtitle: 'Recovery points taken before anything that rewrites history.' },
  worktrees: { key: 'worktrees', icon: 'account_tree', title: 'Worktrees and agents', subtitle: 'Where new worktrees go.' },
  application: { key: 'application', icon: 'tune', title: 'Application', subtitle: 'Windows and updates.' }
} satisfies Record<string, SectionInfo>;

function section(info: SectionInfo, children: (Node | null)[]): HTMLElement {
  return el('section', {
    className: 'settings-section',
    data: { section: info.key },
    attrs: { 'aria-labelledby': `settings-section-${info.key}` },
    children: [
      sectionHeading(info.icon, info.title, info.subtitle, `settings-section-${info.key}`),
      ...children.filter((child): child is Node => child !== null)
    ]
  });
}

// ---------- the panel ----------

function buildAgentAddress(): HTMLElement {
  const address = window.location.origin;
  const input = el('input', {
    className: 'settings-field',
    attrs: { type: 'text', readonly: '', 'aria-label': 'Agent CLI server URL', value: address }
  });

  const copy = el('button', {
    className: 'btn btn-secondary',
    attrs: { type: 'button', title: 'Copy the address' },
    children: [icon('content_copy', 16), el('span', { text: 'Copy' })]
  });

  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(address).then(
      () => showToast('Address copied.', 'success'),
      () => showToast('Could not copy the address.', 'error')
    );
  });

  return settingItem({
    label: 'Agent CLI connection',
    description: 'Use this address with the Multi-Git CLI --server option. It changes when the desktop app restarts.',
    control: el('div', { className: 'settings-input-row', children: [input, copy] }),
    stacked: true
  });
}

/**
 * The tools this application leans on, and how to get them.
 *
 * Here as well as on the welcome screen, because the welcome screen is only
 * seen when no repository is open -- and the person who decides to start
 * creating pull requests six months in has no reason to go back there.
 */
function buildIntegrations(): HTMLElement {
  const report = prerequisites();

  const tools = (report?.tools ?? []).map((tool) => {
    const usable = tool.installed && tool.signedIn !== false;

    return settingItem({
      label: tool.version ? `${tool.label} — ${tool.version}` : tool.label,
      description: tool.detail,
      control: el('span', {
        className: `setup-badge ${usable ? 'setup-badge-ok' : 'setup-badge-missing'}`,
        children: [
          icon(usable ? 'check_circle' : 'error', 14),
          el('span', { text: usable ? 'Ready' : tool.installed ? 'Not signed in' : 'Not installed' })
        ]
      })
    });
  });

  const recheck = el('button', {
    className: 'btn btn-secondary',
    attrs: { type: 'button' },
    children: [icon('refresh', 16), el('span', { text: 'Check again' })]
  });

  recheck.addEventListener('click', () => {
    void withButtonBusy(recheck, async () => {
      await refreshPrerequisites();
      // Redrawn from the new answer, so the badges here agree with the ones on
      // the welcome screen.
      render();
    });
  });

  return section(SECTIONS.integrations, [
    settingGroup([buildAgentAddress()]),
    el('p', {
      className: 'settings-group-caption',
      text: 'Multi-Git runs Git for everything. The GitHub CLI is optional and unlocks repository browsing, pull requests and publishing a new repository to GitHub.'
    }),
    settingGroup([
      ...tools,
      settingItem({
        label: 'Re-check what is installed',
        description: 'After installing something, or after signing in with gh auth login.',
        control: recheck
      })
    ])
  ]);
}

function buildSync(current: AppSettings): HTMLElement {
  return section(SECTIONS.sync, [
    settingGroup([
      toggle(
        'Pull automatically after a fetch',
        'Only ever a fast-forward. Local commits, a dirty tree, a detached HEAD or an operation in progress all hold it back.',
        current.autoPull === true,
        (value) => void save({ autoPull: value })
      ),
      toggle(
        'Keep ~/.ssh/config in sync with the active key',
        'Multi-Git maintains its own block in that file so your terminal and your IDE use the same key. Turning it off asks whether to remove the block it already wrote.',
        current.manageSshConfig !== false,
        (value) => {
          void onManageSshConfigChanged(value).then(() => refresh());
        }
      )
    ])
  ]);
}

function buildStale(current: AppSettings): HTMLElement {
  const rules: StaleRules = { ...DEFAULT_STALE_RULES, ...(current.staleRules ?? {}) };
  const form = { rules, onChange: (next: StaleRules) => void save({ staleRules: next }) };

  return section(SECTIONS.stale, [
    settingGroup([
      settingItem({
        label: 'How the rules combine',
        description: 'Whether a branch has to meet every rule switched on below, or just one of them.',
        control: buildMatchSelect(form)
      }),
      // The shared form, drawn here as one switch per rule; see
      // .settings-group .maintenance-rules in style.css.
      buildStaleRulesForm(form)
    ])
  ]);
}

function buildSafetyNet(current: AppSettings): HTMLElement {
  const retention = current.recoveryRetentionDays;

  return section(SECTIONS.safety, [
    settingGroup([
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
        },
        'days'
      )
    ])
  ]);
}

function buildWorktrees(current: AppSettings): HTMLElement {
  return section(SECTIONS.worktrees, [
    settingGroup([
      field(
        'Create worktrees in',
        'Where a new worktree is suggested. Empty means a sibling of the repository named <repo>.worktrees.',
        current.worktreeParentDir ?? '',
        { type: 'text', placeholder: 'D:\\work' },
        (value) => void save({ worktreeParentDir: value })
      ),
      // There is deliberately no control for keeping agent prompt text. Nothing
      // records it: buildLaunchPlan builds the launch history entry from the
      // arguments without the prompt, and recordLaunch takes no prompt parameter
      // at all, so there is no path by which one could be written. A switch here
      // could only have promised something the design refuses to do.
      settingNote(
        'lock',
        'The text of an agent prompt is never recorded. Launch history keeps the command and the folder, and nothing else.'
      )
    ])
  ]);
}

function buildApplication(current: AppSettings): HTMLElement {
  return section(SECTIONS.application, [
    settingGroup([
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
      ),
      checkNowRow(current)
    ])
  ]);
}

/**
 * An update check the user can start.
 *
 * The navbar icon only appears once there is a release to act on, so an app
 * that is up to date offered no way to ask at all. Shown only where a check
 * can actually happen: on a build that can update itself, and with the setting
 * above switched on -- the service declines a check while it is off, and a
 * button that quietly did nothing would be worse than no button.
 */
function checkNowRow(current: AppSettings): HTMLElement | null {
  if (!updates.isSupported() || current.checkForUpdates === false) {
    return null;
  }

  const button = el('button', {
    className: 'btn btn-secondary',
    attrs: { type: 'button' },
    children: [icon('update', 16), el('span', { text: 'Check now' })]
  });

  button.addEventListener('click', () => {
    void withButtonBusy(button, async () => {
      await updates.checkNow();
    });
  });

  return settingItem({
    label: 'Check for updates now',
    description: 'Asks GitHub once. Anything found opens the update window; nothing is downloaded until you choose to.',
    control: button
  });
}

// ---------- section navigation ----------

function renderNav(): void {
  nav.render(Object.values(SECTIONS));
}

function render(): void {
  if (loadError !== '') {
    ui.settingsNav.replaceChildren();
    ui.settingsBody.replaceChildren(el('div', { className: 'inline-warning', text: loadError }));
    return;
  }

  const current = settings;
  if (current === null) {
    return;
  }

  ui.settingsBody.replaceChildren(
    buildIntegrations(),
    buildSync(current),
    buildStale(current),
    buildSafetyNet(current),
    buildWorktrees(current),
    buildApplication(current)
  );
  renderNav();
}
