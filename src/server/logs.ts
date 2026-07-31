// The Terminal Log stream.
//
// The renderer posts every log line here and the pop-out log window subscribes
// over Server-Sent Events. A ring buffer lets a window opened later replay
// recent history.
import type { Response } from 'express';

export type LogType = 'error' | 'success' | 'cmd' | 'info';

export interface LogEntry {
  ts: number;
  type: LogType;
  text: string;
}

const LOG_TYPES: readonly LogType[] = ['error', 'success', 'cmd', 'info'];

export const LOG_BUFFER_MAX = 2000;

/**
 * Longest single log line accepted.
 *
 * Without a cap, the buffer's 2000-entry limit bounds the entry count but not
 * the memory: one client posting megabyte-long lines could grow it without
 * limit. Git output lines are far below this.
 */
export const LOG_TEXT_MAX = 16 * 1024;

const buffer: LogEntry[] = [];
const subscribers = new Set<Response>();

function normalizeType(value: unknown): LogType {
  return LOG_TYPES.includes(value as LogType) ? (value as LogType) : 'info';
}

/** Records a line and pushes it to every live subscriber. */
export function appendLog(text: string, type: unknown): LogEntry {
  const entry: LogEntry = {
    ts: Date.now(),
    type: normalizeType(type),
    text: text.length > LOG_TEXT_MAX ? `${text.slice(0, LOG_TEXT_MAX)}… (truncated)` : text
  };

  buffer.push(entry);
  if (buffer.length > LOG_BUFFER_MAX) {
    buffer.shift();
  }

  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const subscriber of subscribers) {
    // A window closed between the 'close' event and this write leaves a
    // finished response in the set; writing to it would throw.
    if (subscriber.writableEnded) {
      subscribers.delete(subscriber);
      continue;
    }

    try {
      subscriber.write(payload);
    } catch {
      subscribers.delete(subscriber);
    }
  }

  return entry;
}

/** Registers an SSE response, replays the backlog, and returns a disposer. */
export function subscribe(res: Response): () => void {
  res.write(`event: backlog\ndata: ${JSON.stringify(buffer)}\n\n`);
  subscribers.add(res);

  // Proxies and browsers drop an idle event stream; a comment line keeps it
  // open without appearing as an event.
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': ping\n\n');
    }
  }, 30_000);

  return () => {
    clearInterval(keepAlive);
    subscribers.delete(res);
  };
}

export function subscriberCount(): number {
  return subscribers.size;
}

/** Empties the buffer. Used by tests. */
export function clearLogBuffer(): void {
  buffer.length = 0;
}
