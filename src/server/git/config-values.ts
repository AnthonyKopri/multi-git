// Several git configuration values from one `git config` run.
import { tryGitCommand } from './run';

/** Escapes a key for the extended regular expression `--get-regexp` takes. */
function escapeKey(key: string): string {
  return key.replace(/[.^$*+?()[\]{}|\\]/g, '\\$&');
}

/**
 * The value each of `keys` resolves to.
 *
 * The last value set wins, as it does for `git config --get`, and a key that
 * is not set at all is absent from the map. A key written with no `=`, such as
 * `[commit] gpgsign`, maps to null. `--get` prints an empty line for that, the
 * same as for an empty value, but git reads the two as opposite booleans (see
 * `parseGitBoolean`), so the difference has to survive the read. `-z` keeps
 * it: each entry ends with a NUL, and a newline separates key from value only
 * when there is a value. A value with spaces, `=` or a newline of its own
 * comes back whole.
 *
 * Keys are matched in git's canonical spelling, section and name in lower
 * case. `local` reads the repository's own file alone, without the files its
 * `include.path` names, which is what `--local` has always meant.
 */
export async function readConfigValues(
  repoPath: string,
  keys: readonly string[],
  options: { local?: boolean } = {}
): Promise<Map<string, string | null>> {
  const args = ['config', '-z'];
  if (options.local === true) {
    args.push('--local');
  }
  args.push('--get-regexp', `^(${keys.map(escapeKey).join('|')})$`);

  const values = new Map<string, string | null>();

  // Exit 1 means no key matched, which is every key unset.
  const result = await tryGitCommand(repoPath, args);

  for (const entry of (result?.stdout ?? '').split('\0')) {
    if (entry === '') {
      continue;
    }

    const newline = entry.indexOf('\n');
    const name = newline === -1 ? entry : entry.slice(0, newline);

    if (keys.includes(name)) {
      values.set(name, newline === -1 ? null : entry.slice(newline + 1));
    }
  }

  return values;
}
