import { Router } from 'express';

import { commitish, pathArg, pathArgs } from '../git/args';
import { withRepoLock } from '../git/lock';
import { GitError, runGitCommand, tryGitCommand } from '../git/run';
import { parseGitDiffText } from '../git/diff';
import { unquoteGitPath } from '../git/status';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import type { CommitFile } from '../../shared/git-types';

export const historyRouter: Router = Router();

historyRouter.use(requireRepoPath);

historyRouter.get(
  '/api/git/commit/details',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const hash = commitish(req.query['hash']);

    // "git show --name-status" also covers root and merge commits, which
    // "diff-tree --no-commit-id" reports as empty.
    const filesOut = await runGitCommand(repoPath, ['show', hash, '--name-status', '--format=']);

    const files: CommitFile[] = filesOut.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        return {
          status: (parts[0] ?? '')[0] ?? 'M',
          // Renames and copies produce "R100\told\tnew"; show the new path.
          path: unquoteGitPath(parts.length > 2 ? (parts[2] ?? '') : (parts[1] ?? ''))
        };
      });

    const infoOut = await runGitCommand(repoPath, [
      'show',
      '--quiet',
      '--pretty=format:%H\x1f%an\x1f%ae\x1f%ad\x1f%s',
      hash
    ]);
    const [commitHash, author, email, date, message] = infoOut.stdout.trim().split('\x1f');

    res.json({
      success: true,
      commit: {
        hash: commitHash ?? '',
        author: author ?? '',
        email: email ?? '',
        date: date ?? '',
        message: message ?? ''
      },
      files
    });
  })
);

historyRouter.get(
  '/api/git/commit/diff',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const hash = commitish(req.query['hash']);
    const safePath = pathArg(req.query['path']);

    const { stdout } = await runGitCommand(repoPath, ['show', hash, ...pathArgs(safePath)]);
    res.json({ success: true, diff: parseGitDiffText(stdout) });
  })
);

historyRouter.get(
  '/api/git/file/history',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const safePath = pathArg(req.query['path']);

    const { stdout } = await runGitCommand(repoPath, [
      'log',
      '-n',
      '50',
      '--follow',
      '--pretty=format:%H\x1f%an\x1f%ad\x1f%s',
      '--date=relative',
      ...pathArgs(safePath)
    ]);

    const commits =
      stdout.trim() === ''
        ? []
        : stdout.split('\n').map((line) => {
            const [hash, author, date, message] = line.split('\x1f');
            return {
              hash: hash ?? '',
              author: author ?? '',
              date: date ?? '',
              message: message ?? ''
            };
          });

    res.json({ success: true, commits });
  })
);

/**
 * Cherry-pick and revert report conflicts as a 200 with success:false, the
 * same shape merge and rebase use, because the UI treats them identically.
 */
async function runHistoryOperation(
  repoPath: string,
  args: readonly string[],
  label: string,
  fallbackMessage: string
): Promise<{ success: boolean; conflict?: boolean; error?: string; stdout?: string; stderr?: string }> {
  await captureCheckpoint(repoPath, label);

  try {
    const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));
    return { success: true, stdout, stderr };
  } catch (error) {
    return {
      success: false,
      conflict: true,
      error: error instanceof GitError ? error.displayMessage : fallbackMessage
    };
  }
}

historyRouter.post(
  '/api/git/cherry-pick',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const hash = commitish((req.body as { hash?: unknown })?.hash);

    res.json(
      await runHistoryOperation(
        repoPath,
        ['cherry-pick', hash],
        `Cherry-pick ${hash.substring(0, 8)}`,
        'Cherry-pick failed'
      )
    );
  })
);

historyRouter.post(
  '/api/git/revert',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const hash = commitish((req.body as { hash?: unknown })?.hash);

    res.json(
      await runHistoryOperation(
        repoPath,
        // --no-edit stops git from opening an editor, which would hang.
        ['revert', '--no-edit', hash],
        `Revert ${hash.substring(0, 8)}`,
        'Revert failed'
      )
    );
  })
);

historyRouter.post(
  '/api/git/reset',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { hash, mode } = (req.body ?? {}) as { hash?: unknown; mode?: unknown };

    const safeHash = commitish(hash);
    if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
      throw new HttpError('Reset mode must be soft, mixed, or hard', 400);
    }

    await captureCheckpoint(repoPath, `Reset (${mode}) to ${safeHash.substring(0, 8)}`);
    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['reset', `--${mode}`, safeHash])
    );

    res.json({ success: true, stdout, stderr });
  })
);

historyRouter.get(
  '/api/git/tags',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    const result = await tryGitCommand(repoPath, [
      'for-each-ref',
      'refs/tags',
      '--sort=-creatordate',
      '--format=%(refname:short)\x1f%(objectname:short)\x1f%(creatordate:relative)'
    ]);

    const tags = (result?.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, hash, date] = line.split('\x1f');
        return { name: name ?? '', hash: hash ?? '', date: date ?? '' };
      });

    res.json({ success: true, tags });
  })
);
