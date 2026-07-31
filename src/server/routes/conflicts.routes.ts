import fs from 'node:fs';
import { Router } from 'express';

import { pathArg, pathArgs } from '../git/args';
import { withRepoLock } from '../git/lock';
import { runGitCommand } from '../git/run';
import { parseConflictBlocks } from '../git/conflicts';
import { resolveInsideRepo } from '../fs/paths';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';

export const conflictsRouter: Router = Router();

conflictsRouter.use(requireRepoPath);

conflictsRouter.get(
  '/api/git/conflict/file',
  asyncRoute((req, res) => {
    const repoPath = req.repoPath as string;
    const safePath = pathArg(req.query['path']);

    const fullPath = resolveInsideRepo(repoPath, safePath);
    if (!fullPath) {
      throw new HttpError('Access denied: path is outside the repository', 403);
    }
    if (!fs.existsSync(fullPath)) {
      throw new HttpError('File not found', 404);
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({ success: true, rawContent: content, blocks: parseConflictBlocks(content) });
  })
);

conflictsRouter.post(
  '/api/git/conflict/resolve',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { filePath, resolvedContent } = (req.body ?? {}) as {
      filePath?: unknown;
      resolvedContent?: unknown;
    };

    if (resolvedContent === undefined || typeof resolvedContent !== 'string') {
      throw new HttpError(
        'Repository path, file path, and resolved content are required',
        400
      );
    }

    const safePath = pathArg(filePath);
    const fullPath = resolveInsideRepo(repoPath, safePath);
    if (!fullPath) {
      throw new HttpError('Access denied: path is outside the repository', 403);
    }

    fs.writeFileSync(fullPath, resolvedContent, 'utf8');

    // Staging a conflicted file is how git records it as resolved.
    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['add', ...pathArgs(safePath)])
    );

    res.json({ success: true, stdout, stderr });
  })
);
