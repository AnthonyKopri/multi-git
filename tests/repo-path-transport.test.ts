// The repository path's trip from the renderer to a resolved directory.
//
// The defect this covers was silent and total: a repository whose folder name
// contained a character above U+00FF could be picked in the folder dialog and
// then failed every subsequent request, because `fetch` writes one byte per
// UTF-16 code unit into a header and the server resolved the truncated result
// to a path that does not exist.
//
// The encoder lives in the renderer and the decoder in the server, so the
// round-trip test below is the only place that proves they agree.
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { encodeRepoPathHeader } from '../src/renderer/api/client';
import {
  REPO_PATH_ENCODING_HEADER,
  decodeRepoPathHeader
} from '../src/server/middleware/repo-path';
import { cleanupRepos, createEmptyRepoNamed, git, writeFile } from './helpers/temp-repo';

const app: Express = createApp();

afterAll(() => {
  cleanupRepos();
});

/** Issues a request exactly the way the renderer's API client does. */
function asRenderer(repoPath: string) {
  return request(app)
    .get('/api/git/status')
    .set('Host', '127.0.0.1')
    .set('x-repo-path', encodeRepoPathHeader(repoPath))
    .set(REPO_PATH_ENCODING_HEADER, 'base64');
}

describe('encoding a repository path for the header', () => {
  it('round-trips paths the old transport destroyed', () => {
    const paths = [
      'D:\\Work\\中文-仓库',
      '/home/jane/proj/🔑-keys',
      'C:\\Users\\Jane Doe\\Documents\\café',
      '/tmp/ascii-only',
      'D:\\Work\\混合 mixed 🎯 spaces'
    ];

    for (const original of paths) {
      const header = encodeRepoPathHeader(original);
      // Every byte an HTTP header can carry unchanged.
      expect(header).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
      expect(decodeRepoPathHeader(header, 'base64')).toBe(original);
    }
  });

  it('survives a path longer than the encoder chunks at', () => {
    // The encoder widens bytes 1024 at a time; a path that spans several
    // chunks must not be reassembled in the wrong order or truncated.
    const original = `/tmp/${'ü中🎯'.repeat(400)}`;
    expect(decodeRepoPathHeader(encodeRepoPathHeader(original), 'base64')).toBe(original);
  });
});

describe('decoding the header on the server', () => {
  it('passes a raw value through untouched when no encoding is declared', () => {
    // Existing scripts, curl lines and the whole existing test suite.
    expect(decodeRepoPathHeader('D:\\Work\\app', undefined)).toBe('D:\\Work\\app');
    expect(decodeRepoPathHeader('D:\\Work\\app', 'utf-8')).toBe('D:\\Work\\app');
  });

  it('accepts the encoding name in any case, with surrounding space', () => {
    expect(decodeRepoPathHeader(encodeRepoPathHeader('/tmp/x'), ' BASE64 ')).toBe('/tmp/x');
  });

  it('rejects a value that is not the base64 it claims to be', () => {
    // Buffer.from is lenient and would silently return whatever it could
    // salvage, which is a plausible path pointing somewhere else entirely.
    expect(() => decodeRepoPathHeader('not valid base64!!', 'base64')).toThrow(/base64/i);
  });

  it('rejects a truncated value rather than resolving a shorter path', () => {
    const full = encodeRepoPathHeader('/tmp/some/long/repository/path');
    expect(() => decodeRepoPathHeader(full.slice(0, full.length - 3), 'base64')).toThrow(/base64/i);
  });

  it('rejects an embedded null byte', () => {
    const smuggled = Buffer.from('/tmp/app\0/etc', 'utf8').toString('base64');
    expect(() => decodeRepoPathHeader(smuggled, 'base64')).toThrow(/null byte/i);
  });

  it('rejects a missing header', () => {
    expect(() => decodeRepoPathHeader(undefined, 'base64')).toThrow(/No repository path/i);
  });
});

describe('opening a repository whose folder name is not Latin-1', () => {
  it('works for a CJK folder name', async () => {
    const repo = createEmptyRepoNamed('中文-仓库');
    writeFile(repo, 'README.md', '# 你好\n');
    git(repo, 'add', 'README.md');
    git(repo, 'commit', '-m', 'docs: add readme');

    const { body } = await asRenderer(repo).expect(200);
    expect(body).toMatchObject({ success: true, branch: 'main' });
  });

  it('works for an emoji folder name', async () => {
    const repo = createEmptyRepoNamed('🔑-keys');
    writeFile(repo, 'a.txt', 'alpha\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'feat: add a');

    const { body } = await asRenderer(repo).expect(200);
    expect(body).toMatchObject({ success: true, branch: 'main' });
  });

  it('still reports a genuinely missing folder as gone, not as bad encoding', async () => {
    const repo = createEmptyRepoNamed('中文-仓库');
    await request(app)
      .get('/api/git/status')
      .set('Host', '127.0.0.1')
      .set('x-repo-path', encodeRepoPathHeader(`${repo}-does-not-exist`))
      .set(REPO_PATH_ENCODING_HEADER, 'base64')
      .expect(404);
  });

  it('answers 400, not 500, when the header is malformed', async () => {
    await request(app)
      .get('/api/git/status')
      .set('Host', '127.0.0.1')
      .set('x-repo-path', 'not valid base64!!')
      .set(REPO_PATH_ENCODING_HEADER, 'base64')
      .expect(400);
  });
});
