// Repository maintenance over HTTP: the survey, and the purge it authorises.
//
// The survey is a read. It runs a handful of git commands and, when the
// pull-request rule is on, one `gh` call — enough that it is worth registering
// as an operation so the bar can show it and a slow GitHub does not look like
// a hung window.
//
// The purge names the worktrees it was given rather than recomputing "all the
// stale ones" here. What the user confirmed is a list they were shown; a
// server that re-ran the rules could act on a set that had changed since.
import { Router } from 'express';

import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { purgeWorktrees, surveyMaintenance } from '../git/maintenance';
import { staleRules } from '../config/store';
import { operations } from '../operations/registry';

export const maintenanceRouter: Router = Router();

maintenanceRouter.use('/api/maintenance', requireRepoPath);

maintenanceRouter.get(
  '/api/maintenance/survey',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const rules = staleRules();

    const operation = operations.begin({
      kind: 'maintenance-survey',
      repoPath,
      message: 'Looking for stale worktrees and merged branches',
      // Nothing here writes, so there is no half-finished state to leave
      // behind; cancelling would only mean showing an empty tab.
      cancellable: false
    });
    operation.start();

    try {
      const survey = await surveyMaintenance(repoPath, { rules });
      operation.succeed(
        `${survey.staleWorktrees.length} stale worktree(s), ${survey.mergedBranches.length} merged branch(es)`
      );
      res.json({ success: true, survey });
    } catch (error) {
      operation.fail(error instanceof Error ? error.message : 'Could not survey the repository');
      throw error;
    }
  })
);

maintenanceRouter.post(
  '/api/maintenance/purge-worktrees',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const paths = body['paths'];

    if (!Array.isArray(paths) || paths.length === 0) {
      throw new HttpError('Choose at least one worktree to purge.', 400);
    }
    if (paths.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
      throw new HttpError('Every worktree must be named by its path.', 400);
    }

    const result = await purgeWorktrees(repoPath, {
      paths: paths as string[],
      deleteBranches: body['deleteBranches'] === true,
      // Both default to off. Losing uncommitted work and deleting an unmerged
      // branch are the two irreversible-feeling outcomes here, so neither
      // happens unless the request said so in as many words.
      includeDirty: body['includeDirty'] === true,
      forceBranchDelete: body['forceBranchDelete'] === true
    });

    res.json(result);
  })
);
