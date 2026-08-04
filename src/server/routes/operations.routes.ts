// Renderer-facing view of the operation registry: list, subscribe, cancel.
//
// The stream is Server-Sent Events rather than a poll. Progress is a push from
// the server — a process wrote a line, a transfer advanced — and polling would
// either lag behind it or ask constantly for nothing. The Terminal Log already
// uses SSE over this same boundary, in browser and desktop mode alike.
import { Router } from 'express';
import type { Response } from 'express';

import { operations } from '../operations/registry';
import { executableRunner } from '../process/runner';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import type { OperationProgress } from '../../shared/operation-types';

export const operationsRouter: Router = Router();

/** Proxies and browsers drop an idle event stream. */
const KEEP_ALIVE_MS = 30_000;

function writeEvent(res: Response, payload: unknown, event?: string): void {
  const prefix = event ? `event: ${event}\n` : '';
  res.write(`${prefix}data: ${JSON.stringify(payload)}\n\n`);
}

operationsRouter.get('/api/operations', (_req, res) => {
  res.json({ success: true, operations: operations.list() });
});

operationsRouter.get('/api/operations/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  // A client that reconnects mid-operation needs the current picture before
  // it starts applying deltas, or it renders an empty list until the next
  // change happens to arrive.
  writeEvent(res, operations.list(), 'snapshot');

  const unsubscribe = operations.subscribe((operation: OperationProgress) => {
    if (res.writableEnded) {
      return;
    }
    try {
      writeEvent(res, operation);
    } catch {
      // The disposer below runs on 'close'; a failed write needs nothing more.
    }
  });

  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      // A comment line holds the connection without appearing as an event.
      res.write(': ping\n\n');
    }
  }, KEEP_ALIVE_MS);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

operationsRouter.post('/api/operations/cancel', (req, res) => {
  const { id } = (req.body ?? {}) as { id?: unknown };

  if (typeof id !== 'string' || id === '') {
    res.status(400).json({ error: 'Operation id is required.' });
    return;
  }

  res.json({ success: true, cancelled: operations.cancel(id) });
});

/**
 * A deliberately long operation, for verifying cancellation by hand.
 *
 * It spawns a child that spawns a grandchild, because that is the shape the
 * real cases have — `git push` starting `ssh` — and the shape a naive
 * `child.kill()` gets wrong. Cancelling this must leave neither process
 * behind.
 *
 * Off unless MULTI_GIT_DEV_OPERATIONS=1. It runs an arbitrary sleep on demand,
 * which is harmless but has no business being reachable in a shipped build.
 */
export function devOperationsEnabled(): boolean {
  return process.env['MULTI_GIT_DEV_OPERATIONS'] === '1';
}

/**
 * Node, however this process was started.
 *
 * Under Electron `process.execPath` is the app executable, which only behaves
 * as Node with this variable set.
 */
function nodeCommand(): { executable: string; env: NodeJS.ProcessEnv } {
  return {
    executable: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  };
}

operationsRouter.post(
  '/api/operations/dev/sleep',
  asyncRoute((req, res) => {
    if (!devOperationsEnabled()) {
      throw new HttpError('Development operations are not enabled.', 404);
    }

    const { seconds } = (req.body ?? {}) as { seconds?: unknown };
    const durationMs = Math.min(
      Math.max(typeof seconds === 'number' ? seconds : 300, 1),
      3600
    ) * 1000;

    const handle = operations.begin({
      kind: 'dev.sleep',
      message: 'Sleeping until cancelled',
      cancellable: true
    });
    handle.start();

    const { executable, env } = nodeCommand();
    const script = [
      "const { spawn } = require('child_process');",
      `spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${durationMs})'],`,
      "  { stdio: 'ignore', env: process.env });",
      `setTimeout(() => {}, ${durationMs});`
    ].join('\n');

    // Deliberately not awaited: the point is to answer immediately so the
    // caller has an id to cancel with.
    void executableRunner
      .run(executable, ['-e', script], { env, signal: handle.signal, timeoutMs: durationMs + 5000 })
      .then((result) => {
        handle.succeed(result.cancelled ? 'Cancelled' : 'Finished');
      })
      .catch((error: unknown) => {
        handle.fail(error instanceof Error ? error.message : String(error));
      });

    res.json({ success: true, id: handle.id });
  })
);
