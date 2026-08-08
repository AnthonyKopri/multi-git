// The recovery browser: what was about to happen, and where everything was.
//
// Read-only except for three actions, all of which are ways of getting back to
// a recorded position: branch from an object, restore a ref to one, and forget
// a point. Restoring is itself destructive, so it records a recovery point of
// its own first — undoing an undo has to be possible too.
import { Router } from 'express';

import { commitish, refArg } from '../git/args';
import { withRepoLock } from '../git/lock';
import { runGitCommand, tryGitCommand } from '../git/run';
import { readReflog } from '../git/reflog';
import {
  DEFAULT_RETENTION_DAYS,
  captureRecoveryPoint,
  findRecoveryPoint,
  forgetRecoveryPoint,
  listRecoveryPoints
} from '../safety-net/recovery';
import { readConfig } from '../config/store';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { isMerging, isRebasing } from './status.routes';

export const recoveryRouter: Router = Router();

recoveryRouter.use(requireRepoPath);

/** Retention in days. 0 disables expiry, which the UI states as "kept". */
export function retentionDays(): number {
  const configured = readConfig().settings?.recoveryRetentionDays;
  return typeof configured === 'number' && configured >= 0 ? configured : DEFAULT_RETENTION_DAYS;
}

recoveryRouter.get(
  '/api/git/recovery',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const operationInProgress = isMerging(repoPath) || isRebasing(repoPath);

    const [points, reflog] = await Promise.all([
      listRecoveryPoints(repoPath, { skipExpiry: operationInProgress }),
      readReflog(repoPath, { limit: 100 })
    ]);

    res.json({
      success: true,
      points,
      reflog,
      retentionDays: retentionDays(),
      operationInProgress
    });
  })
);

recoveryRouter.post(
  '/api/git/recovery/branch',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { oid, branchName } = (req.body ?? {}) as { oid?: unknown; branchName?: unknown };

    const safeOid = commitish(oid, 'Object name');
    const safeBranch = refArg(branchName, 'Branch name');

    // Creating a branch is the non-destructive way out: it makes the object
    // reachable again without moving anything the user is standing on.
    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['branch', safeBranch, safeOid])
    );

    res.json({ success: true, branch: safeBranch, oid: safeOid, stdout, stderr });
  })
);

recoveryRouter.post(
  '/api/git/recovery/restore',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { pointId, ref } = (req.body ?? {}) as { pointId?: unknown; ref?: unknown };

    if (isMerging(repoPath) || isRebasing(repoPath)) {
      throw new HttpError(
        'Finish or abort the in-progress merge or rebase before restoring a ref.',
        400
      );
    }

    const point = await findRecoveryPoint(repoPath, String(pointId));
    if (!point) {
      throw new HttpError('That recovery point is no longer in the journal.', 404);
    }

    const target = typeof ref === 'string' && ref !== '' ? ref : 'HEAD';
    const oid = point.refs[target];
    if (!oid) {
      throw new HttpError(`This recovery point does not record ${target}.`, 400);
    }

    // The object has to still exist. It normally does — the reflog keeps it
    // reachable — but a repository that has been aggressively collected will
    // not have it, and saying so beats a bare "unknown revision".
    const exists = await tryGitCommand(repoPath, ['cat-file', '-e', `${oid}^{commit}`]);
    if (exists === null) {
      throw new HttpError(
        `Commit ${oid.substring(0, 8)} is no longer in this repository, so it cannot be restored. Git may have collected it.`,
        410
      );
    }

    // Undoing an undo has to be possible, so this records its own point first.
    await captureRecoveryPoint(repoPath, {
      operation: 'restore',
      label: `Before restoring ${target} to ${oid.substring(0, 8)}`,
      retentionDays: retentionDays()
    });

    const result = await withRepoLock(repoPath, async () => {
      // Restoring the ref HEAD is on means moving the working tree with it;
      // any other ref is just a pointer, and moving it must not touch files.
      const movesTheWorkingTree = target === 'HEAD' || target === point.headRef;
      return movesTheWorkingTree
        ? runGitCommand(repoPath, ['reset', '--hard', oid])
        : runGitCommand(repoPath, ['update-ref', refArg(target, 'Ref'), oid]);
    });

    res.json({
      success: true,
      ref: target,
      oid,
      shortOid: oid.substring(0, 8),
      stdout: result.stdout,
      stderr: result.stderr
    });
  })
);

recoveryRouter.delete(
  '/api/git/recovery',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { id } = (req.body ?? {}) as { id?: unknown };

    const removed = await forgetRecoveryPoint(repoPath, String(id));
    if (!removed) {
      throw new HttpError('That recovery point is no longer in the journal.', 404);
    }

    res.json({ success: true });
  })
);
