// Floating panels.
//
// Five of the overlays are not modal questions. Worktrees, rebase, recovery,
// branch maintenance and search are things you want open *beside* the work:
// you cannot watch a rebase and read the conflict's diff at once, or clean up
// branches while looking at the history that sent you there, if opening one
// dims and freezes everything else.
//
// They used to dock down the right-hand side, which took the width from the
// main body and turned a three-pane window into four cramped ones. Each now
// pops out as a panel of its own over the window: moved by its header, resized
// from its corner, and remembered where it was left. The layout under it is
// untouched.
//
// They keep their markup, their open and close functions, and every listener
// they had. `.as-panel` in the stylesheet turns the overlay from a sheet over
// the window into a free-standing panel; this module is the behaviour that goes
// with that: placing a panel when it opens, dragging, raising the one clicked,
// and remembering position and size.
//
// Deliberately not every overlay. Confirm, prompt, the passphrase dialogs and
// the wizards are genuinely "answer this, then continue", and a question you can
// ignore while clicking elsewhere is a worse question.

/** Per panel, keyed by overlay id. Matches the `pane_size_` convention. */
const BOUNDS_KEY_PREFIX = 'pane_bounds_';

const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
/** How much of a panel must stay on screen so it can always be dragged back. */
const MIN_VISIBLE = 80;
/** Each panel opened while another is showing lands this much further in. */
const CASCADE_STEP = 28;
/** Panels sit between the page (100) and the true modals (120). */
const BASE_Z = 110;

interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Open panels, bottom of the stack first. */
let stack: HTMLElement[] = [];

/** Every surface that behaves as a floating panel rather than a modal. */
export function panelOverlays(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.modal-overlay.as-panel')];
}

/** True for an overlay that floats rather than covers. */
export function isPanel(overlay: Element): boolean {
  return overlay.classList.contains('as-panel');
}

/** The panels currently open, in document order. */
export function openPanels(): HTMLElement[] {
  return panelOverlays().filter((panel) => !panel.classList.contains('hidden'));
}

/** The open panel on top of the others, which Escape closes first. */
export function topmostPanel(): HTMLElement | undefined {
  return stack.filter((panel) => !panel.classList.contains('hidden')).at(-1);
}

function navbarHeight(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--navbar-height');
  return Number.parseInt(value, 10) || 64;
}

function readBounds(panel: HTMLElement): Bounds | null {
  try {
    const raw = window.localStorage.getItem(BOUNDS_KEY_PREFIX + panel.id);
    const parsed = raw === null ? null : (JSON.parse(raw) as Partial<Bounds>);

    if (
      parsed &&
      [parsed.left, parsed.top, parsed.width, parsed.height].every(
        (value) => typeof value === 'number' && Number.isFinite(value)
      )
    ) {
      return parsed as Bounds;
    }
  } catch {
    // A corrupt entry is the same as none: the panel opens where a new one would.
  }

  return null;
}

function saveBounds(panel: HTMLElement): void {
  try {
    window.localStorage.setItem(BOUNDS_KEY_PREFIX + panel.id, JSON.stringify(currentBounds(panel)));
  } catch {
    // Storage full or blocked: the panel still works, it just forgets.
  }
}

/**
 * The panel's bounds as last placed.
 *
 * Read from the inline style, which both this module and the browser's own
 * resize grip write to, so it still answers once the panel is hidden and has
 * no layout to measure.
 */
function currentBounds(panel: HTMLElement): Bounds {
  const read = (value: string, fallback: number): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    left: read(panel.style.left, panel.offsetLeft),
    top: read(panel.style.top, panel.offsetTop),
    width: read(panel.style.width, panel.offsetWidth),
    height: read(panel.style.height, panel.offsetHeight)
  };
}

/**
 * Keeps a panel inside the window.
 *
 * Size is capped at the window, and position keeps the header on screen, so a
 * panel left on a monitor that is gone, or a window made smaller, never leaves
 * something that cannot be reached to move back.
 */
function clampBounds(bounds: Bounds): Bounds {
  const top = navbarHeight();
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - 16);
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - top - 8);

  const width = Math.min(Math.max(bounds.width, MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(bounds.height, MIN_HEIGHT), maxHeight);

  return {
    width,
    height,
    left: Math.min(Math.max(bounds.left, MIN_VISIBLE - width), window.innerWidth - MIN_VISIBLE),
    top: Math.min(Math.max(bounds.top, top), window.innerHeight - MIN_VISIBLE)
  };
}

function applyBounds(panel: HTMLElement, bounds: Bounds): void {
  const clamped = clampBounds(bounds);
  panel.style.left = `${clamped.left}px`;
  panel.style.top = `${clamped.top}px`;
  panel.style.width = `${clamped.width}px`;
  panel.style.height = `${clamped.height}px`;
}

/**
 * Where a panel opens the first time.
 *
 * Toward the right, where the dock used to be and where the eye expects it,
 * but floating and shorter than the window so it reads as its own panel. A
 * second panel opened while one is showing cascades rather than landing
 * exactly on top of it.
 */
function defaultBounds(): Bounds {
  const top = navbarHeight() + 16;
  const offset = (stack.length % 6) * CASCADE_STEP;
  const width = Math.min(DEFAULT_WIDTH, window.innerWidth - 32);
  const height = Math.min(720, window.innerHeight - top - 24);

  return {
    left: window.innerWidth - width - 24 - offset,
    top: top + offset,
    width,
    height
  };
}

/** Puts a panel on top of the others, and records the order. */
function raise(panel: HTMLElement): void {
  stack = [...stack.filter((candidate) => candidate !== panel), panel];
  stack.forEach((candidate, index) => {
    candidate.style.zIndex = String(BASE_Z + index);
  });
}

function onOpened(panel: HTMLElement): void {
  applyBounds(panel, readBounds(panel) ?? defaultBounds());
  raise(panel);
}

function onClosed(panel: HTMLElement): void {
  stack = stack.filter((candidate) => candidate !== panel);
  // Where it was left is where it comes back, whichever way it was closed.
  saveBounds(panel);
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
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const panel = record.target as HTMLElement;
      const hidden = panel.classList.contains('hidden');
      const wasHidden = (record.oldValue ?? '').split(/\s+/).includes('hidden');

      if (wasHidden && !hidden) {
        onOpened(panel);
      } else if (!wasHidden && hidden) {
        onClosed(panel);
      }
    }
  });

  for (const panel of panelOverlays()) {
    observer.observe(panel, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  }
}

/** Controls inside a header that keep their own click rather than start a drag. */
const NOT_A_HANDLE = 'button, a, input, select, textarea, label, [role="tab"]';

/** Drags a panel by its header. */
function attachDrag(panel: HTMLElement): void {
  const header = panel.querySelector<HTMLElement>('.modal-header');
  if (!header) {
    return;
  }

  header.classList.add('panel-drag-handle');

  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest(NOT_A_HANDLE)) {
      return;
    }

    event.preventDefault();
    const start = currentBounds(panel);
    const originX = event.clientX;
    const originY = event.clientY;

    document.body.classList.add('panel-dragging');

    const onMove = (move: PointerEvent): void => {
      applyBounds(panel, {
        ...start,
        left: start.left + move.clientX - originX,
        top: start.top + move.clientY - originY
      });
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('panel-dragging');
      saveBounds(panel);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Back to where a new one opens: the way out of a panel dragged somewhere
  // awkward that does not need the mouse to be precise.
  header.addEventListener('dblclick', (event) => {
    if ((event.target as Element).closest(NOT_A_HANDLE)) {
      return;
    }

    try {
      window.localStorage.removeItem(BOUNDS_KEY_PREFIX + panel.id);
    } catch {
      // Nothing stored to forget.
    }
    stack = stack.filter((candidate) => candidate !== panel);
    applyBounds(panel, defaultBounds());
    raise(panel);
  });
}

/**
 * Remembers a size changed from the corner grip.
 *
 * The grip is the browser's own (`resize: both` in the stylesheet), which is
 * costs nothing and behaves as everyone expects; this only persists the
 * result once the pointer lets go, and only when a press on this panel
 * actually changed its size.
 */
function attachResizeMemory(panel: HTMLElement): void {
  let before: Bounds | null = null;

  panel.addEventListener('pointerdown', () => {
    before = currentBounds(panel);
  });

  window.addEventListener('pointerup', () => {
    if (before === null) {
      return;
    }

    const after = currentBounds(panel);
    if (after.width !== before.width || after.height !== before.height) {
      saveBounds(panel);
    }
    before = null;
  });
}

export function initFloatingPanels(): void {
  for (const panel of panelOverlays()) {
    attachDrag(panel);
    attachResizeMemory(panel);

    // Any press inside a panel brings it forward, as a window would.
    panel.addEventListener('pointerdown', () => raise(panel), { capture: true });

    if (!panel.classList.contains('hidden')) {
      onOpened(panel);
    }
  }

  observePanels();

  // A window made smaller pulls every open panel back inside it.
  window.addEventListener('resize', () => {
    for (const panel of openPanels()) {
      applyBounds(panel, currentBounds(panel));
    }
  });
}
