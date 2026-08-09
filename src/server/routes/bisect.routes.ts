// Bisect over HTTP.
//
// There is deliberately no route here that runs the test command, for the same
// reason there is no agent launch route: the loopback server answers anything
// on this machine that can reach the port, and "run this program" is not a
// capability that should be reachable that way. A header saying "I am the
// desktop app" would not help — anything that can reach the port can set one.
//
// Starting, marking, resetting and reading a session are all plain git
// operations and are safe to answer here. The automated run lives behind the
// Electron IPC bridge in src/main/main.ts, and is simply absent in browser
// mode. Anything added to this file should be checked against that line.
import { Router } from 'express';

import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { withRepoLock } from '../git/lock';
import { readConfig, writeConfig } from '../config/store';
import { markCommit, readSession, resetBisect, startBisect } from '../git/bisect';
import type { BisectVerdict } from '../../shared/bisect-types';

export const bisectRouter: Router = Router();

bisectRouter.use('/api/bisect', requireRepoPath);

bisectRouter.get(
  '/api/bisect',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    res.json({
      success: true,
      session: await readSession(repoPath),
      // The saved commands, so the panel can offer them without a second call.
      commands: readConfig().bisectCommands ?? []
    });
  })
);

bisectRouter.post(
  '/api/bisect/start',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { goodRef, badRef } = (req.body ?? {}) as { goodRef?: unknown; badRef?: unknown };

    if (typeof goodRef !== 'string' || typeof badRef !== 'string') {
      throw new HttpError('A known good and a known bad commit are both required.', 400);
    }

    const session = await withRepoLock(repoPath, () => startBisect(repoPath, goodRef, badRef));
    res.json({ success: true, session });
  })
);

bisectRouter.post(
  '/api/bisect/mark',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const verdict = (req.body ?? {})['verdict'] as BisectVerdict;

    const session = await withRepoLock(repoPath, () => markCommit(repoPath, verdict));
    res.json({ success: true, session });
  })
);

bisectRouter.post(
  '/api/bisect/reset',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    const session = await withRepoLock(repoPath, () => resetBisect(repoPath));
    res.json({ success: true, session });
  })
);

/**
 * Saves a test command definition.
 *
 * Writing one is safe here — it is configuration, and the validator in
 * ../config/validate.ts checks it. Running it is not, and is not offered.
 */
bisectRouter.post(
  '/api/bisect/commands',
  asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (typeof body['executable'] !== 'string' || body['executable'].trim() === '') {
      throw new HttpError('An executable is required.', 400);
    }

    const config = readConfig();
    const existing = config.bisectCommands ?? [];

    const id = typeof body['id'] === 'string' && body['id'] !== '' ? body['id'] : `bisect-${Date.now()}`;
    const definition = {
      id,
      label: typeof body['label'] === 'string' && body['label'] !== '' ? body['label'] : id,
      executable: body['executable'].trim(),
      args: Array.isArray(body['args'])
        ? (body['args'] as unknown[]).filter((value) => typeof value === 'string') as string[]
        : [],
      ...(typeof body['skipExitCode'] === 'number' ? { skipExitCode: body['skipExitCode'] } : {})
    };

    writeConfig({
      ...config,
      bisectCommands: [...existing.filter((entry) => entry.id !== id), definition]
    });

    res.json({ success: true, commands: readConfig().bisectCommands ?? [] });
  })
);
