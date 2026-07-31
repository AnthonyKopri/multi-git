import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

import { withRepoLock } from '../git/lock';
import { runGitCommand } from '../git/run';
import { resolveInsideRepo } from '../fs/paths';
import {
  consumeCheckpoint,
  findCheckpoint,
  listCheckpoints
} from '../safety-net/checkpoints';
import {
  readTrashIndex,
  repoTrashDir,
  pruneTrash,
  writeTrashIndex
} from '../safety-net/trash';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { isMerging, isRebasing } from './status.routes';

export const safetyNetRouter: Router = Router();

safetyNetRouter.use(requireRepoPath);

safetyNetRouter.get('/api/git/checkpoints', (req, res) => {
  res.json({ success: true, checkpoints: listCheckpoints(req.repoPath as string) });
});

safetyNetRouter.post(
  '/api/git/undo-operation',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { checkpointId } = (req.body ?? {}) as { checkpointId?: unknown };

    // Resetting mid-merge would leave the repository in a state the conflict
    // UI cannot describe.
    if (isMerging(repoPath) || isRebasing(repoPath)) {
      throw new HttpError(
        'Finish or abort the in-progress merge/rebase first (use the conflict banner).',
        400
      );
    }

    const checkpoint = findCheckpoint(repoPath, String(checkpointId));
    if (!checkpoint) {
      throw new HttpError(
        'Checkpoint not found (checkpoints reset when the app restarts).',
        404
      );
    }

    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['reset', '--hard', checkpoint.head])
    );

    consumeCheckpoint(repoPath, checkpoint.id);

    res.json({ success: true, stdout, stderr, restoredHead: checkpoint.head.substring(0, 8) });
  })
);

safetyNetRouter.get('/api/git/trash', (req, res) => {
  const repoPath = req.repoPath as string;
  const trashDir = repoTrashDir(repoPath);

  const entries = readTrashIndex(trashDir);
  const pruned = pruneTrash(entries);
  if (pruned.length !== entries.length) {
    writeTrashIndex(trashDir, pruned);
  }

  res.json({
    success: true,
    // trashFile is a server-side path the client has no use for.
    entries: pruned.map((entry) => ({
      id: entry.id,
      path: entry.path,
      savedAt: entry.savedAt
    }))
  });
});

safetyNetRouter.post(
  '/api/git/trash/restore',
  asyncRoute((req, res) => {
    const repoPath = req.repoPath as string;
    const { id } = (req.body ?? {}) as { id?: unknown };

    const trashDir = repoTrashDir(repoPath);
    const entries = readTrashIndex(trashDir);
    const entry = entries.find((candidate) => candidate.id === id);

    if (!entry) {
      throw new HttpError('Trash entry not found (entries expire after 24 hours).', 404);
    }
    if (!fs.existsSync(entry.trashFile)) {
      throw new HttpError('The saved copy is no longer available.', 404);
    }

    // The recorded path is restored, so it must still resolve inside the
    // repository even though it was validated when the snapshot was taken.
    const targetPath = resolveInsideRepo(repoPath, entry.path, { allowMissing: true });
    if (!targetPath) {
      throw new HttpError('Access denied: path is outside the repository', 403);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(entry.trashFile, targetPath);
    fs.unlinkSync(entry.trashFile);
    writeTrashIndex(
      trashDir,
      entries.filter((candidate) => candidate.id !== id)
    );

    res.json({ success: true, restoredPath: entry.path });
  })
);
