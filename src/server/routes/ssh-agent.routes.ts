// The native SSH agent, over HTTP.
//
// Not repository-scoped as a router: reading agent state is a machine-level
// question that the UI asks before a repository is even open. Routes that do
// touch a repository validate the path themselves.
import { Router } from 'express';

import {
  agentStatus,
  applyProfile,
  profileForRepo,
  rememberProfileForRepo,
  unloadProfileKey
} from '../ssh/agent-session';
import { AGENT_REPAIR_COMMAND } from '../ssh/agent-service';
import { resolveRepoPath } from '../middleware/repo-path';
import { asyncRoute } from '../middleware/error-handler';

export const sshAgentRouter: Router = Router();

/** Optional repository path from a body or query, validated when present. */
function optionalRepoPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  return resolveRepoPath(raw);
}

function asProfileId(raw: unknown): string {
  // '' is meaningful — it is the System profile — so only a non-string is bad.
  return typeof raw === 'string' ? raw : '';
}

sshAgentRouter.get(
  '/api/ssh/agent/status',
  asyncRoute(async (req, res) => {
    const repoPath = optionalRepoPath(req.query['repoPath']);

    // When the caller names a repository but no profile, answer about the
    // profile that repository is configured for. That is what the UI wants on
    // open, and it saves a round trip.
    const profileId =
      typeof req.query['profileId'] === 'string'
        ? req.query['profileId']
        : (repoPath ? profileForRepo(repoPath) : null) ?? undefined;

    res.json({ success: true, agent: await agentStatus({ profileId }) });
  })
);

sshAgentRouter.post(
  '/api/ssh/agent/load',
  asyncRoute(async (req, res) => {
    const { repoPath, profileId, passphrase, savePassphrase } = (req.body ?? {}) as {
      repoPath?: unknown;
      profileId?: unknown;
      passphrase?: unknown;
      savePassphrase?: unknown;
    };

    const resolvedRepo = optionalRepoPath(repoPath);
    const selectedProfile = asProfileId(profileId);

    const result = await applyProfile({
      ...(resolvedRepo ? { repoPath: resolvedRepo } : {}),
      profileId: selectedProfile,
      // Used for this one load and then dropped. It reaches ssh through the
      // AskPass bridge, is on the runner's redaction list, and is stored only
      // when the user asked for that and the vault is open to receive it.
      ...(typeof passphrase === 'string' && passphrase !== '' ? { passphrase } : {}),
      ...(savePassphrase === true ? { savePassphrase: true } : {})
    });

    // Remembered even when loading failed: the user's choice of account for
    // this repository is still their choice, and forgetting it would silently
    // fall back to a different identity on the next open.
    if (resolvedRepo) {
      rememberProfileForRepo(resolvedRepo, selectedProfile);
    }

    res.json({
      success: result.success,
      agent: result.agent,
      routingChanged: result.routingChanged,
      ...(result.error ? { error: result.error } : {}),
      ...(result.code ? { code: result.code } : {})
    });
  })
);

sshAgentRouter.post(
  '/api/ssh/agent/unload',
  asyncRoute(async (req, res) => {
    const { profileId, force } = (req.body ?? {}) as { profileId?: unknown; force?: unknown };

    const result = await unloadProfileKey(asProfileId(profileId), { force: force === true });

    res.json({
      success: result.success,
      agent: result.agent,
      ...(result.error ? { error: result.error } : {}),
      ...(result.code ? { code: result.code } : {})
    });
  })
);

/**
 * What the repair action would run, for the UI to show before asking for
 * administrator rights.
 *
 * Showing the exact command is the point: the user is about to approve a UAC
 * prompt, and "trust us" is not an acceptable thing to ask at that moment.
 * The command is a constant — this endpoint cannot be made to return anything
 * else, and the elevated handler in the main process ignores its input
 * entirely.
 */
sshAgentRouter.get('/api/ssh/agent/repair-command', (_req, res) => {
  res.json({
    success: true,
    executable: 'powershell.exe',
    args: AGENT_REPAIR_COMMAND,
    /** Elevation is a desktop-only capability; the browser build cannot do it. */
    availableInBrowser: false
  });
});
