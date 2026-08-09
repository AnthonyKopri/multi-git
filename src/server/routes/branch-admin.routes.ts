// Branch housekeeping: the things you do to branches rather than with them.
//
// Kept apart from branches.routes.ts, which is the daily create/switch/delete
// path. Everything here answers "which of these forty branches can go", which
// is a different question and needs a different shape of data.
import { Router } from 'express';

import { refArg } from '../git/args';
import { withRepoLock } from '../git/lock';
import { runGitCommand, tryGitCommand } from '../git/run';
import { readConfig, writeConfig } from '../config/store';
import { canonicalRepoKey } from '../config/repo-identity';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';

export const branchAdminRouter: Router = Router();

branchAdminRouter.use(requireRepoPath);

/** A branch is stale when nothing has landed on it for this long. */
const STALE_AFTER_DAYS = 60;

const DETAIL_FORMAT = [
  '%(refname:short)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(objectname)',
  '%(committerdate:iso-strict)',
  '%(contents:subject)',
  '%(HEAD)'
].join('\x1f');

/** `[ahead 3, behind 1]` — git's own wording, which needs unpicking. */
function parseTracking(value: string): { ahead: number; behind: number; gone: boolean } {
  return {
    ahead: Number.parseInt(/ahead (\d+)/.exec(value)?.[1] ?? '0', 10) || 0,
    behind: Number.parseInt(/behind (\d+)/.exec(value)?.[1] ?? '0', 10) || 0,
    gone: value.includes('gone')
  };
}

function pinnedFor(repoPath: string): string[] {
  const key = canonicalRepoKey(repoPath);
  const pinned = readConfig().repoSettings[key]?.pinnedBranches;
  return Array.isArray(pinned) ? pinned : [];
}

/**
 * Every local branch with what you need to decide its fate: where it tracks,
 * how far it has diverged, whether it is already merged, and how long since
 * anyone touched it.
 */
branchAdminRouter.get(
  '/api/git/branches/details',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    const [listed, mergedInto] = await Promise.all([
      runGitCommand(repoPath, ['for-each-ref', 'refs/heads', `--format=${DETAIL_FORMAT}`]),
      // Branches already contained in HEAD: the safe-to-delete set.
      tryGitCommand(repoPath, ['branch', '--merged', 'HEAD', '--format=%(refname:short)'])
    ]);

    const merged = new Set(
      (mergedInto?.stdout ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );

    const pinned = new Set(pinnedFor(repoPath));
    const staleBefore = Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

    const branches = listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, upstream, track, oid, date, subject, headMarker] = line.split('\x1f');
        const tracking = parseTracking(track ?? '');
        const committedAt = Date.parse(date ?? '');

        return {
          name: name ?? '',
          upstream: upstream === '' ? null : (upstream ?? null),
          ahead: tracking.ahead,
          behind: tracking.behind,
          /** The upstream branch was deleted on the remote. */
          upstreamGone: tracking.gone,
          oid: oid ?? '',
          date: date ?? '',
          subject: subject ?? '',
          isCurrent: (headMarker ?? '').trim() === '*',
          merged: merged.has(name ?? ''),
          pinned: pinned.has(name ?? ''),
          stale: Number.isFinite(committedAt) && committedAt < staleBefore
        };
      });

    res.json({ success: true, branches, staleAfterDays: STALE_AFTER_DAYS });
  })
);

branchAdminRouter.post(
  '/api/git/branch/rename',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { from, to } = (req.body ?? {}) as { from?: unknown; to?: unknown };

    const safeFrom = refArg(from, 'Branch name');
    const safeTo = refArg(to, 'New branch name');

    // -m rather than -M: refusing to clobber an existing branch is the
    // behaviour a rename should have, and the UI has no "overwrite" story.
    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['branch', '-m', safeFrom, safeTo])
    );

    // A pin follows its branch, or it would point at a name that is gone.
    const key = canonicalRepoKey(repoPath);
    const config = readConfig();
    const pinned = config.repoSettings[key]?.pinnedBranches;
    if (Array.isArray(pinned) && pinned.includes(safeFrom)) {
      config.repoSettings[key] = {
        ...config.repoSettings[key],
        pinnedBranches: pinned.map((name) => (name === safeFrom ? safeTo : name))
      };
      writeConfig(config);
    }

    res.json({ success: true, from: safeFrom, to: safeTo, stdout, stderr });
  })
);

branchAdminRouter.post(
  '/api/git/branch/upstream',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { branch, upstream } = (req.body ?? {}) as { branch?: unknown; upstream?: unknown };

    const safeBranch = refArg(branch, 'Branch name');

    // An empty upstream means "stop tracking", which is a separate flag.
    if (upstream === null || upstream === '') {
      const { stdout, stderr } = await withRepoLock(repoPath, () =>
        runGitCommand(repoPath, ['branch', '--unset-upstream', safeBranch])
      );
      res.json({ success: true, branch: safeBranch, upstream: null, stdout, stderr });
      return;
    }

    const safeUpstream = refArg(upstream, 'Upstream branch');
    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['branch', `--set-upstream-to=${safeUpstream}`, safeBranch])
    );

    res.json({ success: true, branch: safeBranch, upstream: safeUpstream, stdout, stderr });
  })
);

/** Pins are the user's own ordering, so they live in config, not in git. */
branchAdminRouter.post(
  '/api/git/branch/pin',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { branch, pinned } = (req.body ?? {}) as { branch?: unknown; pinned?: unknown };

    const safeBranch = refArg(branch, 'Branch name');
    const key = canonicalRepoKey(repoPath);
    if (key === '') {
      throw new HttpError('This repository has no usable identity to store pins against.', 400);
    }

    const config = readConfig();
    const current = config.repoSettings[key]?.pinnedBranches ?? [];
    const next =
      pinned === false
        ? current.filter((name) => name !== safeBranch)
        : [...new Set([...current, safeBranch])];

    config.repoSettings[key] = { ...config.repoSettings[key], pinnedBranches: next };
    writeConfig(config);

    res.json({ success: true, pinnedBranches: next });
  })
);

// Pruning used to live here as `/api/git/remote/prune`, hardcoded to origin at
// the caller and with no recovery point. It is now `/api/remotes/prune` in
// remotes.routes.ts, which validates the remote name as a remote name rather
// than as a ref, pins the locale so the output it parses is stable, and
// captures a checkpoint first — a remote-tracking ref is the only local record
// that a branch existed once its remote is gone.

/** Deletes several branches, reporting each outcome rather than stopping. */
branchAdminRouter.post(
  '/api/git/branches/delete-many',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { branches, force } = (req.body ?? {}) as { branches?: unknown; force?: unknown };

    if (!Array.isArray(branches) || branches.length === 0) {
      throw new HttpError('At least one branch is required.', 400);
    }

    const names = branches.map((branch) => refArg(branch, 'Branch name'));

    await captureCheckpoint(repoPath, `Delete ${names.length} branch(es)`, {
      operation: 'branch-delete',
      refs: names.map((name) => `refs/heads/${name}`)
    });

    const results: { branch: string; deleted: boolean; error?: string }[] = [];

    for (const name of names) {
      try {
        await withRepoLock(repoPath, () =>
          runGitCommand(repoPath, ['branch', force ? '-D' : '-d', name])
        );
        results.push({ branch: name, deleted: true });
      } catch (error) {
        // One branch that will not go must not stop the other thirty-nine.
        results.push({
          branch: name,
          deleted: false,
          error: error instanceof Error ? error.message : 'Could not delete this branch'
        });
      }
    }

    res.json({
      success: true,
      results,
      deleted: results.filter((entry) => entry.deleted).length
    });
  })
);
