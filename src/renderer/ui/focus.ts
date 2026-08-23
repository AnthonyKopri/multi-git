// Keyboard behaviour for the modal layer.
//
// Two rules, stated once here rather than re-decided in each of the twenty-odd
// modals:
//
//   * A modal that opens takes focus. Without it the user has to click before
//     they can type, and any key handler the modal registered on itself never
//     hears anything -- which is how the pull-request creator came to have an
//     Escape listener that could not fire.
//   * Tab stays inside the modal that has focus. The page behind an open modal
//     is blurred and click-through, so tabbing into it lands on controls that
//     can be seen faintly and not used, with no way back except the mouse.
//
// Visibility is decided by the `hidden` class rather than by geometry, because
// that is how setHidden hides things here and because offsetParent and
// getClientRects report nothing under happy-dom, where this is tested.

/** Things a user can tab to, in the order the document defines them. */
const FOCUSABLE = [
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'button',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function isAvailable(element: HTMLElement, root: HTMLElement): boolean {
  if (element.hasAttribute('disabled') || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  // Walk to the root rather than using :not(.hidden), which would only exclude
  // the element itself and not a whole hidden section it sits inside.
  for (let node: HTMLElement | null = element; node && node !== root; node = node.parentElement) {
    if (node.classList.contains('hidden')) {
      return false;
    }
  }

  return true;
}

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) =>
    isAvailable(element, root)
  );
}

/**
 * Gives a modal focus, preferring somewhere the user can type.
 *
 * The first field if there is one, otherwise the first control -- usually the
 * primary button, which is the right place to land in a modal that only asks a
 * question. Deferred past the reflow, because focus() does nothing while the
 * element is still hidden.
 */
export function focusFirst(root: HTMLElement): void {
  setTimeout(() => {
    const candidates = focusableWithin(root);
    if (candidates.length === 0) {
      return;
    }

    const field = candidates.find((element) =>
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)
    );

    (field ?? candidates[0])?.focus();
  }, 30);
}

/** Open modals, in the order they are painted. */
function openModals(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.modal-overlay')].filter(
    (modal) => !modal.classList.contains('hidden')
  );
}

/**
 * Keeps Tab inside the modal the user is working in.
 *
 * The modal containing focus rather than the last one open, so a dialog raised
 * on top of another traps within itself while the one underneath stays as it
 * was. Returns true when the key was handled.
 */
export function trapTab(event: KeyboardEvent): boolean {
  const open = openModals();
  if (open.length === 0) {
    return false;
  }

  const active = document.activeElement as HTMLElement | null;
  const modal = open.find((candidate) => active !== null && candidate.contains(active))
    ?? open[open.length - 1];

  if (!modal) {
    return false;
  }

  const candidates = focusableWithin(modal);
  if (candidates.length === 0) {
    return false;
  }

  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  const index = active === null ? -1 : candidates.indexOf(active);

  // Focus outside the modal, or on the modal itself: pull it to whichever end
  // the direction implies rather than leaving Tab to walk into the page behind.
  if (index === -1) {
    (event.shiftKey ? last : first)?.focus();
    return true;
  }

  const next = candidates[(index + (event.shiftKey ? -1 : 1) + candidates.length) % candidates.length];
  next?.focus();
  return true;
}
