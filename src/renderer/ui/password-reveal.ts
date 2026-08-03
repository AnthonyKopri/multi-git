// Show/hide toggles for passphrase inputs.
//
// A master key and an SSH passphrase are both typed blind into a field that
// gives no feedback, and a mistyped one comes back as "wrong key" with no way
// to tell a typo from the wrong key. The eye reveals what was typed.
//
// Revealing only changes the input's `type`. Nothing is copied, stored, or
// logged, and every field is put back to masked when its dialog opens so a
// revealed passphrase is never left on screen for the next use.
import { asButton, asInput } from '../dom/elements';

const MASKED_GLYPH = 'visibility';
const REVEALED_GLYPH = 'visibility_off';

function applyState(input: HTMLInputElement, button: HTMLButtonElement, revealed: boolean): void {
  input.type = revealed ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(revealed));

  const label = revealed ? 'Hide' : 'Show';
  button.title = label;
  button.setAttribute('aria-label', label);

  const glyph = button.querySelector('.material-symbols-outlined');
  if (glyph) {
    glyph.textContent = revealed ? REVEALED_GLYPH : MASKED_GLYPH;
  }
}

/**
 * Wires a reveal button to its input.
 *
 * Both come from the element registry, so a renamed id fails at startup rather
 * than leaving a button that quietly does nothing.
 */
export function attachPasswordReveal(inputElement: HTMLElement, buttonElement: HTMLElement): void {
  const input = asInput(inputElement);
  const button = asButton(buttonElement);

  applyState(input, button, false);

  button.addEventListener('click', () => {
    const revealed = button.getAttribute('aria-pressed') === 'true';
    applyState(input, button, !revealed);
    // Typing continues where it left off rather than at the start.
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

/** Puts a field back to masked. Call when the dialog holding it opens. */
export function maskPasswordField(inputElement: HTMLElement, buttonElement: HTMLElement): void {
  applyState(asInput(inputElement), asButton(buttonElement), false);
}
