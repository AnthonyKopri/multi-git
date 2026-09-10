// Noticing a tool that was installed after this application started.
//
// The second half of issue #46. Having installed the GitHub CLI by hand --
// `winget install --id GitHub.cli --exact`, which succeeds -- pressing "Check
// again" still reported it missing, and would go on doing so until the app was
// restarted.
//
// Nothing was wrong with the detection. A process inherits its environment once,
// at creation, and an installer that extends PATH writes to the registry and
// broadcasts a settings change that only the shell and programs that listen for
// it act on. Explorer picks it up, so a *new* terminal sees the tool and this
// application, started earlier, never does. That is also why the button appears
// to lie: it is answering honestly about an environment that is out of date.
//
// So the registry is re-read, which is where the durable value lives, and any
// directory PATH has gained since startup is appended. Appended rather than
// replaced: the running process may have entries of its own that belong to it
// and not to the machine, and dropping those to adopt the registry's copy would
// trade one stale environment for another.
import { executableRunner } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';

/** Where Windows keeps the two halves of PATH. */
const PATH_KEYS = [
  { hive: 'HKLM', key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' },
  { hive: 'HKCU', key: 'HKCU\\Environment' }
] as const;

/** Long enough for a cold registry read, short enough not to hold up a window. */
const REG_TIMEOUT_MS = 5_000;

/**
 * The value out of `reg query ... /v Path`.
 *
 * The output is `    Path    REG_EXPAND_SZ    <value>`, and the value itself
 * routinely contains spaces, so only the first two runs of whitespace separate
 * anything.
 */
export function parsePathFromRegistry(output: string): string | null {
  const match = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(output);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/**
 * Expands `%NAME%` against the current environment.
 *
 * REG_EXPAND_SZ stores `%SystemRoot%\system32` rather than the expanded path.
 * A name with nothing behind it is left as it was written: a literal percent
 * sign in a directory name is rare but legal, and inventing an empty string for
 * it would silently corrupt the entry.
 */
export function expandEnvironmentStrings(
  value: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    // Windows environment variables are case-insensitive; Node's copy is not.
    const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    const resolved = key === undefined ? undefined : env[key];
    return resolved ?? whole;
  });
}

/** Splits a PATH into entries, dropping the empties a trailing `;` leaves. */
function entriesOf(value: string): string[] {
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** Two directories are the same directory whatever case they were typed in. */
function normalized(entry: string): string {
  return entry.replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * PATH as the registry has it now, or null when it cannot be read.
 *
 * Machine before user, which is the order Windows composes them in.
 */
export async function readRegistryPath(
  runner: ExecutableRunner = executableRunner,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null;
  }

  const found: string[] = [];

  for (const { key } of PATH_KEYS) {
    try {
      const result = await runner.run('reg.exe', ['query', key, '/v', 'Path'], {
        timeoutMs: REG_TIMEOUT_MS
      });

      const value = parsePathFromRegistry(result.stdout);
      if (value !== null) {
        found.push(expandEnvironmentStrings(value, env));
      }
    } catch {
      // A hive that cannot be read is not a reason to fail a detection; the
      // process environment is still a perfectly good answer, just an older
      // one.
    }
  }

  return found.length > 0 ? found.join(';') : null;
}

export interface PathRefresh {
  /** Directories PATH did not have before. */
  added: string[];
  /** The value now in `process.env.PATH`. */
  path: string;
}

/**
 * Adds anything the registry knows about that this process does not.
 *
 * Returns what changed, so a caller can say whether looking again was worth
 * anything. A no-op off Windows.
 */
export async function refreshPathFromRegistry(
  runner: ExecutableRunner = executableRunner,
  env: NodeJS.ProcessEnv = process.env
): Promise<PathRefresh> {
  const current = env['PATH'] ?? env['Path'] ?? '';

  const registryPath = await readRegistryPath(runner, env);
  if (registryPath === null) {
    return { added: [], path: current };
  }

  const known = new Set(entriesOf(current).map(normalized));
  const added: string[] = [];

  for (const entry of entriesOf(registryPath)) {
    const key = normalized(entry);
    if (key === '' || known.has(key)) {
      continue;
    }

    known.add(key);
    added.push(entry);
  }

  if (added.length === 0) {
    return { added: [], path: current };
  }

  const updated = current === '' ? added.join(';') : `${current};${added.join(';')}`;

  // Windows resolves the variable case-insensitively but Node's env object does
  // not, so whichever spelling this process actually carries is the one to set.
  if (env['PATH'] !== undefined || env['Path'] === undefined) {
    env['PATH'] = updated;
  } else {
    env['Path'] = updated;
  }

  return { added, path: updated };
}
