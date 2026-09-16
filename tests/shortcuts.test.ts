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
  formatShortcut,
  isTypingTarget,
  localizeShortcutHints,
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

  it('matches Cmd+Option chords on a Mac, where Option changes the character', () => {
    expect(
      matchesShortcut('Ctrl+Alt+F', press({ key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true }))
    ).toBe(true);
    // The position is only a fallback for Alt; without it the character decides.
    expect(matchesShortcut('Ctrl+K', press({ key: 'x', code: 'KeyK', ctrlKey: true }))).toBe(false);
  });

  it('accepts Cmd for Ctrl', () => {
    expect(matchesShortcut('Ctrl+1', press({ key: '1', metaKey: true }))).toBe(true);
  });

  it('matches function keys by name', () => {
    expect(matchesShortcut('F5', press({ key: 'F5' }))).toBe(true);
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

describe('formatShortcut', () => {
  it('leaves the hint as written off a Mac', () => {
    expect(formatShortcut('Ctrl+Shift+B', false)).toBe('Ctrl+Shift+B');
  });

  it('writes Cmd and Option the way macOS does', () => {
    // Cmd is what matches there, so a hint naming Ctrl would send a Mac user
    // to a key that does something else.
    expect(formatShortcut('Ctrl+K', true)).toBe('⌘K');
    expect(formatShortcut('Ctrl+Shift+B', true)).toBe('⇧⌘B');
    expect(formatShortcut('Ctrl+Alt+P', true)).toBe('⌥⌘P');
    expect(formatShortcut('Ctrl+Enter', true)).toBe('⌘↩');
    expect(formatShortcut('F5', true)).toBe('F5');
  });
});

describe('localizeShortcutHints', () => {
  it('rewrites the Ctrl hints in tooltips and placeholders on a Mac', () => {
    document.body.innerHTML = `
      <button id="a" title="Push (Ctrl+Alt+U)"></button>
      <textarea id="b" placeholder="Type commit message (Ctrl+Enter to commit)..."></textarea>
      <button id="c" title="Refresh"></button>`;

    localizeShortcutHints(document, true);

    expect(document.getElementById('a')?.title).toBe('Push (⌥⌘U)');
    expect(document.getElementById('b')?.getAttribute('placeholder')).toBe(
      'Type commit message (⌘↩ to commit)...'
    );
    expect(document.getElementById('c')?.title).toBe('Refresh');
  });

  it('changes nothing elsewhere', () => {
    document.body.innerHTML = '<button id="a" title="Push (Ctrl+Alt+U)"></button>';

    localizeShortcutHints(document, false);

    expect(document.getElementById('a')?.title).toBe('Push (Ctrl+Alt+U)');
  });
});
