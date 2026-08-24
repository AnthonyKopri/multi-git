import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../src/server/app';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

afterAll(() => {
  cleanupRepos();
});

describe('workspace file path listing', () => {
  it('round-trips Unicode tracked and untracked names exactly', async () => {
    const repo = createRepoWithHistory();
    const tracked = path.posix.join('docs', 'café tracked.txt');
    const untracked = path.posix.join('notes', '中文 untracked.txt');

    writeFile(repo, tracked, 'tracked\n');
    git(repo, 'add', tracked);
    git(repo, 'commit', '-m', 'add Unicode path');
    writeFile(repo, untracked, 'untracked\n');

    const response = await request(createApp())
      .get('/api/git/files')
      .set('Host', '127.0.0.1')
      .set('x-repo-path', repo)
      .expect(200);

    expect(response.body.tracked).toContain(tracked);
    expect(response.body.untracked).toContain(untracked);
  });
});
