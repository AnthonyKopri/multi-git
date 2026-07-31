// Network-facing guards for the local API.
//
// This API runs git commands and reads files inside the selected repository,
// so reaching it is equivalent to code execution as the logged-in user. Two
// things keep that contained: the socket binds to 127.0.0.1, and these
// middlewares reject anything that did not come from the app's own page.
import type { NextFunction, Request, Response } from 'express';

/**
 * Content Security Policy for the app's own pages.
 *
 * `script-src 'self'` with no 'unsafe-inline' is the load-bearing part: the
 * renderer builds DOM from repository data — branch names, commit messages,
 * file paths — and a strict policy means a crafted repository cannot turn a
 * rendering mistake into script execution in a page that can drive this API.
 *
 * The font hosts are here because the UI loads Material Symbols and its web
 * fonts from Google Fonts.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}

/**
 * True when a Host or Origin value refers to the local machine.
 *
 * An absent value passes: Origin is omitted on same-origin GETs, and a
 * missing Host is not something a conforming HTTP/1.1 client produces.
 */
export function isLocalhostValue(value: string | undefined): boolean {
  if (!value) {
    return true;
  }

  const host = String(value)
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    ?.split(':')[0]
    ?.toLowerCase();

  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Rejects requests that did not originate from a page served by this server.
 *
 * The Host check stops DNS rebinding, where an attacker-controlled name
 * resolves to 127.0.0.1 so a remote page can address the local API. The
 * Origin check stops an ordinary cross-site page from driving it, since
 * browsers attach Origin to every cross-origin request that can change state.
 */
export function localhostOnly(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host;
  const origin = req.headers.origin;

  if (!isLocalhostValue(host) || !isLocalhostValue(origin)) {
    res.status(403).json({ error: 'Requests are only accepted from localhost.' });
    return;
  }

  next();
}
