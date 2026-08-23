// The right-hand dock.
//
// Seven of the twenty-three overlays are not modal questions. Repository tools,
// worktrees, rebase, recovery, branch maintenance, search and agents are things
// you want open *beside* the work: you cannot watch a rebase and read the
// conflict's diff at once, or manage remotes while looking at the history that
// sent you there, if opening one dims and freezes everything else.
//
// They keep their markup, their open and close functions, and every listener
// they had. What changed is what the overlay is -- `.as-panel` in the stylesheet
// turns it from a sheet over the window into a column down the side. This module
// is the behaviour that goes with that: knowing when one is open, giving the
// body its margin, and remembering the width.
//
// Deliberately not all twenty-three. Confirm, prompt, the passphrase dialogs and
// the wizards are genuinely "answer this, then continue", and a question you can
// ignore while clicking elsewhere is a worse question.

/** Matches the `pane_size_` convention the other resizable panes use. */
const PANEL_WIDTH_KEY = 'pane_size_dock';

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 480;

/** Every surface that behaves as a dock panel rather than a modal. */
export function panelOverlays(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.modal-overlay.as-panel')];
}

/** True for an overlay that docks rather than covers. */
export function isPanel(overlay: Element): boolean {
  return overlay.classList.contains('as-panel');
}

/** The panels currently open, in document order. */
export function openPanels(): HTMLElement[] {
  return panelOverlays().filter((panel) => !panel.classList.contains('hidden'));
}

function storedWidth(): number {
  const stored = Number.parseInt(window.localStorage.getItem(PANEL_WIDTH_KEY) ?? '', 10);
  return Number.isFinite(stored) ? clamp(stored) : DEFAULT_WIDTH;
}

function clamp(width: number): number {
  // Also against the window: a dock wider than the screen would leave nothing
  // to dock beside.
  const ceiling = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 360));
  return Math.min(Math.max(width, MIN_WIDTH), ceiling);
}

function applyWidth(width: number): void {
  document.documentElement.style.setProperty('--dock-width', `${clamp(width)}px`);
}

/**
 * Adds or removes the class that makes room for the dock.
 *
 * Called after anything opens or closes a panel. Cheap enough to run on every
 * change, and reading the DOM rather than tracking state means it cannot drift
 * from what is actually on screen.
 */
export function syncDock(): void {
  document.body.classList.toggle('dock-open', openPanels().length > 0);
}

/**
 * Watches for panels opening and closing.
 *
 * A MutationObserver rather than asking every feature to report in: opening is
 * `setHidden(modal, false)` in a dozen places, and threading a callback through
 * all of them to say something the DOM already knows would be a second source
 * of truth to keep in step.
 */
function observePanels(): void {
  const observer = new MutationObserver(syncDock);

  for (const panel of panelOverlays()) {
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }
}

/** Drag handle down the dock's leading edge. */
function attachResizer(panel: HTMLElement): void {
  const handle = document.createElement('div');
  handle.className = 'dock-resizer';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Resize the panel');
  handle.tabIndex = 0;

  const onMove = (event: PointerEvent): void => {
    // Measured from the right edge, which is where the dock is anchored.
    applyWidth(window.innerWidth - event.clientX);
  };

  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.body.classList.remove('pane-resizing', 'pane-resizing-x');

    const current = document.documentElement.style.getPropertyValue('--dock-width');
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(Number.parseInt(current, 10) || DEFAULT_WIDTH));
  };

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    document.body.classList.add('pane-resizing', 'pane-resizing-x');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // The keyboard equivalent, so the dock is not mouse-only.
  handle.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowLeft' ? 32 : event.key === 'ArrowRight' ? -32 : 0;
    if (step === 0) {
      return;
    }

    event.preventDefault();
    const current = Number.parseInt(
      document.documentElement.style.getPropertyValue('--dock-width'),
      10
    ) || DEFAULT_WIDTH;

    applyWidth(current + step);
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(clamp(current + step)));
  });

  panel.prepend(handle);
}

export function initDock(): void {
  applyWidth(storedWidth());

  for (const panel of panelOverlays()) {
    attachResizer(panel);
  }

  observePanels();
  syncDock();

  // A window narrowed past what the stored width allows re-clamps rather than
  // leaving the dock wider than the screen.
  window.addEventListener('resize', () => applyWidth(storedWidth()));
}
