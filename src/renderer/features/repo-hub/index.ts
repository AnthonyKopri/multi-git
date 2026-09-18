// The Repository hub: one window holding the six Phase 4 toolsets.
//
// The sidebar already carries seven sections. Remotes, submodules, LFS,
// patches, bisect and notes would have made thirteen, most of them empty most
// of the time, in a column that already has to be scrolled. They live behind
// one button instead, the way the SSH, worktree and agent managers already do.
//
// This module owns the shell only: which tab is showing, and telling the tab
// that just became visible to load itself. What each tab contains belongs to
// the feature that owns it, which registers here.
import { el, setHidden } from '../../dom/create';
import { attachHorizontalWheel } from '../../ui/wheel-scroll';
import { getState } from '../../state/store';
import type { Elements } from '../../dom/elements';
import { focusFirst } from '../../ui/focus';
import { warnNoRepo } from '../../ui/no-repo';
import { sectionHeading } from '../../ui/setting-rows';

export type HubTab =
  | 'remotes'
  | 'submodules'
  | 'lfs'
  | 'patches'
  | 'bisect'
  | 'notes'
  | 'maintenance'
  | 'tools';

export const HUB_TABS: readonly HubTab[] = [
  'remotes',
  'submodules',
  'lfs',
  'patches',
  'bisect',
  'notes',
  'maintenance',
  'tools'
];

/**
 * What a tab needs from its owning feature.
 *
 * `render` is called with the tab's panel element the first time it is shown
 * and on every refresh after, so a feature never has to find its own container
 * or guess whether the hub is open.
 */
export interface HubTabOwner {
  render(panel: HTMLElement): void | Promise<void>;
}

const owners = new Map<HubTab, HubTabOwner>();

let ui: Elements;
let current: HubTab = 'remotes';

export function initRepoHub(elements: Elements): void {
  ui = elements;

  ui.btnRepoHub.addEventListener('click', () => openRepoHub());
  ui.btnCloseRepoHub.addEventListener('click', closeRepoHub);

  // Clicking the backdrop closes, matching every other modal here.
  ui.repoHubModal.addEventListener('click', (event) => {
    if (event.target === ui.repoHubModal) {
      closeRepoHub();
    }
  });

  ui.repoHubTabs.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-hub-tab]');
    const name = tab?.dataset['hubTab'] as HubTab | undefined;

    if (name && HUB_TABS.includes(name)) {
      void showTab(name);
    }
  });

  // Up and down move between tabs, as a vertical tablist is expected to.
  // Left and right as well, because on a narrow window the list becomes a
  // row of chips and those are the keys that row suggests.
  ui.repoHubTabs.addEventListener('keydown', (event) => {
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const step = forward ? 1 : back ? -1 : 0;
    if (step === 0) {
      return;
    }

    event.preventDefault();
    const index = HUB_TABS.indexOf(current);
    const next = HUB_TABS[(index + step + HUB_TABS.length) % HUB_TABS.length] as HubTab;
    void showTab(next);
    tabButton(next)?.focus();
  });

  // On a narrow window the list becomes a strip that scrolls sideways, and an
  // ordinary wheel should reach the tabs past its edge.
  attachHorizontalWheel(ui.repoHubTabs);

  // The sidebar summaries are shortcuts into a particular tab. One listener on
  // the sidebar rather than one per button, so a summary section added later
  // works without being wired.
  for (const sidebar of document.querySelectorAll<HTMLElement>('.sidebar')) {
    sidebar.addEventListener('click', (event) => {
      const trigger = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-hub-tab]');
      const name = trigger?.dataset['hubTab'] as HubTab | undefined;

      if (name && HUB_TABS.includes(name)) {
        openRepoHub(name);
      }
    });
  }
}

/** Registers the feature that fills one tab. Called once, at startup. */
export function registerHubTab(tab: HubTab, owner: HubTabOwner): void {
  owners.set(tab, owner);
}

function tabButton(tab: HubTab): HTMLElement | null {
  return ui.repoHubTabs.querySelector<HTMLElement>(`[data-hub-tab="${tab}"]`);
}

function panelFor(tab: HubTab): HTMLElement | null {
  return document.getElementById(`hub-panel-${tab}`);
}

export function isRepoHubOpen(): boolean {
  return !ui.repoHubModal.classList.contains('hidden');
}

/**
 * Scrolls the tab list so the active tab is on screen.
 *
 * Only matters on a narrow window, where the list is a sideways strip that
 * cannot show all eight tabs: a tab opened from the menu or a sidebar shortcut
 * would otherwise be selected but out of sight. Done on the strip alone rather
 * than with scrollIntoView, which would also scroll the window around it.
 */
function revealTab(button: HTMLElement | null): void {
  const strip = ui.repoHubTabs;
  if (button === null || strip.clientWidth === 0) {
    return;
  }

  const bounds = strip.getBoundingClientRect();
  const tab = button.getBoundingClientRect();
  // Enough of the neighbour showing to say there is more that way.
  const margin = 32;

  if (tab.left < bounds.left) {
    strip.scrollLeft -= bounds.left - tab.left + margin;
  } else if (tab.right > bounds.right) {
    strip.scrollLeft += tab.right - bounds.right + margin;
  }
}

/**
 * The icon and name of the tab being shown, above its panel.
 *
 * Read from the tab's own button, so the heading cannot drift from the list.
 * The tab's first paragraph, which every tab opens with, sits under it as its
 * summary; see .hub-panel > .modal-desc:first-child in style.css.
 */
function renderPageHeader(tab: HubTab): void {
  const button = tabButton(tab);
  const glyph = button?.querySelector('.material-symbols-outlined')?.textContent ?? '';
  const title = button?.querySelector('span:not(.material-symbols-outlined)')?.textContent ?? '';

  ui.repoHubPageHeader.replaceChildren(...sectionHeading(glyph, title, '').childNodes);
}

/** Names the repository the window is acting on, under its title. */
function renderSubtitle(): void {
  const repo = getState().activeRepo;
  const name = repo === null ? '' : repo.split(/[\\/]/).filter(Boolean).pop() ?? repo;

  ui.repoHubSubtitle.replaceChildren(
    repo === null
      ? document.createTextNode('Tools that do not need a repository open.')
      : el('span', { children: [document.createTextNode('Tools and settings for '), el('strong', { text: name, title: repo })] })
  );
}

/**
 * Shows a tab and asks its owner to draw it.
 *
 * Rendering happens on show rather than on open, so opening the hub does not
 * run seven repository reads to fill six panels nobody is looking at.
 */
export async function showTab(tab: HubTab): Promise<void> {
  current = tab;

  for (const name of HUB_TABS) {
    const button = tabButton(name);
    const panel = panelFor(name);
    const active = name === tab;

    button?.classList.toggle('active', active);
    button?.setAttribute('aria-selected', String(active));
    // Only the visible tab is in the tab order; the rest are reached with the
    // arrow keys, which is how a tablist is meant to behave.
    button?.setAttribute('tabindex', active ? '0' : '-1');

    if (panel) {
      setHidden(panel, !active);
    }
  }

  revealTab(tabButton(tab));
  renderPageHeader(tab);
  // A new tab starts at its top, not wherever the last one was scrolled to.
  ui.repoHubPageHeader.parentElement?.scrollTo({ top: 0 });

  const panel = panelFor(tab);
  const owner = owners.get(tab);

  if (panel && owner) {
    await owner.render(panel);
  }
}

/**
 * Tabs that mean something with no repository open.
 *
 * External tools are a machine-level setting -- where the diff tool and the
 * terminal live -- and its endpoints are not repository-scoped. The other seven
 * read the repository on sight, so opening one without a repository fills the
 * panel with failures instead of content.
 */
const APP_LEVEL_TABS: readonly HubTab[] = ['tools'];

/** Opens the hub, optionally straight to a tab. */
export function openRepoHub(tab: HubTab = current): void {
  if (!getState().activeRepo && !APP_LEVEL_TABS.includes(tab)) {
    warnNoRepo('use the repository tools');
    return;
  }

  setHidden(ui.repoHubModal, false);
  renderSubtitle();
  focusFirst(ui.repoHubModal);
  void showTab(tab);
}

export function closeRepoHub(): void {
  setHidden(ui.repoHubModal, true);
}

/** Redraws the visible tab, for when the repository changed underneath it. */
export async function refreshRepoHub(): Promise<void> {
  if (isRepoHubOpen()) {
    renderSubtitle();
    await showTab(current);
  }
}
