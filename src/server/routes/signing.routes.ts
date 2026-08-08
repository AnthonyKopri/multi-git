// Signature status, and what this repository signs with.
import { Router } from 'express';

import {
  readCommitSignature,
  readSigningConfig,
  readTagSignature,
  signingDiagnostics,
  writeSigningConfig
} from '../git/signing';
import { readConfig } from '../config/store';
import { withRepoLock } from '../git/lock';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import type { SigningMode } from '../../shared/signing-types';

export const signingRouter: Router = Router();

signingRouter.use(requireRepoPath);

const MODES: readonly SigningMode[] = ['system', 'gpg', 'ssh', 'off'];

/**
 * The SSH profiles that could sign.
 *
 * Reuses the keys Phase 1 already registered rather than asking for a path
 * again: an account the user has already set up is the obvious thing to sign
 * as. The public key beside the private one is what git wants for `gpg.format
 * = ssh`.
 */
function sshSigningCandidates(): { profileId: string; label: string; publicKeyPath: string }[] {
  return readConfig()
    .sshProfiles.filter((profile) => typeof profile.privateKeyPath === 'string')
    .map((profile) => ({
      profileId: profile.id,
      label: profile.label,
      publicKeyPath: `${profile.privateKeyPath}.pub`
    }));
}

signingRouter.get(
  '/api/git/signing/status',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    const config = await readSigningConfig(repoPath);
    const { diagnostics, gpgVersion } = await signingDiagnostics(config);

    res.json({
      success: true,
      config,
      diagnostics,
      sshSigningCandidates: sshSigningCandidates(),
      gpgAvailable: gpgVersion !== null,
      gpgVersion
    });
  })
);

signingRouter.post(
  '/api/git/signing/config',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as {
      mode?: unknown;
      signingKey?: unknown;
      signCommitsByDefault?: unknown;
      signTagsByDefault?: unknown;
      allowedSignersFile?: unknown;
    };

    if (!MODES.includes(body.mode as SigningMode)) {
      throw new HttpError(`Mode must be one of: ${MODES.join(', ')}`, 400);
    }

    const input: Parameters<typeof writeSigningConfig>[1] = {
      mode: body.mode as SigningMode,
      signCommitsByDefault: body.signCommitsByDefault === true,
      signTagsByDefault: body.signTagsByDefault === true
    };

    // A string sets it, null clears it, and undefined leaves it alone — three
    // different intentions that a single optional field would conflate.
    if (typeof body.signingKey === 'string' || body.signingKey === null) {
      input.signingKey = body.signingKey;
    }
    if (typeof body.allowedSignersFile === 'string' || body.allowedSignersFile === null) {
      input.allowedSignersFile = body.allowedSignersFile;
    }

    const config = await withRepoLock(repoPath, () => writeSigningConfig(repoPath, input));
    const { diagnostics, gpgVersion } = await signingDiagnostics(config);

    res.json({
      success: true,
      config,
      diagnostics,
      sshSigningCandidates: sshSigningCandidates(),
      gpgAvailable: gpgVersion !== null,
      gpgVersion
    });
  })
);

signingRouter.get(
  '/api/git/signature/commit',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const signature = await readCommitSignature(repoPath, req.query['hash']);

    res.json({ success: true, signature });
  })
);

signingRouter.get(
  '/api/git/signature/tag',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const signature = await readTagSignature(repoPath, req.query['tag']);

    res.json({ success: true, signature });
  })
);
