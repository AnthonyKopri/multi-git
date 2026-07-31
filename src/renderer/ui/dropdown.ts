// Header dropdown menus.
//
// One registry so opening any menu closes the others, and a single
// document-level click handler closes all of them, instead of each menu
// wiring its own outside-click listener.
import { setHidden } from '../dom/create';

interface Registration {
  trigger: HTMLElement;
  menu: HTMLElement;
}

const registry: Registration[] = [];

export function closeAllDropdowns(): void {
  for (const { trigger, menu } of registry) {
    setHidden(menu, true);
    trigger.classList.remove('open');
  }
}

/**
 * Wires a trigger button to a menu.
 *
 * `onOpen` runs just before the menu is shown, so a menu can populate itself
 * lazily rather than being re-rendered on every state change.
 */
export function registerDropdown(
  trigger: HTMLElement,
  menu: HTMLElement,
  onOpen?: () => void
): void {
  registry.push({ trigger, menu });

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();

    const wasHidden = menu.classList.contains('hidden');
    closeAllDropdowns();

    if (wasHidden) {
      onOpen?.();
      setHidden(menu, false);
      trigger.classList.add('open');
    }
  });

  // Clicks inside the menu must not bubble to the document handler that
  // closes everything.
  menu.addEventListener('click', (event) => event.stopPropagation());
}

/** Installs the document-level handler that closes menus on an outside click. */
export function initDropdowns(): void {
  document.addEventListener('click', closeAllDropdowns);
}

export function isAnyDropdownOpen(): boolean {
  return registry.some(({ menu }) => !menu.classList.contains('hidden'));
}
