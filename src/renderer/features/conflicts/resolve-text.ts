// Bulk "keep ours" / "keep theirs" for a conflicted file's text.

export type ConflictChoice = 'ours' | 'theirs';

/**
 * Matches one conflict group:
 *   <<<<<<< label
 *   ours
 *   =======
 *   theirs
 *   >>>>>>> label
 *
 * Non-greedy so adjacent conflicts are matched separately rather than one
 * span swallowing everything between the first and last marker.
 */
const CONFLICT_GROUP =
  /<<<<<<<[^\r\n]*\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>[^\r\n]*/g;

/**
 * Replaces every conflict group with one side.
 *
 * In git's terms "ours" and "theirs" depend on the operation — during a
 * rebase they are the reverse of what most people expect — so the editor
 * shows the result for review rather than applying it blind.
 */
export function resolveConflictText(text: string, choice: ConflictChoice): string {
  return text.replace(CONFLICT_GROUP, choice === 'ours' ? '$1' : '$2');
}

/** Whether any conflict markers remain, so the UI can refuse to stage early. */
export function hasConflictMarkers(text: string): boolean {
  return /^<{7}|^={7}$|^>{7}/m.test(text);
}
