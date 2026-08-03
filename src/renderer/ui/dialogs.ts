// Modal confirm and prompt dialogs, as promises.
//
// The app has destructive actions — discard, force delete, hard reset — that
// must be confirmed. Using the platform `confirm()` would block the event
// loop and cannot carry the "don't ask again" checkbox the discard flow needs.
import { asInput, type Elements } from '../dom/elements';
import { setHidden } from '../dom/create';
import { attachPasswordReveal, maskPasswordField } from './password-reveal';

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
}

export interface ConfirmResult {
  confirmed: boolean;
  /** State of the optional checkbox, false when it was not shown. */
  checked: boolean;
}

export interface PromptOptions {
  title?: string;
  label?: string;
  type?: 'password' | 'text';
}

let elements: Elements | null = null;
let confirmResolve: ((result: ConfirmResult) => void) | null = null;
let promptResolve: ((value: string | null) => void) | null = null;

function required(): Elements {
  if (!elements) {
    throw new Error('Dialogs used before initDialogs()');
  }
  return elements;
}

export function initDialogs(resolved: Elements): void {
  elements = resolved;

  const {
    confirmModal,
    btnConfirmOk,
    btnConfirmCancel,
    promptModal,
    promptForm,
    btnPromptCancel
  } = resolved;

  btnConfirmOk.addEventListener('click', () => settleConfirm(true));
  btnConfirmCancel.addEventListener('click', () => settleConfirm(false));
  // Clicking the backdrop cancels, matching the Escape handler.
  confirmModal.addEventListener('click', (event) => {
    if (event.target === confirmModal) {
      settleConfirm(false);
    }
  });

  attachPasswordReveal(resolved.promptInput, resolved.btnPromptReveal);

  promptForm.addEventListener('submit', (event) => {
    event.preventDefault();
    settlePrompt(asInput(resolved.promptInput).value);
  });
  btnPromptCancel.addEventListener('click', () => settlePrompt(null));
  promptModal.addEventListener('click', (event) => {
    if (event.target === promptModal) {
      settlePrompt(null);
    }
  });
}

export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<ConfirmResult> {
  const ui = required();

  return new Promise((resolve) => {
    // Only one confirm at a time; a previous unresolved one cancels so its
    // caller is never left awaiting forever.
    confirmResolve?.({ confirmed: false, checked: false });
    confirmResolve = resolve;

    ui.confirmTitle.textContent = options.title ?? 'Are you sure?';
    ui.confirmMessage.textContent = message;
    ui.btnConfirmOk.textContent = options.confirmLabel ?? 'Confirm';
    ui.btnConfirmOk.className = options.danger ? 'btn btn-danger' : 'btn btn-primary';

    if (options.checkboxLabel) {
      ui.confirmCheckboxLabel.textContent = options.checkboxLabel;
      asInput(ui.confirmCheckbox).checked = Boolean(options.checkboxChecked);
      setHidden(ui.confirmCheckboxRow, false);
    } else {
      setHidden(ui.confirmCheckboxRow, true);
    }

    setHidden(ui.confirmModal, false);
    ui.btnConfirmOk.focus();
  });
}

export function settleConfirm(confirmed: boolean): void {
  if (!confirmResolve) {
    return;
  }

  const resolve = confirmResolve;
  confirmResolve = null;

  const ui = required();
  setHidden(ui.confirmModal, true);
  resolve({ confirmed, checked: asInput(ui.confirmCheckbox).checked });
}

export function promptDialog(options: PromptOptions = {}): Promise<string | null> {
  const ui = required();

  return new Promise((resolve) => {
    promptResolve?.(null);
    promptResolve = resolve;

    ui.promptTitle.textContent = options.title ?? 'Input required';
    ui.promptLabel.textContent = options.label ?? 'Value';

    const input = asInput(ui.promptInput);
    const isPassword = (options.type ?? 'password') === 'password';

    // Always reopen masked: the eye is a deliberate act, not a setting, and a
    // passphrase revealed once should not still be on screen next time.
    maskPasswordField(ui.promptInput, ui.btnPromptReveal);
    setHidden(ui.btnPromptReveal, !isPassword);
    if (!isPassword) {
      input.type = 'text';
    }
    input.value = '';

    setHidden(ui.promptModal, false);
    // The modal is hidden when focus() is called, so defer past the reflow.
    setTimeout(() => input.focus(), 30);
  });
}

export function settlePrompt(value: string | null): void {
  if (!promptResolve) {
    return;
  }

  const resolve = promptResolve;
  promptResolve = null;

  setHidden(required().promptModal, true);
  resolve(value);
}

/** True when a dialog is open, so Escape knows what to close first. */
export function hasOpenDialog(): boolean {
  return confirmResolve !== null || promptResolve !== null;
}

/** Cancels whichever dialog is open. */
export function cancelOpenDialog(): void {
  if (promptResolve) {
    settlePrompt(null);
  } else if (confirmResolve) {
    settleConfirm(false);
  }
}
