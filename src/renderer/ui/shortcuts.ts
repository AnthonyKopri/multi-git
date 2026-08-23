// Keyboard shortcuts, read from the command they belong to.
//
// There were six for forty-one commands and a hundred and eighty buttons, and
// nothing in the interface taught any of them -- which for an application whose
// audience is keyboard-first Git users is the wrong way round.
//
// The binding and the hint are the same string. `buildCommands` already carries
// `shortcut` for display, so making it the thing that also matches means the
// palette, the menu row and the handler cannot disagree about what a key does:
// there is one place to write it and no table to keep in step. The contract test
// that checks every advertised shortcut is bound polices the rest.

/** The parts of a chord, as written for a person: `Ctrl+Shift+B`. */
interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Lower-cased, or an `F` key by name. */
  key: string;
}

function parse(spec: string): Chord | null {
  const parts = spec.split('+').map((part) => part.trim()).filter(Boolean);
  const key = parts.at(-1);

  if (key === undefined || parts.length === 0) {
    return null;
  }

  const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase());

  return {
    ctrl: modifiers.includes('ctrl') || modifiers.includes('cmd'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt'),
    // Function keys keep their case so `F5` does not become `f5`; everything
    // else is compared lower-cased, because Shift and Caps Lock change what the
    // browser reports and a shortcut that breaks under Caps Lock looks broken.
    key: /^F\d{1,2}$/i.test(key) ? key.toUpperCase() : key.toLowerCase()
  };
}

/** Whether an event is this chord. */
export function matchesShortcut(spec: string, event: KeyboardEvent): boolean {
  const chord = parse(spec);
  if (chord === null) {
    return false;
  }

  // Cmd on macOS stands in for Ctrl, as it does everywhere else in this app.
  const ctrl = event.ctrlKey || event.metaKey;
  const pressed = /^F\d{1,2}$/i.test(event.key) ? event.key.toUpperCase() : event.key.toLowerCase();

  return (
    ctrl === chord.ctrl &&
    event.shiftKey === chord.shift &&
    event.altKey === chord.alt &&
    pressed === chord.key
  );
}

/**
 * Whether a shortcut should be ignored because the user is typing.
 *
 * A chord carrying Ctrl or Alt is not something anyone types into a commit
 * message, so those still fire. A bare key would be, so it does not -- which is
 * what stops a future single-letter shortcut from eating a character mid-word.
 */
export function isTypingTarget(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }

  const target = event.target as HTMLElement | null;
  if (target === null) {
    return false;
  }

  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}
