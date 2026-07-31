import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';

import { readConfig, writeConfig, isSshConfigManagementEnabled } from '../config/store';
import { sanitizeConfigForClient } from '../config/sanitize';
import { syncSshConfigForHost } from '../ssh/config-sync';
import { deriveOriginHost } from '../ssh/profiles';
import {
  buildUniqueKeyBaseName,
  generateSshKeyPair,
  isPermittedKeyPath,
  normalizeSshPath,
  sanitizeLabelForKeyName,
  sshDirectory,
  validateSshKeyPair
} from '../ssh/keys';
import type { SshKeyType } from '../ssh/keys';
import { openPathInFileExplorer } from '../os/reveal';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import {
  getStoredPassphrase,
  isUnlocked,
  removeStoredPassphrase,
  setStoredPassphrase
} from '../vault/vault';
import type { SshProfile } from '../../shared/config-types';

export const sshRouter: Router = Router();

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

sshRouter.post(
  '/api/config/ssh',
  asyncRoute((req, res) => {
    const { id, label, privateKeyPath, keepPassword, passphrase, userName, userEmail } =
      (req.body ?? {}) as Record<string, unknown>;

    if (!label || !privateKeyPath || typeof privateKeyPath !== 'string') {
      throw new HttpError('Label and Private Key Path are required', 400);
    }

    const resolvedKeyPath = normalizeSshPath(privateKeyPath);
    if (!fs.existsSync(resolvedKeyPath)) {
      throw new HttpError(`Private Key file not found at: ${resolvedKeyPath}`, 400);
    }

    const config = readConfig();
    const profileId = typeof id === 'string' && id ? id : Date.now().toString();
    const profile: SshProfile = {
      id: profileId,
      label: String(label),
      privateKeyPath: resolvedKeyPath,
      userName: trimmed(userName),
      userEmail: trimmed(userEmail)
    };

    const index = config.sshProfiles.findIndex((entry) => entry.id === profileId);
    if (index >= 0) {
      config.sshProfiles[index] = profile;
    } else {
      config.sshProfiles.push(profile);
    }

    if (keepPassword) {
      if (!isUnlocked()) {
        throw new HttpError('Vault is locked. Unlock vault before saving passwords.', 400);
      }
      if (typeof passphrase !== 'string' || passphrase === '') {
        throw new HttpError('Passphrase is required when Keep Password is enabled.', 400);
      }
      setStoredPassphrase(profileId, passphrase);
    } else {
      removeStoredPassphrase(profileId);
    }

    writeConfig(config);
    res.json({ success: true, config: sanitizeConfigForClient(config) });
  })
);

sshRouter.delete('/api/config/ssh', (req, res) => {
  const { id } = (req.body ?? {}) as { id?: unknown };
  const config = readConfig();

  config.sshProfiles = config.sshProfiles.filter((profile) => profile.id !== id);
  // Auto-select rules pointing at a deleted account would silently never match.
  config.accountRules = config.accountRules.filter((rule) => rule.profileId !== id);
  removeStoredPassphrase(String(id));
  writeConfig(config);

  res.json({ success: true, config: sanitizeConfigForClient(config) });
});

sshRouter.post(
  '/api/config/ssh/apply-ssh-config',
  asyncRoute(async (req, res) => {
    const { profileId, repoPath } = (req.body ?? {}) as { profileId?: unknown; repoPath?: unknown };
    const config = readConfig();

    if (!isSshConfigManagementEnabled(config)) {
      res.json({ success: true, skipped: true });
      return;
    }

    let keyPath: string | null = null;
    if (profileId) {
      const profile = config.sshProfiles.find((entry) => entry.id === profileId);
      if (!profile) {
        throw new HttpError('SSH profile not found.', 404);
      }
      keyPath = profile.privateKeyPath;
    }

    let host = await deriveOriginHost(typeof repoPath === 'string' ? repoPath : undefined);
    if (!host) {
      if (!keyPath) {
        // Nothing to assign and no host to remove.
        res.json({ success: true, skipped: true });
        return;
      }
      host = 'github.com';
    }

    const result = syncSshConfigForHost(host, keyPath);
    if (result.error) {
      throw new HttpError(result.error, 500);
    }

    res.json({
      success: true,
      host,
      updated: Boolean(result.updated),
      removed: !keyPath,
      warning: result.warning ?? null
    });
  })
);

sshRouter.post(
  '/api/config/ssh/validate-all',
  asyncRoute(async (_req, res) => {
    const profiles = readConfig().sshProfiles;

    const results = await Promise.all(
      profiles.map(async (profile) => {
        const base = { id: profile.id, label: profile.label, privateKeyPath: profile.privateKeyPath };

        if (!profile.privateKeyPath || !fs.existsSync(profile.privateKeyPath)) {
          return { ...base, status: 'missing', message: 'Key file not found on disk.' };
        }

        const check = await validateSshKeyPair(profile.privateKeyPath, '');
        if (check.valid) {
          return { ...base, status: 'ok', message: 'Key is valid.' };
        }
        if (/ssh-keygen execution error/i.test(check.message)) {
          return { ...base, status: 'unavailable', message: check.message };
        }
        // A passphrase-protected key is healthy, just locked.
        if (/passphrase|encrypted/i.test(check.message)) {
          return {
            ...base,
            status: 'passphrase',
            message: 'Key is valid but protected by a passphrase.'
          };
        }
        return { ...base, status: 'invalid', message: check.message };
      })
    );

    // If ssh-keygen itself is missing, do not nag about every profile.
    const unavailable =
      results.length > 0 && results.every((result) => result.status === 'unavailable');

    res.json({ success: true, unavailable, results: unavailable ? [] : results });
  })
);

sshRouter.post(
  '/api/config/account-rules',
  asyncRoute((req, res) => {
    const { match, profileId } = (req.body ?? {}) as { match?: unknown; profileId?: unknown };
    const safeMatch = trimmed(match);

    if (!safeMatch) {
      throw new HttpError('A match text is required (e.g. github.com/your-org).', 400);
    }

    const config = readConfig();
    if (!config.sshProfiles.some((profile) => profile.id === profileId)) {
      throw new HttpError('Selected account profile was not found.', 400);
    }

    config.accountRules.push({
      id: Date.now().toString(),
      match: safeMatch,
      profileId: String(profileId)
    });
    writeConfig(config);

    res.json({ success: true, config: sanitizeConfigForClient(config) });
  })
);

sshRouter.delete('/api/config/account-rules', (req, res) => {
  const { id } = (req.body ?? {}) as { id?: unknown };
  const config = readConfig();

  config.accountRules = config.accountRules.filter((rule) => rule.id !== id);
  writeConfig(config);

  res.json({ success: true, config: sanitizeConfigForClient(config) });
});

sshRouter.post(
  '/api/config/ssh/test',
  asyncRoute(async (req, res) => {
    const { profileId, privateKeyPath, passphrase } = (req.body ?? {}) as Record<string, unknown>;
    const config = readConfig();

    let resolvedKeyPath = '';
    let effectivePassphrase = typeof passphrase === 'string' ? passphrase : '';

    if (profileId) {
      const profile = config.sshProfiles.find((entry) => entry.id === profileId);
      if (!profile) {
        throw new HttpError('SSH profile not found', 404);
      }

      resolvedKeyPath = profile.privateKeyPath;
      if (!effectivePassphrase) {
        effectivePassphrase = getStoredPassphrase(String(profileId)) ?? '';
      }
    } else if (typeof privateKeyPath === 'string' && privateKeyPath) {
      resolvedKeyPath = normalizeSshPath(privateKeyPath);
    } else {
      throw new HttpError('Provide either profileId or privateKeyPath', 400);
    }

    if (!fs.existsSync(resolvedKeyPath)) {
      throw new HttpError(`Private key file not found at: ${resolvedKeyPath}`, 400);
    }

    const result = await validateSshKeyPair(resolvedKeyPath, effectivePassphrase);
    res.json({
      success: result.valid,
      message: result.message,
      usedSavedPassword: Boolean(profileId && !passphrase && effectivePassphrase)
    });
  })
);

sshRouter.post(
  '/api/config/ssh/generate',
  asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const safeLabel = trimmed(body['label']);

    if (!safeLabel) {
      throw new HttpError('Profile label is required', 400);
    }

    const keyType = String(body['keyType'] ?? 'ed25519').toLowerCase();
    if (keyType !== 'ed25519' && keyType !== 'rsa') {
      throw new HttpError('Unsupported key type. Use ed25519 or rsa.', 400);
    }

    const passphrase = typeof body['passphrase'] === 'string' ? body['passphrase'] : '';
    const keepPassword = Boolean(body['keepPassword']);

    if (keepPassword && !isUnlocked()) {
      throw new HttpError('Vault is locked. Unlock vault before saving passwords.', 400);
    }
    if (keepPassword && !passphrase) {
      throw new HttpError('Passphrase is required when Keep Password is enabled.', 400);
    }

    const requestedName = trimmed(body['keyName']);
    if (requestedName && !/^[a-zA-Z0-9._-]+$/.test(requestedName)) {
      throw new HttpError(
        'Key file name may only contain letters, numbers, dot, underscore, and dash.',
        400
      );
    }

    const sshDir = sshDirectory();
    const labelToken = sanitizeLabelForKeyName(safeLabel);
    const desiredBaseName = requestedName || `id_${keyType}_${labelToken || 'profile'}`;
    const baseName = buildUniqueKeyBaseName(sshDir, desiredBaseName);
    const privateKeyPath = path.join(sshDir, baseName);
    const publicKeyPath = `${privateKeyPath}.pub`;

    try {
      fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw new HttpError(`Failed to create SSH directory: ${(error as Error).message}`, 500);
    }

    await generateSshKeyPair({
      privateKeyPath,
      keyType: keyType as SshKeyType,
      passphrase,
      comment: `multi-git:${safeLabel}`
    });

    if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
      throw new HttpError('SSH key generation did not produce expected key files.', 500);
    }

    const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
    const config = readConfig();
    const profileId = Date.now().toString();
    const profile: SshProfile = {
      id: profileId,
      label: safeLabel,
      privateKeyPath,
      userName: trimmed(body['userName']),
      userEmail: trimmed(body['userEmail'])
    };
    config.sshProfiles.push(profile);

    if (keepPassword) {
      setStoredPassphrase(profileId, passphrase);
    }

    if (!writeConfig(config)) {
      throw new HttpError('Failed to persist generated SSH profile to config.', 500);
    }

    // Point ~/.ssh/config at the new key so external tools use it too.
    const repoPath = typeof body['repoPath'] === 'string' ? body['repoPath'] : undefined;
    const originHost = (await deriveOriginHost(repoPath)) ?? 'github.com';
    const sshConfigResult = syncSshConfigForHost(originHost, privateKeyPath);

    res.json({
      success: true,
      profileId,
      profile,
      privateKeyPath,
      publicKeyPath,
      publicKey,
      sshConfigUpdated: Boolean(sshConfigResult.updated),
      sshConfigHost: sshConfigResult.updated ? originHost : null,
      sshConfigWarning: sshConfigResult.error ?? sshConfigResult.warning ?? null,
      config: sanitizeConfigForClient(readConfig())
    });
  })
);

sshRouter.post(
  '/api/config/ssh/public',
  asyncRoute((req, res) => {
    const { profileId, privateKeyPath } = (req.body ?? {}) as Record<string, unknown>;
    const config = readConfig();

    let resolvedPrivatePath: string;
    if (profileId) {
      const profile = config.sshProfiles.find((entry) => entry.id === profileId);
      if (!profile) {
        throw new HttpError('SSH profile not found.', 404);
      }
      resolvedPrivatePath = profile.privateKeyPath;
    } else if (typeof privateKeyPath === 'string' && privateKeyPath) {
      resolvedPrivatePath = normalizeSshPath(privateKeyPath);
    } else {
      throw new HttpError('Provide profileId or privateKeyPath.', 400);
    }

    // Without this the endpoint reads any file on disk whose name ends in
    // .pub, for any path the client cares to send.
    const registered = config.sshProfiles.map((profile) => profile.privateKeyPath);
    if (!isPermittedKeyPath(resolvedPrivatePath, registered)) {
      throw new HttpError(
        'Public keys can only be read for a saved profile or a key inside your ~/.ssh directory.',
        403
      );
    }

    if (!fs.existsSync(resolvedPrivatePath)) {
      throw new HttpError(`Private key file not found at: ${resolvedPrivatePath}`, 400);
    }

    const publicKeyPath = `${resolvedPrivatePath}.pub`;
    if (!fs.existsSync(publicKeyPath)) {
      throw new HttpError(`Public key file not found at: ${publicKeyPath}`, 404);
    }

    res.json({
      success: true,
      publicKeyPath,
      publicKey: fs.readFileSync(publicKeyPath, 'utf8').trim()
    });
  })
);

sshRouter.post(
  '/api/config/ssh/open-location',
  asyncRoute(async (req, res) => {
    const { targetPath } = (req.body ?? {}) as { targetPath?: unknown };
    const resolvedPath = normalizeSshPath(typeof targetPath === 'string' ? targetPath : '');

    if (!resolvedPath) {
      throw new HttpError('Target path is required.', 400);
    }
    if (!fs.existsSync(resolvedPath)) {
      throw new HttpError(`Path not found: ${resolvedPath}`, 400);
    }

    const target = fs.statSync(resolvedPath).isDirectory()
      ? resolvedPath
      : path.dirname(resolvedPath);

    const sshHome = path.join(os.homedir(), '.ssh');
    const relative = path.relative(sshHome, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new HttpError('Opening locations is restricted to your ~/.ssh directory.', 400);
    }

    await openPathInFileExplorer(target);
    res.json({ success: true, openedPath: target });
  })
);
