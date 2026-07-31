import { Router } from 'express';

import { commitish, refArg } from '../git/args';
import { withRepoLock } from '../git/lock';
import { runGitCommand } from '../git/run';
import { runSyncOperationWithProfile } from '../ssh/profiles';
import { requireRepoPath } from '../middleware/repo-path';
import { asyncRoute } from '../middleware/error-handler';

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
    const { name, hash, message } = (req.body ?? {}) as {
      name?: unknown;
      hash?: unknown;
      message?: unknown;
    };

    const safeName = tagName(name);
    const args = ['tag'];

    // A message makes it an annotated tag; without one it stays lightweight.
    if (typeof message === 'string' && message !== '') {
      args.push('-a', '-m', message);
    }
    args.push(safeName);

    if (hash) {
      args.push(commitish(hash));
    }

    const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));
    res.json({ success: true, stdout, stderr });
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
