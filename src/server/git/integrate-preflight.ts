// What an integration would do, worked out before it does it.
//
// Modelled on the pull-request preflight, which is the one place this
// application already got this right: it answers every question that decides
// whether the button is safe to press, in one round trip, and the window
// renders it rather than re-deriving it.
//
// Merge and rebase never had one. They rewrite history from a dropdown and a
// button, with no preview and no confirmation, while discarding a single file
// asks you twice. This closes that gap for the four operations that change
// something.
import { refArg } from './args';
import { runGitCommand, tryGitCommand } from './run';
import { resolvePullStrategy } from '../../shared/pull-strategy';
import type {
  IntegrationCommit,
  IntegrationKind,
  IntegrationPreflight
} from '../../shared/integrate-types';

/** A separator no commit subject will contain. */
const FIELD = '';

/**
 * Commits in `range`, newest first.
 *
 * Capped: a branch a thousand commits behind should not send a thousand
 * subjects to draw a list nobody scrolls. The count is reported separately, so
 * the cap costs detail rather than truth.
 */
const MAX_LISTED = 50;

async function commitsIn(repoPath: string, range: string): Promise<IntegrationCommit[]> {
  const result = await tryGitCommand(repoPath, [
    'log',
    `--max-count=${MAX_LISTED}`,
    `--pretty=%H${FIELD}%s${FIELD}%an`,
    range
  ]);

  if (result === null) {
    return [];
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash = '', subject = '', author = ''] = line.split(FIELD);
      return { hash, subject, author };
    });
}

async function countIn(repoPath: string, range: string): Promise<number> {
  const result = await tryGitCommand(repoPath, ['rev-list', '--count', range]);
  return Number.parseInt(result?.stdout.trim() ?? '0', 10) || 0;
}

async function changedFileCount(repoPath: string, from: string, to: string): Promise<number> {
  // Three dots: what `to` changed since the branches diverged, which is what an
  // integration would actually bring, rather than every difference between them.
  const result = await tryGitCommand(repoPath, ['diff', '--name-only', `${from}...${to}`]);
  if (result === null) {
    return 0;
  }

  return result.stdout.split('\n').filter((line) => line.trim() !== '').length;
}

/** True when `ancestor` is already contained in `descendant`. */
async function isAncestor(repoPath: string, ancestor: string, descendant: string): Promise<boolean> {
  const result = await tryGitCommand(repoPath, [
    'merge-base',
    '--is-ancestor',
    ancestor,
    descendant
  ]);

  // tryGitCommand answers null on a non-zero exit, which here means "no".
  return result !== null;
}

async function readConfigValue(repoPath: string, key: string): Promise<string | undefined> {
  const result = await tryGitCommand(repoPath, ['config', '--get', key]);
  const value = result?.stdout.trim();
  return value ? value : undefined;
}

/** The working tree state that should stop or warn about an integration. */
async function treeWarnings(repoPath: string): Promise<{ warnings: string[]; blocked?: string }> {
  const warnings: string[] = [];

  const status = await tryGitCommand(repoPath, ['status', '--porcelain']);
  const lines = (status?.stdout ?? '').split('\n').filter((line) => line.trim() !== '');

  const conflicted = lines.some((line) => /^(DD|AU|UD|UA|DU|AA|UU)/.test(line));
  if (conflicted) {
    return {
      warnings,
      blocked: 'This repository has unresolved conflicts. Finish or abort that first.'
    };
  }

  const tracked = lines.filter((line) => !line.startsWith('??'));
  if (tracked.length > 0) {
    warnings.push(
      `${tracked.length} uncommitted ${tracked.length === 1 ? 'change' : 'changes'} in tracked files. Git will refuse if any of them are in the way.`
    );
  }

  return { warnings };
}

export interface PreflightInput {
  repoPath: string;
  kind: IntegrationKind;
  /** The branch to integrate, or the upstream for pull and push. */
  target: string;
  identity?: { label: string; keyPath: string } | null;
}

/**
 * Works out what would happen, without doing any of it.
 *
 * Every command here is a read, so this costs a few queries and changes
 * nothing -- which is what makes it safe to run on opening a dialog.
 */
export async function integrationPreflight(input: PreflightInput): Promise<IntegrationPreflight> {
  const { repoPath, kind } = input;
  const target = refArg(input.target, 'Branch name');

  const head = (await tryGitCommand(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']))?.stdout.trim();

  // For push the direction is reversed: what leaves, not what arrives.
  const incomingRange = kind === 'push' ? `${target}..HEAD` : `HEAD..${target}`;
  const outgoingRange = kind === 'push' ? `HEAD..${target}` : `${target}..HEAD`;

  const [incoming, outgoingCount, changedFiles, tree] = await Promise.all([
    commitsIn(repoPath, incomingRange),
    countIn(repoPath, outgoingRange),
    changedFileCount(repoPath, 'HEAD', target),
    treeWarnings(repoPath)
  ]);

  const incomingCount = await countIn(repoPath, incomingRange);
  const outgoing = outgoingCount === 0 ? [] : await commitsIn(repoPath, outgoingRange);

  // A fast-forward is possible when HEAD is already an ancestor of the target:
  // nothing of yours has to move, so nothing can be rewritten.
  const fastForward =
    kind === 'push' ? true : incomingCount > 0 && (await isAncestor(repoPath, 'HEAD', target));

  const preflight: IntegrationPreflight = {
    kind,
    target,
    incoming,
    outgoing,
    changedFiles,
    fastForward,
    // Merge and rebase have always captured one. Saying so is the point.
    recoveryPoint: kind === 'merge' || kind === 'rebase',
    ...(input.identity === undefined ? {} : { identity: input.identity }),
    warnings: [...tree.warnings],
    ...(tree.blocked === undefined ? {} : { blocked: tree.blocked })
  };

  if (kind === 'pull') {
    const [pullRebase, pullFf] = await Promise.all([
      readConfigValue(repoPath, 'pull.rebase'),
      readConfigValue(repoPath, 'pull.ff')
    ]);

    preflight.strategy = resolvePullStrategy({
      behind: incomingCount,
      ahead: outgoingCount,
      pullRebase,
      pullFf
    });

    // A rebase pull rewrites local commits, which is the one outcome of the
    // three that a user would want to have been warned about.
    if (preflight.strategy === 'rebase') {
      preflight.recoveryPoint = true;
    }
  }

  if (kind === 'rebase' && outgoingCount > 0) {
    preflight.warnings.push(
      `${outgoingCount} of your ${outgoingCount === 1 ? 'commit' : 'commits'} will be replayed and get new object names.`
    );
  }

  if (incomingCount === 0 && kind !== 'push') {
    preflight.warnings.push(`Nothing to bring in — ${head ?? 'HEAD'} already has everything from ${target}.`);
  }

  return preflight;
}

/** Confirms the target exists before anything asks what it would do. */
export async function targetExists(repoPath: string, target: string): Promise<boolean> {
  try {
    await runGitCommand(repoPath, ['rev-parse', '--verify', '--quiet', `${refArg(target)}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
