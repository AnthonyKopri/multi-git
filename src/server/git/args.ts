// Guards for values that reach a subprocess argument vector.
//
// Nothing here is about shell quoting: every process this app starts is
// spawned with `shell: false`, so there is no shell to escape. The risk is
// that git, and the GitHub CLI, parse any argument beginning with "-" as an
// option. A branch named `--upload-pack=...` or a file named `-x` is a valid
// name that turns a data argument into a flag.
//
// Two defences, used together:
//   * `--` before path arguments, which stops git's own option parsing.
//   * Validation of refs and commit-ish values, where `--` is not accepted.

export class InvalidGitArgumentError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidGitArgumentError';
  }
}

/**
 * Control characters break line-oriented git output parsing, and a newline
 * in a ref or path would let one argument masquerade as several lines of
 * output. Checked by code point rather than a regex literal so the source
 * file stays free of literal control bytes.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

const OBJECT_NAME = /^[0-9a-fA-F]{4,64}$/;

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidGitArgumentError(`${label} is required.`);
  }
  return value;
}

/**
 * Validates a branch, tag, or remote-tracking ref name.
 *
 * Mirrors the rules `git check-ref-format` enforces, minus the ones git will
 * reject on its own anyway. The leading-hyphen rule is the security-relevant
 * one; the rest keep malformed names from producing confusing git errors.
 */
export function refArg(value: unknown, label = 'Reference name'): string {
  const ref = requireNonEmptyString(value, label);

  if (ref.startsWith('-')) {
    throw new InvalidGitArgumentError(`${label} may not start with "-".`);
  }
  if (hasControlCharacter(ref)) {
    throw new InvalidGitArgumentError(`${label} may not contain control characters.`);
  }
  if (ref.includes('..') || ref.includes('@{') || ref.includes('\\')) {
    throw new InvalidGitArgumentError(`${label} contains a sequence Git reserves.`);
  }
  if (/[ ~^:?*[\]]/.test(ref)) {
    throw new InvalidGitArgumentError(`${label} contains a character Git does not allow in a ref.`);
  }
  if (ref.startsWith('/') || ref.endsWith('/') || ref.endsWith('.') || ref.endsWith('.lock')) {
    throw new InvalidGitArgumentError(`${label} is not a valid Git reference.`);
  }

  return ref;
}

/**
 * Validates a commit-ish: a full or abbreviated object name, or a ref that
 * `refArg` accepts. Callers pass values that came from the app's own history
 * listing, so the object-name form covers almost every case.
 */
export function commitish(value: unknown, label = 'Commit'): string {
  const candidate = requireNonEmptyString(value, label);

  if (OBJECT_NAME.test(candidate)) {
    return candidate;
  }

  return refArg(candidate, label);
}

/**
 * Validates one repository-relative path destined for a git argument vector.
 * Containment is `resolveInsideRepo`'s job; this only rejects values that
 * would be misread as options or would corrupt output parsing.
 */
export function pathArg(value: unknown, label = 'File path'): string {
  const filePath = requireNonEmptyString(value, label);

  if (hasControlCharacter(filePath)) {
    throw new InvalidGitArgumentError(`${label} may not contain control characters.`);
  }

  return filePath;
}

/**
 * Builds the trailing pathspec section of a git command: `--` followed by the
 * validated paths. The separator is what makes a file literally named `-x`
 * safe to pass, so paths must always go through this rather than being spread
 * into the argument list directly.
 */
export function pathArgs(values: unknown, label = 'File path'): string[] {
  const list = Array.isArray(values) ? values : [values];

  if (list.length === 0) {
    throw new InvalidGitArgumentError(`At least one ${label.toLowerCase()} is required.`);
  }

  return ['--', ...list.map((value) => pathArg(value, label))];
}

/**
 * Validates a GitHub repository name for `gh repo create`.
 *
 * GitHub itself permits leading hyphens in some historical names, but passing
 * one to the CLI would hand an attacker-chosen flag to the tool holding the
 * user's GitHub credentials, so this is deliberately stricter than GitHub is.
 */
export function githubRepoName(value: unknown, label = 'Repository name'): string {
  const name = requireNonEmptyString(value, label);

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) {
    throw new InvalidGitArgumentError(
      `"${name}" is not a usable GitHub repository name. It must start with a letter or digit and use only letters, digits, dots, hyphens, and underscores.`
    );
  }

  return name;
}
