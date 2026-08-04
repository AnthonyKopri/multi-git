// Pull-request preflight and creation.
import { Router } from 'express';

import { requireRepoPath } from '../middleware/repo-path';
import { asyncRoute, HttpError } from '../middleware/error-handler';
import {
  createPullRequest,
  preflightPullRequest,
  PullRequestError
} from '../providers/github-pull-requests';
import { operations } from '../operations/registry';

export const pullRequestsRouter: Router = Router();

pullRequestsRouter.use('/api/pull-requests', requireRepoPath);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** A list of names, rejecting anything that is not a plausible handle. */
function nameList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(`${field} must be a list.`, 400);
  }

  return value.map((entry) => {
    if (typeof entry !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(entry)) {
      // These land in gh's argv; a value starting with '-' would be a flag.
      throw new HttpError(`"${String(entry)}" is not a valid ${field} name.`, 400);
    }
    return entry;
  });
}

pullRequestsRouter.get(
  '/api/pull-requests/preflight',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    res.json({
      success: true,
      preflight: await preflightPullRequest({
        repoPath,
        headBranch: optionalString(req.query['headBranch']),
        baseBranch: optionalString(req.query['baseBranch'])
      })
    });
  })
);

pullRequestsRouter.post(
  '/api/pull-requests',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const baseBranch = optionalString(body['baseBranch']);
    const headBranch = optionalString(body['headBranch']);
    const title = typeof body['title'] === 'string' ? body['title'] : '';

    if (!baseBranch || !headBranch) {
      throw new HttpError('Base and compare branches are required.', 400);
    }

    // Tracked as an operation: creating a PR can push first, which is a
    // network round trip worth showing and being able to cancel.
    const handle = operations.begin({
      kind: 'github.pull-request.create',
      repoPath,
      message: `Creating pull request from ${headBranch}`,
      // gh has no safe mid-flight interruption point, and a half-created PR is
      // worse than waiting.
      cancellable: false
    });
    handle.start();

    try {
      const pullRequest = await createPullRequest({
        repoPath,
        baseBranch,
        headBranch,
        title,
        body: typeof body['body'] === 'string' ? body['body'] : '',
        draft: body['draft'] === true,
        maintainerCanModify: body['maintainerCanModify'] !== false,
        reviewers: nameList(body['reviewers'], 'reviewer'),
        assignees: nameList(body['assignees'], 'assignee'),
        labels: nameList(body['labels'], 'label'),
        pushFirst: body['pushFirst'] === true,
        ...(optionalString(body['profileId']) !== undefined
          ? { profileId: optionalString(body['profileId']) as string }
          : {})
      });

      handle.succeed(`Created #${pullRequest.number}`);
      res.json({ success: true, pullRequest });
    } catch (error) {
      if (error instanceof PullRequestError) {
        handle.fail(error.message);

        // 200 with success:false for states the window recovers from in place
        // — the form is still open and its contents still matter. Only genuine
        // faults get a non-2xx.
        res.status(error.statusCode >= 500 ? error.statusCode : 200).json({
          success: false,
          error: error.message,
          code: error.code,
          pushed: error.pushed
        });
        return;
      }

      handle.fail(error instanceof Error ? error.message : String(error));
      throw error;
    }
  })
);
