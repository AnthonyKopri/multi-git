// Conventional Commit helpers for the commit message box.
//
// These are suggestions, never requirements: a non-conventional message is
// always allowed to be committed.

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'chore',
  'docs',
  'refactor',
  'test',
  'style',
  'perf'
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

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
