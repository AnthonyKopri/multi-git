// Files that are not UTF-8.
//
// Every case here is a byte-for-byte assertion, because the failure this
// guards against is invisible in decoded text: a Latin-1 `Café` decoded as
// UTF-8 becomes `Caf<U+FFFD>`, and encoding that back produces three bytes
// where there was one. Reading the result as a string would show the same
// thing before and after the bug.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import {
  bytesToTransport,
  toDisplayDiffFile,
  transportToBytes,
  transportToDisplay
} from '../src/server/git/encoding';
import type { DiffFile } from '../src/shared/diff-types';
import { cleanupRepos, createEmptyRepo, git } from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Host', '127.0.0.1').set('x-repo-path', repo),
    post: (url: string) => agent.post(url).set('Host', '127.0.0.1').set('x-repo-path', repo)
  };
}

/** 0xE9 is `é` in Latin-1, and is not a valid UTF-8 sequence on its own. */
const LATIN1_CAFE = Buffer.from([0x43, 0x61, 0x66, 0xe9]); // "Caf\xe9"

function write(repo: string, name: string, ...parts: (string | Buffer)[]): void {
  const buffers = parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'ascii') : part));
  fs.writeFileSync(path.join(repo, name), Buffer.concat(buffers));
}

/** The file as the index holds it, as bytes rather than as text. */
function stagedBytes(repo: string, name: string): Buffer {
  return require('node:child_process').execFileSync('git', ['show', `:${name}`], {
    cwd: repo,
    maxBuffer: 10 * 1024 * 1024
  }) as Buffer;
}

function workingBytes(repo: string, name: string): Buffer {
  return fs.readFileSync(path.join(repo, name));
}

/** A repository with one committed Latin-1 file. */
function latin1Repo(committed: Buffer, working: Buffer): string {
  const repo = createEmptyRepo();
  fs.writeFileSync(path.join(repo, 'legacy.txt'), committed);
  git(repo, 'add', 'legacy.txt');
  git(repo, 'commit', '-m', 'feat: legacy file');
  fs.writeFileSync(path.join(repo, 'legacy.txt'), working);
  return repo;
}

async function firstAddition(repo: string, file = 'legacy.txt'): Promise<string> {
  const { body } = await api(repo)
    .get('/api/git/diff/structured')
    .query({ path: file })
    .expect(200);

  const line = (body.file as DiffFile).hunks[0]?.lines.find((entry) => entry.kind === 'addition');
  return line?.id ?? '';
}

beforeEach(() => {
  clearRepoPathCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('the transport encoding', () => {
  it('round-trips every possible byte', () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

    expect(transportToBytes(bytesToTransport(all)).equals(all)).toBe(true);
  });

  it('round-trips a byte sequence UTF-8 would replace', () => {
    expect(transportToBytes(bytesToTransport(LATIN1_CAFE)).equals(LATIN1_CAFE)).toBe(true);
  });

  it('still decodes valid UTF-8 for display', () => {
    const utf8 = Buffer.from('Café ☕', 'utf8');

    expect(transportToDisplay(bytesToTransport(utf8))).toBe('Café ☕');
  });

  it('leaves ids alone when converting a file for display', () => {
    const file: DiffFile = {
      oldPath: 'a.txt',
      newPath: 'a.txt',
      status: 'modified',
      additions: 1,
      deletions: 0,
      binary: false,
      modeChanged: false,
      headerLines: ['diff --git a/a.txt b/a.txt'],
      hunks: [
        {
          id: 'hunk-1',
          header: '@@ -1 +1 @@',
          oldStart: 1,
          oldCount: 1,
          newStart: 1,
          newCount: 1,
          lines: [
            {
              id: 'hunk-1:0',
              kind: 'addition',
              content: bytesToTransport(LATIN1_CAFE),
              oldLine: null,
              newLine: 1,
              noNewline: false
            }
          ]
        }
      ]
    };

    const shown = toDisplayDiffFile(file);

    // The id is what a selection round-trips on, so it must not depend on how
    // the text was decoded.
    expect(shown.hunks[0]?.id).toBe('hunk-1');
    expect(shown.hunks[0]?.lines[0]?.id).toBe('hunk-1:0');
    expect(shown.hunks[0]?.lines[0]?.content).not.toBe(bytesToTransport(LATIN1_CAFE));
  });
});

describe('staging part of a file that is not UTF-8', () => {
  it('stages a line without rewriting its bytes', async () => {
    // The added line carries the Latin-1 byte and every context line is ASCII,
    // so git's context matching cannot catch a corrupted result. This used to
    // report success and put U+FFFD in the index.
    const repo = latin1Repo(
      Buffer.from('alpha\nbravo\ncharlie\n', 'ascii'),
      Buffer.concat([Buffer.from('alpha\n', 'ascii'), LATIN1_CAFE, Buffer.from('\ncharlie\n', 'ascii')])
    );

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'legacy.txt', lineIds: [await firstAddition(repo)] })
      .expect(200);

    const staged = stagedBytes(repo, 'legacy.txt');
    expect(staged.includes(LATIN1_CAFE)).toBe(true);
    // The replacement character, which is what the bug produced.
    expect(staged.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
  });

  it('applies at all when the context is not UTF-8', async () => {
    // Here the Latin-1 byte is in a context line. A mangled context no longer
    // matches the file, so this used to fail with "patch does not apply".
    const original = Buffer.concat([
      Buffer.from('first line\n', 'ascii'),
      LATIN1_CAFE,
      Buffer.from('\nthird line\n', 'ascii')
    ]);
    const edited = Buffer.concat([
      Buffer.from('first line CHANGED\n', 'ascii'),
      LATIN1_CAFE,
      Buffer.from('\nthird line\n', 'ascii')
    ]);

    const repo = latin1Repo(original, edited);

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'legacy.txt', lineIds: [await firstAddition(repo)] })
      .expect(200);

    expect(stagedBytes(repo, 'legacy.txt').includes(LATIN1_CAFE)).toBe(true);
  });

  it('discards a hunk without rewriting the rest of the file', async () => {
    const original = Buffer.concat([
      Buffer.from('keep\n', 'ascii'),
      LATIN1_CAFE,
      Buffer.from('\ntail\n', 'ascii')
    ]);
    const edited = Buffer.concat([
      Buffer.from('keep CHANGED\n', 'ascii'),
      LATIN1_CAFE,
      Buffer.from('\ntail\n', 'ascii')
    ]);

    const repo = latin1Repo(original, edited);
    const { body } = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'legacy.txt' })
      .expect(200);

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({
        action: 'discard',
        filePath: 'legacy.txt',
        hunkIds: [(body.file as DiffFile).hunks[0]?.id]
      })
      .expect(200);

    // Back to exactly the committed bytes, not a re-encoded approximation.
    expect(workingBytes(repo, 'legacy.txt').equals(original)).toBe(true);
  });

  it('stages part of an untracked file byte for byte', async () => {
    const repo = createEmptyRepo();
    write(repo, 'seed.txt', 'seed\n');
    git(repo, 'add', 'seed.txt');
    git(repo, 'commit', '-m', 'feat: seed');

    fs.writeFileSync(
      path.join(repo, 'fresh.txt'),
      Buffer.concat([Buffer.from('one\n', 'ascii'), LATIN1_CAFE, Buffer.from('\nthree\n', 'ascii')])
    );

    const { body } = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'fresh.txt' })
      .expect(200);

    const lines = (body.file as DiffFile).hunks[0]?.lines ?? [];

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'fresh.txt', lineIds: [lines[1]?.id] })
      .expect(200);

    expect(stagedBytes(repo, 'fresh.txt').equals(Buffer.concat([LATIN1_CAFE, Buffer.from('\n')]))).toBe(
      true
    );
  });

  it('stashes a hunk without rewriting its bytes', async () => {
    const original = Buffer.concat([
      Buffer.from('alpha\n', 'ascii'),
      Buffer.from('bravo\n', 'ascii'),
      Buffer.from('charlie\n', 'ascii')
    ]);
    const edited = Buffer.concat([
      Buffer.from('alpha\n', 'ascii'),
      LATIN1_CAFE,
      Buffer.from('\ncharlie\n', 'ascii')
    ]);

    const repo = latin1Repo(original, edited);
    const { body } = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'legacy.txt' })
      .expect(200);

    await api(repo)
      .post('/api/git/stash')
      .send({
        message: 'latin-1 work',
        selections: [{ filePath: 'legacy.txt', hunkIds: [(body.file as DiffFile).hunks[0]?.id] }]
      })
      .expect(200);

    // The working tree went back to the committed bytes exactly...
    expect(workingBytes(repo, 'legacy.txt').equals(original)).toBe(true);

    // ...and the stash holds the Latin-1 bytes, so applying it restores them.
    git(repo, 'stash', 'apply');
    expect(workingBytes(repo, 'legacy.txt').equals(edited)).toBe(true);
  });

  it('shows the line as text, replacement characters and all', async () => {
    // Display is unchanged by the fix and cannot be better: nothing tells the
    // application that the file is Latin-1. What matters is that the bytes it
    // writes back are never the decoded ones.
    const repo = latin1Repo(
      Buffer.from('alpha\nbravo\n', 'ascii'),
      Buffer.concat([Buffer.from('alpha\n', 'ascii'), LATIN1_CAFE, Buffer.from('\n', 'ascii')])
    );

    const { body } = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'legacy.txt' })
      .expect(200);

    const added = (body.file as DiffFile).hunks[0]?.lines.find((line) => line.kind === 'addition');
    expect(added?.content).toBe('Caf�');
  });
});

describe('a file that is valid UTF-8', () => {
  it('still reads and stages correctly', async () => {
    const utf8 = Buffer.from('Café ☕\nsecond\n', 'utf8');
    const edited = Buffer.from('Café ☕ changed\nsecond\n', 'utf8');
    const repo = latin1Repo(utf8, edited);

    const { body } = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'legacy.txt' })
      .expect(200);

    const added = (body.file as DiffFile).hunks[0]?.lines.find((line) => line.kind === 'addition');
    // Decoded properly for display, with no replacement characters.
    expect(added?.content).toBe('Café ☕ changed');

    // The whole hunk, so the index should end up matching the file exactly.
    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({
        action: 'stage',
        filePath: 'legacy.txt',
        hunkIds: [(body.file as DiffFile).hunks[0]?.id]
      })
      .expect(200);

    expect(stagedBytes(repo, 'legacy.txt').equals(edited)).toBe(true);
  });
});
