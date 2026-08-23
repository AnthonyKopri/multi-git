// The Terminal Log stream.
//
// Commands are recorded here by the server, at the point they actually run, so
// the log says what happened rather than what the renderer meant. The renderer
// still posts the narrative lines -- why something was done, what it meant --
// because the argument vector cannot say that.
//
// A ring buffer lets a window opened later replay recent history, and every
// entry carries a sequence number so a reader can order what arrives.
import type { Response } from 'express';

import type { LogCommand, LogEntry, LogType } from '../shared/log-types';

export type { LogCommand, LogEntry, LogType } from '../shared/log-types';

/** What a caller supplies. The sequence number and timestamp are added here. */
export interface LogInput {
  text: string;
  type?: unknown;
  repoPath?: string | undefined;
  command?: LogCommand | undefined;
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
let nextSeq = 1;

function normalizeType(value: unknown): LogType {
  return LOG_TYPES.includes(value as LogType) ? (value as LogType) : 'info';
}

function cap(text: string): string {
  return text.length > LOG_TEXT_MAX ? `${text.slice(0, LOG_TEXT_MAX)}… (truncated)` : text;
}

/** Records a line and pushes it to every live subscriber. */
export function appendLog(input: LogInput): LogEntry {
  const entry: LogEntry = {
    seq: nextSeq++,
    ts: Date.now(),
    type: normalizeType(input.type),
    text: cap(input.text),
    ...(input.repoPath === undefined ? {} : { repoPath: input.repoPath }),
    ...(input.command === undefined ? {} : { command: input.command })
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

/**
 * Reports a server-side problem to the user as well as to the console.
 *
 * These used to go only to the Electron process's stdout, which nobody has
 * open. Several of them are Safety Net failing quietly -- a recovery point that
 * was not written, a file that did not reach the trash before it was discarded
 * -- and an application that promises a safety net owes the user the news when
 * it does not deliver one. The console call is kept for developers.
 */
export function reportServerProblem(text: string, repoPath?: string): void {
  console.warn(text);

  try {
    appendLog({ text, type: 'error', ...(repoPath === undefined ? {} : { repoPath }) });
  } catch {
    // The console line above already happened; nothing further is owed.
  }
}

/** Empties the buffer. Used by tests. */
export function clearLogBuffer(): void {
  buffer.length = 0;
  nextSeq = 1;
}

/** The buffer as it stands. Used by tests. */
export function logBuffer(): readonly LogEntry[] {
  return buffer;
}
