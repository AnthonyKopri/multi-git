// Reading git's own record of where a ref used to point.
//
// The reflog is the recovery mechanism that already exists. Multi-Git's
// recovery points annotate it rather than replace it: a point says "this is
// what you were doing", the reflog says "and this is every position the ref
// has held". A commit that is unreachable but still in the reflog is still
// recoverable, which is what makes both worth showing together.
import { refArg } from './args';
import { tryGitCommand } from './run';
import type { ReflogEntry } from '../../shared/recovery-types';

/** Field separator. Reflog messages are single-line, so newline ends a record. */
const FIELD = '\x1f';

const FORMAT = ['%H', '%gD', '%gs', '%cI'].join(FIELD);

/**
 * Splits `reset: moving to HEAD~1` into its verb and the rest.
 *
 * Git writes `<action>: <subject>`, except for a handful of entries such as a
 * bare `rebase (finish)` that carry no subject at all.
 */
function splitMessage(message: string): { action: string; subject: string } {
  const separator = message.indexOf(': ');
  if (separator === -1) {
    return { action: message.trim(), subject: '' };
  }

  return {
    action: message.slice(0, separator).trim(),
    subject: message.slice(separator + 2).trim()
  };
}

export interface ReadReflogOptions {
  /** Defaults to HEAD, which is the log that covers every operation. */
  ref?: string;
  limit?: number;
}

/**
 * Reads a ref's reflog, newest first.
 *
 * Resolves to an empty list rather than failing: a fresh repository, a ref
 * with reflogs disabled, and a bare repository are all normal states in which
 * there is simply nothing to show.
 */
export async function readReflog(
  repoPath: string,
  options: ReadReflogOptions = {}
): Promise<ReflogEntry[]> {
  const ref = options.ref === undefined || options.ref === '' ? 'HEAD' : refArg(options.ref, 'Ref');
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);

  const result = await tryGitCommand(repoPath, [
    'reflog',
    'show',
    `--format=${FORMAT}`,
    '-n',
    String(limit),
    ref
  ]);

  if (!result) {
    return [];
  }

  const entries: ReflogEntry[] = [];

  for (const line of result.stdout.split('\n')) {
    if (line.trim() === '') {
      continue;
    }

    const [oid, selector, message, timestamp] = line.split(FIELD);
    if (!oid || !selector) {
      continue;
    }

    const { action, subject } = splitMessage(message ?? '');
    entries.push({
      ref,
      selector,
      oid,
      // Filled in below: the previous position is the next entry's, because
      // the reflog is walked newest first.
      previousOid: null,
      action,
      subject,
      timestamp: timestamp ?? ''
    });
  }

  for (let index = 0; index < entries.length - 1; index += 1) {
    (entries[index] as ReflogEntry).previousOid = (entries[index + 1] as ReflogEntry).oid;
  }

  return entries;
}
