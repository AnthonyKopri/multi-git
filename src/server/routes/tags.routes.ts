import { Router } from 'express';

import { commitish, refArg } from '../git/args';
import { withRepoLock } from '../git/lock';
import { GitError, runGitCommand } from '../git/run';
import { explainSigningFailure } from '../git/signing';
import { runSyncOperationWithProfile } from '../ssh/profiles';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';

export const tagsRouter: Router = Router();

tagsRouter.use(requireRepoPath);

/** Tag names go through the same ref validation as branches. */
function tagName(value: unknown): string {
  return refArg(value, 'Tag name');
}

tagsRouter.post(
  '/api/git/tag',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { name, hash, message, sign } = (req.body ?? {}) as {
      name?: unknown;
      hash?: unknown;
      message?: unknown;
      sign?: unknown;
    };

    const safeName = tagName(name);
    const args = ['tag'];

    // Only an annotated tag can carry a signature, so signing implies -a.
    if (sign === true) {
      args.push('-s');
    } else if (typeof message === 'string' && message !== '') {
      // A message makes it an annotated tag; without one it stays lightweight.
      args.push('-a');
    }

    if (typeof message === 'string' && message !== '') {
      args.push('-m', message);
    } else if (sign === true) {
      // git refuses to sign a tag with no message and would open an editor.
      args.push('-m', safeName);
    }

    args.push(safeName);

    if (hash) {
      args.push(commitish(hash));
    }

    try {
      const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));
      res.json({ success: true, stdout, stderr });
    } catch (error) {
      const explained = error instanceof GitError ? explainSigningFailure(error.stderr) : null;
      if (explained === null) {
        throw error;
      }
      throw new HttpError(explained, 400);
    }
  })
);

tagsRouter.delete(
  '/api/git/tag',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const safeName = tagName((req.body as { name?: unknown })?.name);

    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['tag', '-d', safeName])
    );

    res.json({ success: true, stdout, stderr });
  })
);

tagsRouter.post(
  '/api/git/tag/push',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { name, sshKeyPath, profileId } = (req.body ?? {}) as {
      name?: unknown;
      sshKeyPath?: unknown;
      profileId?: unknown;
    };

    const safeName = tagName(name);

    // The fully-qualified refspec stops a tag and a branch of the same name
    // from being ambiguous to the remote.
    const { stdout, stderr, profileLabel } = await runSyncOperationWithProfile(
      repoPath,
      ['push', 'origin', `refs/tags/${safeName}`],
      typeof profileId === 'string' ? profileId : undefined,
      typeof sshKeyPath === 'string' ? sshKeyPath : undefined
    );

    res.json({ success: true, stdout, stderr, profileLabel });
  })
);
