// Precision staging, driven end to end against real Git repositories.
//
// Unit tests can prove a patch is well formed; only git can prove it applies
// and leaves the index and the working tree in the states the user asked for.
// So every case here reads a real diff, sends a real selection, and then asks
// git what actually happened.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { listTrash } from '../src/server/safety-net/trash';
import type { DiffFile } from '../src/shared/diff-types';
import {
  cleanupRepos,
  createRepoWithHistory,
  git,
  writeFile
} from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Host', '127.0.0.1').set('x-repo-path', repo),
    post: (url: string) => agent.post(url).set('Host', '127.0.0.1').set('x-repo-path', repo)
  };
}

async function readDiff(
  repo: string,
  filePath: string,
  source: 'working-tree' | 'index' = 'working-tree'
): Promise<DiffFile> {
  const { body } = await api(repo)
    .get('/api/git/diff/structured')
    .query({ path: filePath, source })
    .expect(200);

  expect(body.file, `expected a diff for ${filePath}`).not.toBeNull();
  return body.file as DiffFile;
}

/** The file as the index sees it, which is what staging actually changed. */
function stagedContent(repo: string, filePath: string): string {
  return git(repo, 'show', `:${filePath}`);
}

function workingContent(repo: string, filePath: string): string {
  return fs.readFileSync(path.join(repo, filePath), 'utf8');
}

/** A file whose two edits are far enough apart to stay separate hunks. */
function repoWithTwoHunks(): { repo: string; file: string } {
  const repo = createRepoWithHistory();
  const file = 'lines.txt';
  const original = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');

  writeFile(repo, file, `${original}\n`);
  git(repo, 'add', file);
  git(repo, 'commit', '-m', 'feat: add lines');

  const edited = original
    .split('\n')
    .map((line) => (line === 'line 3' ? 'line 3 CHANGED' : line === 'line 17' ? 'line 17 CHANGED' : line))
    .join('\n');
  writeFile(repo, file, `${edited}\n`);

  return { repo, file };
}

beforeEach(() => {
  clearRepoPathCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('reading a structured diff', () => {
  it('splits distant edits into separate hunks with usable line numbers', async () => {
    const { repo, file } = repoWithTwoHunks();
    const diff = await readDiff(repo, file);

    expect(diff.status).toBe('modified');
    expect(diff.binary).toBe(false);
    expect(diff.hunks).toHaveLength(2);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(2);

    const [first, second] = diff.hunks;
    expect(first?.lines.find((line) => line.kind === 'addition')?.content).toBe('line 3 CHANGED');
    expect(first?.lines.find((line) => line.kind === 'deletion')?.oldLine).toBe(3);
    expect(second?.lines.find((line) => line.kind === 'addition')?.content).toBe('line 17 CHANGED');

    // Ids have to be distinct, or a selection could not name one hunk.
    expect(first?.id).not.toBe(second?.id);
  });

  it('gives an untracked file an added-file diff instead of nothing', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'fresh.txt', 'alpha\nbravo\ncharlie\n');

    const { body } = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'fresh.txt' })
      .expect(200);

    expect(body.untracked).toBe(true);
    expect(body.file.status).toBe('added');
    expect(body.file.additions).toBe(3);
    expect(body.file.hunks[0].lines.map((line: { content: string }) => line.content)).toEqual([
      'alpha',
      'bravo',
      'charlie'
    ]);
  });

  it('reports a binary file without inventing lines for it', async () => {
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 0, 3]));
    git(repo, 'add', 'blob.bin');
    git(repo, 'commit', '-m', 'feat: add blob');
    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.from([0, 9, 9, 0, 4]));

    const diff = await readDiff(repo, 'blob.bin');

    expect(diff.binary).toBe(true);
    expect(diff.hunks).toEqual([]);
  });

  it('answers with a null file when nothing changed', async () => {
    const repo = createRepoWithHistory();
    const { body } = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'README.md' })
      .expect(200);

    expect(body.file).toBeNull();
  });
});

describe('staging part of a file', () => {
  it('stages one hunk and leaves the other unstaged', async () => {
    const { repo, file } = repoWithTwoHunks();
    const diff = await readDiff(repo, file);
    const [first] = diff.hunks;

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: file, hunkIds: [first?.id] })
      .expect(200);

    const staged = stagedContent(repo, file);
    expect(staged).toContain('line 3 CHANGED');
    expect(staged).not.toContain('line 17 CHANGED');

    // The working tree still has both edits: staging moved nothing on disk.
    const working = workingContent(repo, file);
    expect(working).toContain('line 3 CHANGED');
    expect(working).toContain('line 17 CHANGED');

    // And the second hunk is still there to stage.
    const remaining = await readDiff(repo, file);
    expect(remaining.hunks).toHaveLength(1);
    expect(remaining.hunks[0]?.lines.some((line) => line.content === 'line 17 CHANGED')).toBe(true);
  });

  it('stages a single added line out of several', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'notes.txt', 'keep\n');
    git(repo, 'add', 'notes.txt');
    git(repo, 'commit', '-m', 'feat: notes');
    writeFile(repo, 'notes.txt', 'keep\nfirst new\nsecond new\nthird new\n');

    const diff = await readDiff(repo, 'notes.txt');
    const additions = diff.hunks[0]?.lines.filter((line) => line.kind === 'addition') ?? [];
    expect(additions).toHaveLength(3);

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'notes.txt', lineIds: [additions[1]?.id] })
      .expect(200);

    expect(stagedContent(repo, 'notes.txt')).toBe('keep\nsecond new\n');
    expect(workingContent(repo, 'notes.txt')).toBe('keep\nfirst new\nsecond new\nthird new\n');
  });

  it('stages a chosen deletion without staging the additions around it', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'edit.txt', 'one\ntwo\nthree\n');
    git(repo, 'add', 'edit.txt');
    git(repo, 'commit', '-m', 'feat: edit');
    writeFile(repo, 'edit.txt', 'one\nTWO\nthree\n');

    const diff = await readDiff(repo, 'edit.txt');
    const deletion = diff.hunks[0]?.lines.find((line) => line.kind === 'deletion');

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'edit.txt', lineIds: [deletion?.id] })
      .expect(200);

    // The removal is staged; the replacement line is not.
    expect(stagedContent(repo, 'edit.txt')).toBe('one\nthree\n');
  });

  it('stages part of a file git has never seen', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'fresh.txt', 'alpha\nbravo\ncharlie\n');

    const diff = await readDiff(repo, 'fresh.txt');
    const lines = diff.hunks[0]?.lines ?? [];

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'fresh.txt', lineIds: [lines[0]?.id, lines[2]?.id] })
      .expect(200);

    expect(stagedContent(repo, 'fresh.txt')).toBe('alpha\ncharlie\n');
    expect(workingContent(repo, 'fresh.txt')).toBe('alpha\nbravo\ncharlie\n');
  });
});

describe('unstaging part of a file', () => {
  it('removes one hunk from the index and keeps the rest staged', async () => {
    const { repo, file } = repoWithTwoHunks();
    git(repo, 'add', file);

    const staged = await readDiff(repo, file, 'index');
    expect(staged.hunks).toHaveLength(2);

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'unstage', filePath: file, hunkIds: [staged.hunks[1]?.id] })
      .expect(200);

    const indexed = stagedContent(repo, file);
    expect(indexed).toContain('line 3 CHANGED');
    expect(indexed).not.toContain('line 17 CHANGED');

    // Unstaging must never touch the working tree.
    expect(workingContent(repo, file)).toContain('line 17 CHANGED');
  });

  it('puts back a single deleted line without restoring the whole hunk', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'trim.txt', 'a\nb\nc\nd\n');
    git(repo, 'add', 'trim.txt');
    git(repo, 'commit', '-m', 'feat: trim');
    writeFile(repo, 'trim.txt', 'a\nd\n');
    git(repo, 'add', 'trim.txt');

    const staged = await readDiff(repo, 'trim.txt', 'index');
    const deletions = staged.hunks[0]?.lines.filter((line) => line.kind === 'deletion') ?? [];
    expect(deletions).toHaveLength(2);

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'unstage', filePath: 'trim.txt', lineIds: [deletions[0]?.id] })
      .expect(200);

    // "b" is back in the index; "c" is still staged for removal.
    expect(stagedContent(repo, 'trim.txt')).toBe('a\nb\nd\n');
    expect(workingContent(repo, 'trim.txt')).toBe('a\nd\n');
  });
});

describe('files that were wholly added or wholly deleted', () => {
  it('unstages one line of a newly added file, leaving the rest staged', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'added.txt', 'a\nb\nc\n');
    git(repo, 'add', 'added.txt');

    const staged = await readDiff(repo, 'added.txt', 'index');
    expect(staged.status).toBe('added');
    const middle = staged.hunks[0]?.lines[1];

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'unstage', filePath: 'added.txt', lineIds: [middle?.id] })
      .expect(200);

    // The file is still staged as an addition, minus the one line. A patch
    // that still called itself a file creation would make git refuse with
    // "new file added.txt depends on old contents".
    expect(stagedContent(repo, 'added.txt')).toBe('a\nc\n');
    expect(workingContent(repo, 'added.txt')).toBe('a\nb\nc\n');
  });

  it('stages one line of a whole-file deletion', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'doomed.txt', 'one\ntwo\nthree\n');
    git(repo, 'add', 'doomed.txt');
    git(repo, 'commit', '-m', 'feat: doomed');
    fs.rmSync(path.join(repo, 'doomed.txt'));

    const diff = await readDiff(repo, 'doomed.txt');
    expect(diff.status).toBe('deleted');
    const first = diff.hunks[0]?.lines[0];

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'doomed.txt', lineIds: [first?.id] })
      .expect(200);

    // Only that line's removal is staged; the file still exists in the index.
    expect(stagedContent(repo, 'doomed.txt')).toBe('two\nthree\n');
  });

  it('still stages a whole-file deletion when every line is selected', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'gone.txt', 'one\ntwo\n');
    git(repo, 'add', 'gone.txt');
    git(repo, 'commit', '-m', 'feat: gone');
    fs.rmSync(path.join(repo, 'gone.txt'));

    const diff = await readDiff(repo, 'gone.txt');

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'gone.txt', hunkIds: [diff.hunks[0]?.id] })
      .expect(200);

    expect(git(repo, 'diff', '--cached', '--name-status').trim()).toBe('D\tgone.txt');
  });
});

describe('discarding part of a file', () => {
  it('reverts one hunk in the working tree and snapshots it first', async () => {
    const { repo, file } = repoWithTwoHunks();
    const diff = await readDiff(repo, file);

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'discard', filePath: file, hunkIds: [diff.hunks[0]?.id] })
      .expect(200);

    const working = workingContent(repo, file);
    expect(working).not.toContain('line 3 CHANGED');
    expect(working).toContain('line 17 CHANGED');

    // Safety Net holds the pre-discard contents, which is the whole point of
    // routing every destructive action through it.
    const trash = listTrash(repo);
    expect(trash.some((entry) => entry.path === file)).toBe(true);
    const snapshot = fs.readFileSync(
      trash.find((entry) => entry.path === file)?.trashFile as string,
      'utf8'
    );
    expect(snapshot).toContain('line 3 CHANGED');
  });

  it('refuses to discard part of an untracked file', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'fresh.txt', 'alpha\nbravo\n');
    const diff = await readDiff(repo, 'fresh.txt');

    const { body } = await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'discard', filePath: 'fresh.txt', hunkIds: [diff.hunks[0]?.id] })
      .expect(400);

    expect(body.error).toMatch(/not tracked/i);
    expect(fs.existsSync(path.join(repo, 'fresh.txt'))).toBe(true);
  });
});

describe('selections that no longer describe the file', () => {
  it('refuses a hunk id that is not in the current diff', async () => {
    const { repo, file } = repoWithTwoHunks();
    const diff = await readDiff(repo, file);
    const [first, second] = diff.hunks;

    // Someone else edits the file between the read and the apply.
    writeFile(repo, file, `${workingContent(repo, file)}appended\n`);
    // The first hunk is untouched by an append at the end, so use the second,
    // whose trailing context now differs.
    expect(first?.id).toBeDefined();

    const { body } = await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: file, hunkIds: [second?.id] })
      .expect(409);

    expect(body.error).toMatch(/changed since/i);

    // Nothing was staged, so the user can reload and decide again.
    expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('refuses an empty selection rather than staging everything', async () => {
    const { repo, file } = repoWithTwoHunks();

    const { body } = await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: file, hunkIds: [], lineIds: [] })
      .expect(400);

    expect(body.error).toMatch(/at least one/i);
  });

  it('rejects an action it does not implement', async () => {
    const { repo, file } = repoWithTwoHunks();

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'delete-everything', filePath: file })
      .expect(400);
  });
});

describe('content git is fussy about', () => {
  it('preserves CRLF line endings through a partial stage', async () => {
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'crlf.txt'), 'one\r\ntwo\r\nthree\r\n', 'utf8');
    git(repo, 'add', 'crlf.txt');
    git(repo, 'commit', '-m', 'feat: crlf');
    fs.writeFileSync(path.join(repo, 'crlf.txt'), 'one\r\nTWO\r\nthree\r\nfour\r\n', 'utf8');

    const diff = await readDiff(repo, 'crlf.txt');
    const additions = diff.hunks[0]?.lines.filter((line) => line.kind === 'addition') ?? [];
    const four = additions.find((line) => line.content.startsWith('four'));

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'crlf.txt', lineIds: [four?.id] })
      .expect(200);

    // Every line, including the newly staged one, keeps its CR.
    expect(stagedContent(repo, 'crlf.txt')).toBe('one\r\ntwo\r\nthree\r\nfour\r\n');
  });

  it('keeps a file that ends without a newline ending without one', async () => {
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'nonl.txt'), 'first\nlast', 'utf8');
    git(repo, 'add', 'nonl.txt');
    git(repo, 'commit', '-m', 'feat: no trailing newline');
    fs.writeFileSync(path.join(repo, 'nonl.txt'), 'first\nlast changed', 'utf8');

    const diff = await readDiff(repo, 'nonl.txt');
    expect(diff.hunks[0]?.lines.some((line) => line.noNewline)).toBe(true);

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'nonl.txt', hunkIds: [diff.hunks[0]?.id] })
      .expect(200);

    expect(stagedContent(repo, 'nonl.txt')).toBe('first\nlast changed');
  });

  it('handles a path with a space and a non-ASCII name', async () => {
    const repo = createRepoWithHistory();
    const name = 'docs/café notes.txt';
    writeFile(repo, name, 'uno\ndos\n');
    git(repo, 'add', name);
    git(repo, 'commit', '-m', 'feat: unicode path');
    writeFile(repo, name, 'uno\nDOS\ntres\n');

    const diff = await readDiff(repo, name);
    const tres = diff.hunks[0]?.lines.find((line) => line.content === 'tres');

    await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: name, lineIds: [tres?.id] })
      .expect(200);

    expect(stagedContent(repo, name)).toBe('uno\ndos\ntres\n');
  });

  it('refuses line selection on a binary file with an explanation', async () => {
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.from([0, 1, 2]));
    git(repo, 'add', 'blob.bin');
    git(repo, 'commit', '-m', 'feat: blob');
    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.from([0, 5, 6]));

    const { body } = await api(repo)
      .post('/api/git/diff/apply-selection')
      .send({ action: 'stage', filePath: 'blob.bin' })
      .expect(400);

    expect(body.error).toMatch(/binary/i);
  });
});
