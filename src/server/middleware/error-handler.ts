// One error path for every route.
//
// Replaces the `err.stderr || err.error?.message || 'Error doing X'` triad
// that was repeated in roughly 65 catch blocks. Handlers now let errors
// propagate and this decides the status and the message.
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { GitError } from '../git/run';
import { InvalidGitArgumentError } from '../git/args';
import { PatchSelectionError } from '../git/patch-build';
import { WorktreeError } from '../git/worktrees';
import { RemoteError } from '../git/remotes';
import { SubmoduleError } from '../git/submodules';
import { LfsError } from '../git/lfs';
import { CommandFailedError, CommandSpawnError } from '../process/runner';
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
  /**
   * A machine-readable reason, for the few failures where the client has to do
   * something other than show the message. "Git LFS is not installed" needs an
   * install link and a different panel; "the push was rejected" does not.
   */
  code?: string;
  documentation?: string;
}

function classify(error: unknown, fallbackMessage: string): ErrorShape {
  if (error instanceof GitError) {
    // Git's own diagnostic is far more useful than "git exited with code 1".
    return { statusCode: error.statusCode, message: error.displayMessage || fallbackMessage };
  }

  if (error instanceof CommandFailedError) {
    // Already redacted by the runner, so this cannot leak a passphrase or a
    // token into a response body.
    return { statusCode: error.statusCode, message: error.displayMessage || fallbackMessage };
  }

  if (error instanceof LfsError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      code: error.code,
      ...(error.documentation !== undefined ? { documentation: error.documentation } : {})
    };
  }

  if (
    error instanceof InvalidGitArgumentError ||
    error instanceof PatchSelectionError ||
    error instanceof RepoPathError ||
    error instanceof WorktreeError ||
    error instanceof RemoteError ||
    error instanceof SubmoduleError ||
    error instanceof LfsError ||
    error instanceof HttpError ||
    error instanceof CommandSpawnError
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

  const { statusCode, message, code, documentation } = classify(error, 'Unexpected server error');

  if (statusCode >= 500) {
    console.error('Request failed:', error);
  }

  res.status(statusCode).json({
    error: message,
    ...(code !== undefined ? { code } : {}),
    ...(documentation !== undefined ? { documentation } : {})
  });
}
