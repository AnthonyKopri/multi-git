// Reading git configuration values the way git itself reads them.

/**
 * Git's boolean reading of a configuration value, or null when it is not one.
 *
 * `null` stands for a key written with no `=` at all, such as
 * `[commit] gpgsign`, and git reads that as true. It is easy to get wrong:
 * `git config --get` prints an empty line for it, exactly as it does for an
 * empty value, and an empty value is false. Words are matched whatever their
 * case, and a decimal number, with or without a k, m or g suffix, is true
 * unless it is zero.
 */
export function parseGitBoolean(value: string | null): boolean | null {
  if (value === null) {
    return true;
  }

  const text = value.trim().toLowerCase();

  if (text === '' || text === 'false' || text === 'no' || text === 'off') {
    return false;
  }

  if (text === 'true' || text === 'yes' || text === 'on') {
    return true;
  }

  const number = /^[-+]?(\d+)[kmg]?$/.exec(text);
  if (number?.[1] !== undefined) {
    return /[1-9]/.test(number[1]);
  }

  return null;
}
