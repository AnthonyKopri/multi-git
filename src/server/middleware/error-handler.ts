// One error path for every route.
//
// Replaces the `err.stderr || err.error?.message || 'Error doing X'` triad
// that was repeated in roughly 65 catch blocks. Handlers now let errors
// propagate and this decides the status and the message.
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { GitError } from '../git/run';
import { InvalidGitArgumentError } from '../git/args';
import { RepoPathError } from './repo-path';

/** An error carrying the HTTP status it should produce. */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 * Express 4 does not await handlers, so without this an async throw becomes an
 * unhandled rejection and the request hangs until the client gives up.
 */
export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

interface ErrorShape {
  statusCode: number;
  message: string;
}

function classify(error: unknown, fallbackMessage: string): ErrorShape {
  if (error instanceof GitError) {
    // Git's own diagnostic is far more useful than "git exited with code 1".
    return { statusCode: error.statusCode, message: error.displayMessage || fallbackMessage };
  }

  if (
    error instanceof InvalidGitArgumentError ||
    error instanceof RepoPathError ||
    error instanceof HttpError
  ) {
    return { statusCode: error.statusCode, message: error.message };
  }

  if (error instanceof Error) {
    return { statusCode: 500, message: error.message || fallbackMessage };
  }

  return { statusCode: 500, message: fallbackMessage };
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    // Streaming responses such as the log SSE endpoint cannot be re-answered.
    next(error);
    return;
  }

  const { statusCode, message } = classify(error, 'Unexpected server error');

  if (statusCode >= 500) {
    console.error('Request failed:', error);
  }

  res.status(statusCode).json({ error: message });
}
