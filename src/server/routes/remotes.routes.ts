// Remote management over HTTP.
//
// Two things stand between a request and a changed remote. Every name and URL
// goes through the validators in ../git/remotes.ts before it reaches an
// argument vector, and every mutating route holds the repository lock, so a
// remote cannot be renamed underneath a fetch that is already running.
//
// Removing a remote and pruning one both destroy something git cannot get back
// — the remote-tracking refs are the only local record that a branch existed
// once its remote is gone — so both capture a recovery point first.
import { Router } from 'express';

import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { withRepoLock } from '../git/lock';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { operations } from '../operations/registry';
import { ensureAgentForRepo } from '../ssh/agent-session';
import { runGitCommand } from '../git/run';
import {
  addRemote,
  listRemotes,
  previewRemotePrune,
  pruneRemote,
  removeRemote,
  setDefaultPushRemote,
  testRemote,
  updateRemote
} from '../git/remotes';
import type { AddRemoteInput, UpdateRemoteInput } from '../../shared/remote-types';

export const remotesRouter: Router = Router();

remotesRouter.use('/api/remotes', requireRepoPath);

function stringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new HttpError(`${label} must be a list of text values.`, 400);
  }
  return value as string[];
}

function profileArgs(body: unknown): { profileId?: string; sshKeyPath?: string } {
  const { profileId, sshKeyPath } = (body ?? {}) as Record<string, unknown>;
  return {
    ...(typeof profileId === 'string' ? { profileId } : {}),
    ...(typeof sshKeyPath === 'string' ? { sshKeyPath } : {})
  };
}

remotesRouter.get(
  '/api/remotes',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const remotes = await listRemotes(repoPath);
    const defaultPush = remotes.find((remote) => remote.isDefaultPush);

    res.json({
      success: true,
      remotes,
      ...(defaultPush ? { defaultPushRemote: defaultPush.name } : {})
    });
  })
);

remotesRouter.post(
  '/api/remotes',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const input: AddRemoteInput = {
      name: String(body['name'] ?? ''),
      fetchUrl: String(body['fetchUrl'] ?? ''),
      ...(typeof body['pushUrl'] === 'string' ? { pushUrl: body['pushUrl'] } : {}),
      ...(stringList(body['fetchRefspecs'], 'Fetch refspecs') !== undefined
        ? { fetchRefspecs: stringList(body['fetchRefspecs'], 'Fetch refspecs') as string[] }
        : {}),
      ...(stringList(body['pushRefspecs'], 'Push refspecs') !== undefined
        ? { pushRefspecs: stringList(body['pushRefspecs'], 'Push refspecs') as string[] }
        : {}),
      ...(body['prune'] !== undefined ? { prune: body['prune'] === true } : {})
    };

    const remote = await withRepoLock(repoPath, () => addRemote(repoPath, input));
    res.json({ success: true, remote, remotes: await listRemotes(repoPath) });
  })
);

remotesRouter.post(
  '/api/remotes/update',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const input: UpdateRemoteInput = {
      name: String(body['name'] ?? ''),
      ...(typeof body['newName'] === 'string' ? { newName: body['newName'] } : {}),
      ...(typeof body['fetchUrl'] === 'string' ? { fetchUrl: body['fetchUrl'] } : {}),
      ...(typeof body['pushUrl'] === 'string' ? { pushUrl: body['pushUrl'] } : {}),
      ...(stringList(body['fetchRefspecs'], 'Fetch refspecs') !== undefined
        ? { fetchRefspecs: stringList(body['fetchRefspecs'], 'Fetch refspecs') as string[] }
        : {}),
      ...(stringList(body['pushRefspecs'], 'Push refspecs') !== undefined
        ? { pushRefspecs: stringList(body['pushRefspecs'], 'Push refspecs') as string[] }
        : {}),
      ...(body['prune'] !== undefined ? { prune: body['prune'] === true } : {})
    };

    const remote = await withRepoLock(repoPath, () => updateRemote(repoPath, input));
    res.json({ success: true, remote, remotes: await listRemotes(repoPath) });
  })
);

remotesRouter.post(
  '/api/remotes/default-push',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { name } = (req.body ?? {}) as { name?: unknown };

    await withRepoLock(repoPath, () =>
      setDefaultPushRemote(repoPath, name === null || name === '' ? null : name)
    );

    res.json({ success: true, remotes: await listRemotes(repoPath) });
  })
);

remotesRouter.delete(
  '/api/remotes',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { name } = (req.body ?? {}) as { name?: unknown };

    const removed = await withRepoLock(repoPath, async () => {
      // Before, not after: once the remote is gone its tracking refs go with
      // it, and the checkpoint is the only way back to knowing they existed.
      await captureCheckpoint(repoPath, `Removed remote ${String(name)}`, {
        operation: 'remote-remove'
      });

      return removeRemote(repoPath, name);
    });

    res.json({ success: true, removed, remotes: await listRemotes(repoPath) });
  })
);

remotesRouter.get(
  '/api/remotes/prune-preview',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const name = req.query['name'];

    res.json({ success: true, preview: await previewRemotePrune(repoPath, name) });
  })
);

remotesRouter.post(
  '/api/remotes/prune',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { name } = (req.body ?? {}) as { name?: unknown };

    // The preview is taken again here rather than trusting the one the client
    // saw: between showing it and confirming, a fetch may have changed what is
    // stale, and the record should say what was actually deleted.
    const preview = await previewRemotePrune(repoPath, name);

    await withRepoLock(repoPath, async () => {
      await captureCheckpoint(
        repoPath,
        `Pruned ${preview.staleRefs.length} stale ref(s) from ${preview.remote}`,
        { operation: 'remote-prune', refs: preview.staleRefs }
      );

      await pruneRemote(repoPath, name);
    });

    res.json({ success: true, pruned: preview.staleRefs });
  })
);

remotesRouter.post(
  '/api/remotes/test',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { name } = (req.body ?? {}) as { name?: unknown };
    const { profileId, sshKeyPath } = profileArgs(req.body);

    // The same preflight a push does: get the repository's key into the agent
    // before reaching the network, or the test reports an auth failure that
    // says nothing about the remote.
    await ensureAgentForRepo(repoPath, profileId);

    const operation = operations.begin({
      kind: 'remote.test',
      repoPath,
      message: `Contacting ${String(name)}`
    });
    operation.start();

    try {
      const result = await testRemote(repoPath, name, {
        sshKeyPath: sshKeyPath ?? null,
        signal: operation.signal
      });

      operation.succeed(result.reachable ? 'Reachable' : 'Not reachable');
      res.json({ success: true, result });
    } catch (error) {
      operation.fail(error instanceof Error ? error.message : 'Could not contact the remote');
      throw error;
    }
  })
);

remotesRouter.post(
  '/api/remotes/fetch-all',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { profileId, sshKeyPath } = profileArgs(req.body);
    const prune = (req.body ?? {})['prune'] === true;

    await ensureAgentForRepo(repoPath, profileId);
    const remotes = await listRemotes(repoPath);

    const operation = operations.begin({
      kind: 'remote.fetch-all',
      repoPath,
      message: `Fetching ${remotes.length} remote(s)`,
      total: remotes.length
    });
    operation.start();

    // One fetch per remote rather than `--all`, so a remote that is down is
    // reported as one failed target instead of failing the whole run.
    const results: { remote: string; ok: boolean; message?: string }[] = [];

    for (const [index, remote] of remotes.entries()) {
      if (operation.cancelled) {
        break;
      }

      operation.update({ completed: index, message: `Fetching ${remote.name}` });

      try {
        const args = ['fetch', remote.name];
        if (prune) {
          args.push('--prune');
        }

        await runGitCommand(repoPath, args, sshKeyPath ?? null, {
          signal: operation.signal,
          envOverrides: { GIT_TERMINAL_PROMPT: '0' }
        });

        results.push({ remote: remote.name, ok: true });
      } catch (error) {
        results.push({
          remote: remote.name,
          ok: false,
          message: error instanceof Error ? error.message : 'Fetch failed'
        });
      }
    }

    operation.succeed(`${results.filter((entry) => entry.ok).length}/${remotes.length} fetched`);
    res.json({ success: true, results, cancelled: operation.cancelled });
  })
);
