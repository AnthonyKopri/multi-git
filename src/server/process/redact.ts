// Removes known secrets from anything that might be logged or shown.
//
// The values this exists for are passphrases, AskPass responses, host tokens,
// and private-key material. They reach a command as an argument, on stdin, or
// in the environment, and they come back out in the command's own error
// messages — `ssh-add` echoing the key it failed to load, `gh` quoting the
// token it rejected. Redacting only the arguments would miss every one of
// those, so this runs over stdout, stderr, and the recorded argv alike.

export const REDACTED = '***';

/**
 * Secrets worth acting on.
 *
 * Empty strings would match at every position, and a secret made only of
 * asterisks would match the placeholder and make replacement non-idempotent —
 * which matters because the streaming redactor rewrites its buffer repeatedly.
 */
function usableSecrets(secrets: readonly string[]): string[] {
  const usable = secrets.filter((secret) => secret !== '' && !REDACTED.includes(secret));

  // Longest first, so a secret that contains another is replaced whole rather
  // than left as `***fix` after the shorter one is substituted inside it.
  return [...new Set(usable)].sort((a, b) => b.length - a.length);
}

/** Replaces every occurrence of every secret. Safe to apply more than once. */
export function redactText(text: string, secrets: readonly string[]): string {
  let result = text;

  for (const secret of usableSecrets(secrets)) {
    // split/join is a literal replace: no regex escaping to get wrong.
    result = result.split(secret).join(REDACTED);
  }

  return result;
}

export function redactArgs(
  args: readonly string[],
  secrets: readonly string[]
): readonly string[] {
  if (secrets.length === 0) {
    return args;
  }

  return args.map((arg) => redactText(arg, secrets));
}

/**
 * Redacts a stream that arrives in pieces.
 *
 * A secret split across two chunks — routine, since chunk boundaries fall
 * wherever the pipe buffer filled — matches neither piece on its own. This
 * holds back the last `longest - 1` characters until more arrives, so the
 * boundary is never where a match is decided.
 *
 * The held-back tail is kept already-redacted. Because replacement is
 * idempotent, re-running it over the joined buffer cannot re-expose anything,
 * and any unreplaced text left in the tail is at most a partial secret.
 */
export class StreamRedactor {
  private readonly secrets: readonly string[];
  private readonly holdback: number;
  private buffer = '';

  constructor(secrets: readonly string[]) {
    this.secrets = usableSecrets(secrets);
    this.holdback = this.secrets.reduce((longest, secret) => {
      return Math.max(longest, secret.length - 1);
    }, 0);
  }

  /** Returns the portion safe to emit now. May be empty. */
  push(chunk: string): string {
    if (this.secrets.length === 0) {
      return chunk;
    }

    this.buffer = redactText(this.buffer + chunk, this.secrets);

    const cut = Math.max(0, this.buffer.length - this.holdback);
    const emit = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);

    return emit;
  }

  /** Returns whatever is still held back. Call once, at end of stream. */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    return remaining;
  }
}
