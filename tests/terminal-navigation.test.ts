// The terminal UI's keys: Vim motions, two-key prefixes and the leader.
import { describe, expect, it } from 'vitest';

import { initialNavigation, leaderBindings, navigate, terminalText, validateBindings } from '../src/server/terminal/navigation';
import type { Navigation } from '../src/server/terminal/navigation';
import { validatePreferences, defaultPreferences } from '../src/server/terminal/preferences';

/** Presses keys in turn over a list of `count` rows, a page of 10. */
function keys(sequence: string[], count = 50, start: Partial<Navigation> = {}) {
  let state = { ...initialNavigation(), ...start };
  let action: string | undefined;
  for (const key of sequence) {
    ({ state, action } = navigate(state, key, count, 10));
  }
  return { state, action };
}

describe('motions', () => {
  it('moves with j/k and the arrows, and stops at either end', () => {
    expect(keys(['j', 'j', 'down']).state.index).toBe(3);
    expect(keys(['j', 'k', 'up', 'k']).state.index).toBe(0);
    expect(keys(['G', 'j']).state.index).toBe(49);
  });

  it('jumps with gg and G, and half a page with Ctrl+d / Ctrl+u', () => {
    expect(keys(['G']).state.index).toBe(49);
    expect(keys(['G', 'g', 'g']).state.index).toBe(0);
    expect(keys(['ctrl+d', 'ctrl+d']).state.index).toBe(10);
    expect(keys(['ctrl+d', 'ctrl+u']).state.index).toBe(0);
  });

  it('moves between panes with Tab, Shift+Tab and Ctrl+w then a direction', () => {
    expect(keys(['tab']).state.pane).toBe(1);
    expect(keys(['shift+tab']).state.pane).toBe(2);
    expect(keys(['ctrl+w', 'l', 'ctrl+w', 'l']).state.pane).toBe(2);
    expect(keys(['ctrl+w', 'l', 'ctrl+w', 'h']).state.pane).toBe(0);
    // The direction after Ctrl+w moves the pane, not the selection.
    expect(keys(['ctrl+w', 'j']).state.index).toBe(0);
  });

  it('opens with Enter or l, and goes back with h or Esc', () => {
    expect(keys(['enter']).action).toBe('open');
    expect(keys(['l']).action).toBe('open');
    expect(keys(['h']).action).toBe('back');
    expect(keys(['escape']).action).toBe('back');
  });

  it('names the palette, search, help and next or previous match', () => {
    expect(keys([':']).action).toBe('palette');
    expect(keys(['/']).action).toBe('search');
    expect(keys(['?']).action).toBe('help');
    expect(keys(['n']).action).toBe('next-match');
    expect(keys(['N']).action).toBe('previous-match');
  });
});

describe('the leader', () => {
  it('waits after Space, then runs the bound action', () => {
    expect(keys([' ']).state.prefix).toBe('leader');
    expect(keys([' ', 'f']).action).toBe('fetch');
    expect(keys([' ', 'P']).action).toBe('push');
    expect(keys([' ', 'A']).action).toBe('auto-pull');
  });

  it('is cancelled by Esc without going back a view', () => {
    const { state, action } = keys([' ', 'escape']);
    expect(state.prefix).toBe('');
    expect(action).toBeUndefined();
  });

  it('uses remapped keys', () => {
    const bindings: Record<string, string> = { ...leaderBindings, x: 'fetch' };
    delete bindings['f'];
    let state = initialNavigation();
    state = navigate(state, ' ', 10, 10, bindings).state;
    expect(navigate(state, 'x', 10, 10, bindings).action).toBe('fetch');
  });
});

describe('selection', () => {
  it('selects the rows moved over in SELECT mode, and clears on Esc', () => {
    const { state } = keys(['v', 'j', 'j']);
    expect(state.mode).toBe('SELECT');
    expect(state.selected).toEqual([0, 1, 2]);
    expect(keys(['v', 'j', 'escape']).state).toMatchObject({ mode: 'NORMAL', selected: [] });
  });
});

describe('INPUT mode', () => {
  it('turns no key into an action', () => {
    for (const key of ['s', 'u', 'j', ':', ' ', 'enter', 'G', 'ctrl+d', 'v']) {
      const { state, action } = keys([key], 50, { mode: 'INPUT' });
      expect(action, key).toBeUndefined();
      expect(state.index, key).toBe(0);
    }
  });
});

describe('remapping', () => {
  it('rejects conflicts, unknown actions, missing actions and awkward keys', () => {
    expect(validateBindings(leaderBindings)).toBeNull();
    expect(validateBindings({ ...leaderBindings, x: 'fetch' })).toContain('Two keys');
    expect(validateBindings({ ...leaderBindings, x: 'format-disk' })).toContain('Unknown action');
    const missing = { ...leaderBindings };
    delete missing['f'];
    expect(validateBindings(missing)).toContain('every leader action');
    expect(validateBindings({ ...leaderBindings, '!': 'fetch' })).toContain('one letter or digit');
  });

  it('validates stored preferences as a whole', () => {
    expect(validatePreferences(defaultPreferences())).toBeNull();
    expect(validatePreferences({ ...defaultPreferences(), theme: 'neon' })).toContain('Theme');
    expect(validatePreferences({ ...defaultPreferences(), ascii: 'yes' })).toContain('ASCII');
  });
});

describe('repository text', () => {
  it('cannot carry terminal control sequences', () => {
    expect(terminalText('file\x1b[2Jname\x07\ttab')).toBe('file[2Jname  tab');
  });
});
