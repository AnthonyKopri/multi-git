import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

import { MAX_RECENT_REPOS, readConfig, writeConfig } from '../config/store';
import { sanitizeConfigForClient } from '../config/sanitize';
import { removeManagedBlock } from '../ssh/config-block';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { getVaultStatus, lockVault, unlockVault } from '../vault/vault';

export const configRouter: Router = Router();

/** Shared guard for the routes that take a repository path in the body. */
function requireExistingRepo(rawPath: unknown): string {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new HttpError('Repository path is required', 400);
  }

  const resolved = path.resolve(rawPath);
  if (!fs.existsSync(resolved)) {
    throw new HttpError('Directory does not exist', 400);
  }
  if (!fs.existsSync(path.join(resolved, '.git'))) {
    throw new HttpError('Not a valid Git repository (missing .git folder)', 400);
  }

  return resolved;
}

configRouter.get('/api/config', (_req, res) => {
  res.json(sanitizeConfigForClient(readConfig()));
});

configRouter.get('/api/secrets/status', (_req, res) => {
  res.json({ success: true, ...getVaultStatus() });
});

configRouter.post('/api/secrets/unlock', (req, res) => {
  const { masterKey } = (req.body ?? {}) as { masterKey?: unknown };

  if (typeof masterKey !== 'string' || masterKey === '') {
    res.status(400).json({ error: 'Master key is required' });
    return;
  }

  try {
    unlockVault(masterKey);
  } catch (error) {
    // 401, not 500: a wrong master key is a credential failure, not a fault.
    res.status(401).json({ error: (error as Error).message || 'Failed to unlock vault' });
    return;
  }

  res.json({ success: true, ...getVaultStatus() });
});

configRouter.post('/api/secrets/lock', (_req, res) => {
  lockVault();
  res.json({ success: true, ...getVaultStatus() });
});

configRouter.post(
  '/api/config/repo',
  asyncRoute((req, res) => {
    const resolvedPath = requireExistingRepo((req.body as { repoPath?: unknown })?.repoPath);
    const config = readConfig();

    // Move to front, de-duplicating any earlier entry.
    config.recentRepos = [
      resolvedPath,
      ...config.recentRepos.filter((entry) => entry !== resolvedPath)
    ].slice(0, MAX_RECENT_REPOS);

    writeConfig(config);
    res.json({ success: true, repoPath: resolvedPath, config: sanitizeConfigForClient(config) });
  })
);

configRouter.post(
  '/api/config/repo-settings',
  asyncRoute((req, res) => {
    const { repoPath, warnBeforeDelete } = (req.body ?? {}) as {
      repoPath?: unknown;
      warnBeforeDelete?: unknown;
    };
    const resolvedPath = requireExistingRepo(repoPath);

    const config = readConfig();
    config.repoSettings[resolvedPath] = {
      ...(config.repoSettings[resolvedPath] ?? {}),
      warnBeforeDelete: warnBeforeDelete !== false
    };
    writeConfig(config);

    res.json({
      success: true,
      repoPath: resolvedPath,
      repoSettings: config.repoSettings[resolvedPath]
    });
  })
);

configRouter.delete('/api/config/repo', (req, res) => {
  const { repoPath } = (req.body ?? {}) as { repoPath?: unknown };
  const config = readConfig();

  config.recentRepos = config.recentRepos.filter((entry) => entry !== repoPath);
  writeConfig(config);

  res.json({ success: true, config: sanitizeConfigForClient(config) });
});

configRouter.post('/api/config/settings', (req, res) => {
  const { manageSshConfig, removeManagedBlock: shouldRemoveBlock } = (req.body ?? {}) as {
    manageSshConfig?: unknown;
    removeManagedBlock?: unknown;
  };

  const config = readConfig();
  const enabled = manageSshConfig !== false;
  config.settings = { ...(config.settings ?? {}), manageSshConfig: enabled };

  let warning: string | null = null;
  if (!enabled && shouldRemoveBlock) {
    try {
      removeManagedBlock();
      config.sshConfigHosts = {};
    } catch (error) {
      warning = `Could not remove the managed block from ~/.ssh/config: ${(error as Error).message}`;
    }
  }

  writeConfig(config);
  res.json({ success: true, warning, config: sanitizeConfigForClient(config) });
});
