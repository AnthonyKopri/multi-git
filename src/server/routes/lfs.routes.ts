// Git LFS over HTTP.
//
// Every route here can answer "LFS is not installed", and does so as a
// structured 409 with a documentation link rather than as an empty result. An
// empty object list looks like "this repository has no large files", which is a
// different and much more misleading thing.
//
// Transfers are registered as operations so they appear in the operations bar
// and can be cancelled; force-unlock is the one action that takes something
// away from another person, so it is a separate flag the client has to send.
import { Router } from 'express';

import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { operations } from '../operations/registry';
import { ensureAgentForRepo } from '../ssh/agent-session';
import {
  createLock,
  listLocks,
  previewTransfer,
  readStatus,
  releaseLock,
  runTransfer,
  setInstallation,
  trackPattern,
  untrackPattern
} from '../git/lfs';

export const lfsRouter: Router = Router();

lfsRouter.use('/api/lfs', requireRepoPath);

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(`${label} is required.`, 400);
  }
  return value;
}

function transferAction(value: unknown): 'fetch' | 'pull' | 'prune' {
  if (value === 'fetch' || value === 'pull' || value === 'prune') {
    return value;
  }
  throw new HttpError('Choose fetch, pull or prune.', 400);
}

lfsRouter.get(
  '/api/lfs/status',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    const operation = operations.begin({
      kind: 'lfs.status',
      repoPath,
      message: 'Reading Git LFS state'
    });
    operation.start();

    try {
      const status = await readStatus(repoPath, { signal: operation.signal });
      operation.succeed();
      res.json({ success: true, status });
    } catch (error) {
      operation.fail(error instanceof Error ? error.message : 'Could not read Git LFS state');
      throw error;
    }
  })
);

/**
 * Wires LFS into this repository, or takes it back out.
 *
 * Scoped to the repository at every layer: the server only ever passes
 * `--local`, so neither direction can reach the global config and change what
 * other repositories on this machine do.
 */
lfsRouter.post(
  '/api/lfs/installation',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const action = (req.body ?? {})['action'];

    if (action !== 'install' && action !== 'uninstall') {
      throw new HttpError('Choose install or uninstall.', 400);
    }

    res.json({ success: true, installation: await setInstallation(repoPath, action) });
  })
);

lfsRouter.post(
  '/api/lfs/track',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const pattern = requiredString((req.body ?? {})['pattern'], 'Pattern');

    res.json({ success: true, trackedPatterns: await trackPattern(repoPath, pattern) });
  })
);

lfsRouter.post(
  '/api/lfs/untrack',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const pattern = requiredString((req.body ?? {})['pattern'], 'Pattern');

    res.json({ success: true, trackedPatterns: await untrackPattern(repoPath, pattern) });
  })
);

lfsRouter.get(
  '/api/lfs/preview',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const action = transferAction(req.query['action']);

    res.json({ success: true, preview: await previewTransfer(repoPath, action) });
  })
);

lfsRouter.post(
  '/api/lfs/transfer',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = transferAction(body['action']);

    if (action !== 'prune') {
      // Fetch and pull reach the network; prune works on the local store.
      await ensureAgentForRepo(
        repoPath,
        typeof body['profileId'] === 'string' ? body['profileId'] : undefined
      );
    }

    const operation = operations.begin({
      kind: `lfs.${action}`,
      repoPath,
      message: `Running git lfs ${action}`
    });
    operation.start();

    try {
      await runTransfer(repoPath, action, { signal: operation.signal });
      operation.succeed(`git lfs ${action} finished`);
      res.json({ success: true, cancelled: operation.cancelled });
    } catch (error) {
      operation.fail(error instanceof Error ? error.message : `git lfs ${action} failed`);
      throw error;
    }
  })
);

lfsRouter.get(
  '/api/lfs/locks',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const state = await listLocks(repoPath);

    res.json({ success: true, ...state });
  })
);

lfsRouter.post(
  '/api/lfs/lock',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const filePath = requiredString((req.body ?? {})['path'], 'File path');

    await ensureAgentForRepo(repoPath);
    await createLock(repoPath, filePath);

    res.json({ success: true, ...(await listLocks(repoPath)) });
  })
);

lfsRouter.post(
  '/api/lfs/unlock',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const filePath = requiredString(body['path'], 'File path');

    await ensureAgentForRepo(repoPath);

    // Force takes a lock that belongs to someone else, and is never inferred
    // from a plain unlock being refused: the retry has to be the user's choice.
    await releaseLock(repoPath, filePath, body['force'] === true);

    res.json({ success: true, ...(await listLocks(repoPath)) });
  })
);
