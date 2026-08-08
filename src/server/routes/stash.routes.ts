import { Router } from 'express';

import { withRepoLock } from '../git/lock';
import { runGitCommand, tryGitCommand } from '../git/run';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';

export const stashRouter: Router = Router();

stashRouter.use(requireRepoPath);

/** `stash@{N}` is the only shape git accepts, and the only one this allows. */
function stashRef(value: unknown): string {
  if (typeof value !== 'string' || !/^stash@\{\d+\}$/.test(value)) {
    throw new HttpError('A valid stash reference (stash@{n}) is required', 400);
  }
  return value;
}

stashRouter.get(
  '/api/git/stash',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    // Fails when there is no stash ref yet, which is the normal empty state.
    const result = await tryGitCommand(repoPath, [
      'stash',
      'list',
      '--format=%gd\x1f%s\x1f%cr'
    ]);

    const stashes = (result?.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ref, message, date] = line.split('\x1f');
        return { ref: ref ?? '', message: message ?? '', date: date ?? '' };
      });

    res.json({ success: true, stashes });
  })
);

stashRouter.post(
  '/api/git/stash',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { message, includeUntracked } = (req.body ?? {}) as {
      message?: unknown;
      includeUntracked?: unknown;
    };

    const args = ['stash', 'push'];
    if (includeUntracked) {
      args.push('-u');
    }
    if (typeof message === 'string' && message !== '') {
      // -m takes the message as a value, so it is never read as an option.
      args.push('-m', message);
    }

    const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));
    res.json({ success: true, stdout, stderr });
  })
);

stashRouter.post(
  '/api/git/stash/apply',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { ref, pop } = (req.body ?? {}) as { ref?: unknown; pop?: unknown };

    const safeRef = stashRef(ref);
    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['stash', pop ? 'pop' : 'apply', safeRef])
    );

    res.json({ success: true, stdout, stderr });
  })
);

stashRouter.post(
  '/api/git/stash/drop',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const safeRef = stashRef((req.body as { ref?: unknown })?.ref);

    // A dropped stash leaves no reflog trail of its own, so its commit is the
    // one thing worth recording: `git stash store` or `git branch` can bring
    // it back for as long as git keeps unreachable objects.
    const resolved = await tryGitCommand(repoPath, ['rev-parse', safeRef]);
    const stashOid = resolved?.stdout.trim();

    await captureCheckpoint(repoPath, `Drop ${safeRef}`, {
      operation: 'stash-drop',
      ...(stashOid ? { stashRef: stashOid } : {})
    });

    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['stash', 'drop', safeRef])
    );

    res.json({ success: true, stdout, stderr, droppedCommit: stashOid ?? null });
  })
);
