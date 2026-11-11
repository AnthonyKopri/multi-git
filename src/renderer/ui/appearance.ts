// The theme and Simple mode, applied to the page.
//
// Both are app-wide settings stored in the config file, and both are drawn by
// CSS alone: the theme as `data-theme` on <html>, Simple mode as a class on
// <body>. Nothing is re-rendered when either changes, which is why switching is
// instant and loses no state.
//
// The theme is also copied to localStorage. public/theme.js reads that copy in
// <head>, before the stylesheet, so the next window opens in the right theme
// rather than dark-then-flipped; the config file needs a request to read, and
// the first frame does not wait for one.
import type { ThemeChoice } from '../../shared/commit-types';

const STORAGE_KEY = 'mg_theme';

let choice: ThemeChoice = 'dark';
let media: MediaQueryList | null = null;

function systemPrefersLight(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

/** The theme actually drawn for a choice. */
export function resolveTheme(value: ThemeChoice, prefersLight: boolean): 'dark' | 'light' {
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

/** Turns Simple mode on or off for this window. */
export function applySimpleMode(enabled: boolean): void {
  document.body.classList.toggle('simple-mode', enabled);
}

export function isSimpleMode(): boolean {
  return document.body.classList.contains('simple-mode');
}
