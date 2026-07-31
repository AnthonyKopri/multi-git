import fs from 'node:fs';
import os from 'node:os';
import { Router } from 'express';

import { pathArg, pathArgs } from '../git/args';
import { runGitCommand } from '../git/run';
import { parseBlameOutput } from '../git/blame';
import { resolveInsideRepo } from '../fs/paths';
import { openPathInDefaultApp, pickFolderWithPowerShell } from '../os/reveal';
import { requireRepoPath, resolveNewRepoTarget } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';

/** Repository-scoped file reads. */
export const filesRouter: Router = Router();

/** Routes that do not target an existing repository. */
export const folderRouter: Router = Router();

filesRouter.use(requireRepoPath);

/**
 * Largest file the explorer will load into the browser.
 *
 * The previous implementation read any file whole and JSON-encoded it, so
 * opening a multi-gigabyte artifact would exhaust memory on the server and
 * then again in the renderer.
 */
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

/** Bytes inspected when deciding whether a file is binary. */
const BINARY_SNIFF_BYTES = 8192;

/** A NUL byte near the start is the same heuristic git itself uses. */
function looksBinary(fd: number, size: number): boolean {
  const length = Math.min(size, BINARY_SNIFF_BYTES);
  if (length === 0) {
    return false;
  }

  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, 0);
  return buffer.includes(0);
}

filesRouter.get(
  '/api/git/file/content',
  asyncRoute((req, res) => {
    const repoPath = req.repoPath as string;
    const safePath = pathArg(req.query['path']);

    const fullPath = resolveInsideRepo(repoPath, safePath);
    if (!fullPath) {
      throw new HttpError('Access denied: path is outside the repository', 403);
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(fullPath);
    } catch {
      throw new HttpError('File not found', 404);
    }

    if (stats.isDirectory()) {
      throw new HttpError('Path is a directory, not a file', 400);
    }

    const handle = fs.openSync(fullPath, 'r');
    try {
      if (looksBinary(handle, stats.size)) {
        res.json({ success: true, binary: true, size: stats.size, content: '' });
        return;
      }

      if (stats.size > MAX_TEXT_FILE_BYTES) {
        res.json({
          success: true,
          truncated: true,
          size: stats.size,
          content: fs.readFileSync(fullPath, 'utf8').slice(0, MAX_TEXT_FILE_BYTES)
        });
        return;
      }

      res.json({ success: true, content: fs.readFileSync(fullPath, 'utf8'), size: stats.size });
    } finally {
      fs.closeSync(handle);
    }
  })
);

filesRouter.get(
  '/api/git/file/blame',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const safePath = pathArg(req.query['path']);

    const { stdout } = await runGitCommand(repoPath, [
      'blame',
      '--date=short',
      ...pathArgs(safePath)
    ]);

    res.json({ success: true, blame: parseBlameOutput(stdout) });
  })
);

filesRouter.post(
  '/api/git/open-in-editor',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { filePath } = (req.body ?? {}) as { filePath?: unknown };

    const safePath = pathArg(filePath);
    if (/["]/.test(safePath)) {
      throw new HttpError('Invalid repository file path', 403);
    }

    // resolveInsideRepo resolves symlinks, so a link pointing out of the
    // repository cannot be used to launch an arbitrary file.
    const fullPath = resolveInsideRepo(repoPath, safePath);
    if (!fullPath) {
      throw new HttpError('Invalid repository file path', 403);
    }
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new HttpError('File not found', 404);
    }

    await openPathInDefaultApp(fullPath);
    res.json({ success: true, openedPath: fullPath });
  })
);

folderRouter.get(
  '/api/git/select-folder',
  asyncRoute(async (_req, res) => {
    // Desktop mode uses Electron's native dialog through the preload bridge.
    if (process.versions.electron || process.env['IS_ELECTRON'] === 'true') {
      throw new HttpError('Folder selection is handled by Electron in desktop mode', 400);
    }
    if (os.platform() !== 'win32') {
      throw new HttpError(
        'Folder selection endpoint is only available on Windows web mode',
        501
      );
    }

    res.json({ success: true, path: await pickFolderWithPowerShell() });
  })
);

folderRouter.post(
  '/api/git/init',
  asyncRoute(async (req, res) => {
    const resolved = resolveNewRepoTarget((req.body as { repoPath?: unknown })?.repoPath);

    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    if (fs.existsSync(`${resolved}/.git`)) {
      throw new HttpError('A Git repository already exists in this folder', 400);
    }

    await runGitCommand(resolved, ['init']);
    res.json({ success: true, message: 'Git repository initialized successfully' });
  })
);
