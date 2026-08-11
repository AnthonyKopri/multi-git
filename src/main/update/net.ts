// The network side of updating: HTTPS to a fixed set of hosts, and nothing else.
//
// Everything here exists to make one guarantee: the only bytes that can end up
// in a file this app later executes came from GitHub over TLS. The host
// allow-list is re-checked on every redirect hop, because a permitted host
// answering with `Location: https://elsewhere/` would otherwise walk the
// download straight off the list. Redirects, response size, and the set of
// hosts are all capped rather than trusted.
//
// The transport is injected so the redirect, allow-list, and size-cap logic can
// be tested with a fake that never opens a socket.

import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

/** Hosts serving the release list and the asset URL, matched exactly. */
export const ALLOWED_UPDATE_HOSTS: readonly string[] = ['api.github.com', 'github.com'];

/**
 * Domain the asset redirect lands on, matched at a label boundary.
 *
 * GitHub has moved release-asset delivery between `objects.` and
 * `release-assets.` subdomains, so pinning an exact host would turn a
 * GitHub-side change into "updates silently stopped working" with nothing to
 * notice it by. The boundary check is what keeps this safe: `host === base` or
 * `host` ending in `.base` accepts `objects.githubusercontent.com` and rejects
 * `evilgithubusercontent.com`, which a bare `endsWith` would not.
 */
export const ALLOWED_UPDATE_DOMAIN = 'githubusercontent.com';

const MAX_REDIRECTS = 5;
/** Well above a ~120 MB Electron artifact, well below anything worth streaming. */
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;
/** Release JSON and the checksum list are small; anything larger is wrong. */
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

const USER_AGENT = 'Multi-Git-Client';

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
}

export type Fetcher = (url: string, headers: Record<string, string>) => Promise<HttpResponse>;

/**
 * True for an HTTPS URL on an allowed host.
 *
 * Hostname is compared exactly, not by suffix: `github.com.evil.test` ends with
 * a permitted name but is a different host. A URL carrying userinfo is refused
 * outright — `https://github.com@evil.test/` reads as GitHub to a human and
 * resolves to evil.test.
 */
export function isAllowedUpdateUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return (
    ALLOWED_UPDATE_HOSTS.includes(host) ||
    host === ALLOWED_UPDATE_DOMAIN ||
    host.endsWith(`.${ALLOWED_UPDATE_DOMAIN}`)
  );
}

/**
 * Thrown when GitHub's unauthenticated hourly limit is exhausted.
 *
 * Distinguished from other failures because it is not the user's problem and
 * not actionable: behind shared egress someone else may have spent the quota.
 * The check goes quiet rather than showing an error nobody can act on.
 */
export class RateLimitedError extends Error {
  constructor() {
    super('GitHub rate limit reached.');
    this.name = 'RateLimitedError';
  }
}

function isRateLimited(response: HttpResponse): boolean {
  if (response.statusCode !== 403 && response.statusCode !== 429) {
    return false;
  }
  const remaining = response.headers['x-ratelimit-remaining'];
  const value = Array.isArray(remaining) ? remaining[0] : remaining;
  return value === '0' || response.statusCode === 429;
}

function assertAllowed(url: string): void {
  if (!isAllowedUpdateUrl(url)) {
    throw new Error(`Refusing to fetch an update from ${url}.`);
  }
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function locationOf(response: HttpResponse): string | null {
  const location = response.headers['location'];
  const value = Array.isArray(location) ? location[0] : location;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Follows redirects, checking the allow-list at every hop. */
export async function openUrl(
  url: string,
  fetcher: Fetcher,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertAllowed(current);
    const response = await fetcher(current, { 'User-Agent': USER_AGENT, ...headers });

    if (!REDIRECT_CODES.has(response.statusCode)) {
      if (isRateLimited(response)) {
        throw new RateLimitedError();
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`GitHub answered ${response.statusCode} for the update check.`);
      }
      return response;
    }

    const location = locationOf(response);
    if (!location) {
      throw new Error(`GitHub sent a ${response.statusCode} with no destination.`);
    }

    // Relative redirects are legal, so resolve against the URL that produced
    // them before the next allow-list check.
    current = new URL(location, current).toString();
  }

  throw new Error('The update download redirected too many times.');
}

async function readAll(body: AsyncIterable<Uint8Array>, limit: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > limit) {
      throw new Error('The update response was larger than expected.');
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export async function fetchText(url: string, fetcher: Fetcher): Promise<string> {
  const response = await openUrl(url, fetcher);
  return (await readAll(response.body, MAX_TEXT_BYTES)).toString('utf8');
}

export async function fetchJson(url: string, fetcher: Fetcher): Promise<unknown> {
  const response = await openUrl(url, fetcher, { Accept: 'application/vnd.github+json' });
  const text = (await readAll(response.body, MAX_TEXT_BYTES)).toString('utf8');

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('GitHub sent something that is not a release list.');
  }
}

/** Somewhere to put bytes. Injected so a download can be tested without a disk. */
export interface FileSink {
  write: (chunk: Uint8Array) => Promise<void>;
  /** Closes the temporary file, leaving it staged rather than in place. */
  finish: () => Promise<void>;
  /** Moves the staged file to its destination. Only ever called after verifying. */
  commit: () => Promise<void>;
  /** Removes whatever was written. Must not throw. */
  discard: () => Promise<void>;
}

export type SinkFactory = (destPath: string) => Promise<FileSink>;

export interface DownloadOptions {
  fetcher: Fetcher;
  openSink: SinkFactory;
  onProgress?: (percent: number) => void;
}

export interface StagedDownload {
  sha256: string;
  bytes: number;
  /** Puts the file at its destination. Call only once the digest matches. */
  commit: () => Promise<void>;
  /** Throws the download away. */
  discard: () => Promise<void>;
}

/**
 * Streams a URL to a staging file, hashing as it goes.
 *
 * The hash is computed from the same bytes that are written, in one pass, so
 * the digest the caller verifies is necessarily the digest of the file on disk
 * — not of a second read that could differ.
 *
 * It returns the download *staged*, not in place. The caller compares the
 * digest and then commits. That ordering is the point: for a portable update
 * the destination is a runnable `.exe` in the user's own folder, and a file
 * that failed verification must never have existed under that name.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  options: DownloadOptions
): Promise<StagedDownload> {
  const response = await openUrl(url, options.fetcher);

  const declared = Number(
    Array.isArray(response.headers['content-length'])
      ? response.headers['content-length'][0]
      : response.headers['content-length']
  );
  const expected = Number.isFinite(declared) && declared > 0 ? declared : 0;

  if (expected > MAX_DOWNLOAD_BYTES) {
    throw new Error('The update download is larger than expected.');
  }

  const hash = crypto.createHash('sha256');
  const sink = await options.openSink(destPath);
  let bytes = 0;
  let lastPercent = -1;

  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_DOWNLOAD_BYTES) {
        throw new Error('The update download is larger than expected.');
      }

      hash.update(chunk);
      await sink.write(chunk);

      if (expected > 0 && options.onProgress) {
        const percent = Math.min(100, Math.floor((bytes / expected) * 100));
        if (percent !== lastPercent) {
          lastPercent = percent;
          options.onProgress(percent);
        }
      }
    }

    await sink.finish();
  } catch (error) {
    await sink.discard();
    throw error;
  }

  return {
    sha256: hash.digest('hex'),
    bytes,
    commit: sink.commit,
    discard: sink.discard
  };
}

/** The real transport. Everything above is exercised in tests without it. */
export const httpsFetcher: Fetcher = (url, headers) =>
  new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers as Record<string, string | string[] | undefined>,
        body: response
      });
    });

    request.on('error', reject);
    // A stalled connection must not leave the update stuck in `downloading`.
    request.setTimeout(60_000, () => {
      request.destroy(new Error('The connection to GitHub timed out.'));
    });
  });

/**
 * The real sink: writes `<dest>.part`, and renames only when told to.
 *
 * Staging beside the destination rather than in the system temp folder keeps
 * the final step a same-volume rename, which is atomic. Downloading to %TEMP%
 * and copying across volumes can half-finish, which for the portable build
 * would mean a truncated exe sitting under the name the user double-clicks.
 */
export const fileSinkFactory: SinkFactory = async (destPath) => {
  const partPath = `${destPath}.part`;
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await fs.promises.rm(partPath, { force: true });

  const handle = await fs.promises.open(partPath, 'w');
  let open = true;

  const close = async (): Promise<void> => {
    if (open) {
      open = false;
      await handle.close();
    }
  };

  return {
    write: async (chunk) => {
      await handle.write(chunk);
    },
    finish: close,
    commit: async () => {
      await close();
      await fs.promises.rm(destPath, { force: true });
      await fs.promises.rename(partPath, destPath);
    },
    discard: async () => {
      try {
        await close();
        await fs.promises.rm(partPath, { force: true });
      } catch {
        // Already failing; a leftover .part file is not worth masking why.
      }
    }
  };
};
