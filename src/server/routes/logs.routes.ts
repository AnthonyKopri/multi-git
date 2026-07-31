import { Router } from 'express';

import { appendLog, subscribe } from '../logs';

export const logsRouter: Router = Router();

logsRouter.post('/api/logs', (req, res) => {
  const { text, type } = (req.body ?? {}) as { text?: unknown; type?: unknown };

  if (typeof text !== 'string') {
    res.status(400).json({ error: 'Log text is required.' });
    return;
  }

  appendLog(text, type);
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
