// Guided workflows: the desktop's safety checks, for clients without dialogs.
//
// The desktop asks before a pull that would merge or rebase, before switching
// a repository's account over a deliberate setup, and before pushing as an
// account that is not the one the remote expects. The terminal UI, the CLI and
// MCP clients have no dialog to ask with. These routes run the same checks and
// answer 409 with DECISION_REQUIRED, and the caller repeats the request with
// `confirmed: true` once the user has seen what the inspect route reports.
//
// Nothing here force-pushes, and nothing takes a secret as input.
import { Router } from 'express';

import { readConfig, writeConfig } from '../config/store';
import { sanitizeConfigForClient } from '../config/sanitize';
import { canonicalRepoKey } from '../config/repo-identity';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { readRepoAccountSetup, wouldOverwrite } from '../ssh/repo-setup';
import { applyProfile, ensureAgentForRepo, profileForRepo, rememberProfileForRepo } from '../ssh/agent-session';
import { verifyProfileAccount } from '../ssh/verify-profile';
import { getOriginRemoteUrl, runSyncOperationWithProfile } from '../ssh/profiles';
import { getToggledRemoteUrl, parseRemoteUrl } from '../git/remote';
import { updateRemote } from '../git/remotes';
import { withRepoLock } from '../git/lock';
import { readStatus } from '../git/read-status';
import { integrationPreflight } from '../git/integrate-preflight';
import { asOperation } from '../operations/as-operation';

export const workflowsRouter: Router = Router();

const DECISION = 'DECISION_REQUIRED';

function decisionRequired(message: string): HttpError {
  return new HttpError(`${DECISION}: ${message}`, 409);
}

// ---------------------------------------------------------------------------
// Application-level: no repository.

workflowsRouter.get('/api/workflows/repositories', (_req, res) => {
  res.json({ success: true, repositories: readConfig().recentRepos });
});

/** Auto-pull is one global switch, off unless the user turned it on. */
workflowsRouter.get('/api/workflows/auto-pull', (_req, res) => {
  res.json({ success: true, enabled: readConfig().settings?.autoPull === true });
});

workflowsRouter.post('/api/workflows/auto-pull', (req, res) => {
  const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
  if (typeof enabled !== 'boolean') {
    throw new HttpError('enabled must be true or false.', 400);
  }

  const config = readConfig();
  config.settings = { ...(config.settings ?? { manageSshConfig: false }), autoPull: enabled };
  writeConfig(config);

  res.json({ success: true, enabled });
});

/** Profiles without anything secret: labels, key paths, authors, accounts. */
workflowsRouter.get('/api/workflows/ssh/profiles', (_req, res) => {
  res.json({ success: true, profiles: sanitizeConfigForClient(readConfig()).sshProfiles });
});

// ---------------------------------------------------------------------------
// Repository-scoped.

workflowsRouter.use('/api/workflows', requireRepoPath);

/** The profile a request names, or the one the repository already uses. */
function chosenProfile(repoPath: string, raw: unknown): string {
  return typeof raw === 'string' ? raw : (profileForRepo(repoPath) ?? '');
}

function profileEmail(profileId: string): string | null {
  const profile = readConfig().sshProfiles.find((entry) => entry.id === profileId);
  if (profileId && !profile) {
    throw new HttpError('SSH profile not found.', 404);
  }
  return profile?.userEmail || null;
}

/** What switching this repository to a profile would change. Reads only. */
workflowsRouter.get(
  '/api/workflows/ssh',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const profileId = chosenProfile(repoPath, req.query['profileId']);
    const setup = await readRepoAccountSetup(repoPath);

    res.json({
      success: true,
      profileId,
      setup,
      // Whether the user chose to keep this repository's author when its
      // account changes, so a client can start from that choice.
      keepIdentity: readConfig().repoSettings[canonicalRepoKey(repoPath)]?.identityOptOut === true,
      wouldOverwrite: wouldOverwrite(setup, profileId, profileEmail(profileId))
    });
  })
);

/**
 * Switches the repository to a profile: SSH routing and, unless the user keeps
 * a deliberate author, the commit identity with it. The same applyProfile the
 * desktop's account picker uses, so custom `core.sshCommand` handling and the
 * atomic identity change are the same too.
 */
workflowsRouter.post(
  '/api/workflows/ssh',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { profileId: rawProfile, confirmed, keepIdentity } = (req.body ?? {}) as Record<string, unknown>;
    const profileId = chosenProfile(repoPath, rawProfile);

    const result = await withRepoLock(repoPath, async () => {
      const setup = await readRepoAccountSetup(repoPath);
      if (wouldOverwrite(setup, profileId, profileEmail(profileId)) && confirmed !== true) {
        throw decisionRequired(
          'this repository already has an account or author set up. Inspect it with ssh.inspect, then confirm.'
        );
      }

      // Only when asked: an earlier deliberate choice to keep the author must
      // not be undone by a request that did not mention it.
      if (typeof keepIdentity === 'boolean') {
        const config = readConfig();
        const key = canonicalRepoKey(repoPath);
        config.repoSettings[key] = { ...(config.repoSettings[key] ?? {}), identityOptOut: keepIdentity };
        writeConfig(config);
      }

      const applied = await applyProfile({ repoPath, profileId });
      // Remembered even when loading the key failed, as the desktop does: the
      // choice of account is still the user's choice.
      rememberProfileForRepo(repoPath, profileId);
      return applied;
    });

    res.json({
      success: result.success,
      profileId,
      agent: result.agent,
      routingChanged: result.routingChanged,
      setup: await readRepoAccountSetup(repoPath),
      ...(result.error ? { error: result.error } : {}),
      ...(result.code ? { code: result.code } : {})
    });
  })
);

workflowsRouter.post(
  '/api/workflows/ssh/verify',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const profileId = chosenProfile(repoPath, (req.body as { profileId?: unknown } | undefined)?.profileId);
    res.json({ success: true, profileId, ...(await verifyProfileAccount(profileId, repoPath)) });
  })
);

/** SSH ↔ HTTPS for origin, after the caller has seen the proposed URL. */
workflowsRouter.post(
  '/api/workflows/remote',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    if ((req.body as { confirmed?: unknown } | undefined)?.confirmed !== true) {
      throw decisionRequired('review the proposed URL with remote.inspect, then confirm.');
    }

    const remoteUrl = await withRepoLock(repoPath, async () => {
      const current = await getOriginRemoteUrl(repoPath);
      if (!current) {
        throw new HttpError('Origin remote not found.', 404);
      }
      const next = getToggledRemoteUrl(current);
      if (!next) {
        throw new HttpError(
          'Origin remote URL cannot be converted automatically. Update the remote manually for this repository.',
          400
        );
      }
      await updateRemote(repoPath, { name: 'origin', fetchUrl: next });
      return next;
    });

    res.json({ success: true, remoteUrl, protocol: parseRemoteUrl(remoteUrl)?.protocol ?? 'other' });
  })
);

/**
 * Pull, checked the way the desktop checks it: a fast-forward goes ahead, a
 * pull git would refuse is refused now, and a merge or rebase needs the user.
 */
workflowsRouter.post(
  '/api/workflows/pull',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { profileId: rawProfile, confirmed } = (req.body ?? {}) as Record<string, unknown>;
    const profileId = chosenProfile(repoPath, rawProfile);

    const status = await readStatus(repoPath);
    if (status.detached || status.noCommits || !status.branch) {
      throw new HttpError('Switch to a branch with at least one commit before pulling.', 409);
    }
    if (!status.tracking) {
      throw new HttpError(
        `${status.branch} has no upstream to pull from. Publish it with sync.push, or set one with the branch tools.`,
        409
      );
    }

    const preflight = await integrationPreflight({ repoPath, kind: 'pull', target: status.tracking });
    if (preflight.blocked) {
      throw new HttpError(preflight.blocked, 409);
    }
    if (preflight.strategy === 'ff-only-blocked') {
      throw new HttpError(
        'pull.ff is set to only, and this branch has commits of its own, so git would refuse. Merge or rebase deliberately instead.',
        409
      );
    }
    const quiet = [undefined, 'fast-forward', 'up-to-date'];
    if (!quiet.includes(preflight.strategy) && confirmed !== true) {
      throw decisionRequired(
        `this pull would ${preflight.strategy} (${preflight.incoming.length} incoming, ${preflight.outgoing.length} of your own). ` +
          'Review them, then confirm.'
      );
    }

    const result = await asOperation('git.pull', repoPath, `Pulling ${status.branch}`, (signal) =>
      withRepoLock(repoPath, async () => {
        const current = await readStatus(repoPath);
        if (current.branch !== status.branch || current.tracking !== status.tracking || current.detached) {
          throw decisionRequired('the branch or upstream changed while waiting. Review the current status before pulling.');
        }
        const check = await integrationPreflight({ repoPath, kind: 'pull', target: current.tracking });
        if (check.blocked) throw new HttpError(check.blocked, 409);
        if (check.strategy === 'ff-only-blocked') throw decisionRequired('the branch diverged; choose merge or rebase deliberately.');
        await ensureAgentForRepo(repoPath, profileId);
        // An upstream can change between preview and the network response.
        // Without a decision, even that race may only fast-forward. A plain
        // pull also respects an upstream with a different remote/branch name.
        const mode = confirmed === true && check.strategy === 'merge' ? '--no-rebase'
          : confirmed === true && check.strategy === 'rebase' ? '--rebase' : '--ff-only';
        return runSyncOperationWithProfile(repoPath, ['pull', mode], profileId, undefined, { signal });
      })
    );

    res.json({ success: true, strategy: preflight.strategy, ...result });
  })
);

/**
 * Push, or publish a branch with no upstream yet. Never forced. When the
 * profile's key signs in as a different account than the remote expects, the
 * user has to say that is intended.
 */
workflowsRouter.post(
  '/api/workflows/push',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { profileId: rawProfile, confirmed } = (req.body ?? {}) as Record<string, unknown>;
    const profileId = chosenProfile(repoPath, rawProfile);

    const status = await readStatus(repoPath);
    if (status.detached || status.noCommits || !status.branch) {
      throw new HttpError('Switch to a branch with at least one commit before pushing.', 409);
    }

    if (profileId && confirmed !== true) {
      const { check } = await verifyProfileAccount(profileId, repoPath);
      if (check.mismatch) {
        throw decisionRequired(
          `${check.message} Pushing would publish as ${check.account ?? 'another account'}. Confirm only if that is intended.`
        );
      }
    }

    const publishing = !status.tracking;
    const result = await asOperation(
      'git.push',
      repoPath,
      `${publishing ? 'Publishing' : 'Pushing'} ${status.branch}`,
      (signal) =>
        withRepoLock(repoPath, async () => {
          const current = await readStatus(repoPath);
          if (current.branch !== status.branch || current.detached) throw decisionRequired('the branch changed while waiting. Review it before pushing.');
          await ensureAgentForRepo(repoPath, profileId);
          return runSyncOperationWithProfile(repoPath, ['push', '-u', 'origin', status.branch], profileId, undefined, {
            signal
          });
        })
    );

    res.json({ success: true, published: publishing, ...result });
  })
);
