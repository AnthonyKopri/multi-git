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
import { setHidden } from '../../dom/create';
import { attachHorizontalWheel } from '../../ui/wheel-scroll';
import type { Elements } from '../../dom/elements';

export type HubTab =
  | 'remotes'
  | 'submodules'
  | 'lfs'
  | 'patches'
  | 'bisect'
  | 'notes'
  | 'tools';

export const HUB_TABS: readonly HubTab[] = [
  'remotes',
  'submodules',
  'lfs',
  'patches',
  'bisect',
  'notes',
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

  // Left and right move between tabs, which is what a tablist is expected to
  // do and the only way to reach a tab scrolled off the strip from a keyboard.
  ui.repoHubTabs.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) {
      return;
    }

    event.preventDefault();
    const index = HUB_TABS.indexOf(current);
    const next = HUB_TABS[(index + step + HUB_TABS.length) % HUB_TABS.length] as HubTab;
    void showTab(next);
    tabButton(next)?.focus();
  });

  // The strip scrolls sideways on a narrow window, and an ordinary wheel
  // should reach the tabs past its edge.
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

export function currentHubTab(): HubTab {
  return current;
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

  const panel = panelFor(tab);
  const owner = owners.get(tab);

  if (panel && owner) {
    await owner.render(panel);
  }
}

/** Opens the hub, optionally straight to a tab. */
export function openRepoHub(tab: HubTab = current): void {
  setHidden(ui.repoHubModal, false);
  void showTab(tab);
}

export function closeRepoHub(): void {
  setHidden(ui.repoHubModal, true);
}

/** Redraws the visible tab, for when the repository changed underneath it. */
export async function refreshRepoHub(): Promise<void> {
  if (isRepoHubOpen()) {
    await showTab(current);
  }
}
