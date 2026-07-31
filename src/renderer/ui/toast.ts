// Transient notifications.
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

export function showToast(message: string, type: ToastType = 'info', durationMs = 4000): void {
  if (!container) {
    return;
  }

  const toast = el('div', {
    className: `toast toast-${type}`,
    children: [icon(TOAST_ICONS[type]), el('span', { text: message })]
  });

  const dismiss = (): void => {
    if (!toast.parentNode) {
      return;
    }
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), EXIT_ANIMATION_MS);
  };

  toast.addEventListener('click', dismiss);
  setTimeout(dismiss, durationMs);

  container.appendChild(toast);
}
