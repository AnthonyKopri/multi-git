// Button busy state and pane messages.
import { el } from '../dom/create';

/**
 * Disables a button and swaps its icon for a spinner.
 *
 * The icon is replaced in place rather than the label being changed, so icon
 * buttons keep their fixed size and text buttons do not shift while an action
 * runs.
 */
export function setButtonBusy(button: HTMLElement | null, busy: boolean): void {
  if (!button) {
    return;
  }

  const icon = button.querySelector<HTMLElement>('.material-symbols-outlined');

  if (busy) {
    // Guard against a double-start losing the original icon name.
    if (button.dataset['busy'] === 'true') {
      return;
    }

    (button as HTMLButtonElement).disabled = true;
    button.dataset['busy'] = 'true';

    if (icon) {
      icon.dataset['originalIcon'] = icon.textContent ?? '';
      icon.textContent = 'progress_activity';
      icon.classList.add('btn-spinner-icon');
    }
    return;
  }

  (button as HTMLButtonElement).disabled = false;
  delete button.dataset['busy'];

  const spinner = button.querySelector<HTMLElement>(
    '.material-symbols-outlined[data-original-icon]'
  );
  if (spinner) {
    spinner.textContent = spinner.dataset['originalIcon'] ?? '';
    delete spinner.dataset['originalIcon'];
    spinner.classList.remove('btn-spinner-icon');
  }
}

/** Runs an action with the button showing a spinner, restoring it after. */
export async function withButtonBusy<T>(
  button: HTMLElement | null,
  action: () => Promise<T>
): Promise<T> {
  setButtonBusy(button, true);
  try {
    return await action();
  } finally {
    setButtonBusy(button, false);
  }
}

/** Replaces a pane's contents with a single status or error message. */
export function renderPaneMessage(
  container: Element,
  message: string,
  isError = false,
  wrapperClass = 'diff-empty-state'
): void {
  container.replaceChildren(
    el('div', {
      className: wrapperClass,
      children: [el('p', { className: isError ? 'logger-line-error' : '', text: message })]
    })
  );
}
