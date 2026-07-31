import { Router } from 'express';

import { refArg } from '../git/args';
import { withRepoLock } from '../git/lock';
import { GitError, runGitCommand, tryGitCommand } from '../git/run';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { requireRepoPath } from '../middleware/repo-path';
import { asyncRoute } from '../middleware/error-handler';

export const branchesRouter: Router = Router();

branchesRouter.use(requireRepoPath);

branchesRouter.get(
  '/api/git/branches',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    // Full refnames disambiguate local from remote. "%(refname:short)" drops
    // the refs/remotes/ prefix, which made every branch look local.
    const { stdout } = await runGitCommand(repoPath, [
      'for-each-ref',
      'refs/heads',
      'refs/remotes',
      '--format=%(refname)'
    ]);

    const local: string[] = [];
    const remote: string[] = [];

    for (const line of stdout.split('\n')) {
      const ref = line.trim();
      if (ref.startsWith('refs/heads/')) {
        local.push(ref.substring('refs/heads/'.length));
      } else if (ref.startsWith('refs/remotes/')) {
        const name = ref.substring('refs/remotes/'.length);
        // Skip symbolic pointers such as origin/HEAD.
        if (!/\/HEAD$/.test(name)) {
          remote.push(name);
        }
      }
    }

    res.json({ success: true, local, remote });
  })
);

branchesRouter.post(
  '/api/git/checkout',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { branch, isRemote } = (req.body ?? {}) as { branch?: unknown; isRemote?: unknown };

    const safeBranch = refArg(branch, 'Branch name');
    const args = ['checkout'];

    if (isRemote) {
      // origin/feature -> feature
      const baseName = refArg(
        safeBranch.substring(safeBranch.indexOf('/') + 1),
        'Branch name'
      );

      const localExists =
        (await tryGitCommand(repoPath, [
          'rev-parse',
          '--verify',
          '--quiet',
          `refs/heads/${baseName}`
        ])) !== null;

      if (localExists) {
        args.push(baseName);
      } else {
        args.push('-b', baseName, '--track', safeBranch);
      }
    } else {
      args.push(safeBranch);
    }

    const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));
    res.json({ success: true, stdout, stderr });
  })
);

branchesRouter.post(
  '/api/git/create-branch',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { branchName } = (req.body ?? {}) as { branchName?: unknown };

    const safeBranch = refArg(branchName, 'Branch name');
    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['checkout', '-b', safeBranch])
    );

    res.json({ success: true, stdout, stderr });
  })
);

branchesRouter.post(
  '/api/git/delete-branch',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { branch, force } = (req.body ?? {}) as { branch?: unknown; force?: unknown };

    const safeBranch = refArg(branch, 'Branch name');

    try {
      const { stdout, stderr } = await withRepoLock(repoPath, () =>
        runGitCommand(repoPath, ['branch', force ? '-D' : '-d', safeBranch])
      );
      res.json({ success: true, stdout, stderr });
    } catch (error) {
      const errorText =
        error instanceof GitError ? error.displayMessage : 'Error deleting branch';

      // The UI offers a force-delete follow-up when this flag is set, so this
      // route answers by hand rather than through the error middleware.
      res.status(500).json({
        error: errorText,
        notFullyMerged: /not fully merged/i.test(errorText)
      });
    }
  })
);

/** Merge and rebase report conflicts as a 200 with success:false, not an error. */
async function runIntegration(
  repoPath: string,
  args: readonly string[],
  label: string,
  conflictMessage: string
): Promise<{ success: boolean; conflict?: boolean; error?: string; stdout?: string; stderr?: string }> {
  await captureCheckpoint(repoPath, label);

  try {
    const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));
    return { success: true, stdout, stderr };
  } catch (error) {
    // Exit code 1 here usually means conflicts, which is a workflow state the
    // UI handles rather than a failure to report.
    return {
      success: false,
      conflict: true,
      error: error instanceof GitError ? error.displayMessage : conflictMessage
    };
  }
}

branchesRouter.post(
  '/api/git/merge',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const safeBranch = refArg((req.body as { branch?: unknown })?.branch, 'Branch name');

    res.json(
      await runIntegration(
        repoPath,
        ['merge', safeBranch],
        `Merge ${safeBranch}`,
        'Merge conflict occurred'
      )
    );
  })
);

branchesRouter.post(
  '/api/git/rebase',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const safeBranch = refArg((req.body as { branch?: unknown })?.branch, 'Branch name');

    res.json(
      await runIntegration(
        repoPath,
        ['rebase', safeBranch],
        `Rebase onto ${safeBranch}`,
        'Rebase conflict occurred'
      )
    );
  })
);

branchesRouter.post(
  '/api/git/abort',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { type } = (req.body ?? {}) as { type?: unknown };

    const args = type === 'rebase' ? ['rebase', '--abort'] : ['merge', '--abort'];
    const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));

    res.json({ success: true, stdout, stderr });
  })
);

branchesRouter.post(
  '/api/git/conflict/continue',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { type } = (req.body ?? {}) as { type?: unknown };

    const result = await withRepoLock(repoPath, () => {
      if (type === 'rebase') {
        // GIT_EDITOR=true stops rebase --continue from opening an editor for
        // the commit message, which would hang the request forever.
        return runGitCommand(repoPath, ['rebase', '--continue'], null, {
          envOverrides: { GIT_EDITOR: 'true' }
        });
      }

      // Completing a merge means committing; --no-edit takes git's generated
      // merge message.
      return runGitCommand(repoPath, ['commit', '--no-edit']);
    });

    res.json({ success: true, stdout: result.stdout, stderr: result.stderr });
  })
);
