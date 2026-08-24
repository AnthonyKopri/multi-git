// @vitest-environment happy-dom
//
// Matching a chord written for a person against a key the browser reports.
//
// The string is both the hint shown in the palette and the thing that matches,
// which is the whole point: there were six shortcuts for forty-one commands,
// nothing taught them, and F5 was printed in a tooltip and bound to nothing for
// two releases because the hint and the binding were separate.
import { describe, expect, it } from 'vitest';

import {
  displayShortcut,
  isTypingTarget,
  localizeShortcutLabels,
  matchesShortcut
} from '../src/renderer/ui/shortcuts';

function press(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('matching a chord', () => {
  it('matches the modifiers exactly', () => {
    expect(matchesShortcut('Ctrl+Alt+P', press({ key: 'p', ctrlKey: true, altKey: true }))).toBe(true);

    // A superset is not a match: Ctrl+Alt+P must not fire on Ctrl+Alt+Shift+P,
    // or two commands could answer one press.
    expect(
      matchesShortcut('Ctrl+Alt+P', press({ key: 'p', ctrlKey: true, altKey: true, shiftKey: true }))
    ).toBe(false);
    expect(matchesShortcut('Ctrl+Alt+P', press({ key: 'p', ctrlKey: true }))).toBe(false);
    expect(matchesShortcut('Ctrl+Alt+P', press({ key: 'p' }))).toBe(false);
  });

  it('survives Caps Lock, which is what broke Ctrl+K', () => {
    expect(matchesShortcut('Ctrl+K', press({ key: 'K', ctrlKey: true }))).toBe(true);
    expect(matchesShortcut('Ctrl+K', press({ key: 'k', ctrlKey: true }))).toBe(true);
  });

  it('keeps Ctrl-only shortcuts logical on non-QWERTY layouts', () => {
    expect(
      matchesShortcut('Ctrl+K', press({ key: 'k', code: 'KeyV', ctrlKey: true }))
    ).toBe(true);
  });

  it('keeps Windows and Linux Ctrl+Alt shortcuts logical too', () => {
    expect(
      matchesShortcut(
        'Ctrl+Alt+S',
        press({ key: 's', code: 'KeyO', ctrlKey: true, altKey: true })
      )
    ).toBe(true);
  });

  it('accepts Cmd for Ctrl', () => {
    expect(matchesShortcut('Ctrl+1', press({ key: '1', metaKey: true }))).toBe(true);
  });

  it('matches a Cmd+Option letter by code when Option changes the typed character', () => {
    // On the macOS US layout Option+S produces ß. KeyboardEvent.key therefore
    // no longer contains the letter written in the shortcut, even though this
    // is the physical S key. Every Ctrl+Alt command is exposed as Cmd+Option on
    // macOS, so matching only `key` makes Stage all, Fetch, Pull and Push inert.
    expect(
      matchesShortcut(
        'Ctrl+Alt+S',
        press({ key: 'ß', code: 'KeyS', metaKey: true, altKey: true })
      )
    ).toBe(true);
    expect(
      matchesShortcut(
        'Ctrl+Alt+S',
        press({ key: '∂', code: 'KeyD', metaKey: true, altKey: true })
      )
    ).toBe(false);
  });

  it('matches function keys by name', () => {
    expect(matchesShortcut('F5', press({ key: 'F5' }))).toBe(true);
    expect(matchesShortcut('F5', press({ key: 'r', code: 'KeyR', metaKey: true }))).toBe(true);
    expect(matchesShortcut('F5', press({ key: 'F6' }))).toBe(false);
    // And is not confused by a modifier nobody asked for.
    expect(matchesShortcut('F5', press({ key: 'F5', ctrlKey: true }))).toBe(false);
  });

  it('distinguishes Ctrl+B from Ctrl+Shift+B', () => {
    // Two real bindings that differ only by Shift, so getting this wrong would
    // collapse the two side panels onto one key.
    expect(matchesShortcut('Ctrl+B', press({ key: 'b', ctrlKey: true }))).toBe(true);
    expect(matchesShortcut('Ctrl+B', press({ key: 'B', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesShortcut('Ctrl+Shift+B', press({ key: 'B', ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it('refuses a spec it cannot read rather than matching everything', () => {
    expect(matchesShortcut('', press({ key: 'a' }))).toBe(false);
    expect(matchesShortcut('+', press({ key: 'a' }))).toBe(false);
  });
});

describe('not stealing keys from a text box', () => {
  function inField(tag: string, init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
    const field = document.createElement(tag);
    document.body.append(field);
    const event = press(init);
    Object.defineProperty(event, 'target', { value: field });
    return event;
  }

  it('leaves a bare key alone while typing', () => {
    expect(isTypingTarget(inField('input', { key: 'a' }))).toBe(true);
    expect(isTypingTarget(inField('textarea', { key: 'a' }))).toBe(true);
    expect(isTypingTarget(inField('select', { key: 'a' }))).toBe(true);
  });

  it('still fires a chord, which nobody types into a commit message', () => {
    // The commit box is a textarea, and fetch is Ctrl+Alt+F. If a modifier
    // chord were suppressed there, half these shortcuts would be dead in the
    // one place people spend their time.
    expect(isTypingTarget(inField('textarea', { key: 'f', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isTypingTarget(inField('input', { key: 'k', ctrlKey: true }))).toBe(false);
  });

  it('does not treat the rest of the page as a text box', () => {
    const event = press({ key: 'a' });
    Object.defineProperty(event, 'target', { value: document.createElement('div') });
    expect(isTypingTarget(event)).toBe(false);
  });
});

describe('platform shortcut labels', () => {
  it('uses conventional macOS modifier symbols without changing the binding', () => {
    expect(displayShortcut('Ctrl+Alt+S', true)).toBe('⌘⌥S');
    expect(displayShortcut('Ctrl+Shift+B', true)).toBe('⌘⇧B');
    expect(displayShortcut('Ctrl+Enter', true)).toBe('⌘↩');
    expect(displayShortcut('F5', true)).toBe('⌘R');
    expect(displayShortcut('Ctrl+Alt+S', false)).toBe('Ctrl+Alt+S');
  });

  it('localises shortcut hints embedded in static markup', () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<button title="Fetch (Ctrl+Alt+F)"></button>',
      '<textarea placeholder="Type (Ctrl+Enter to commit)"></textarea>'
    ].join('');

    localizeShortcutLabels(root, true);

    expect(root.querySelector('button')?.title).toBe('Fetch (⌘⌥F)');
    expect(root.querySelector('textarea')?.getAttribute('placeholder')).toBe(
      'Type (⌘↩ to commit)'
    );
  });
});
