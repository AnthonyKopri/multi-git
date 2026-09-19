// The terminal UI's own settings: look and leader keys. Kept by the backend
// beside its discovery record, so every terminal session shares them.
import { leaderBindings, validateBindings } from './navigation';

export const THEMES = ['terminal', 'light', 'dark', 'mono'] as const;
export type TerminalTheme = (typeof THEMES)[number];

export interface TerminalPreferences {
  /** `terminal` keeps the terminal's own colours and only adds an accent. */
  theme: TerminalTheme;
  /** Plain ASCII markers and borders, for fonts and consoles without them. */
  ascii: boolean;
  /** Leader key → action id. Every leader action has exactly one key. */
  bindings: Record<string, string>;
}

export function defaultPreferences(): TerminalPreferences {
  return { theme: 'terminal', ascii: false, bindings: { ...leaderBindings } };
}

/** Null when valid, otherwise what is wrong, in words for the user. */
export function validatePreferences(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Terminal preferences must be an object.';
  }
  const candidate = value as Partial<TerminalPreferences>;
  if (!THEMES.includes(candidate.theme as TerminalTheme)) {
    return `Theme must be one of ${THEMES.join(', ')}.`;
  }
  if (typeof candidate.ascii !== 'boolean') {
    return 'ASCII-only must be true or false.';
  }
  if (!candidate.bindings || typeof candidate.bindings !== 'object' || Array.isArray(candidate.bindings)) {
    return 'Shortcuts must map keys to actions.';
  }
  return validateBindings(candidate.bindings);
}
