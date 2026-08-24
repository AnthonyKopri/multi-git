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
  /** Physical key for printable ASCII shortcuts, when the browser supplies it. */
  code: string | null;
}

let macOSOverride: boolean | null = null;

/** Uses the backend's host value once it arrives, with UA only as first-paint fallback. */
export function setShortcutPlatform(platform: string): void {
  macOSOverride = platform === 'darwin';
}

function runningOnMacOS(): boolean {
  if (macOSOverride !== null) {
    return macOSOverride;
  }
  if (typeof navigator === 'undefined') {
    return false;
  }

  const modern = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = modern.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac/i.test(platform);
}

/** The same binding, rendered using the current platform's keyboard notation. */
export function displayShortcut(spec: string, macOS = runningOnMacOS()): string {
  if (!macOS) {
    return spec;
  }
  // Refresh is Command+R in a Mac application; F5 is commonly behind Fn and
  // is kept as the Windows/browser binding.
  if (spec.toUpperCase() === 'F5') {
    return '⌘R';
  }

  const parts = spec.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return spec;
  }

  const key = parts.pop() as string;
  const modifiers = parts.map((part) => {
    switch (part.toLowerCase()) {
      case 'ctrl':
      case 'cmd':
        return '⌘';
      case 'alt':
      case 'option':
        return '⌥';
      case 'shift':
        return '⇧';
      default:
        return `${part}+`;
    }
  });

  return `${modifiers.join('')}${key === 'Enter' ? '↩' : key}`;
}

const SHORTCUT_IN_TEXT = /(?:Ctrl|Cmd)(?:\+(?:Shift|Alt|Option))*\+(?:F\d{1,2}|[A-Za-z0-9]+|Enter)|F5/g;

/**
 * Localises shortcut hints written in the static HTML. Command rows and pane
 * controls use `displayShortcut` when they are created; this covers titles and
 * placeholders that existed before the renderer bundle ran.
 */
export function localizeShortcutLabels(
  root: ParentNode = document,
  macOS = runningOnMacOS()
): void {
  if (!macOS) {
    return;
  }

  const elements = root.querySelectorAll<HTMLElement>(
    '[title*="Ctrl+"], [placeholder*="Ctrl+"], [aria-label*="Ctrl+"], [title*="F5"]'
  );

  for (const element of elements) {
    for (const attribute of ['title', 'placeholder', 'aria-label'] as const) {
      const value = element.getAttribute(attribute);
      if (value !== null) {
        element.setAttribute(
          attribute,
          value.replace(SHORTCUT_IN_TEXT, (shortcut) => displayShortcut(shortcut, true))
        );
      }
    }
  }
}

/**
 * `KeyboardEvent.key` is the produced character, not the key named by a
 * shortcut. On macOS Option changes that character (`Option+S` is `ß` on a US
 * layout), so Cmd+Option shortcuts cannot be matched from `key` alone. `code`
 * remains `KeyS` and is therefore the reliable representation for these
 * command chords.
 */
function codeFor(key: string): string | null {
  if (/^[a-z]$/i.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(key)) {
    return `Digit${key}`;
  }
  return null;
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
    key: /^F\d{1,2}$/i.test(key) ? key.toUpperCase() : key.toLowerCase(),
    code: codeFor(key)
  };
}

/** Whether an event is this chord. */
export function matchesShortcut(spec: string, event: KeyboardEvent): boolean {
  const chord = parse(spec);
  if (chord === null) {
    return false;
  }

  if (
    chord.key === 'F5' &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'r'
  ) {
    return true;
  }

  // Cmd on macOS stands in for Ctrl, as it does everywhere else in this app.
  const ctrl = event.ctrlKey || event.metaKey;
  const pressed = /^F\d{1,2}$/i.test(event.key) ? event.key.toUpperCase() : event.key.toLowerCase();
  const keyMatches =
    // Only Option/Alt needs the physical key: it can transform the produced
    // character. Ctrl/Cmd-only shortcuts stay logical so Dvorak and other
    // non-QWERTY layouts keep the behavior they had before macOS support.
    event.metaKey && event.altKey && chord.code !== null && event.code !== ''
      ? event.code === chord.code
      : pressed === chord.key;

  return (
    ctrl === chord.ctrl &&
    event.shiftKey === chord.shift &&
    event.altKey === chord.alt &&
    keyMatches
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
