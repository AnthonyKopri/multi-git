// Conventional Commit helpers for the commit message box.
//
// These are suggestions, never requirements: a non-conventional message is
// always allowed to be committed.
import { BUILT_IN_COMMIT_TYPES, isBuiltInCommitType } from '../../../shared/commit-types';
import type { BuiltInCommitType } from '../../../shared/commit-types';

/** The types that ship with the app. A user can add more; see `allCommitTypes`. */
export const COMMIT_TYPES = BUILT_IN_COMMIT_TYPES;

/**
 * A commit type as the message box handles it.
 *
 * A plain string rather than the built-in union, because the pills now include
 * whatever the user added with the "+" button.
 */
export type CommitType = string;

/** `type(scope)!: ` at the start of a message. */
export const CONVENTIONAL_PREFIX = /^([a-z]+)(\([^)]*\))?!?:\s*/;

/**
 * Applies a type prefix to a message.
 *
 * An existing conventional prefix is replaced rather than stacked, so
 * clicking `fix` after `feat` gives `fix: …` and not `fix: feat: …`.
 */
export function applyCommitType(message: string, type: CommitType, scope: string): string {
  const trimmedScope = scope.trim();
  const prefix = trimmedScope ? `${type}(${trimmedScope}): ` : `${type}: `;

  return prefix + message.replace(CONVENTIONAL_PREFIX, '');
}

/**
 * Whether to nudge the user about the message format.
 *
 * Only once the message is substantial: prefixing a three-word message is not
 * worth interrupting for.
 */
export function shouldShowFormatHint(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 10 && !CONVENTIONAL_PREFIX.test(trimmed);
}

export function chipTitle(type: CommitType, scope: string): string {
  const trimmedScope = scope.trim();
  return `Insert "${type}${trimmedScope ? `(${trimmedScope})` : ''}: " prefix`;
}

/** The built-in types followed by the user's own, without repeats. */
export function allCommitTypes(custom: readonly string[]): string[] {
  return [...COMMIT_TYPES, ...custom.filter((type) => !isBuiltInCommitType(type))];
}

/** One of the eight tints in style.css, named by `data-tint`. */
export type Tint = 'violet' | 'green' | 'amber' | 'blue' | 'pink' | 'teal' | 'orange' | 'gray';

export interface CommitTypeStyle {
  /** Material symbol drawn at the front of the pill. */
  icon: string;
  tint: Tint;
}

/**
 * Each built-in type's symbol and colour.
 *
 * Fixed rather than derived, so `fix` is the pink one with the bug on it in
 * every repository and on every machine: a colour that moved would be a colour
 * nobody learned.
 */
const BUILT_IN_STYLES: Record<BuiltInCommitType, CommitTypeStyle> = {
  feat: { icon: 'auto_awesome', tint: 'violet' },
  fix: { icon: 'bug_report', tint: 'pink' },
  chore: { icon: 'build', tint: 'gray' },
  docs: { icon: 'menu_book', tint: 'blue' },
  refactor: { icon: 'swap_horiz', tint: 'teal' },
  test: { icon: 'science', tint: 'green' },
  style: { icon: 'palette', tint: 'orange' },
  perf: { icon: 'bolt', tint: 'amber' }
};

/** Tints handed to user-added types, in turn. */
const CUSTOM_TINTS: readonly Tint[] = ['teal', 'orange', 'blue', 'green', 'pink', 'amber', 'violet'];

/**
 * How a type's pill is drawn.
 *
 * A type the user added gets a tint from its own letters, so it keeps the same
 * colour wherever it sits in the row and whatever is added after it.
 */
export function commitTypeStyle(type: CommitType): CommitTypeStyle {
  if (isBuiltInCommitType(type)) {
    return BUILT_IN_STYLES[type];
  }

  let sum = 0;
  for (const character of type) {
    sum += character.charCodeAt(0);
  }

  return { icon: 'label', tint: CUSTOM_TINTS[sum % CUSTOM_TINTS.length] as Tint };
}
