// Git notes.
//
// A note is text attached to a commit after the fact, kept in its own ref
// rather than in the commit — which is why editing one does not rewrite
// history, and also why most hosts never show them.
//
// The one performance decision here: whether a commit has a note is answered
// for a whole page at once with a single `git notes list`, not with one call per
// commit. The history list asks that question for every row it draws.
import { runGitCommand, tryGitCommand } from './run';
import { commitish, refArg } from './args';

export class NotesError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'NotesError';
    this.statusCode = statusCode;
  }
}

/** Git's default notes ref, and the one nearly everyone uses. */
export const DEFAULT_NOTES_REF = 'refs/notes/commits';

/**
 * Validates a notes ref.
 *
 * Accepts both the short form users type and the full ref, because `--ref`
 * takes either and refusing the short one would be refusing the common case.
 */
function notesRefArg(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_NOTES_REF;
  }
  return refArg(value, 'Notes ref');
}

/** Every notes ref in the repository, so one can be chosen. */
export async function listNotesRefs(repoPath: string): Promise<string[]> {
  const result = await tryGitCommand(repoPath, [
    'for-each-ref',
    '--format=%(refname)',
    'refs/notes/'
  ]);

  const refs = (result?.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  // The default is always offered, even before anything has written to it.
  return refs.includes(DEFAULT_NOTES_REF) ? refs : [DEFAULT_NOTES_REF, ...refs];
}

/**
 * The set of commits carrying a note, for one page of history.
 *
 * `git notes list` prints `<note-oid> <commit-oid>` per line for the whole ref
 * in one call. Asking per commit would be one process per row.
 */
export async function commitsWithNotes(
  repoPath: string,
  notesRef?: string
): Promise<Set<string>> {
  const result = await tryGitCommand(repoPath, [
    'notes',
    `--ref=${notesRefArg(notesRef)}`,
    'list'
  ]);

  const commits = new Set<string>();
  if (!result) {
    // No notes ref yet, which is the normal state for most repositories.
    return commits;
  }

  for (const line of result.stdout.split(/\r?\n/)) {
    const commit = line.trim().split(/\s+/)[1];
    if (commit) {
      commits.add(commit);
    }
  }

  return commits;
}

export async function readNote(
  repoPath: string,
  commit: string,
  notesRef?: string
): Promise<string | null> {
  const result = await tryGitCommand(repoPath, [
    'notes',
    `--ref=${notesRefArg(notesRef)}`,
    'show',
    commitish(commit)
  ]);

  // A missing note is an exit code, not an error worth surfacing: most commits
  // do not have one.
  return result === null ? null : result.stdout.replace(/\n$/, '');
}

/**
 * Writes a note, replacing any existing one.
 *
 * `add -f` rather than `append` or `edit`: the UI shows the whole note in a
 * text box, so what comes back is the whole note. `edit` would open an editor,
 * which is exactly what this application exists to avoid needing.
 */
export async function writeNote(
  repoPath: string,
  commit: string,
  message: string,
  notesRef?: string
): Promise<string | null> {
  const target = commitish(commit);

  if (message.trim() === '') {
    await removeNote(repoPath, target, notesRef);
    return null;
  }

  await runGitCommand(repoPath, [
    'notes',
    `--ref=${notesRefArg(notesRef)}`,
    'add',
    '-f',
    // Over stdin rather than as an argument: a note is free text and can be
    // any length, contain newlines, or begin with a hyphen.
    '--file=-',
    target
  ], null, { input: message });

  return readNote(repoPath, target, notesRef);
}

export async function removeNote(
  repoPath: string,
  commit: string,
  notesRef?: string
): Promise<void> {
  const result = await tryGitCommand(repoPath, [
    'notes',
    `--ref=${notesRefArg(notesRef)}`,
    'remove',
    '--ignore-missing',
    commitish(commit)
  ]);

  if (result === null) {
    throw new NotesError('That note could not be removed.');
  }
}

/**
 * Fetches or pushes a notes ref.
 *
 * Separate from ordinary fetch and push on purpose: notes refs are outside the
 * default refspec, so they do not travel with a normal push, and a user who
 * assumes otherwise loses them. The UI says so.
 */
export async function syncNotes(
  repoPath: string,
  direction: 'fetch' | 'push',
  remote: string,
  notesRef?: string,
  options: { sshKeyPath?: string | null; signal?: AbortSignal } = {}
): Promise<void> {
  const ref = notesRefArg(notesRef);
  const refspec = direction === 'fetch' ? `${ref}:${ref}` : `${ref}:${ref}`;

  await runGitCommand(
    repoPath,
    [direction, refArg(remote, 'Remote name'), refspec],
    options.sshKeyPath ?? null,
    {
      ...(options.signal ? { signal: options.signal } : {}),
      envOverrides: { GIT_TERMINAL_PROMPT: '0' }
    }
  );
}
