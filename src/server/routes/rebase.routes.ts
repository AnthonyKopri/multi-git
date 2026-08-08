// Interactive rebase.
//
// Starting one is the most destructive thing this application does, so the
// order here is fixed: build a plan, validate it, say what it would cost on a
// published branch, record a recovery point, and only then let git touch
// anything.
import { Router } from 'express';

import { commitish } from '../git/args';
import { withRepoLock } from '../git/lock';
import { tryGitCommand } from '../git/run';
import {
  buildPlan,
  rebaseStatus,
  splitRemainder,
  startRebase,
  startSplit,
  stepRebase,
  validatePlan
} from '../git/rebase';
import type { RebaseStep } from '../git/rebase';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import type { RebaseAction, RebasePlan, RebaseTodoItem } from '../../shared/rebase-types';

export const rebaseRouter: Router = Router();

rebaseRouter.use(requireRepoPath);

const ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

/**
 * How much of what is about to be rewritten is already on the remote.
 *
 * The number that matters is not "is this branch pushed" but "how many commits
 * would someone else's clone disagree about", so it is counted rather than
 * reported as a yes or no.
 */
async function publishedWarning(
  repoPath: string,
  onto: string
): Promise<{ branch: string | null; upstream: string | null; publishedCommits: number }> {
  const branchResult = await tryGitCommand(repoPath, ['symbolic-ref', '--short', 'HEAD']);
  const branch = branchResult?.stdout.trim() || null;

  if (branch === null) {
    return { branch: null, upstream: null, publishedCommits: 0 };
  }

  const upstreamResult = await tryGitCommand(repoPath, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    `${branch}@{upstream}`
  ]);
  const upstream = upstreamResult?.stdout.trim() || null;

  if (upstream === null) {
    return { branch, upstream: null, publishedCommits: 0 };
  }

  // Commits in the range being rewritten that the upstream also has.
  const shared = await tryGitCommand(repoPath, [
    'rev-list',
    '--count',
    `${onto}..${upstream}`
  ]);

  return {
    branch,
    upstream,
    publishedCommits: Number.parseInt(shared?.stdout.trim() ?? '0', 10) || 0
  };
}

function parsePlan(value: unknown): RebasePlan {
  const record = (value ?? {}) as Record<string, unknown>;

  if (typeof record['onto'] !== 'string' || record['onto'] === '') {
    throw new HttpError('A base commit is required.', 400);
  }
  if (!Array.isArray(record['items'])) {
    throw new HttpError('The plan needs a list of commits.', 400);
  }

  const items: RebaseTodoItem[] = record['items'].map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;

    if (typeof item['oid'] !== 'string' || !/^[0-9a-fA-F]{4,40}$/.test(item['oid'])) {
      throw new HttpError('Every plan item needs an object name.', 400);
    }
    if (!ACTIONS.includes(item['action'] as RebaseAction)) {
      throw new HttpError(`Action must be one of: ${ACTIONS.join(', ')}`, 400);
    }

    const parsed: RebaseTodoItem = {
      oid: item['oid'],
      action: item['action'] as RebaseAction,
      subject: typeof item['subject'] === 'string' ? item['subject'] : '',
      author: typeof item['author'] === 'string' ? item['author'] : '',
      date: typeof item['date'] === 'string' ? item['date'] : ''
    };

    if (typeof item['message'] === 'string' && item['message'] !== '') {
      parsed.message = item['message'];
    }

    return parsed;
  });

  return {
    onto: commitish(record['onto'], 'Base commit'),
    items,
    autosquash: record['autosquash'] === true
  };
}

/** The plan a rebase onto this base would start from. */
rebaseRouter.get(
  '/api/git/rebase/plan',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const autosquash = req.query['autosquash'] === 'true';

    const plan = await buildPlan(repoPath, req.query['onto'], autosquash);
    const warning = await publishedWarning(repoPath, plan.onto);

    res.json({ success: true, plan, warning });
  })
);

rebaseRouter.get(
  '/api/git/rebase/status',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const status = await rebaseStatus(repoPath);
    const remainder = status.splitInProgress ? await splitRemainder(repoPath) : null;

    res.json({ success: true, status, remainder });
  })
);

rebaseRouter.post(
  '/api/git/rebase/start',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const plan = parsePlan((req.body as { plan?: unknown })?.plan);

    const existing = await rebaseStatus(repoPath);
    if (existing.inProgress) {
      throw new HttpError(
        'A rebase is already in progress. Continue, skip or abort it first.',
        409
      );
    }

    // Validated against the commits that are actually there right now, not
    // against whatever the planner was looking at when it was opened.
    const current = await buildPlan(repoPath, plan.onto, false);
    const validation = validatePlan(plan, current.items);

    if (!validation.valid) {
      res.status(400).json({ error: validation.errors.join(' '), validation });
      return;
    }

    await captureCheckpoint(repoPath, `Interactive rebase onto ${plan.onto.substring(0, 8)}`, {
      operation: 'rebase'
    });

    const result = await withRepoLock(repoPath, () => startRebase(repoPath, plan));
    res.json({ success: true, ...result, validation });
  })
);

rebaseRouter.post(
  '/api/git/rebase/step',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { step } = (req.body ?? {}) as { step?: unknown };

    if (step !== 'continue' && step !== 'skip' && step !== 'abort') {
      throw new HttpError('Step must be continue, skip or abort.', 400);
    }

    const status = await rebaseStatus(repoPath);
    if (!status.inProgress) {
      throw new HttpError('No rebase is in progress.', 409);
    }

    const result = await withRepoLock(repoPath, () => stepRebase(repoPath, step as RebaseStep));
    res.json({ success: true, ...result });
  })
);

/**
 * Resets the stopped commit, keeping its changes in the working tree.
 *
 * From here the ordinary staging and commit routes do the work: the user
 * stages part of it, commits, and repeats until nothing is left.
 */
rebaseRouter.post(
  '/api/git/rebase/split',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    const result = await withRepoLock(repoPath, () => startSplit(repoPath));
    const remainder = await splitRemainder(repoPath);

    res.json({ success: true, ...result, remainder });
  })
);
