// Bisect: the manual walk, and the automated one.
//
// The session state is git's, not this process's — it lives in `.git/BISECT_*`
// — which is what lets a bisect survive a restart, and also what makes an
// abandoned one a real state the repository is in rather than something the app
// can forget about. `readSession` therefore always asks git.
//
// The automated run executes a command the user saved and confirmed. It is
// desktop-only at the route, it goes through the injectable runner argv-only
// with no shell, and the exit-code mapping is git's own: 0 good, 125 skip,
// anything else bad.
import { executableRunner, CommandFailedError, CommandSpawnError } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';
import { runGitCommand, tryGitCommand } from './run';
import { commitish } from './args';
import type {
  BisectRunOutcome,
  BisectRunStep,
  BisectSession,
  BisectVerdict
} from '../../shared/bisect-types';
import type { BisectCommandDefinition } from '../../shared/config-types';

export class BisectError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'BisectError';
    this.statusCode = statusCode;
  }
}

/** Git's own convention for a bisect run script. */
const SKIP_EXIT_CODE = 125;

let runner: ExecutableRunner = executableRunner;

/** Swaps the runner. Tests only. */
export function setBisectRunner(replacement: ExecutableRunner = executableRunner): void {
  runner = replacement;
}

// ---------- reading the session ----------

async function subjectOf(repoPath: string, oid: string): Promise<string | undefined> {
  const result = await tryGitCommand(repoPath, ['log', '-1', '--format=%s', oid]);
  const subject = result?.stdout.trim();
  return subject === '' ? undefined : subject;
}

export async function readSession(repoPath: string): Promise<BisectSession> {
  // The presence of BISECT_START is what git itself treats as "a bisect is in
  // progress"; asking git for the path handles linked worktrees.
  const startPath = await tryGitCommand(repoPath, ['rev-parse', '--git-path', 'BISECT_START']);
  const fs = await import('node:fs');
  const path = await import('node:path');

  const started =
    startPath !== null &&
    fs.existsSync(path.resolve(repoPath, startPath.stdout.trim()));

  if (!started) {
    return { state: 'none' };
  }

  const log = await tryGitCommand(repoPath, ['bisect', 'log']);
  const head = await tryGitCommand(repoPath, ['rev-parse', 'HEAD']);
  const currentOid = head?.stdout.trim();

  // `--bisect-vars` is the machine-readable form: shell assignments giving the
  // remaining count and the step estimate. The human `bisect view` output is
  // not parseable and not stable.
  const vars = await tryGitCommand(repoPath, ['rev-list', '--bisect-vars', 'HEAD']);
  const remaining = readVar(vars?.stdout ?? '', 'bisect_nr');
  const steps = readVar(vars?.stdout ?? '', 'bisect_steps');

  // Once git has narrowed to one commit it says so in the log rather than in
  // any status command.
  const firstBad = (log?.stdout ?? '').match(/^#\s*first bad commit:\s*\[([0-9a-f]+)\]/mi);

  if (firstBad?.[1]) {
    return {
      state: 'complete',
      firstBadOid: firstBad[1],
      ...(await subjectOf(repoPath, firstBad[1]).then((s) => (s ? { firstBadSubject: s } : {}))),
      ...(log ? { log: log.stdout } : {})
    };
  }

  return {
    state: 'active',
    ...(currentOid ? { currentOid } : {}),
    ...(currentOid
      ? await subjectOf(repoPath, currentOid).then((s) => (s ? { currentSubject: s } : {}))
      : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(steps !== undefined ? { stepsRemaining: steps } : {}),
    ...(log ? { log: log.stdout } : {})
  };
}

function readVar(output: string, name: string): number | undefined {
  const match = output.match(new RegExp(`^${name}=(\\d+)`, 'm'));
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

// ---------- the manual walk ----------

export async function startBisect(
  repoPath: string,
  goodRef: string,
  badRef: string
): Promise<BisectSession> {
  const good = commitish(goodRef, 'Known good commit');
  const bad = commitish(badRef, 'Known bad commit');

  const existing = await readSession(repoPath);
  if (existing.state !== 'none') {
    throw new BisectError(
      'A bisect is already in progress in this repository. Reset it before starting another.',
      409
    );
  }

  // `--` so a ref that begins with a hyphen cannot become a flag.
  await runGitCommand(repoPath, ['bisect', 'start', bad, good, '--']);
  return readSession(repoPath);
}

export async function markCommit(
  repoPath: string,
  verdict: BisectVerdict
): Promise<BisectSession> {
  if (!['good', 'bad', 'skip'].includes(verdict)) {
    throw new BisectError(`Unknown verdict "${verdict}".`);
  }

  const session = await readSession(repoPath);
  if (session.state !== 'active') {
    throw new BisectError('No bisect is in progress.', 409);
  }

  await runGitCommand(repoPath, ['bisect', verdict]);
  return readSession(repoPath);
}

/**
 * Ends the bisect and returns to where it started.
 *
 * Always available, including when no bisect is running: a repository left
 * mid-bisect by a crashed session is exactly the case someone needs this for,
 * and refusing because this process does not remember starting it would be
 * unhelpful.
 */
export async function resetBisect(repoPath: string): Promise<BisectSession> {
  await tryGitCommand(repoPath, ['bisect', 'reset']);
  return readSession(repoPath);
}

// ---------- the automated run ----------

function verdictFor(exitCode: number, skipExitCode: number): BisectVerdict {
  if (exitCode === 0) {
    return 'good';
  }
  if (exitCode === skipExitCode) {
    return 'skip';
  }
  return 'bad';
}

/**
 * Runs a saved command at each step until bisect finishes.
 *
 * Driven here rather than through `git bisect run`, for two reasons. `git
 * bisect run` takes a *shell command string*, which is exactly the shape this
 * application refuses to build anywhere; and driving it means each step's exit
 * code and verdict can be reported as it happens rather than parsed back out of
 * git's prose afterwards.
 */
export async function runBisect(
  repoPath: string,
  definition: BisectCommandDefinition,
  options: { signal?: AbortSignal; maxSteps?: number } = {}
): Promise<BisectRunOutcome> {
  let session = await readSession(repoPath);
  if (session.state !== 'active') {
    throw new BisectError('Start a bisect before running a command against it.', 409);
  }

  const skipExitCode = definition.skipExitCode ?? SKIP_EXIT_CODE;
  const steps: BisectRunStep[] = [];
  // A hard ceiling: bisect is logarithmic, so anything past this means the
  // command is not deciding and the loop would not end on its own.
  const maxSteps = options.maxSteps ?? 60;

  while (session.state === 'active' && steps.length < maxSteps) {
    if (options.signal?.aborted) {
      return { steps, session, cancelled: true };
    }

    const oid = session.currentOid ?? '';
    let exitCode: number;

    try {
      const result = await runner.run(definition.executable, definition.args, {
        cwd: repoPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        // Every exit code is a verdict here, so none of them is an exception.
        allowNonZero: ALL_EXIT_CODES,
        ...(options.signal ? { signal: options.signal } : {})
      });

      if (result.cancelled) {
        return { steps, session, cancelled: true };
      }

      exitCode = result.exitCode;
    } catch (error) {
      if (error instanceof CommandSpawnError) {
        throw new BisectError(
          `The test command could not be started: ${definition.executable} was not found.`,
          400
        );
      }
      if (error instanceof CommandFailedError) {
        // Should not happen with allowNonZero, but a non-zero exit must never
        // be read as "bad" by accident when it was really a runner failure.
        throw new BisectError(error.displayMessage, 500);
      }
      throw error;
    }

    const verdict = verdictFor(exitCode, skipExitCode);
    steps.push({
      oid,
      ...(session.currentSubject ? { subject: session.currentSubject } : {}),
      exitCode,
      verdict
    });

    // A verdict git refuses ends the run rather than crashing it. The usual
    // cause is a range it can no longer narrow — "there are only 'skip'ped
    // commits left to test" — which is an outcome the user needs reported
    // along with the steps that did get judged, not a stack trace.
    const marked = await tryGitCommand(repoPath, ['bisect', verdict]);
    session = await readSession(repoPath);

    if (marked === null) {
      return { steps, session, cancelled: false };
    }
  }

  return { steps, session, cancelled: false };
}

/** 0–255, so no exit code is treated as a thrown failure. */
const ALL_EXIT_CODES: readonly number[] = Array.from({ length: 256 }, (_, code) => code);
