import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  RateLimitedError,
  downloadToFile,
  fetchJson,
  isAllowedUpdateUrl,
  openUrl
} from '../src/main/update/net';
import type { FileSink, Fetcher, HttpResponse } from '../src/main/update/net';

function body(...chunks: string[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk, 'utf8');
      }
    }
  };
}

function ok(text: string, headers: Record<string, string> = {}): HttpResponse {
  return {
    statusCode: 200,
    headers: { 'content-length': String(Buffer.byteLength(text)), ...headers },
    body: body(text)
  };
}

function redirect(to: string, statusCode = 302): HttpResponse {
  return { statusCode, headers: { location: to }, body: body('') };
}

/** Answers each URL from a table, and records the order they were asked for. */
function fetcherFor(routes: Record<string, HttpResponse>): Fetcher & { seen: string[] } {
  const seen: string[] = [];
  const fetcher: Fetcher = (url) => {
    seen.push(url);
    const response = routes[url];
    if (!response) {
      throw new Error(`unexpected request: ${url}`);
    }
    return Promise.resolve(response);
  };
  return Object.assign(fetcher, { seen });
}

/** A sink that keeps bytes in memory and reports what it was told to do. */
function memorySink(): FileSink & { staged: Buffer; committed: boolean; discarded: boolean } {
  const state = {
    staged: Buffer.alloc(0),
    committed: false,
    discarded: false,
    write: async (chunk: Uint8Array) => {
      state.staged = Buffer.concat([state.staged, Buffer.from(chunk)]);
    },
    finish: async () => {},
    commit: async () => {
      state.committed = true;
    },
    discard: async () => {
      state.discarded = true;
    }
  };
  return state;
}

describe('which hosts an update may come from', () => {
  it('accepts the GitHub hosts a release download actually traverses', () => {
    expect(isAllowedUpdateUrl('https://api.github.com/repos/x/y/releases')).toBe(true);
    expect(isAllowedUpdateUrl('https://github.com/x/y/releases/download/t/a.exe')).toBe(true);
    expect(isAllowedUpdateUrl('https://objects.githubusercontent.com/a')).toBe(true);
    expect(isAllowedUpdateUrl('https://release-assets.githubusercontent.com/a')).toBe(true);
  });

  it('rejects a host that merely ends with an allowed name', () => {
    expect(isAllowedUpdateUrl('https://github.com.evil.test/a')).toBe(false);
    // The case a bare endsWith() would wave through.
    expect(isAllowedUpdateUrl('https://evilgithubusercontent.com/a')).toBe(false);
    expect(isAllowedUpdateUrl('https://notgithub.com/a')).toBe(false);
  });

  it('rejects plaintext and credential-carrying URLs', () => {
    expect(isAllowedUpdateUrl('http://github.com/a')).toBe(false);
    // Reads as github.com to a human; resolves to evil.test.
    expect(isAllowedUpdateUrl('https://github.com@evil.test/a')).toBe(false);
    expect(isAllowedUpdateUrl('https://user:pw@github.com/a')).toBe(false);
    expect(isAllowedUpdateUrl('not a url')).toBe(false);
  });
});

describe('following redirects', () => {
  it('re-checks the allow-list on each hop, not just the first', async () => {
    const fetcher = fetcherFor({
      'https://github.com/a': redirect('https://evil.test/payload.exe')
    });

    await expect(openUrl('https://github.com/a', fetcher)).rejects.toThrow(
      /Refusing to fetch an update from https:\/\/evil\.test/
    );
    // It never asked for the off-list URL.
    expect(fetcher.seen).toEqual(['https://github.com/a']);
  });

  it('follows an allowed redirect and resolves a relative destination', async () => {
    const fetcher = fetcherFor({
      'https://github.com/a': redirect('/b'),
      'https://github.com/b': redirect('https://objects.githubusercontent.com/c'),
      'https://objects.githubusercontent.com/c': ok('payload')
    });

    const response = await openUrl('https://github.com/a', fetcher);
    expect(response.statusCode).toBe(200);
    expect(fetcher.seen).toHaveLength(3);
  });

  it('gives up rather than looping forever', async () => {
    const fetcher: Fetcher = () => Promise.resolve(redirect('https://github.com/next'));
    await expect(openUrl('https://github.com/a', fetcher)).rejects.toThrow(/redirected too many/);
  });

  it('reports a spent rate limit as its own kind of failure', async () => {
    const fetcher: Fetcher = () =>
      Promise.resolve({
        statusCode: 403,
        headers: { 'x-ratelimit-remaining': '0' },
        body: body('')
      });

    await expect(fetchJson('https://api.github.com/x', fetcher)).rejects.toBeInstanceOf(
      RateLimitedError
    );
  });

  it('reports an ordinary failure as an ordinary failure', async () => {
    const fetcher: Fetcher = () =>
      Promise.resolve({ statusCode: 500, headers: {}, body: body('') });

    const error = await fetchJson('https://api.github.com/x', fetcher).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RateLimitedError);
  });

  it('sends a User-Agent, which api.github.com requires', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(ok('[]'));
    await fetchJson('https://api.github.com/x', fetcher);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ 'User-Agent': expect.any(String) });
  });
});

describe('downloading an artifact', () => {
  const payload = 'multi-git installer bytes';
  const digest = crypto.createHash('sha256').update(payload).digest('hex');

  it('hashes the bytes it wrote, and leaves the file staged rather than in place', async () => {
    const sink = memorySink();
    const percents: number[] = [];

    const staged = await downloadToFile('https://github.com/a.exe', 'C:\\out\\a.exe', {
      fetcher: fetcherFor({ 'https://github.com/a.exe': ok(payload) }),
      openSink: async () => sink,
      onProgress: (percent) => percents.push(percent)
    });

    expect(staged.sha256).toBe(digest);
    expect(sink.staged.toString('utf8')).toBe(payload);
    // Nothing is at the destination until the caller has verified the digest.
    expect(sink.committed).toBe(false);
    expect(percents.at(-1)).toBe(100);

    await staged.commit();
    expect(sink.committed).toBe(true);
  });

  it('throws away what it wrote when the transfer fails', async () => {
    const sink = memorySink();
    const failing: Fetcher = () =>
      Promise.resolve({
        statusCode: 200,
        headers: {},
        body: {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from('half');
            throw new Error('connection reset');
          }
        }
      });

    await expect(
      downloadToFile('https://github.com/a.exe', 'C:\\out\\a.exe', {
        fetcher: failing,
        openSink: async () => sink
      })
    ).rejects.toThrow(/connection reset/);

    expect(sink.discarded).toBe(true);
    expect(sink.committed).toBe(false);
  });

  it('refuses a response that claims to be enormous', async () => {
    const sink = memorySink();
    const huge: Fetcher = () =>
      Promise.resolve({
        statusCode: 200,
        headers: { 'content-length': String(400 * 1024 * 1024) },
        body: body('x')
      });

    await expect(
      downloadToFile('https://github.com/a.exe', 'C:\\out\\a.exe', {
        fetcher: huge,
        openSink: async () => sink
      })
    ).rejects.toThrow(/larger than expected/);
  });
});
