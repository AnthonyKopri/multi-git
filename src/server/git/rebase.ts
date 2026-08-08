// Interactive rebase as an operation this application drives, rather than a
// text file it asks the user to edit.
//
// The plan is built, validated and written for git; git's editor prompts are
// answered by the bridge; and the session is persisted beside the repository
// so a conflict, a closed window or a restarted backend all leave the UI able
// to say what is happening and offer continue, skip and abort.
//
// Reword is implemented as `edit` plus an automatic amend. Git opens the
// message editor for a reword the moment it reaches it, which would mean
// answering editor prompts in the right order from a script; stopping instead
// and amending deliberately is the same result by a route that cannot get the
// order wrong.
import fs from 'node:fs';
import path from 'node:path';

import { commitish } from './args';
import { GitError, runGitCommand, tryGitCommand } from './run';
import { writeJsonAtomic } from '../fs/atomic';
import { createEditorBridge, removeEditorBridge, acceptEditorEnv, bridgeEnv } from './rebase-bridge';
import type { EditorBridge } from './rebase-bridge';
import type {
  RebaseAction,
  RebasePlan,
  RebaseStatus,
  RebaseTodoItem,
  RebaseValidation
} from '../../shared/rebase-types';

const ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

const COMMIT_FORMAT = '%H\x1f%s\x1f%an\x1f%aI';

interface RebaseSession {
  plan: RebasePlan;
  bridgeDirectory: string;
  /** oid to the message the user asked for, for the automatic amend. */
  rewords: Record<string, string>;
  /** Set while a commit is being split and has no replacement commit yet. */
  splitting: boolean;
  startedAt: string;
}

/**
 * Runs git with an environment, tolerating a non-zero exit.
 *
 * A rebase that stops at a conflict or an `edit` exits non-zero, and that is
 * the normal path rather than a failure — the status endpoint is what says
 * what happened. `tryGitCommand` would do, but it cannot carry an environment,
 * and without the environment git would try to open a real editor and hang.
 *
 * `ok` is kept because the two non-zero cases are not the same: a rebase that
 * stopped is in progress afterwards, and a rebase git refused outright is not.
 * Without this the second reads exactly like a rebase that finished, which is
 * how a refusal over a dirty working tree came to be reported as a success.
 */
async function tryGitWithEnv(
  repoPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await runGitCommand(repoPath, args, null, { envOverrides: env });
    return { ok: true, ...result };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/**
 * Configuration every rebase invocation carries.
 *
 * `git rebase -i` keeps its bookkeeping in files inside the repository's git
 * directory, and names one of them after the commit range: two 40-character
 * object names and three dots, 83 characters before the directory it sits in.
 * In a repository whose own path is already long, that name crosses Windows'
 * 260-character limit and the rebase fails before it starts, with
 * "fatal: failed to stat '<sha>...<sha>': Filename too long".
 *
 * `core.longpaths` is git's own remedy for exactly this. It is passed per
 * invocation rather than written to the user's configuration, because it is
 * this application's workaround and not a preference anyone expressed — and it
 * is scoped to rebase, where the long name is git's own internal file, rather
 * than applied to every command, where it would also let git create
 * working-tree paths that other Windows tools cannot open.
 *
 * Ignored by git on every other platform, so it is only sent where it means
 * something.
 */
export function rebaseGitArgs(args: readonly string[]): string[] {
  return process.platform === 'win32' ? ['-c', 'core.longpaths=true', ...args] : [...args];
}

const gitDirCache = new Map<string, string>();

async function gitDir(repoPath: string): Promise<string | null> {
  const cached = gitDirCache.get(repoPath);
  if (cached !== undefined) {
    return cached;
  }

  const result = await tryGitCommand(repoPath, ['rev-parse', '--absolute-git-dir']);
  const resolved = result?.stdout.trim();
  if (!resolved) {
    return null;
  }

  gitDirCache.set(repoPath, resolved);
  return resolved;
}

/** Drops the resolved git directories. Tests reuse paths across repositories. */
export function clearRebaseCache(): void {
  gitDirCache.clear();
}

async function sessionPath(repoPath: string): Promise<string | null> {
  const directory = await gitDir(repoPath);
  return directory === null ? null : path.join(directory, 'multi-git', 'rebase-session.json');
}

async function readSession(repoPath: string): Promise<RebaseSession | null> {
  const file = await sessionPath(repoPath);
  if (file === null || !fs.existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RebaseSession;
  } catch {
    return null;
  }
}

async function writeSession(repoPath: string, session: RebaseSession): Promise<void> {
  const file = await sessionPath(repoPath);
  if (file === null) {
    return;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, session);
}

async function clearSession(repoPath: string): Promise<void> {
  const file = await sessionPath(repoPath);
  if (file === null) {
    return;
  }

  const session = await readSession(repoPath);
  removeEditorBridge(session ? { directory: session.bridgeDirectory } : null);

  try {
    fs.rmSync(file, { force: true });
  } catch {
    // A leftover session file is re-validated against git's own state anyway.
  }
}

function parseCommits(stdout: string): RebaseTodoItem[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [oid, subject, author, date] = line.split('\x1f');
      return {
        oid: oid ?? '',
        action: 'pick' as RebaseAction,
        subject: subject ?? '',
        author: author ?? '',
        date: date ?? ''
      };
    });
}

/**
 * Moves `fixup!`/`squash!` commits under the commit they name, the way
 * `--autosquash` would, so the planner can show the result before it runs.
 */
export function applyAutosquash(items: readonly RebaseTodoItem[]): RebaseTodoItem[] {
  const result: RebaseTodoItem[] = [];
  const pending = new Map<string, RebaseTodoItem[]>();

  for (const item of items) {
    const match = /^(fixup|squash)!\s+(.*)$/.exec(item.subject);
    if (!match) {
      continue;
    }

    const targetSubject = (match[2] ?? '').trim();
    const list = pending.get(targetSubject) ?? [];
    list.push({
      ...item,
      action: match[1] === 'fixup' ? 'fixup' : 'squash',
      autosquashedInto: targetSubject
    });
    pending.set(targetSubject, list);
  }

  for (const item of items) {
    // The marker commits are placed under their target, not in sequence.
    if (/^(fixup|squash)!\s+/.test(item.subject)) {
      continue;
    }

    result.push(item);
    for (const follower of pending.get(item.subject.trim()) ?? []) {
      result.push(follower);
    }
    pending.delete(item.subject.trim());
  }

  // Anything whose target was not found keeps its place rather than vanishing.
  for (const orphans of pending.values()) {
    result.push(...orphans.map((item) => ({ ...item, action: 'pick' as RebaseAction })));
  }

  return result;
}

/** Lists the commits `onto..HEAD`, oldest first, which is todo order. */
export async function buildPlan(
  repoPath: string,
  ontoRef: unknown,
  autosquash: boolean
): Promise<RebasePlan> {
  const onto = commitish(ontoRef, 'Base commit');

  const result = await runGitCommand(repoPath, [
    'log',
    '--reverse',
    `--pretty=format:${COMMIT_FORMAT}`,
    `${onto}..HEAD`
  ]);

  const items = parseCommits(result.stdout);
  return { onto, items: autosquash ? applyAutosquash(items) : items, autosquash };
}

/** Checks a plan against the commits it claims to be about. */
export function validatePlan(
  plan: RebasePlan,
  original: readonly RebaseTodoItem[]
): RebaseValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const originalOids = new Set(original.map((item) => item.oid));
  const seen = new Set<string>();

  for (const item of plan.items) {
    if (!ACTIONS.includes(item.action)) {
      errors.push(`"${item.action}" is not a rebase action.`);
    }
    if (!originalOids.has(item.oid)) {
      errors.push(`${item.oid.substring(0, 8)} is not one of the commits being rebased.`);
    }
    if (seen.has(item.oid)) {
      errors.push(`${item.oid.substring(0, 8)} appears more than once.`);
    }
    seen.add(item.oid);
  }

  for (const item of original) {
    if (!seen.has(item.oid)) {
      warnings.push(`${item.oid.substring(0, 8)} "${item.subject}" was removed from the plan.`);
    }
  }

  const kept = plan.items.filter((item) => item.action !== 'drop');
  if (kept.length === 0) {
    errors.push('Every commit is dropped, which would leave nothing to rebase.');
  } else if (kept[0]?.action === 'squash' || kept[0]?.action === 'fixup') {
    // Git rejects this too, but much later and less clearly.
    errors.push('The first commit cannot be squashed or fixed up — there is nothing before it.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * The todo file git will read.
 *
 * `reword` is written as `edit`; the message is applied by an amend at the
 * stop. Subjects go on the line as git writes them itself, which git treats
 * as a comment — but the line is still built from repository data, so it can
 * only ever be written to a file, never to a command line.
 */
export function renderTodo(plan: RebasePlan): string {
  const lines = plan.items
    .filter((item) => item.action !== 'drop')
    .map((item) => {
      const action = item.action === 'reword' ? 'edit' : item.action;
      // A newline in a subject would forge a second todo line.
      const subject = item.subject.replace(/[\r\n]+/g, ' ');
      return `${action} ${item.oid} ${subject}`;
    });

  return `${lines.join('\n')}\n`;
}

async function currentGitState(repoPath: string): Promise<{
  inProgress: boolean;
  step: number;
  totalSteps: number;
  stoppedAt: string | null;
}> {
  const directory = await gitDir(repoPath);
  if (directory === null) {
    return { inProgress: false, step: 0, totalSteps: 0, stoppedAt: null };
  }

  const merge = path.join(directory, 'rebase-merge');
  const apply = path.join(directory, 'rebase-apply');
  const active = fs.existsSync(merge) ? merge : fs.existsSync(apply) ? apply : null;

  if (active === null) {
    return { inProgress: false, step: 0, totalSteps: 0, stoppedAt: null };
  }

  const readNumber = (name: string): number => {
    try {
      return Number.parseInt(fs.readFileSync(path.join(active, name), 'utf8').trim(), 10) || 0;
    } catch {
      return 0;
    }
  };

  const stopped = await tryGitCommand(repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD']);

  return {
    inProgress: true,
    step: readNumber('msgnum'),
    totalSteps: readNumber('end'),
    stoppedAt: stopped?.stdout.trim() || null
  };
}

async function conflictedFiles(repoPath: string): Promise<string[]> {
  const result = await tryGitCommand(repoPath, ['diff', '--name-only', '--diff-filter=U']);
  return (result?.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function rebaseStatus(repoPath: string): Promise<RebaseStatus> {
  const state = await currentGitState(repoPath);
  const session = await readSession(repoPath);

  if (!state.inProgress) {
    // Git finished or the rebase was aborted elsewhere; the session is stale.
    if (session) {
      await clearSession(repoPath);
    }
    return {
      inProgress: false,
      plan: null,
      step: 0,
      totalSteps: 0,
      stoppedAt: null,
      stoppedSubject: null,
      conflictedFiles: [],
      canSplit: false,
      splitInProgress: false
    };
  }

  const conflicts = await conflictedFiles(repoPath);
  const subject = state.stoppedAt
    ? (await tryGitCommand(repoPath, ['log', '-1', '--pretty=%s', state.stoppedAt]))?.stdout.trim() ?? null
    : null;

  return {
    inProgress: true,
    plan: session?.plan ?? null,
    step: state.step,
    totalSteps: state.totalSteps,
    stoppedAt: state.stoppedAt,
    stoppedSubject: subject,
    conflictedFiles: conflicts,
    // A stop with no conflicts is an `edit` stop, which is where a commit can
    // be taken apart.
    canSplit: conflicts.length === 0,
    splitInProgress: session?.splitting === true
  };
}

export interface StartResult {
  status: RebaseStatus;
  /** Set when git stopped rather than finishing. */
  stopped: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Runs the rebase, then settles it as far as it can go on its own.
 *
 * A reword stops the rebase at the commit; this amends it with the message the
 * user gave and continues, repeating until git either finishes or stops for a
 * reason a person has to deal with.
 */
async function advanceThroughRewords(
  repoPath: string,
  session: RebaseSession,
  bridge: EditorBridge
): Promise<{ stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';

  // Bounded by the plan: every iteration consumes one reword.
  for (let guard = 0; guard <= session.plan.items.length; guard += 1) {
    const state = await currentGitState(repoPath);
    if (!state.inProgress) {
      return { stdout, stderr };
    }

    const conflicts = await conflictedFiles(repoPath);
    if (conflicts.length > 0) {
      return { stdout, stderr };
    }

    const stoppedAt = state.stoppedAt;
    if (stoppedAt === null) {
      return { stdout, stderr };
    }

    // The rebase rewrote the commit, so its object name is new. The original
    // is what the plan named, and git records the mapping in the todo state.
    const originalOid = await originalOidForStop(repoPath, stoppedAt);
    const message = originalOid === null ? undefined : session.rewords[originalOid];
    if (message === undefined) {
      return { stdout, stderr };
    }

    const amended = await runGitCommand(
      repoPath,
      rebaseGitArgs(['commit', '--amend', '-m', message]),
      null,
      { envOverrides: acceptEditorEnv(bridge) }
    );
    stdout += amended.stdout;
    stderr += amended.stderr;

    const continued = await tryGitWithEnv(
      repoPath,
      rebaseGitArgs(['rebase', '--continue']),
      acceptEditorEnv(bridge)
    );
    stdout += continued.stdout;
    stderr += continued.stderr;
  }

  return { stdout, stderr };
}

/**
 * Which planned commit the rebase is currently sitting on.
 *
 * `rebase-merge/stopped-sha` is git's own record and survives the rewrite, so
 * it is preferred; matching on the subject is the fallback for the layouts
 * that do not write it.
 */
async function originalOidForStop(repoPath: string, stoppedAt: string): Promise<string | null> {
  const directory = await gitDir(repoPath);
  if (directory === null) {
    return null;
  }

  const stoppedFile = path.join(directory, 'rebase-merge', 'stopped-sha');
  try {
    const recorded = fs.readFileSync(stoppedFile, 'utf8').trim();
    if (recorded !== '') {
      const full = await tryGitCommand(repoPath, ['rev-parse', recorded]);
      return full?.stdout.trim() ?? recorded;
    }
  } catch {
    // Not every git version writes it; fall through.
  }

  return stoppedAt;
}

export async function startRebase(
  repoPath: string,
  plan: RebasePlan
): Promise<StartResult> {
  const bridge = createEditorBridge();

  try {
    fs.writeFileSync(bridge.todoPath, renderTodo(plan), 'utf8');

    const rewords: Record<string, string> = {};
    for (const item of plan.items) {
      if (item.action === 'reword' && typeof item.message === 'string' && item.message !== '') {
        rewords[item.oid] = item.message;
      }
    }

    const session: RebaseSession = {
      plan,
      bridgeDirectory: bridge.directory,
      rewords,
      splitting: false,
      startedAt: new Date().toISOString()
    };
    await writeSession(repoPath, session);

    // Interactive, but with both editors answered by the bridge: the sequence
    // editor is handed our todo, and the message editor accepts what git
    // prepared. Without this git would open a real editor and never return.
    const started = await tryGitWithEnv(
      repoPath,
      rebaseGitArgs(['rebase', '-i', plan.onto]),
      bridgeEnv(bridge, { todoPath: bridge.todoPath })
    );

    const settled = await advanceThroughRewords(repoPath, session, bridge);
    const status = await rebaseStatus(repoPath);

    if (!status.inProgress) {
      await clearSession(repoPath);
    }

    // Git refused rather than started: no rebase is running and it exited
    // non-zero. Its own message says why — an unstaged change, an unmerged
    // path — and is far more useful than anything invented here.
    if (!started.ok && !status.inProgress) {
      throw new GitError('The rebase did not start.', {
        stdout: started.stdout,
        stderr: started.stderr,
        statusCode: 400
      });
    }

    return {
      status,
      stopped: status.inProgress,
      stdout: started.stdout + settled.stdout,
      stderr: started.stderr + settled.stderr
    };
  } catch (error) {
    removeEditorBridge(bridge);
    throw error;
  }
}

/** `git rebase -i` needs the environment; this is the shape callers use. */
export async function runRebaseWithBridge(
  repoPath: string,
  args: readonly string[],
  todoPath?: string
): Promise<{ stdout: string; stderr: string }> {
  const bridge = createEditorBridge();
  try {
    return await runGitCommand(repoPath, args, null, {
      envOverrides: bridgeEnv(bridge, todoPath === undefined ? {} : { todoPath })
    });
  } finally {
    removeEditorBridge(bridge);
  }
}

export type RebaseStep = 'continue' | 'skip' | 'abort';

export async function stepRebase(
  repoPath: string,
  step: RebaseStep
): Promise<{ status: RebaseStatus; stdout: string; stderr: string }> {
  const session = await readSession(repoPath);
  const bridge = createEditorBridge();

  try {
    // --continue commits the resolution, which opens the message editor.
    const result = await tryGitWithEnv(
      repoPath,
      rebaseGitArgs(['rebase', `--${step}`]),
      acceptEditorEnv(bridge)
    );

    let stdout = result.stdout;
    let stderr = result.stderr;

    if (step !== 'abort' && session) {
      const settled = await advanceThroughRewords(repoPath, session, bridge);
      stdout += settled.stdout;
      stderr += settled.stderr;
    }

    const status = await rebaseStatus(repoPath);
    if (!status.inProgress) {
      await clearSession(repoPath);
    } else if (session && session.splitting) {
      await writeSession(repoPath, { ...session, splitting: false });
    }

    // Same distinction as starting: still stopped means git is waiting for
    // something, but a refusal that left no rebase running is a failure.
    if (!result.ok && !status.inProgress && step !== 'abort') {
      throw new GitError(`The rebase could not ${step}.`, {
        stdout: result.stdout,
        stderr: result.stderr,
        statusCode: 400
      });
    }

    return { status, stdout, stderr };
  } finally {
    removeEditorBridge(bridge);
  }
}

/**
 * Takes the commit the rebase is stopped at apart.
 *
 * A mixed reset to the parent leaves every change in the working tree with
 * nothing staged, which is exactly the state precision staging wants: the user
 * picks the first commit's worth, commits, picks the next, and continues when
 * the remainder is empty.
 */
export async function startSplit(
  repoPath: string
): Promise<{ status: RebaseStatus; stdout: string; stderr: string }> {
  const status = await rebaseStatus(repoPath);

  if (!status.inProgress) {
    throw new Error('No rebase is in progress.');
  }
  if (!status.canSplit) {
    throw new Error('Resolve the conflicts before splitting this commit.');
  }

  const result = await runGitCommand(repoPath, rebaseGitArgs(['reset', 'HEAD^']));

  const session = await readSession(repoPath);
  if (session) {
    await writeSession(repoPath, { ...session, splitting: true });
  }

  return {
    status: await rebaseStatus(repoPath),
    stdout: result.stdout,
    stderr: result.stderr
  };
}

/** Everything the split still has to account for. */
export async function splitRemainder(repoPath: string): Promise<{
  staged: number;
  unstaged: number;
  clean: boolean;
}> {
  const result = await tryGitCommand(repoPath, ['status', '--porcelain']);
  const lines = (result?.stdout ?? '').split('\n').filter((line) => line.trim() !== '');

  const staged = lines.filter((line) => line[0] !== ' ' && line[0] !== '?').length;
  const unstaged = lines.filter((line) => line[1] !== ' ').length;

  return { staged, unstaged, clean: lines.length === 0 };
}
