// Transient notifications.
//
// This is how the application reports the outcome of nearly everything, so it
// carries two things beyond the text. The container is a live region, because a
// result nobody is told about is not a result. And a toast can carry the action
// it is describing: several of these name a remedy -- unlock the key, open a
// repository -- and sending the user off to find it by hand when the button
// could be right there is work the app is making them do for no reason.
import { el, icon } from '../dom/create';

export type ToastType = 'success' | 'error' | 'warn' | 'info';

const TOAST_ICONS: Record<ToastType, string> = {
  success: 'check_circle',
  error: 'error',
  warn: 'warning',
  info: 'info'
};

/** Matches the CSS exit-animation duration. */
const EXIT_ANIMATION_MS = 220;

let container: HTMLElement | null = null;

export function initToasts(toastContainer: HTMLElement): void {
  container = toastContainer;
}

/** A one-click way to do the thing the toast is telling the user to do. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export function showToast(
  message: string,
  type: ToastType = 'info',
  durationMs = 4000,
  action?: ToastAction
): void {
  if (!container) {
    return;
  }

  const toast = el('div', {
    className: `toast toast-${type}`,
    children: [icon(TOAST_ICONS[type]), el('span', { text: message })]
  });

  // A failure interrupts; everything else waits its turn. Set per toast rather
  // than on the container, which would announce successes as urgently as
  // errors.
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const dismiss = (): void => {
    if (!toast.parentNode) {
      return;
    }
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), EXIT_ANIMATION_MS);
  };

  if (action) {
    const button = el('button', {
      className: 'toast-action',
      text: action.label,
      attrs: { type: 'button' }
    });

    // Stopped, so the click does not also reach the dismiss handler below and
    // start the action against a toast that is already animating away.
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      dismiss();
      action.run();
    });

    toast.appendChild(button);
  }

  toast.addEventListener('click', dismiss);
  setTimeout(dismiss, durationMs);

  container.appendChild(toast);
}
