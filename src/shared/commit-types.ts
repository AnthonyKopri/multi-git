// The commit types offered above the message box, and the rules for adding one.
//
// Shared because two sides have to agree on what a valid type is: the renderer
// offers the "+" button, and the server stores what it sends in a file the user
// can also edit by hand. A type that one side accepted and the other dropped
// would be a pill that vanished on restart.

/** The types that ship with the app, in the order they are drawn. */
export const BUILT_IN_COMMIT_TYPES = [
  'feat',
  'fix',
  'chore',
  'docs',
  'refactor',
  'test',
  'style',
  'perf'
] as const;

export type BuiltInCommitType = (typeof BUILT_IN_COMMIT_TYPES)[number];

/** How many types a user may add. The row scrolls, but not for ever. */
export const MAX_CUSTOM_COMMIT_TYPES = 24;

/**
 * Lowercase letters only, two to sixteen of them.
 *
 * Letters only because the conventional prefix is read back with `[a-z]+`: a
 * type containing a digit or a hyphen could be inserted but would then not be
 * recognised as a prefix, so the next pill pressed would stack on top of it.
 */
const CUSTOM_TYPE = /^[a-z]{2,16}$/;

/**
 * Tidies what was typed into a storable type, or null when it cannot be one.
 *
 * Trailing colons and brackets are forgiven, because "art:" and "art()" are
 * what someone who has seen the format will type.
 */
export function normalizeCommitType(raw: string): string | null {
  const tidy = raw.trim().toLowerCase().replace(/[():!\s]+$/g, '');
  return CUSTOM_TYPE.test(tidy) ? tidy : null;
}

export function isBuiltInCommitType(type: string): type is BuiltInCommitType {
  return (BUILT_IN_COMMIT_TYPES as readonly string[]).includes(type);
}

/**
 * A stored list made safe: valid, not a built-in, no repeats, capped.
 *
 * Returns undefined for anything that is not an array, so a caller can tell
 * "nothing was sent" from "an empty list was sent".
 */
export function sanitizeCustomCommitTypes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const kept: string[] = [];

  for (const entry of raw) {
    const type = typeof entry === 'string' ? normalizeCommitType(entry) : null;
    if (type !== null && !isBuiltInCommitType(type) && !kept.includes(type)) {
      kept.push(type);
    }
    if (kept.length >= MAX_CUSTOM_COMMIT_TYPES) {
      break;
    }
  }

  return kept;
}

/** Which of the two themes to draw, or to follow the operating system. */
export const THEME_CHOICES = ['dark', 'light', 'system'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}
