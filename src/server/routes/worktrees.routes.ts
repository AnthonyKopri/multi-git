// Worktree lifecycle over HTTP.
//
// The listing is deliberately split in two. `GET /api/worktrees` is structure
// only and answers in one git call; `GET /api/worktrees/status` is one or two
// calls per worktree and is registered as a cancellable operation, so a family
// of twenty does not make opening the panel feel broken.
//
// Removal is the route that can destroy work, and three things stand between a
// request and a deleted folder: the target must be a path git itself listed,
// the user must have typed the folder's name, and a recovery point must exist
// before git is asked to do anything.
import { Router } from 'express';
import path from 'node:path';

import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { withRepoLock } from '../git/lock';
import { runGitCommand } from '../git/run';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { readConfig } from '../config/store';
import { operations } from '../operations/registry';
import {
  attachWorktreeStatus,
  createWorktree,
  findWorktree,
  isDirty,
  listWorktrees,
  mainWorktree,
  parsePrunePreview,
  readFamilyKey,
  readWorktreeStatus,
  snapshotWorktree,
  suggestWorktreeParent
} from '../git/worktrees';
import type { CreateWorktreeInput, WorktreeInfo } from '../../shared/worktree-types';

export const worktreesRouter: Router = Router();

worktreesRouter.use('/api/worktrees', requireRepoPath);

/** The configured default parent for new worktrees, if the user set one. */
function configuredParent(): string | undefined {
  const value = readConfig().settings?.worktreeParentDir;
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(`${label} is required.`, 400);
  }
  return value;
}

/**
 * Resolves a request's target to a worktree git itself reported.
 *
 * Every mutating route goes through this. Nothing downstream ever operates on
 * a path the caller supplied — only on `worktree.path`, which came out of
 * `git worktree list`.
 */
async function requireWorktree(
  repoPath: string,
  rawPath: unknown
): Promise<{ worktree: WorktreeInfo; worktrees: WorktreeInfo[] }> {
  const worktrees = await listWorktrees(repoPath);
  const worktree = findWorktree(worktrees, asString(rawPath, 'Worktree path'));

  if (!worktree) {
    throw new HttpError('That path is not a worktree of this repository.', 404);
  }

  return { worktree, worktrees };
}

worktreesRouter.get(
  '/api/worktrees',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    const [worktrees, familyKey] = await Promise.all([
      listWorktrees(repoPath),
      readFamilyKey(repoPath)
    ]);

    const main = mainWorktree(worktrees);

    res.json({
      success: true,
      familyKey,
      mainPath: main?.path ?? repoPath,
      worktrees,
      suggestedParent: suggestWorktreeParent(main?.path ?? repoPath, configuredParent())
    });
  })
);

worktreesRouter.get(
  '/api/worktrees/status',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const worktrees = await listWorktrees(repoPath);

    const operation = operations.begin({
      kind: 'worktree-status',
      repoPath,
      message: `Reading ${worktrees.length} worktree(s)`,
      total: worktrees.length
    });
    operation.start();

    try {
      const withStatus = await attachWorktreeStatus(worktrees, { signal: operation.signal });
      operation.succeed();
      res.json({ success: true, worktrees: withStatus, cancelled: operation.cancelled });
    } catch (error) {
      operation.fail(error instanceof Error ? error.message : 'Could not read worktree status');
      throw error;
    }
  })
);

worktreesRouter.post(
  '/api/worktrees',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Partial<CreateWorktreeInput>;

    const branchMode = body.branchMode;
    if (branchMode !== 'existing' && branchMode !== 'new' && branchMode !== 'detached') {
      throw new HttpError('Choose whether to use an existing branch, a new one, or a detached head.', 400);
    }

    const input: CreateWorktreeInput = {
      repoPath,
      targetPath: asString(body.targetPath, 'Worktree folder'),
      branchMode,
      ...(body.branch !== undefined ? { branch: body.branch } : {}),
      ...(body.startPoint !== undefined ? { startPoint: body.startPoint } : {}),
      ...(body.lock !== undefined ? { lock: body.lock === true } : {})
    };

    const created = await withRepoLock(repoPath, () => createWorktree(input));
    const worktrees = await listWorktrees(repoPath);

    res.json({
      success: true,
      path: created.path,
      worktrees,
      stdout: created.stdout,
      stderr: created.stderr
    });
  })
);

worktreesRouter.post(
  '/api/worktrees/move',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { from, to } = (req.body ?? {}) as { from?: unknown; to?: unknown };

    const { worktree } = await requireWorktree(repoPath, from);
    const destination = path.resolve(asString(to, 'Destination folder'));

    if (worktree.isMain) {
      throw new HttpError(
        'The main worktree holds the repository itself and cannot be moved from here.',
        400
      );
    }

    const result = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['worktree', 'move', worktree.path, destination])
    );

    res.json({
      success: true,
      path: destination,
      worktrees: await listWorktrees(repoPath),
      stdout: result.stdout,
      stderr: result.stderr
    });
  })
);

worktreesRouter.post(
  '/api/worktrees/lock',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { path: target, reason } = (req.body ?? {}) as { path?: unknown; reason?: unknown };

    const { worktree } = await requireWorktree(repoPath, target);

    const args = ['worktree', 'lock', worktree.path];
    if (typeof reason === 'string' && reason.trim() !== '') {
      args.push('--reason', reason.trim());
    }

    const result = await runGitCommand(repoPath, args);

    res.json({
      success: true,
      path: worktree.path,
      worktrees: await listWorktrees(repoPath),
      stdout: result.stdout,
      stderr: result.stderr
    });
  })
);

worktreesRouter.post(
  '/api/worktrees/unlock',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { path: target } = (req.body ?? {}) as { path?: unknown };

    const { worktree } = await requireWorktree(repoPath, target);
    const result = await runGitCommand(repoPath, ['worktree', 'unlock', worktree.path]);

    res.json({
      success: true,
      path: worktree.path,
      worktrees: await listWorktrees(repoPath),
      stdout: result.stdout,
      stderr: result.stderr
    });
  })
);

worktreesRouter.post(
  '/api/worktrees/repair',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { paths } = (req.body ?? {}) as { paths?: unknown };

    const args = ['worktree', 'repair'];

    // A repair with no arguments fixes this worktree's own links, which is the
    // case after the repository folder itself was moved.
    if (Array.isArray(paths) && paths.length > 0) {
      for (const candidate of paths) {
        args.push(path.resolve(asString(candidate, 'Worktree path')));
      }
    }

    const result = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));

    res.json({
      success: true,
      path: repoPath,
      worktrees: await listWorktrees(repoPath),
      stdout: result.stdout,
      stderr: result.stderr
    });
  })
);

worktreesRouter.get(
  '/api/worktrees/prune-preview',
  asyncRoute(async (req, res) => {
    res.json({ success: true, entries: await parsePrunePreview(req.repoPath as string) });
  })
);

worktreesRouter.delete(
  '/api/worktrees',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { path: target, force, confirmName } = (req.body ?? {}) as {
      path?: unknown;
      force?: unknown;
      confirmName?: unknown;
    };

    const { worktree, worktrees } = await requireWorktree(repoPath, target);

    if (worktree.isMain) {
      throw new HttpError(
        'The main worktree is the repository itself. Remove the repository from Multi-Git instead.',
        400
      );
    }

    if (worktree.locked) {
      throw new HttpError(
        `That worktree is locked${worktree.lockReason ? `: ${worktree.lockReason}` : ''}. Unlock it before removing it.`,
        409
      );
    }

    const status = worktree.present ? await readWorktreeStatus(worktree.path) : null;
    const dirty = isDirty(status);
    const forced = force === true;

    if (dirty && !forced) {
      throw new HttpError(
        'That worktree has uncommitted changes. Commit or stash them, or remove it with the forced option.',
        409
      );
    }

    let snapshotRef: string | null = null;

    if (forced) {
      // The typed name is the confirmation, and a missing one is the same
      // mistake as a wrong one — both get the message that says what to type.
      const expectedName = path.basename(worktree.path);
      const typed = typeof confirmName === 'string' ? confirmName.trim() : '';

      if (typed !== expectedName) {
        throw new HttpError(
          `Type the worktree's folder name (${expectedName}) to confirm removal.`,
          400
        );
      }

      // Uncommitted work first: `stash create` writes into the shared object
      // store, so the snapshot outlives the folder about to be deleted.
      if (dirty && worktree.present) {
        snapshotRef = await snapshotWorktree(worktree.path);
      }

      // Captured against the main worktree. The doomed worktree's own git
      // directory goes with it, and a recovery point written there would be
      // deleted by the very operation it exists to undo.
      const main = mainWorktree(worktrees);
      await captureCheckpoint(
        main?.path ?? repoPath,
        `Before removing worktree ${path.basename(worktree.path)}`,
        {
          operation: 'worktree-remove',
          ...(worktree.branch ? { refs: [worktree.branch] } : {}),
          ...(snapshotRef ? { stashRef: snapshotRef } : {})
        }
      );
    }

    // Git does the deleting, against its own path. This process never removes
    // a directory tree it computed.
    const args = ['worktree', 'remove'];
    if (forced) {
      args.push('--force');
    }
    args.push(worktree.path);

    try {
      await withRepoLock(repoPath, () => runGitCommand(repoPath, args));
    } catch (error) {
      throw new HttpError(
        `Git could not remove the worktree: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }

    res.json({
      success: true,
      removedPath: worktree.path,
      worktrees: await listWorktrees(repoPath),
      ...(snapshotRef ? { snapshotRef } : {})
    });
  })
);
