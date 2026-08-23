// Whether a git invocation reads or writes.
//
// Every git command the application runs is recorded, which is the only way the
// log can be trusted — but a single refresh runs upwards of forty of them, and
// nearly all are questions rather than actions. Without a way to tell the two
// apart the log becomes a wall of `rev-parse` that nobody reads, which is how
// the old renderer-authored log ended up narrating only the interesting ones and
// therefore inventing them.
//
// So: record everything, classify it here, and let the view default to actions.
// Nothing is hidden from the record, only from the first screen.
//
// The classification fails towards `write`. An unrecognised subcommand shows up,
// because a log that occasionally includes a harmless read is fine and one that
// silently omits a command that changed the repository is not.

/**
 * Subcommands that cannot modify a repository in any of their forms.
 *
 * Taken from what this codebase actually runs, not from git's full surface: the
 * ones that appear here are the ones worth the flood control, and anything not
 * listed is treated as an action.
 */
const ALWAYS_READ: ReadonlySet<string> = new Set([
  'blame',
  'cat-file',
  'check-attr',
  'check-ignore',
  'describe',
  'diff',
  'for-each-ref',
  'log',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'merge-base',
  'name-rev',
  'rev-list',
  'rev-parse',
  'shortlog',
  'show',
  'show-ref',
  'status',
  'var',
  'verify-commit',
  'verify-tag'
]);

/**
 * Subcommands that read in one form and write in another.
 *
 * Each names the flags and words that mean "this one is only asking". Anything
 * else in the same subcommand counts as an action, so `branch --list` is quiet
 * and `branch -d` is not.
 */
const READ_FORMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['branch', ['--list', '-l', '--contains', '--merged', '--no-merged', '--show-current']],
  ['config', ['--get', '--get-all', '--get-regexp', '--list', '-l']],
  ['notes', ['list', 'show']],
  ['reflog', ['show']],
  ['remote', ['-v', '--verbose', 'get-url', 'show']],
  ['stash', ['list', 'show']],
  ['submodule', ['status']],
  ['symbolic-ref', ['--short']],
  ['tag', ['--list', '-l', '-n', '--contains', '--points-at']],
  ['worktree', ['list']]
]);

export type CommandKind = 'read' | 'write';

/**
 * Classifies one git argument vector.
 *
 * `args` is what goes to git, so it may open with `-c core.longpaths=true` and
 * other configuration the application adds. Those are skipped to find the
 * subcommand, because the subcommand is what decides this.
 */
export function gitCommandKind(args: readonly string[]): CommandKind {
  const subcommand = gitSubcommand(args);
  if (subcommand === null) {
    return 'write';
  }

  if (ALWAYS_READ.has(subcommand)) {
    return 'read';
  }

  const readForms = READ_FORMS.get(subcommand);
  if (readForms === undefined) {
    return 'write';
  }

  // `symbolic-ref --short HEAD` reads; `symbolic-ref HEAD refs/…` writes. The
  // read forms are the ones named, and everything else in the subcommand is an
  // action, so a form nobody thought about is shown rather than swallowed.
  return readForms.some((form) => args.includes(form)) ? 'read' : 'write';
}

/**
 * The subcommand, past any leading `-c key=value` and global options.
 *
 * Returns null when there is nothing that looks like one, which is treated as
 * an action by the caller.
 */
export function gitSubcommand(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) {
      break;
    }

    // `-c key=value` and `-C <path>` each swallow the argument after them.
    if (arg === '-c' || arg === '-C') {
      index++;
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    return arg;
  }

  return null;
}

/**
 * The same question for the tools that are not git.
 *
 * `gh`, `ssh-add`, `ssh-keygen` and `sc.exe` reach the process runner rather
 * than the git one, and a few of them are polled often enough to drown the log:
 * `ssh-add -l` runs on every agent status read. Only the polled forms are
 * named; anything nobody listed shows up, on the same reasoning as above.
 */
const PROCESS_READ_FORMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['gh', ['--version', 'status']],
  // Keyed without the extension, because programName strips it.
  ['sc', ['query', 'qc']],
  ['ssh-add', ['-l', '-L']],
  ['ssh-keygen', ['-l', '-y', '-F']]
]);

/** The executable's name, without a directory or a `.exe`. */
function programName(executable: string): string {
  const separator = Math.max(executable.lastIndexOf('/'), executable.lastIndexOf('\\'));
  const base = separator === -1 ? executable : executable.slice(separator + 1);
  return base.toLowerCase().endsWith('.exe') ? base.slice(0, -4) : base;
}

export function processCommandKind(executable: string, args: readonly string[]): CommandKind {
  // Absolute paths, not bare names: the runner is handed the OpenSSH build it
  // picked and the `gh` shim it resolved.
  const name = programName(executable);

  // `git lfs …` is still git, and the subcommand that decides is the one after.
  if (name === 'git') {
    return gitCommandKind(args[0] === 'lfs' ? args.slice(1) : args);
  }

  const readForms = PROCESS_READ_FORMS.get(name);
  if (readForms === undefined) {
    return 'write';
  }

  return readForms.some((form) => args.includes(form)) ? 'read' : 'write';
}
