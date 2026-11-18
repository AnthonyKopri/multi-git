// The theme, reduced colour and Simple mode, applied to the page.
//
// All three are app-wide settings stored in the config file, and all are drawn
// by CSS alone: the theme as `data-theme` on <html>, reduced colour as
// `data-color` beside it, Simple mode as a class on <body>. Nothing is
// re-rendered when one changes, which is why switching is instant and loses no
// state.
//
// The theme and reduced colour are also copied to localStorage.
// public/theme.js reads those copies in <head>, before the stylesheet, so the
// next window opens in the right look rather than dark-then-flipped; the config
// file needs a request to read, and the first frame does not wait for one.
import type { ThemeChoice } from '../../shared/commit-types';

const STORAGE_KEY = 'mg_theme';
const COLOR_KEY = 'mg_color';

/** The themes CSS draws. "system" is not one of them: it picks dark or light. */
export type DrawnTheme = 'dark' | 'oled' | 'light';

let choice: ThemeChoice = 'dark';
let media: MediaQueryList | null = null;

function systemPrefersLight(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

/** The theme actually drawn for a choice. */
export function resolveTheme(value: ThemeChoice, prefersLight: boolean): DrawnTheme {
  if (value === 'system') {
    return prefersLight ? 'light' : 'dark';
  }
  return value;
}

function draw(): void {
  document.documentElement.dataset['theme'] = resolveTheme(choice, systemPrefersLight());
}

/** Applies a theme choice and remembers it for the next window's first paint. */
export function applyTheme(value: ThemeChoice): void {
  choice = value;

  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage can be blocked. The theme still applies to this window.
  }

  // Follow the operating system live, but only while that is what was asked for.
  if (media === null && typeof window.matchMedia === 'function') {
    media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', () => {
      if (choice === 'system') {
        draw();
      }
    });
  }

  draw();
}

/**
 * Turns reduced colour on or off for this window, and remembers it for the
 * next window's first paint.
 */
export function applyReducedColor(enabled: boolean): void {
  try {
    window.localStorage.setItem(COLOR_KEY, enabled ? 'reduced' : 'full');
  } catch {
    // Storage can be blocked. The look still applies to this window.
  }

  if (enabled) {
    document.documentElement.dataset['color'] = 'reduced';
  } else {
    delete document.documentElement.dataset['color'];
  }
}

/** Turns Simple mode on or off for this window. */
export function applySimpleMode(enabled: boolean): void {
  document.body.classList.toggle('simple-mode', enabled);
}

export function isSimpleMode(): boolean {
  return document.body.classList.contains('simple-mode');
}
