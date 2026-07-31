import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

import { refArg } from '../git/args';
import { withRepoLock } from '../git/lock';
import { buildSshCommand, runGitCommand } from '../git/run';
import type { GitCommandOptions } from '../git/run';
import { getToggledRemoteUrl, isLikelyHttpRemote, parseRemoteUrl } from '../git/remote';
import { getOriginRemoteUrl, runSyncOperationWithProfile } from '../ssh/profiles';
import { createAskpassBridge } from '../ssh/askpass';
import { readConfig } from '../config/store';
import { getStoredPassphrase, hasStoredPassphrase, isUnlocked } from '../vault/vault';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';

/** Routes that operate on an existing repository. */
export const syncRouter: Router = Router();

/** Clone has no repository yet, so it cannot use requireRepoPath. */
export const cloneRouter: Router = Router();

syncRouter.use(requireRepoPath);

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

    const pushArgs = ['push', '-u'];
    if (force) {
      // A lease overwrites the remote only if it still matches our
      // remote-tracking ref, so a colleague's push is never silently lost.
      pushArgs.push('--force-with-lease');
    }
    pushArgs.push('origin', targetBranch);

    const result = await withRepoLock(repoPath, () =>
      runSyncOperationWithProfile(repoPath, pushArgs, profileId, sshKeyPath)
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

    const result = await withRepoLock(repoPath, () =>
      runSyncOperationWithProfile(repoPath, ['pull', 'origin', targetBranch], profileId, sshKeyPath)
    );

    res.json({ success: true, ...result });
  })
);

syncRouter.post(
  '/api/git/fetch',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { profileId, sshKeyPath } = profileArgs(req.body);

    // --prune drops remote-tracking refs whose branches were deleted upstream.
    const result = await runSyncOperationWithProfile(
      repoPath,
      ['fetch', '--prune', 'origin'],
      profileId,
      sshKeyPath
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

    await runGitCommand(repoPath, ['remote', 'set-url', 'origin', toggledUrl]);

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

cloneRouter.post(
  '/api/git/clone',
  asyncRoute(async (req, res) => {
    const { url, parentDir, folderName, profileId } = (req.body ?? {}) as Record<string, unknown>;

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
    try {
      // "--" before the URL: a clone URL beginning with "-" would otherwise
      // be read as an option.
      const gitArgs = ['clone', '--', cloneUrl, destPath];
      // Cloning a large repository over a slow link can legitimately take
      // much longer than an ordinary command.
      const options: GitCommandOptions = { timeoutMs: 30 * 60 * 1000 };

      if (selectedProfile) {
        options.customSshCommand = buildSshCommand(selectedProfile.privateKeyPath);

        const storedPassphrase = isUnlocked() ? getStoredPassphrase(selectedProfile.id) : null;
        if (storedPassphrase) {
          bridge = createAskpassBridge(storedPassphrase);
          options.envOverrides = bridge.envOverrides;
        }
      }

      const { stdout, stderr } = await runGitCommand(resolvedParent, gitArgs, null, options);

      res.json({
        success: true,
        stdout,
        stderr,
        repoPath: destPath,
        profileLabel: selectedProfile?.label ?? null
      });
    } finally {
      bridge?.cleanup();
    }
  })
);
