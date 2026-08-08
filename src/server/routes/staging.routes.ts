import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';

import { pathArg, pathArgs } from '../git/args';
import { withRepoLock } from '../git/lock';
import { GitError, runGitCommand, tryGitCommand } from '../git/run';
import { explainSigningFailure } from '../git/signing';
import { parseGitDiffText } from '../git/diff';
import { unquoteGitPath } from '../git/status';
import { resolveInsideRepo } from '../fs/paths';
import { saveToTrash } from '../safety-net/trash';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { isMerging, isRebasing } from './status.routes';
import type { DiffLine } from '../../shared/git-types';

export const stagingRouter: Router = Router();

stagingRouter.use(requireRepoPath);

stagingRouter.post(
  '/api/git/stage',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { files } = (req.body ?? {}) as { files?: unknown };

    if (!Array.isArray(files) || files.length === 0) {
      throw new HttpError('Files are required', 400);
    }

    // pathArgs inserts "--", without which a file named "-x" or "--all" would
    // be parsed by git as an option rather than a path.
    const args = ['add', ...pathArgs(files)];
    const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));

    res.json({ success: true, stdout, stderr });
  })
);

stagingRouter.post(
  '/api/git/unstage',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { files } = (req.body ?? {}) as { files?: unknown };

    if (!Array.isArray(files) || files.length === 0) {
      throw new HttpError('Files are required', 400);
    }

    // "." is the Unstage All sentinel: reset the whole index rather than
    // passing a pathspec.
    const args = files.includes('.')
      ? ['reset', 'HEAD']
      : ['reset', 'HEAD', ...pathArgs(files)];

    const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));

    res.json({ success: true, stdout, stderr });
  })
);

stagingRouter.post(
  '/api/git/ignore',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { filePath } = (req.body ?? {}) as { filePath?: unknown };

    const safePath = pathArg(filePath);
    const fullPath = resolveInsideRepo(repoPath, safePath);
    if (!fullPath) {
      throw new HttpError('Invalid repository file path', 403);
    }

    const relativePath = path.relative(repoPath, fullPath).replace(/\\/g, '/');
    if (relativePath === '.gitignore') {
      throw new HttpError('The repository .gitignore cannot ignore itself', 400);
    }

    const { stdout } = await runGitCommand(repoPath, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '--',
      relativePath
    ]);
    if (!stdout.trim()) {
      throw new HttpError('Only untracked files can be ignored', 400);
    }

    // Anchor the rule at the repository root and escape gitignore glob syntax
    // so clicking Ignore always targets this exact path.
    const escapedPath = relativePath
      .replace(/[\\*?[\]]/g, '\\$&')
      .replace(/ +$/g, (spaces) => spaces.replace(/ /g, '\\ '));
    const ignoreRule = `/${escapedPath}`;

    const ignoreFile = path.join(repoPath, '.gitignore');
    const current = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8') : '';

    if (!current.split(/\r?\n/).includes(ignoreRule)) {
      const separator = current.length > 0 && !current.endsWith('\n') ? os.EOL : '';
      fs.appendFileSync(ignoreFile, `${separator}${ignoreRule}${os.EOL}`, 'utf8');
    }

    res.json({ success: true, rule: ignoreRule });
  })
);

stagingRouter.post(
  '/api/git/discard',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { filePath, isUntracked } = (req.body ?? {}) as {
      filePath?: unknown;
      isUntracked?: unknown;
    };

    const safePath = pathArg(filePath);

    if (isUntracked) {
      const fullPath = resolveInsideRepo(repoPath, safePath);
      if (!fullPath) {
        throw new HttpError('Access denied: path is outside the repository', 403);
      }

      if (fs.existsSync(fullPath)) {
        // Snapshot before removing, so Safety Net can restore it.
        saveToTrash(repoPath, safePath);
        fs.unlinkSync(fullPath);
      }

      res.json({ success: true, message: 'Untracked file deleted' });
      return;
    }

    saveToTrash(repoPath, safePath);
    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['checkout', ...pathArgs(safePath)])
    );

    res.json({ success: true, stdout, stderr });
  })
);

stagingRouter.post(
  '/api/git/discard-all',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { deleteUntracked } = (req.body ?? {}) as { deleteUntracked?: unknown };

    // The file contents go to the trash below, which is what actually brings
    // a bulk discard back. The recovery point is the journal entry that says
    // it happened, and where HEAD was when it did.
    await captureCheckpoint(repoPath, 'Discard all working-tree changes', {
      operation: 'discard-all'
    });

    // Snapshot every file about to be touched into the recoverable trash.
    // Failing to snapshot must not block the discard the user asked for.
    const listing = await tryGitCommand(repoPath, [
      'ls-files',
      '-m',
      '-o',
      '--exclude-standard'
    ]);
    if (listing) {
      for (const line of listing.stdout.split('\n')) {
        const relativePath = unquoteGitPath(line);
        if (relativePath) {
          saveToTrash(repoPath, relativePath);
        }
      }
    } else {
      console.warn('Could not snapshot files before discard-all');
    }

    await withRepoLock(repoPath, async () => {
      // checkout fails in a repository with no commits yet; the clean step
      // should still run, so its failure is only fatal on its own.
      const checkout = await tryGitCommand(repoPath, ['checkout', '--', '.']);

      if (deleteUntracked) {
        await runGitCommand(repoPath, ['clean', '-fd']);
      } else if (!checkout) {
        throw new HttpError('Error discarding changes', 500);
      }
    });

    res.json({ success: true });
  })
);

stagingRouter.post(
  '/api/git/commit',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { message, amend, sign } = (req.body ?? {}) as {
      message?: unknown;
      amend?: unknown;
      sign?: unknown;
    };

    if (typeof message !== 'string' || message === '') {
      throw new HttpError('Commit message is required', 400);
    }

    // -m takes the message as a value, so it is never parsed as an option.
    const args = ['commit', '-m', message];
    if (amend) {
      args.push('--amend');
      // Amending replaces the commit; the one being replaced is only findable
      // afterwards through the reflog or this point.
      await captureCheckpoint(repoPath, 'Amend the last commit', { operation: 'amend' });
    }

    // Explicit true signs, explicit false overrides commit.gpgsign for this
    // one commit, and undefined leaves the repository's setting in charge.
    if (sign === true) {
      args.push('-S');
    } else if (sign === false) {
      args.push('--no-gpg-sign');
    }

    try {
      const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));
      res.json({ success: true, stdout, stderr });
    } catch (error) {
      // A refused signature leaves the changes staged, which is worth saying:
      // git's own message is one line about a subprocess.
      const explained =
        error instanceof GitError ? explainSigningFailure(error.stderr) : null;
      if (explained === null) {
        throw error;
      }
      throw new HttpError(explained, 400);
    }
  })
);

stagingRouter.get(
  '/api/git/last-commit-message',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    // Fails in a repository with no commits, which is not an error.
    const result = await tryGitCommand(repoPath, ['log', '-1', '--pretty=%B']);
    res.json({ success: true, message: result?.stdout.replace(/\r?\n+$/, '') ?? '' });
  })
);

stagingRouter.post(
  '/api/git/undo-commit',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    if (isMerging(repoPath) || isRebasing(repoPath)) {
      throw new HttpError('Cannot undo a commit while a merge or rebase is in progress.', 400);
    }

    const hasParent = (await tryGitCommand(repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD~1'])) !== null;

    const result = await withRepoLock(repoPath, async () => {
      if (hasParent) {
        await captureCheckpoint(repoPath, 'Undo last commit', { operation: 'undo-commit' });
        return runGitCommand(repoPath, ['reset', '--soft', 'HEAD~1']);
      }

      // Root commit: deleting the HEAD ref un-commits it while keeping the
      // index, which matches soft-reset semantics.
      return runGitCommand(repoPath, ['update-ref', '-d', 'HEAD']);
    });

    res.json({ success: true, stdout: result.stdout, stderr: result.stderr });
  })
);

stagingRouter.get(
  '/api/git/diff',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const safePath = pathArg(req.query['path']);
    const isStaged = req.query['staged'] === 'true';
    const isUntracked = req.query['untracked'] === 'true';

    if (isUntracked) {
      // An untracked file has no pre-image, so every line is an addition.
      const fullPath = resolveInsideRepo(repoPath, safePath);
      if (!fullPath) {
        throw new HttpError('Access denied: path is outside the repository', 403);
      }
      if (!fs.existsSync(fullPath)) {
        throw new HttpError('File not found', 404);
      }

      const diff: DiffLine[] = fs
        .readFileSync(fullPath, 'utf8')
        .split(/\r?\n/)
        .map((content, index) => ({
          type: 'addition',
          content,
          oldLine: null,
          newLine: index + 1
        }));

      res.json({ success: true, diff });
      return;
    }

    const args = ['diff'];
    if (isStaged) {
      args.push('--cached');
    }
    args.push(...pathArgs(safePath));

    const { stdout } = await runGitCommand(repoPath, args);
    res.json({ success: true, diff: parseGitDiffText(stdout) });
  })
);
