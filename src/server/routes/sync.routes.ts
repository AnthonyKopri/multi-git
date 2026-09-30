import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

import { refArg } from '../git/args';
import { withRepoLock } from '../git/lock';
import { GitError, buildSshCommand, runGitCommand } from '../git/run';
import type { GitCommandOptions } from '../git/run';
import { getToggledRemoteUrl, isLikelyHttpRemote, parseRemoteUrl } from '../git/remote';
import { updateRemote } from '../git/remotes';
import { getOriginRemoteUrl, runSyncOperationWithProfile } from '../ssh/profiles';
import { createAskpassBridge } from '../ssh/askpass';
import { readConfig } from '../config/store';
import { operations } from '../operations/registry';
import { CloneProgressTracker, withoutGitProgress } from '../../shared/git-progress';
import { getStoredPassphrase, hasStoredPassphrase, isUnlocked } from '../vault/vault';
import { requireRepoPath } from '../middleware/repo-path';
import { ensureAgentForRepo } from '../ssh/agent-session';
import { asOperation } from '../operations/as-operation';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { fetchWithAutoPull } from '../workflows/sync';

/** Routes that operate on an existing repository. */
export const syncRouter: Router = Router();

/** Clone has no repository yet, so it cannot use requireRepoPath. */
export const cloneRouter: Router = Router();

syncRouter.use(requireRepoPath);

/**
 * A fetch that may fast-forward afterwards, when auto-pull is on and nothing
 * stands in the way. The plain fetch below is kept as it was, because agents
 * and scripts rely on a fetch never moving a branch.
 */
syncRouter.post(
  '/api/workflows/fetch',
  asyncRoute(async (req, res) => {
    const { profileId, sshKeyPath } = profileArgs(req.body);
    res.json({
      success: true,
      ...(await fetchWithAutoPull(req.repoPath as string, profileId, sshKeyPath))
    });
  })
);

/**
 * Gets the repository's key into the native agent before a network call.
 *
 * Best effort, and deliberately not awaited for its result: a push must not be
 * blocked because the agent could not be repaired. The per-command
 * GIT_SSH_COMMAND fallback still authenticates in-app operations, so a
 * degraded agent degrades external tooling rather than this.
 */
async function preflightAgent(repoPath: string, profileId: string | undefined): Promise<void> {
  await ensureAgentForRepo(repoPath, profileId);
}

async function currentBranch(repoPath: string): Promise<string> {
  const { stdout } = await runGitCommand(repoPath, ['branch', '--show-current']);
  return stdout.trim();
}

function profileArgs(body: unknown): { profileId?: string; sshKeyPath?: string } {
  const { profileId, sshKeyPath } = (body ?? {}) as Record<string, unknown>;
  return {
    ...(typeof profileId === 'string' ? { profileId } : {}),
    ...(typeof sshKeyPath === 'string' ? { sshKeyPath } : {})
  };
}

syncRouter.post(
  '/api/git/push',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { branch, force } = (req.body ?? {}) as { branch?: unknown; force?: unknown };
    const { profileId, sshKeyPath } = profileArgs(req.body);

    const targetBranch = branch ? refArg(branch, 'Branch name') : await currentBranch(repoPath);

    await preflightAgent(repoPath, profileId);

    const pushArgs = ['push', '-u'];
    if (force) {
      // A lease overwrites the remote only if it still matches our
      // remote-tracking ref, so a colleague's push is never silently lost.
      pushArgs.push('--force-with-lease');
    }
    pushArgs.push('origin', targetBranch);

    const result = await asOperation('git.push', repoPath, `Pushing ${targetBranch}`, (signal) =>
      withRepoLock(repoPath, () =>
        runSyncOperationWithProfile(repoPath, pushArgs, profileId, sshKeyPath, { signal })
      )
    );

    res.json({ success: true, ...result });
  })
);

syncRouter.post(
  '/api/git/pull',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { branch } = (req.body ?? {}) as { branch?: unknown };
    const { profileId, sshKeyPath } = profileArgs(req.body);

    const targetBranch = branch ? refArg(branch, 'Branch name') : await currentBranch(repoPath);

    await preflightAgent(repoPath, profileId);

    const result = await asOperation('git.pull', repoPath, `Pulling ${targetBranch}`, (signal) =>
      withRepoLock(repoPath, () =>
        runSyncOperationWithProfile(
          repoPath,
          ['pull', 'origin', targetBranch],
          profileId,
          sshKeyPath,
          { signal }
        )
      )
    );

    res.json({ success: true, ...result });
  })
);

syncRouter.post(
  '/api/git/fetch',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { profileId, sshKeyPath } = profileArgs(req.body);

    await preflightAgent(repoPath, profileId);

    // --prune drops remote-tracking refs whose branches were deleted upstream.
    const result = await asOperation('git.fetch', repoPath, 'Fetching origin', (signal) =>
      runSyncOperationWithProfile(repoPath, ['fetch', '--prune', 'origin'], profileId, sshKeyPath, {
        signal
      })
    );

    res.json({ success: true, ...result });
  })
);

syncRouter.get(
  '/api/git/remote/origin',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const remoteUrl = await getOriginRemoteUrl(repoPath);

    if (!remoteUrl) {
      throw new HttpError('Origin remote not found.', 404);
    }

    const parsed = parseRemoteUrl(remoteUrl);
    const suggestedUrl = getToggledRemoteUrl(remoteUrl);

    res.json({
      success: true,
      remoteUrl,
      protocol: parsed?.protocol ?? 'other',
      host: parsed?.host ?? null,
      canToggle: Boolean(suggestedUrl),
      suggestedUrl
    });
  })
);

syncRouter.post(
  '/api/git/remote/origin/toggle-protocol',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const remoteUrl = await getOriginRemoteUrl(repoPath);

    if (!remoteUrl) {
      throw new HttpError('Origin remote not found.', 404);
    }

    const toggledUrl = getToggledRemoteUrl(remoteUrl);
    if (!toggledUrl) {
      throw new HttpError(
        'Origin remote URL cannot be converted automatically. Update the remote manually for this repository.',
        400
      );
    }

    // Through the remote editor's own update path rather than a `set-url` of
    // its own. The pill stays a one-click shortcut, but there is one place that
    // decides what a valid remote URL is, and one place that takes the
    // repository lock to change one.
    await withRepoLock(repoPath, () =>
      updateRemote(repoPath, { name: 'origin', fetchUrl: toggledUrl })
    );

    res.json({
      success: true,
      remoteUrl: toggledUrl,
      protocol: parseRemoteUrl(toggledUrl)?.protocol ?? 'other'
    });
  })
);

/** Falls back to the last path segment of the clone URL. */
function deriveRepoNameFromUrl(url: string): string {
  const trimmed = String(url).trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const lastSegment = trimmed.split(/[/:]/).pop() ?? '';
  const safe = lastSegment.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return safe || 'repository';
}

/**
 * The id a caller may choose for the operation that tracks its clone.
 *
 * Only so that the renderer can find its own clone on the event stream while the
 * request is still open. Anything that does not look like an id is dropped, and
 * the registry picks one instead.
 */
function requestedOperationId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : undefined;
}

/**
 * How large the caller says the download will be, if that is believable.
 *
 * Only ever used to improve the time estimate, so a value that makes no sense
 * is ignored rather than rejected: the clone is not worth failing over it.
 */
function requestedExpectedBytes(value: unknown): number | undefined {
  const ONE_TIB = 1024 ** 4;
  return typeof value === 'number' && Number.isFinite(value) && value >= 1024 && value <= ONE_TIB
    ? value
    : undefined;
}

/** How often a running clone's time estimate is worked out again. */
const PROGRESS_REFRESH_MS = 1000;

cloneRouter.post(
  '/api/git/clone',
  asyncRoute(async (req, res) => {
    const { url, parentDir, folderName, profileId, operationId, expectedBytes } = (req.body ?? {}) as Record<
      string,
      unknown
    >;

    const cloneUrl = typeof url === 'string' ? url.trim() : '';
    if (!cloneUrl) {
      throw new HttpError('Repository URL is required.', 400);
    }
    if (typeof parentDir !== 'string' || parentDir === '') {
      throw new HttpError('Destination folder is required.', 400);
    }

    const resolvedParent = path.resolve(parentDir);
    if (!fs.existsSync(resolvedParent) || !fs.statSync(resolvedParent).isDirectory()) {
      throw new HttpError(`Destination folder not found: ${resolvedParent}`, 400);
    }

    const safeFolder =
      typeof folderName === 'string' && folderName.trim()
        ? folderName.trim()
        : deriveRepoNameFromUrl(cloneUrl);

    if (!/^[a-zA-Z0-9._ -]+$/.test(safeFolder)) {
      throw new HttpError(
        'Folder name may only contain letters, numbers, spaces, dot, underscore, and dash.',
        400
      );
    }

    const destPath = path.join(resolvedParent, safeFolder);
    if (fs.existsSync(destPath) && fs.readdirSync(destPath).length > 0) {
      throw new HttpError(`Destination already exists and is not empty: ${destPath}`, 400);
    }

    const config = readConfig();
    let selectedProfile = null;

    if (profileId) {
      selectedProfile = config.sshProfiles.find((profile) => profile.id === profileId) ?? null;
      if (!selectedProfile) {
        throw new HttpError('Selected SSH profile was not found.', 400);
      }
      if (isLikelyHttpRemote(cloneUrl)) {
        throw new HttpError(
          'SSH profiles only apply to SSH URLs (git@host:owner/repo.git). Use an SSH URL or clone without a profile.',
          400
        );
      }
      if (hasStoredPassphrase(selectedProfile.id) && !isUnlocked()) {
        throw new HttpError(
          'Vault is locked. Unlock the vault to use the saved passphrase for this SSH profile.',
          400
        );
      }
    }

    let bridge: ReturnType<typeof createAskpassBridge> | null = null;
    let refresher: NodeJS.Timeout | null = null;
    // Tracked so the renderer can draw progress and the operations bar can show
    // it. Not cancellable: a killed clone leaves a half-written folder behind
    // that git would have cleaned up itself, and the next attempt would then be
    // refused for cloning into a folder that is not empty.
    const requestedId = requestedOperationId(operationId);
    const operation = operations.begin({
      ...(requestedId ? { id: requestedId } : {}),
      kind: 'git.clone',
      repoPath: destPath,
      message: `Cloning ${safeFolder}`,
      cancellable: false
    });
    operation.start();

    try {
      // "--" before the URL: a clone URL beginning with "-" would otherwise
      // be read as an option. --progress because git only reports progress to a
      // terminal, and stderr here is a pipe.
      const gitArgs = ['clone', '--progress', '--', cloneUrl, destPath];
      const requestedBytes = requestedExpectedBytes(expectedBytes);
      const tracker = new CloneProgressTracker({
        ...(requestedBytes !== undefined ? { expectedBytes: requestedBytes } : {})
      });
      const options: GitCommandOptions = {
        // Cloning a large repository over a slow link can legitimately take
        // much longer than an ordinary command.
        timeoutMs: 30 * 60 * 1000,
        // English, because the progress lines are read by their wording and a
        // localised git would print them in another language.
        envOverrides: { LC_ALL: 'C', LANG: 'C' },
        onStderr: (text) => {
          const snapshot = tracker.push(text);
          if (snapshot) {
            operation.update(snapshot);
          }
        }
      };

      if (selectedProfile) {
        options.customSshCommand = buildSshCommand(selectedProfile.privateKeyPath);

        const storedPassphrase = isUnlocked() ? getStoredPassphrase(selectedProfile.id) : null;
        if (storedPassphrase) {
          bridge = createAskpassBridge(storedPassphrase);
          options.envOverrides = { ...options.envOverrides, ...bridge.envOverrides };
        }
      }

      // Git only writes a progress line when an object arrives, so a stalled
      // connection goes silent. Re-reading the estimate on a timer is what lets
      // it lengthen then, instead of sitting on the last figure it was given.
      refresher = setInterval(() => {
        const snapshot = tracker.refresh();
        if (snapshot) {
          operation.update(snapshot);
        }
      }, PROGRESS_REFRESH_MS);
      refresher.unref();

      const { stdout, stderr } = await runGitCommand(resolvedParent, gitArgs, null, options);

      operation.succeed(`Cloned ${safeFolder}`);

      res.json({
        success: true,
        stdout,
        stderr: withoutGitProgress(stderr),
        repoPath: destPath,
        profileLabel: selectedProfile?.label ?? null
      });
    } catch (error) {
      operation.fail(error instanceof Error ? error.message : 'Clone failed');
      // The message a failed clone shows is git's stderr, and with progress on
      // that is thousands of redraws around the one line that says what went
      // wrong. Same tidying as a success gets.
      throw error instanceof GitError
        ? new GitError(error.message, {
            stdout: error.stdout,
            stderr: withoutGitProgress(error.stderr),
            exitCode: error.exitCode,
            statusCode: error.statusCode
          })
        : error;
    } finally {
      if (refresher) {
        clearInterval(refresher);
      }
      bridge?.cleanup();
    }
  })
);
