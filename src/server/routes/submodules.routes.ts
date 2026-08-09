// Submodule operations over HTTP.
//
// Every path in a request is resolved against the submodules `.gitmodules`
// actually declares before anything runs, so a request never names a directory
// of its own choosing. That check lives in ../git/submodules.ts, along with the
// containment rule that keeps a submodule declaring `../../..` from addressing
// anything outside the repository.
//
// Deinitialize is the one route here that can lose work, so it refuses a dirty
// submodule unless forced, and captures a recovery point either way.
import { Router } from 'express';

import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { withRepoLock } from '../git/lock';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { operations } from '../operations/registry';
import { ensureAgentForRepo } from '../ssh/agent-session';
import {
  deinitSubmodules,
  initSubmodules,
  listSubmodules,
  setSubmoduleBranch,
  submoduleRepoPath,
  syncSubmodules,
  updateSubmodules
} from '../git/submodules';

export const submodulesRouter: Router = Router();

submodulesRouter.use('/api/submodules', requireRepoPath);

function pathList(value: unknown, label = 'Submodule paths'): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new HttpError(`${label} must be a list of text values.`, 400);
  }
  return value as string[];
}

submodulesRouter.get(
  '/api/submodules',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    res.json({ success: true, submodules: await listSubmodules(repoPath) });
  })
);

submodulesRouter.post(
  '/api/submodules/init',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const paths = pathList((req.body ?? {})['paths']);

    const results = await withRepoLock(repoPath, () => initSubmodules(repoPath, paths));
    res.json({ success: true, results, submodules: await listSubmodules(repoPath) });
  })
);

submodulesRouter.post(
  '/api/submodules/update',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const paths = pathList(body['paths']);

    // Updating clones and fetches, so the repository's key has to be usable
    // first — the same preflight a push does.
    await ensureAgentForRepo(
      repoPath,
      typeof body['profileId'] === 'string' ? body['profileId'] : undefined
    );

    const targets = paths ?? (await listSubmodules(repoPath)).map((entry) => entry.path);
    const operation = operations.begin({
      kind: 'submodule.update',
      repoPath,
      message: `Updating ${targets.length} submodule(s)`,
      total: targets.length
    });
    operation.start();

    try {
      const results = await withRepoLock(repoPath, () =>
        updateSubmodules(
          repoPath,
          {
            ...(paths ? { paths } : {}),
            init: body['init'] === true,
            recursive: body['recursive'] === true
          },
          {
            sshKeyPath: typeof body['sshKeyPath'] === 'string' ? body['sshKeyPath'] : null,
            signal: operation.signal
          }
        )
      );

      const failed = results.filter((entry) => !entry.ok).length;
      operation.succeed(`${results.length - failed}/${results.length} updated`);

      res.json({ success: true, results, submodules: await listSubmodules(repoPath) });
    } catch (error) {
      operation.fail(error instanceof Error ? error.message : 'Could not update submodules');
      throw error;
    }
  })
);

submodulesRouter.post(
  '/api/submodules/sync',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const results = await withRepoLock(repoPath, () =>
      syncSubmodules(repoPath, pathList(body['paths']), body['recursive'] === true)
    );

    res.json({ success: true, results, submodules: await listSubmodules(repoPath) });
  })
);

submodulesRouter.post(
  '/api/submodules/set-branch',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { path: submodulePath, branch } = (req.body ?? {}) as {
      path?: unknown;
      branch?: unknown;
    };

    if (typeof submodulePath !== 'string' || submodulePath === '') {
      throw new HttpError('Which submodule?', 400);
    }

    const submodule = await withRepoLock(repoPath, () =>
      setSubmoduleBranch(
        repoPath,
        submodulePath,
        typeof branch === 'string' && branch !== '' ? branch : null
      )
    );

    res.json({ success: true, submodule, submodules: await listSubmodules(repoPath) });
  })
);

submodulesRouter.post(
  '/api/submodules/deinit',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const paths = pathList(body['paths']);
    const force = body['force'] === true;

    const results = await withRepoLock(repoPath, async () => {
      await captureCheckpoint(
        repoPath,
        `Deinitialized ${paths ? paths.join(', ') : 'every submodule'}`,
        { operation: 'submodule-deinit' }
      );

      return deinitSubmodules(repoPath, paths, force);
    });

    res.json({ success: true, results, submodules: await listSubmodules(repoPath) });
  })
);

/**
 * The absolute path a submodule can be opened at.
 *
 * The renderer cannot work this out for itself: it knows the submodule's
 * repository-relative path, but opening it needs the resolved absolute one,
 * and resolving it is exactly the step that has to be containment-checked.
 */
submodulesRouter.get(
  '/api/submodules/repo-path',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const submodulePath = req.query['path'];

    if (typeof submodulePath !== 'string' || submodulePath === '') {
      throw new HttpError('Which submodule?', 400);
    }

    const resolved = submoduleRepoPath(repoPath, submodulePath);
    if (!resolved) {
      throw new HttpError(
        'That submodule has no checked-out working tree yet. Initialize it first.',
        409
      );
    }

    res.json({ success: true, path: resolved });
  })
);
