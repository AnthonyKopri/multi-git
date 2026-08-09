// Validates the x-repo-path header once, for every repository-scoped route.
//
// Previously each of ~60 routes did `if (!repoPath) return 400` and then
// handed the raw header straight to spawn() as a working directory, with no
// check that it existed, was a directory, or was a repository at all. This
// centralises that and gives handlers a resolved, verified path.
//
// The header also carries paths this process cannot spell in Latin-1. HTTP
// header values are byte strings, so a path containing `中文` or an emoji is
// truncated a code unit at a time on the way out of the browser and arrives as
// a folder that does not exist. `x-repo-path-encoding: base64` marks a value
// whose bytes are the UTF-8 encoding of the real path, which survives that trip
// intact. A raw value is still accepted, so an existing script or `curl` line
// keeps working.
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

export class RepoPathError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'RepoPathError';
    this.statusCode = statusCode;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireRepoPath: an existing directory inside a work tree. */
      repoPath?: string;
    }
  }
}

/** Cache of paths already confirmed to be repositories, keyed by resolved path. */
const verified = new Map<string, number>();
const VERIFY_TTL_MS = 30_000;

function isGitRepository(candidate: string): boolean {
  const cached = verified.get(candidate);
  if (cached !== undefined && Date.now() - cached < VERIFY_TTL_MS) {
    return true;
  }

  // A work tree has .git as a directory; a linked work tree or submodule has
  // it as a file containing a gitdir: pointer. Both are valid here.
  if (!fs.existsSync(path.join(candidate, '.git'))) {
    return false;
  }

  verified.set(candidate, Date.now());
  return true;
}

/** Header naming the encoding of `x-repo-path`. Only `base64` is defined. */
export const REPO_PATH_ENCODING_HEADER = 'x-repo-path-encoding';

/**
 * Recovers the path from a transport-encoded header value.
 *
 * Base64 is not self-describing and `Buffer.from(value, 'base64')` is lenient
 * to a fault: it skips characters outside the alphabet and returns whatever it
 * managed to collect. So the decoded bytes are re-encoded and compared, which
 * turns a corrupted or truncated header into an error instead of a plausible
 * path pointing somewhere else.
 */
export function decodeRepoPathHeader(rawValue: unknown, encoding: unknown): string {
  if (typeof rawValue !== 'string') {
    throw new RepoPathError('No repository path provided');
  }

  if (typeof encoding !== 'string' || encoding.trim().toLowerCase() !== 'base64') {
    return rawValue;
  }

  const value = rawValue.trim();
  const bytes = Buffer.from(value, 'base64');

  // Compared without padding, because an encoder may legitimately omit it.
  const unpadded = (text: string): string => text.replace(/=+$/, '');
  if (unpadded(bytes.toString('base64')) !== unpadded(value)) {
    throw new RepoPathError('Repository path header is not valid base64');
  }

  if (bytes.includes(0)) {
    // A NUL would end the string early in every C API below this, spawn's
    // working directory included.
    throw new RepoPathError('Repository path contains a null byte');
  }

  return bytes.toString('utf8');
}

/**
 * Resolves and validates the header, throwing a RepoPathError the shared error
 * middleware turns into a response.
 */
export function resolveRepoPath(rawValue: unknown): string {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new RepoPathError('No repository path provided');
  }

  const resolved = path.resolve(rawValue);

  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    throw new RepoPathError('Repository folder no longer exists', 404);
  }

  if (!stats.isDirectory()) {
    throw new RepoPathError('Repository path is not a folder');
  }

  if (!isGitRepository(resolved)) {
    throw new RepoPathError('Folder is not a Git repository', 400);
  }

  return resolved;
}

/** Express middleware form. Attaches `req.repoPath`. */
export function requireRepoPath(req: Request, _res: Response, next: NextFunction): void {
  try {
    req.repoPath = resolveRepoPath(
      decodeRepoPathHeader(req.headers['x-repo-path'], req.headers[REPO_PATH_ENCODING_HEADER])
    );
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Validates a folder that is not a repository yet, for the new-repo wizard.
 *
 * The wizard legitimately targets a folder that does not exist, so it cannot
 * use requireRepoPath. It still must not accept an unchecked string, because
 * the handler goes on to mkdir and write files there.
 */
export function resolveNewRepoTarget(rawValue: unknown): string {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new RepoPathError('Repository folder path is required');
  }

  const resolved = path.resolve(rawValue);

  if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
    throw new RepoPathError('The selected path is a file, not a folder.');
  }

  return resolved;
}

/** Drops the repository-verification cache. Used by tests. */
export function clearRepoPathCache(): void {
  verified.clear();
}
