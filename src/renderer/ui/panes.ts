// User-resizable panels.
//
// The layout used to be fixed at a 280px sidebar, a 320px history column and a
// 280px file tree. Branch names, file paths and commit subjects are all longer
// than that on real repositories, so the panels that had to show them were the
// ones that could not grow, while a wide window spent the extra space on the
// middle column that needed it least.
//
// Each divider in the layout is a handle that writes a CSS custom property on
// :root; the stylesheet reads those for the panel widths and heights. Sizes
// are remembered per panel across sessions.

export type PaneName = 'sidebar' | 'history' | 'tree' | 'diffFiles' | 'commit';

export interface PaneSpec {
  /** Custom property on :root that the stylesheet reads. */
  variable: string;
  axis: 'x' | 'y';
  /**
   * Sign applied to the pointer delta. -1 when the panel being sized is on the
   * far side of the handle, where dragging right (or down) makes it smaller.
   */
  direction: 1 | -1;
  min: number;
  max: number;
  fallback: number;
  /**
   * Space the flexible pane next to this one must keep, used to cap `max` on
   * small windows.
   */
  reserve: number;
  /**
   * Other fixed-size panes competing for the same axis. Their current sizes
   * come off the available space first, so widening both side columns cannot
   * add up to more than the window holds.
   */
  siblings?: readonly PaneName[];
}

export const PANE_SPECS: Record<PaneName, PaneSpec> = {
  sidebar: {
    variable: '--sidebar-width',
    axis: 'x',
    direction: 1,
    min: 190,
    max: 640,
    fallback: 280,
    reserve: 300,
    siblings: ['history']
  },
  history: {
    variable: '--history-width',
    axis: 'x',
    direction: -1,
    min: 220,
    max: 720,
    fallback: 320,
    reserve: 300,
    siblings: ['sidebar']
  },
  // The Explorer and Diff panes split the centre column, which is already
  // sized by the two above, so they have no fixed sibling of their own.
  tree: {
    variable: '--tree-pane-width',
    axis: 'x',
    direction: 1,
    min: 170,
    max: 720,
    fallback: 280,
    reserve: 260
  },
  diffFiles: {
    variable: '--diff-files-width',
    axis: 'x',
    direction: 1,
    min: 170,
    max: 640,
    fallback: 260,
    reserve: 260
  },
  commit: {
    variable: '--commit-panel-height',
    axis: 'y',
    direction: -1,
    /**
     * Set by what the panel cannot shrink: 28px of padding, a 35px template
     * row, and an 82px button column holding a 48px Commit button and the two
     * toggles under it. The old 110 was below that, and because the column is
     * anchored to the bottom of the message box the surplus came out of the
     * top — which is how the Commit button ended up drawn over the commit
     * template chips. Stored sizes are re-clamped on load, so a layout already
     * dragged too small is repaired rather than left broken.
     */
    min: 150,
    max: 560,
    fallback: 156,
    // Header, tabs, and enough of the staging lists to still be a file list.
    reserve: 320
  }
};

/** Step taken by the arrow keys when a handle has focus. */
const KEYBOARD_STEP_PX = 16;

const STORAGE_PREFIX = 'pane_size_';
const COLLAPSE_PREFIX = 'pane_collapsed_';

/**
 * The two panes that can be taken off screen entirely.
 *
 * Only the outer columns: the middle one is the work, and the Explorer, Diff
 * and commit splits are inside it, so collapsing those would leave a pane with
 * no way to say what it was.
 */
export type CollapsibleSide = 'sidebar' | 'history';

interface CollapseSpec {
  /** Class on <body> that the stylesheet keys the whole layout off. */
  bodyClass: string;
  /** The centre-tab restore button, and the panel-header button it mirrors. */
  revealId: string;
  toggleId: string;
  /** Present tense, for the tooltip of whichever control would restore it. */
  showLabel: string;
  hideLabel: string;
  shortcut: string;
}

const COLLAPSE_SPECS: Record<CollapsibleSide, CollapseSpec> = {
  sidebar: {
    bodyClass: 'sidebar-collapsed',
    revealId: 'sidebar-reveal',
    toggleId: 'btn-toggle-sidebar',
    showLabel: 'Show branches panel',
    hideLabel: 'Hide branches panel',
    shortcut: 'Ctrl+B'
  },
  history: {
    bodyClass: 'history-collapsed',
    revealId: 'history-reveal',
    toggleId: 'btn-toggle-history',
    showLabel: 'Show commit history',
    hideLabel: 'Hide commit history',
    shortcut: 'Ctrl+Shift+B'
  }
};

/** True when a pane is one of the collapsible sides and is currently collapsed. */
function isPaneCollapsed(name: PaneName): boolean {
  const spec = COLLAPSE_SPECS[name as CollapsibleSide] as CollapseSpec | undefined;
  return spec !== undefined && document.body.classList.contains(spec.bodyClass);
}

export function isSideCollapsed(side: CollapsibleSide): boolean {
  return document.body.classList.contains(COLLAPSE_SPECS[side].bodyClass);
}

/**
 * Clamps a requested size to what the spec allows and what the window can
 * currently spare.
 *
 * Without the `available` term, a size saved on a large monitor would leave a
 * panel wider than the window it is reopened in, and nothing would give.
 */
export function clampPaneSize(spec: PaneSpec, requested: number, available?: number): number {
  if (!Number.isFinite(requested)) {
    return spec.fallback;
  }

  let max = spec.max;
  if (available !== undefined && available > 0) {
    // Never let the cap fall below the minimum: a tiny window should pin the
    // panel at its minimum, not invert the range.
    max = Math.max(spec.min, Math.min(max, available - spec.reserve));
  }

  return Math.round(Math.min(Math.max(requested, spec.min), max));
}

/**
 * The applied size, read straight off the custom property.
 *
 * Deliberately unclamped: `availableFor` calls this for the sibling panes, and
 * clamping here would recurse.
 */
function appliedSize(spec: PaneSpec): number {
  const raw = parseFloat(document.documentElement.style.getPropertyValue(spec.variable));
  return Number.isFinite(raw) ? raw : spec.fallback;
}

function availableFor(spec: PaneSpec): number {
  const total = spec.axis === 'x' ? window.innerWidth : window.innerHeight;
  const taken = (spec.siblings ?? []).reduce(
    // A collapsed sibling is not on screen and takes nothing. Counting its
    // remembered width anyway would cap this pane as though the other were
    // still there, which is the opposite of what collapsing it was for.
    (sum, other) => sum + (isPaneCollapsed(other) ? 0 : appliedSize(PANE_SPECS[other])),
    0
  );
  return total - taken;
}

function storedSize(name: PaneName, spec: PaneSpec): number {
  const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${name}`);
  // The default is clamped too: on a narrow window even the shipped sizes
  // leave the middle column with nothing.
  return clampPaneSize(spec, raw === null ? spec.fallback : Number(raw), availableFor(spec));
}

function currentSize(name: PaneName, spec: PaneSpec): number {
  const set = document.documentElement.style.getPropertyValue(spec.variable);
  return set === '' ? storedSize(name, spec) : clampPaneSize(spec, parseFloat(set), availableFor(spec));
}

function applySize(spec: PaneSpec, size: number): void {
  document.documentElement.style.setProperty(spec.variable, `${size}px`);
}

function persist(name: PaneName, size: number): void {
  window.localStorage.setItem(`${STORAGE_PREFIX}${name}`, String(size));
}

/** Clamps, applies, and hands back what was actually used, for persisting. */
function setSize(spec: PaneSpec, requested: number): number {
  const size = clampPaneSize(spec, requested, availableFor(spec));
  applySize(spec, size);
  return size;
}

function beginDrag(handle: HTMLElement, name: PaneName, spec: PaneSpec, event: PointerEvent): void {
  event.preventDefault();

  const origin = spec.axis === 'x' ? event.clientX : event.clientY;
  const startSize = currentSize(name, spec);
  let size = startSize;

  handle.setPointerCapture(event.pointerId);
  handle.classList.add('dragging');
  document.body.classList.add('pane-resizing', `pane-resizing-${spec.axis}`);

  const onMove = (move: PointerEvent): void => {
    const position = spec.axis === 'x' ? move.clientX : move.clientY;
    size = setSize(spec, startSize + (position - origin) * spec.direction);
  };

  const onEnd = (): void => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onEnd);
    handle.removeEventListener('pointercancel', onEnd);
    handle.classList.remove('dragging');
    document.body.classList.remove('pane-resizing', `pane-resizing-${spec.axis}`);
    persist(name, size);
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onEnd);
  handle.addEventListener('pointercancel', onEnd);
}

function onKeyDown(name: PaneName, spec: PaneSpec, event: KeyboardEvent): void {
  const grow = spec.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
  const shrink = spec.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';

  let requested: number | null = null;
  if (event.key === grow) {
    requested = currentSize(name, spec) + KEYBOARD_STEP_PX * spec.direction;
  } else if (event.key === shrink) {
    requested = currentSize(name, spec) - KEYBOARD_STEP_PX * spec.direction;
  } else if (event.key === 'Home' || event.key === 'Enter') {
    requested = spec.fallback;
  }

  if (requested === null) {
    return;
  }

  event.preventDefault();
  persist(name, setSize(spec, requested));
}

/**
 * Puts a side's collapsed state on the page and keeps both controls honest.
 *
 * The centre-tab restore button and the panel-header button describe the same
 * thing from opposite states, so their labels and `aria-expanded` are derived
 * here rather than written by whoever happened to trigger the change.
 */
function applyCollapsed(side: CollapsibleSide, collapsed: boolean, root: ParentNode): void {
  const spec = COLLAPSE_SPECS[side];
  document.body.classList.toggle(spec.bodyClass, collapsed);

  const reveal = root.querySelector<HTMLElement>(`#${spec.revealId}`);
  const toggle = root.querySelector<HTMLElement>(`#${spec.toggleId}`);

  for (const control of [reveal, toggle]) {
    control?.setAttribute('aria-expanded', String(!collapsed));
  }

  const label = collapsed ? spec.showLabel : spec.hideLabel;
  if (toggle) {
    toggle.title = `${label} (${spec.shortcut})`;
    toggle.setAttribute('aria-label', label);
  }
  // The centre-tab control only exists to reopen, so its label never changes.
  if (reveal) {
    reveal.title = `${spec.showLabel} (${spec.shortcut})`;
  }
}

/**
 * Collapses or restores a side and remembers it.
 *
 * The sizes are re-clamped afterwards because the pane that stayed can now use
 * the space the other gave up, and would otherwise sit at a cap computed for a
 * layout that no longer exists.
 */
export function setSideCollapsed(side: CollapsibleSide, collapsed: boolean): void {
  applyCollapsed(side, collapsed, document);
  window.localStorage.setItem(`${COLLAPSE_PREFIX}${side}`, String(collapsed));
  reclampAll();
}

export function toggleSide(side: CollapsibleSide): void {
  setSideCollapsed(side, !isSideCollapsed(side));
}

function storedCollapsed(side: CollapsibleSide): boolean {
  return window.localStorage.getItem(`${COLLAPSE_PREFIX}${side}`) === 'true';
}

/** Re-clamps every pane to what the window can currently spare. */
function reclampAll(): void {
  for (const [name, spec] of Object.entries(PANE_SPECS) as [PaneName, PaneSpec][]) {
    applySize(spec, clampPaneSize(spec, storedSize(name, spec), availableFor(spec)));
  }
}

function wireHandle(handle: HTMLElement): void {
  const name = handle.dataset['pane'] as PaneName | undefined;
  const spec = name ? PANE_SPECS[name] : undefined;
  if (!name || !spec) {
    return;
  }

  handle.setAttribute('aria-valuemin', String(spec.min));
  handle.setAttribute('aria-valuemax', String(spec.max));

  handle.addEventListener('pointerdown', (event) => beginDrag(handle, name, spec, event));
  handle.addEventListener('keydown', (event) => onKeyDown(name, spec, event));
  // A layout dragged into a corner needs a way back that is not arithmetic.
  handle.addEventListener('dblclick', () => {
    persist(name, setSize(spec, spec.fallback));
  });
}

/**
 * Applies the remembered sizes and collapse states, and makes every handle in
 * the page draggable.
 */
export function initPanes(root: ParentNode = document): void {
  // Collapse first: a collapsed side frees space, and the sizes clamped below
  // should be clamped against the layout that will actually be on screen.
  for (const side of Object.keys(COLLAPSE_SPECS) as CollapsibleSide[]) {
    applyCollapsed(side, storedCollapsed(side), root);

    const spec = COLLAPSE_SPECS[side];
    root.querySelector<HTMLElement>(`#${spec.revealId}`)
      ?.addEventListener('click', () => setSideCollapsed(side, false));
    root.querySelector<HTMLElement>(`#${spec.toggleId}`)
      ?.addEventListener('click', () => toggleSide(side));
  }

  for (const [name, spec] of Object.entries(PANE_SPECS) as [PaneName, PaneSpec][]) {
    applySize(spec, storedSize(name, spec));
  }

  for (const handle of root.querySelectorAll<HTMLElement>('.pane-resizer')) {
    wireHandle(handle);
  }

  // Shrinking the window can invalidate a size that was fine before. Re-clamp
  // without persisting: the user's chosen size should come back when there is
  // room for it again.
  window.addEventListener('resize', reclampAll);
}
