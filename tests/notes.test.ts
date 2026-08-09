// Git notes against real repositories and a real git.
//
// The claim worth protecting is the cheap one: whether a commit has a note is
// answered for a whole ref in a single call, because the history list asks that
// question for every row it draws. A per-commit lookup would be a git process
// per row and would not show up as a failure — only as a slow list.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { commitsWithNotes, readNote } from '../src/server/git/notes';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  const headers = (req: request.Test): request.Test =>
    req.set('Host', '127.0.0.1').set('x-repo-path', repo);

  return {
    get: (url: string) => headers(agent.get(url)),
    post: (url: string) => headers(agent.post(url)),
    delete: (url: string) => headers(agent.delete(url))
  };
}

/** A repository with three commits, whose oids are returned newest last. */
function repoWithCommits(): { repo: string; oids: string[] } {
  const repo = createRepoWithHistory();
  const oids: string[] = [];

  for (const name of ['one', 'two', 'three']) {
    writeFile(repo, `${name}.txt`, name);
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', `add ${name}`);
    oids.push(git(repo, 'rev-parse', 'HEAD').trim());
  }

  return { repo, oids };
}

beforeEach(() => {
  clearRepoPathCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('reading', () => {
  it('offers the default ref even before anything has written to it', async () => {
    const response = await api(createRepoWithHistory()).get('/api/notes/refs').expect(200);

    expect(response.body.refs).toContain('refs/notes/commits');
    expect(response.body.defaultRef).toBe('refs/notes/commits');
  });

  it('reports an empty index for a repository with no notes', async () => {
    const response = await api(createRepoWithHistory()).get('/api/notes/index').expect(200);

    // The normal state for most repositories, and not an error.
    expect(response.body.commits).toEqual([]);
  });

  it('returns null for a commit with no note', async () => {
    const { repo, oids } = repoWithCommits();

    const response = await api(repo)
      .get(`/api/notes?commit=${oids[0]}`)
      .expect(200);

    expect(response.body.note).toBeNull();
  });

  it('refuses a request that names no commit', async () => {
    await api(createRepoWithHistory()).get('/api/notes').expect(400);
  });
});

describe('writing', () => {
  it('saves a note and reads it back', async () => {
    const { repo, oids } = repoWithCommits();
    const target = oids[1] as string;

    await api(repo)
      .post('/api/notes')
      .send({ commit: target, message: 'Reviewed by the platform team' })
      .expect(200);

    expect(await readNote(repo, target)).toBe('Reviewed by the platform team');
  });

  it('keeps a multi-line note intact', async () => {
    const { repo, oids } = repoWithCommits();
    const target = oids[0] as string;
    const message = 'Line one\nLine two\n\nLine four';

    await api(repo).post('/api/notes').send({ commit: target, message }).expect(200);

    // Written over stdin rather than as an argument, which is what makes
    // newlines and leading hyphens safe.
    expect(await readNote(repo, target)).toBe(message);
  });

  it('takes a note beginning with a hyphen', async () => {
    const { repo, oids } = repoWithCommits();
    const target = oids[0] as string;

    await api(repo)
      .post('/api/notes')
      .send({ commit: target, message: '--not-a-flag' })
      .expect(200);

    expect(await readNote(repo, target)).toBe('--not-a-flag');
  });

  it('replaces an existing note rather than appending to it', async () => {
    const { repo, oids } = repoWithCommits();
    const target = oids[0] as string;

    await api(repo).post('/api/notes').send({ commit: target, message: 'first' }).expect(200);
    await api(repo).post('/api/notes').send({ commit: target, message: 'second' }).expect(200);

    // The UI shows the whole note in a box, so what comes back is the whole
    // note — appending would duplicate what the user was already looking at.
    expect(await readNote(repo, target)).toBe('second');
  });

  it('removes the note when the message is emptied', async () => {
    const { repo, oids } = repoWithCommits();
    const target = oids[0] as string;

    await api(repo).post('/api/notes').send({ commit: target, message: 'temporary' }).expect(200);
    await api(repo).post('/api/notes').send({ commit: target, message: '   ' }).expect(200);

    expect(await readNote(repo, target)).toBeNull();
  });

  it('does not rewrite the commit', async () => {
    const { repo, oids } = repoWithCommits();
    const target = oids[2] as string;

    await api(repo).post('/api/notes').send({ commit: target, message: 'a note' }).expect(200);

    // The note lives in its own ref, which is the whole reason writing one is
    // safe on published history.
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(target);
  });

  it('removes a note explicitly', async () => {
    const { repo, oids } = repoWithCommits();
    const target = oids[0] as string;

    await api(repo).post('/api/notes').send({ commit: target, message: 'doomed' }).expect(200);
    await api(repo).delete('/api/notes').send({ commit: target }).expect(200);

    expect(await readNote(repo, target)).toBeNull();
  });
});

describe('the index the history list reads', () => {
  it('names every annotated commit in one call', async () => {
    const { repo, oids } = repoWithCommits();

    await api(repo).post('/api/notes').send({ commit: oids[0], message: 'a' }).expect(200);
    await api(repo).post('/api/notes').send({ commit: oids[2], message: 'c' }).expect(200);

    const commits = await commitsWithNotes(repo);

    expect(commits.has(oids[0] as string)).toBe(true);
    expect(commits.has(oids[2] as string)).toBe(true);
    // The one without a note must not be marked.
    expect(commits.has(oids[1] as string)).toBe(false);
  });

  it('is empty for a ref nothing has been written to', async () => {
    const { repo, oids } = repoWithCommits();
    await api(repo).post('/api/notes').send({ commit: oids[0], message: 'on the default ref' });

    // A different ref is a different set of notes, not the same ones again.
    expect((await commitsWithNotes(repo, 'refs/notes/review')).size).toBe(0);
  });
});

describe('a non-default notes ref', () => {
  it('keeps notes on separate refs apart', async () => {
    const { repo, oids } = repoWithCommits();
    const target = oids[0] as string;

    await api(repo)
      .post('/api/notes')
      .send({ commit: target, message: 'on review', ref: 'refs/notes/review' })
      .expect(200);

    expect(await readNote(repo, target, 'refs/notes/review')).toBe('on review');
    expect(await readNote(repo, target)).toBeNull();
  });

  it('appears in the ref listing once it exists', async () => {
    const { repo, oids } = repoWithCommits();
    await api(repo)
      .post('/api/notes')
      .send({ commit: oids[0], message: 'x', ref: 'refs/notes/review' })
      .expect(200);

    const response = await api(repo).get('/api/notes/refs').expect(200);

    expect(response.body.refs).toContain('refs/notes/review');
  });

  it('refuses a ref name git would read as an option', async () => {
    const { repo, oids } = repoWithCommits();

    await api(repo)
      .post('/api/notes')
      .send({ commit: oids[0], message: 'x', ref: '--upload-pack=id' })
      .expect(400);
  });
});

describe('sharing', () => {
  it('refuses a direction that is neither fetch nor push', async () => {
    await api(createRepoWithHistory())
      .post('/api/notes/sync')
      .send({ direction: 'sideways' })
      .expect(400);
  });
});
