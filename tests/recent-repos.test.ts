import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app';
import { canonicalRepoKey } from '../src/server/config/repo-identity';
import { cleanupRepos, createRepoWithHistory } from './helpers/temp-repo';

const app = createApp();
const links: string[] = [];

function api() {
  const agent = request(app);
  return {
    post: (url: string) => agent.post(url).set('Host', '127.0.0.1'),
    delete: (url: string) => agent.delete(url).set('Host', '127.0.0.1')
  };
}

function aliasFor(target: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-repo-alias-'));
  const alias = path.join(parent, 'linked-repository');
  fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  links.push(parent);
  return alias;
}

afterAll(() => {
  for (const directory of links) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  cleanupRepos();
});

describe('recent repository identity', () => {
  it('keeps one recent entry when the same repository is opened through a link', async () => {
    const repository = createRepoWithHistory();
    const alias = aliasFor(repository);

    await api().post('/api/config/repo').send({ repoPath: repository }).expect(200);
    const { body } = await api().post('/api/config/repo').send({ repoPath: alias }).expect(200);

    const matching = (body.config.recentRepos as string[]).filter(
      (entry) => canonicalRepoKey(entry) === canonicalRepoKey(repository)
    );
    expect(matching).toEqual([path.resolve(alias)]);
  });

  it('removes every spelling of a repository from the recent list', async () => {
    const repository = createRepoWithHistory();
    const alias = aliasFor(repository);

    await api().post('/api/config/repo').send({ repoPath: repository }).expect(200);
    await api().post('/api/config/repo').send({ repoPath: alias }).expect(200);
    const { body } = await api()
      .delete('/api/config/repo')
      .send({ repoPath: repository })
      .expect(200);

    expect(
      (body.config.recentRepos as string[]).some(
        (entry) => canonicalRepoKey(entry) === canonicalRepoKey(repository)
      )
    ).toBe(false);
  });
});
