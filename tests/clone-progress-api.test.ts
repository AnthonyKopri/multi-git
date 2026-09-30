// Cloning through the real Express app and the real git, watching the operation
// the clone is tracked as.
//
// A `file://` URL rather than a path: git only runs the transfer that reports
// progress when it is fetching, and it clones a plain path by copying files.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import request from 'supertest';

import { createApp } from '../src/server/app';
import { operations } from '../src/server/operations/registry';
import type { OperationProgress } from '../src/shared/operation-types';
import { cleanupRepos, createRepoWithHistory, createTempDir, git, writeFile } from './helpers/temp-repo';

const app = createApp();

function clone(body: Record<string, unknown>) {
  return request(app).post('/api/git/clone').set('Host', '127.0.0.1').send(body);
}

/** Every state the registry published for one operation, in order. */
function watch(id: string): OperationProgress[] {
  const seen: OperationProgress[] = [];
  operations.subscribe((operation) => {
    if (operation.id === id) {
      seen.push(operation);
    }
  });
  return seen;
}

/** A source with enough objects for git to have something to report. */
function createBusyRepo(): string {
  const repo = createRepoWithHistory();
  for (let index = 0; index < 12; index += 1) {
    writeFile(repo, `data/file-${index}.txt`, `${index}\n`.repeat(2000) + `${Math.random()}\n`);
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', `data: ${index}`);
  }
  return repo;
}

beforeEach(() => {
  operations.clear();
});

afterAll(() => {
  cleanupRepos();
});

describe('POST /api/git/clone', () => {
  it('clones, and tracks the clone as an operation it reports progress on', async () => {
    const source = createBusyRepo();
    const parent = createTempDir();
    const operationId = 'clone-test-op-0001';
    const seen = watch(operationId);

    const response = await clone({
      url: pathToFileURL(source).href,
      parentDir: parent,
      folderName: 'copy',
      operationId
    }).expect(200);

    expect(response.body).toMatchObject({ success: true, repoPath: path.join(parent, 'copy') });
    expect(fs.existsSync(path.join(parent, 'copy', '.git'))).toBe(true);

    // Registered under the id the caller chose, so it can find it on the stream.
    expect(seen[0]).toMatchObject({ id: operationId, kind: 'git.clone', state: 'queued' });
    expect(seen[0]?.repoPath).toBe(path.join(parent, 'copy'));

    // Git's own progress made it through as figures.
    const withProgress = seen.filter((operation) => operation.transfer !== undefined);
    expect(withProgress.length).toBeGreaterThan(0);
    for (const operation of withProgress) {
      expect(operation.transfer?.fraction).toBeGreaterThanOrEqual(0);
      expect(operation.transfer?.fraction).toBeLessThanOrEqual(1);
      expect(operation.total).toBeGreaterThan(0);
    }

    // Moving forward only, whichever phase git was in.
    const fractions = withProgress.map((operation) => operation.transfer?.fraction ?? 0);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));

    // And it ended as a success, not left running.
    expect(seen[seen.length - 1]).toMatchObject({ state: 'succeeded' });
  });

  it('reports the expected size it was given alongside the bytes received', async () => {
    const source = createBusyRepo();
    const operationId = 'clone-test-op-0004';
    const seen = watch(operationId);
    const expectedBytes = 50 * 1024 ** 2;

    await clone({
      url: pathToFileURL(source).href,
      parentDir: createTempDir(),
      folderName: 'sized',
      operationId,
      expectedBytes
    }).expect(200);

    const receiving = seen.filter((operation) => operation.message === 'Receiving objects');
    expect(receiving.length).toBeGreaterThan(0);
    expect(receiving.some((operation) => operation.transfer?.expectedBytes === expectedBytes)).toBe(true);
  });

  it.each([['negative', -5], ['a string', 'lots'], ['tiny', 10], ['absurd', 1e18]])(
    'ignores an expected size that is %s, and still clones',
    async (_label, expectedBytes) => {
      const source = createRepoWithHistory();
      const operationId = `clone-ignored-${String(_label).replace(/\W/g, '')}`;
      const seen = watch(operationId);

      await clone({
        url: pathToFileURL(source).href,
        parentDir: createTempDir(),
        folderName: 'ignored',
        operationId,
        expectedBytes
      }).expect(200);

      expect(seen.some((operation) => operation.transfer?.expectedBytes !== undefined)).toBe(false);
      expect(seen[seen.length - 1]).toMatchObject({ state: 'succeeded' });
    }
  );

  it('does not hand the caller the progress redraws in stderr', async () => {
    const source = createBusyRepo();

    const response = await clone({
      url: pathToFileURL(source).href,
      parentDir: createTempDir(),
      folderName: 'quiet'
    }).expect(200);

    expect(response.body.stderr).not.toMatch(/Receiving objects|Resolving deltas/);
    expect(response.body.stderr).toContain('Cloning into');
  });

  it('cannot be cancelled, since a killed clone leaves a half-written folder', async () => {
    const source = createRepoWithHistory();
    const operationId = 'clone-test-op-0002';
    const seen = watch(operationId);

    await clone({
      url: pathToFileURL(source).href,
      parentDir: createTempDir(),
      folderName: 'copy',
      operationId
    }).expect(200);

    expect(seen[0]?.cancellable).toBe(false);
  });

  it('works without an operation id, as the agent and terminal callers send it', async () => {
    const source = createRepoWithHistory();

    const response = await clone({
      url: pathToFileURL(source).href,
      parentDir: createTempDir(),
      folderName: 'plain'
    }).expect(200);

    expect(response.body.success).toBe(true);
    expect(operations.list()[0]).toMatchObject({ kind: 'git.clone', state: 'succeeded' });
  });

  it('ignores an operation id that is not shaped like one', async () => {
    const source = createRepoWithHistory();

    await clone({
      url: pathToFileURL(source).href,
      parentDir: createTempDir(),
      folderName: 'odd',
      operationId: '../../etc/passwd'
    }).expect(200);

    const [tracked] = operations.list();
    expect(tracked?.id).not.toBe('../../etc/passwd');
    expect(tracked?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('marks the operation failed when git fails, and says nothing about the URL', async () => {
    const operationId = 'clone-test-op-0003';
    const seen = watch(operationId);
    const missing = pathToFileURL(path.join(createTempDir(), 'does-not-exist')).href;

    await clone({
      url: missing,
      parentDir: createTempDir(),
      folderName: 'never',
      operationId
    }).expect(500);

    const last = seen[seen.length - 1];
    expect(last?.state).toBe('failed');
    expect(last?.message).not.toContain('does-not-exist');
  });

  it('does not register an operation for a request it rejects up front', async () => {
    await clone({ url: '', parentDir: createTempDir() }).expect(400);
    await clone({ url: 'https://example.com/x.git', parentDir: 'Z:/definitely/not/here' }).expect(400);

    expect(operations.list()).toEqual([]);
  });
});
