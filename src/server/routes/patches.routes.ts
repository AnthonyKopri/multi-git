// Patches over HTTP.
//
// Creating one is a read. Applying one writes untrusted content into the user's
// working tree, so it captures a recovery point first and holds the repository
// lock while it runs.
//
// The apply route accepts a larger body than the 1mb default, since a real
// patch can exceed it. That limit is set in app.ts, next to the default
// parser, because a parser registered here would run after it.
import { Router } from 'express';

import { requireRepoPath } from '../middleware/repo-path';
import { HttpError } from '../middleware/error-handler';
import { withRepoLock } from '../git/lock';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { applyPatch, controlAm, createPatch, readAmState, validatePatch } from '../git/patches';
import type { ApplyPatchRequest, PatchRequest } from '../../shared/patch-types';

export const patchesRouter: Router = Router();

patchesRouter.use('/api/patches', requireRepoPath);

function patchFormat(value: unknown): 'diff' | 'mailbox' {
  if (value === 'diff' || value === 'mailbox') {
    return value;
  }
  throw new HttpError('Choose the diff or mailbox format.', 400);
}

patchesRouter.post(
  '/api/patches/create',
  async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const source = body['source'];
    const request: PatchRequest = {
      format: patchFormat(body['format']),
      from: typeof body['from'] === 'string' ? body['from'] : 'HEAD',
      ...(typeof body['to'] === 'string' && body['to'] !== '' ? { to: body['to'] } : {}),
      ...(Array.isArray(body['selectedPaths'])
        ? { selectedPaths: (body['selectedPaths'] as unknown[]).filter((p) => typeof p === 'string') as string[] }
        : {}),
      ...(source === 'working' || source === 'staged' || source === 'commits'
        ? { source }
        : {})
    };

    const { preview } = await createPatch(repoPath, request);
    res.json({ success: true, preview });
  }
);

patchesRouter.post(
  '/api/patches/apply',
  async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const mode = body['mode'] === 'commits' ? 'commits' : 'working';
    const request: ApplyPatchRequest = {
      patch: typeof body['patch'] === 'string' ? body['patch'] : '',
      mode,
      dryRun: body['dryRun'] === true,
      ...(typeof body['whitespace'] === 'string'
        ? { whitespace: body['whitespace'] as ApplyPatchRequest['whitespace'] }
        : {}),
      index: body['index'] === true,
      threeWay: body['threeWay'] === true
    };

    // Before the lock and before the checkpoint: a patch that is malformed or
    // escapes the repository changes nothing, so it should leave no trace in
    // the recovery journal either.
    validatePatch(repoPath, request.patch);

    const outcome = await withRepoLock(repoPath, async () => {
      // A dry run writes nothing, so it needs no recovery point — and taking
      // one would fill the journal with entries for checks that did nothing.
      if (!request.dryRun) {
        await captureCheckpoint(repoPath, `Applied a patch (${request.mode})`, {
          operation: 'patch-apply'
        });
      }

      return applyPatch(repoPath, request);
    });

    res.json({ success: true, outcome });
  }
);

patchesRouter.get(
  '/api/patches/am-state',
  async (req, res) => {
    res.json({ success: true, state: await readAmState(req.repoPath as string) });
  }
);

patchesRouter.post(
  '/api/patches/am',
  async (req, res) => {
    const repoPath = req.repoPath as string;
    const action = (req.body ?? {})['action'];

    if (action !== 'continue' && action !== 'skip' && action !== 'abort') {
      throw new HttpError('Choose continue, skip or abort.', 400);
    }

    const state = await withRepoLock(repoPath, () => controlAm(repoPath, action));
    res.json({ success: true, state });
  }
);
