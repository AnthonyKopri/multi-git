// The "..." menu a row opens for the actions that did not fit.
//
// It floats above everything from `document.body` rather than living inside
// the row: the sidebar scrolls, so a menu positioned inside a row would be
// clipped by it the moment a row sat near an edge.
import { el, icon } from '../dom/create';

export interface OverflowItem {
  action: string;
  glyph: string;
  label: string;
  danger?: boolean;
}

/** The one menu that can be open; opening another closes it. */
let openMenu: HTMLElement | null = null;
let openAnchor: HTMLElement | null = null;

export function closeOverflowMenu(): void {
  openMenu?.remove();
  openAnchor?.classList.remove('open');
  openMenu = null;
  openAnchor = null;
}

/** Places the menu under its anchor, flipping when the viewport runs out. */
function position(menu: HTMLElement, anchor: HTMLElement): void {
  const from = anchor.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const margin = 8;

  const left = Math.max(
    margin,
    Math.min(from.right - size.width, window.innerWidth - size.width - margin)
  );
  const below = from.bottom + 4;
  const top = below + size.height + margin > window.innerHeight
    ? Math.max(margin, from.top - size.height - 4)
    : below;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

/**
 * Opens a menu under `anchor`. `onPick` receives the chosen action; the menu
 * closes first, so a handler is free to open a dialog of its own.
 */
export function openOverflowMenu(
  anchor: HTMLElement,
  items: readonly OverflowItem[],
  onPick: (action: string) => void
): void {
  // A second click on the same button is a request to put the menu away.
  const reopening = openAnchor === anchor;
  closeOverflowMenu();
  if (reopening) {
    return;
  }

  const menu = el('div', {
    className: 'overflow-menu',
    attrs: { role: 'menu' },
    children: items.map((item) =>
      el('button', {
        // The same menu-row styling the SSH profile table's overflow uses.
        className: `btn btn-menu-row${item.danger === true ? ' danger' : ''}`,
        attrs: { type: 'button', role: 'menuitem' },
        children: [icon(item.glyph, 16), el('span', { text: item.label })],
        // The click is caught below rather than per button, so the rows stay
        // plain markup.
        data: { action: item.action }
      })
    )
  });

  menu.addEventListener('click', (event) => {
    const picked = (event.target as Element).closest<HTMLElement>('[data-action]');
    const action = picked?.dataset['action'];
    if (action === undefined) {
      return;
    }
    event.stopPropagation();
    closeOverflowMenu();
    onPick(action);
  });

  document.body.appendChild(menu);
  position(menu, anchor);
  anchor.classList.add('open');
  openMenu = menu;
  openAnchor = anchor;
  menu.querySelector<HTMLElement>('.btn-menu-row')?.focus();
}

/**
 * Installs the listeners that dismiss an open menu. Anything that moves the
 * anchor out from under the menu closes it, since a floating menu cannot
 * follow a scroll it is not part of.
 */
export function initOverflowMenus(): void {
  document.addEventListener('click', () => closeOverflowMenu());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openMenu !== null) {
      closeOverflowMenu();
    }
  });
  window.addEventListener('resize', () => closeOverflowMenu());
  // Capture: scrolling happens in the panels, not on the document.
  document.addEventListener('scroll', () => closeOverflowMenu(), true);
}
