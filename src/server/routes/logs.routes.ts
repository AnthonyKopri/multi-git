// The Terminal Log's HTTP surface.
//
// Commands are recorded by the server itself, where they run. What arrives here
// is the renderer's narration -- why something was done, what it meant -- which
// the argument vector cannot say and which therefore still has to come from the
// side that knows.
//
// Lines arrive in batches. The previous shape was one request per line, so a
// refresh firing fourteen parallel requests could land its lines in any order,
// and a failed request dropped its line into the developer console where nobody
// would ever see it. A batch preserves the order it was written in, and the
// renderer holds a queue so a failure can be retried rather than lost.
import { Router } from 'express';

import { appendLog, subscribe } from '../logs';
import type { LogInput } from '../logs';

export const logsRouter: Router = Router();

/** Lines accepted in one request. Beyond this the client is misbehaving. */
const MAX_BATCH = 200;

function readEntry(value: unknown): LogInput | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record['text'] !== 'string') {
    return null;
  }

  return {
    text: record['text'],
    type: record['type'],
    ...(typeof record['repoPath'] === 'string' ? { repoPath: record['repoPath'] } : {})
  };
}

logsRouter.post('/api/logs', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // A batch, or a single line in the older shape. Both are accepted so a
  // window left open across an upgrade keeps logging.
  const raw = Array.isArray(body['entries']) ? body['entries'] : [body];

  if (raw.length > MAX_BATCH) {
    res.status(400).json({ error: `At most ${MAX_BATCH} log entries per request.` });
    return;
  }

  const entries = raw.map(readEntry);
  if (entries.some((entry) => entry === null)) {
    res.status(400).json({ error: 'Log text is required.' });
    return;
  }

  // In array order: that order is the only record of what happened first.
  for (const entry of entries as LogInput[]) {
    appendLog(entry);
  }

  res.json({ success: true });
});

logsRouter.get('/api/logs/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  const unsubscribe = subscribe(res);
  req.on('close', unsubscribe);
});
