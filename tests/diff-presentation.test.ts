// Reviewing a change without reaching for another tool: word-level
// highlighting, whitespace handling, image comparison, and cancelling a read
// that is taking too long.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { imageMimeType } from '../src/server/git/blob';
import { diffWords, pairChangedLines, tokenize, MAX_TOKENS } from '../src/renderer/features/diff/word-diff';
import type { DiffHunk, StructuredDiffLine } from '../src/shared/diff-types';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Host', '127.0.0.1').set('x-repo-path', repo)
  };
}

/** A one-pixel PNG, so the fixtures are real image bytes rather than a stub. */
const PNG_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const PNG_BLUE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

beforeEach(() => {
  clearRepoPathCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('tokenizing a line', () => {
  it('keeps words, whitespace runs and punctuation apart', () => {
    expect(tokenize('const a = 1;')).toEqual(['const', ' ', 'a', ' ', '=', ' ', '1', ';']);
  });

  it('makes indentation a token of its own, so it can be the only change', () => {
    const diff = diffWords('  value', '    value');

    expect(diff.newSegments).toEqual([
      { kind: 'changed', text: '    ' },
      { kind: 'same', text: 'value' }
    ]);
  });
});

describe('word-level diffing', () => {
  it('marks only the word that changed', () => {
    const diff = diffWords('const total = price * quantity;', 'const total = price * amount;');

    expect(diff.oldSegments.filter((s) => s.kind === 'changed').map((s) => s.text)).toEqual([
      'quantity'
    ]);
    expect(diff.newSegments.filter((s) => s.kind === 'changed').map((s) => s.text)).toEqual([
      'amount'
    ]);
  });

  it('marks an inserted word without touching the rest', () => {
    const diff = diffWords('a b', 'a x b');

    expect(diff.oldSegments.every((s) => s.kind === 'same')).toBe(true);
    expect(diff.newSegments.filter((s) => s.kind === 'changed').map((s) => s.text)).toEqual(['x ']);
  });

  it('reports two entirely different lines as entirely changed', () => {
    const diff = diffWords('alpha', 'bravo');

    expect(diff.oldSegments).toEqual([{ kind: 'changed', text: 'alpha' }]);
    expect(diff.newSegments).toEqual([{ kind: 'changed', text: 'bravo' }]);
  });

  it('merges neighbouring changed tokens into one segment', () => {
    // "b", ".", "c" are three tokens and one run; emitting three spans for
    // them would triple the DOM for no extra information.
    const diff = diffWords('a', 'b.c');

    expect(diff.newSegments).toEqual([{ kind: 'changed', text: 'b.c' }]);
  });

  it('keeps shared whitespace common, so a run can be split by it', () => {
    // Deliberate: the space between two changed words is genuinely unchanged,
    // and marking it as changed would widen every highlight by a character.
    const diff = diffWords('one two three', 'one ONE TWO three');

    expect(diff.newSegments.filter((s) => s.kind === 'changed').map((s) => s.text)).toEqual([
      'ONE',
      'TWO '
    ]);
  });

  it('gives up rather than building a huge table for a minified line', () => {
    const long = Array.from({ length: MAX_TOKENS + 50 }, (_, i) => `t${i}`).join(' ');
    const diff = diffWords(long, `${long} extra`);

    expect(diff.oldSegments).toHaveLength(1);
    expect(diff.oldSegments[0]?.kind).toBe('changed');
  });

  it('says nothing for an empty side rather than emitting an empty segment', () => {
    expect(diffWords('', 'added').oldSegments).toEqual([]);
  });
});

describe('pairing changed lines', () => {
  function hunk(kinds: StructuredDiffLine['kind'][]): DiffHunk {
    return {
      id: 'h',
      header: '@@',
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      lines: kinds.map((kind, index) => ({
        id: `h:${index}`,
        kind,
        content: String(index),
        oldLine: null,
        newLine: null,
        noNewline: false
      }))
    };
  }

  it('pairs a removal with the addition that replaced it', () => {
    const pairs = pairChangedLines(hunk(['context', 'deletion', 'addition', 'context']));

    expect(pairs.get('h:1')).toBe('h:2');
    expect(pairs.get('h:2')).toBe('h:1');
  });

  it('pairs runs by position', () => {
    const pairs = pairChangedLines(hunk(['deletion', 'deletion', 'addition', 'addition']));

    expect(pairs.get('h:0')).toBe('h:2');
    expect(pairs.get('h:1')).toBe('h:3');
  });

  it('leaves the extra lines of an uneven run unpaired', () => {
    // Two removed, three added: the third addition replaced nothing, and
    // highlighting it against something would invent a relationship.
    const pairs = pairChangedLines(hunk(['deletion', 'deletion', 'addition', 'addition', 'addition']));

    expect(pairs.has('h:4')).toBe(false);
    expect(pairs.size).toBe(4);
  });

  it('pairs nothing in a hunk that only adds', () => {
    expect(pairChangedLines(hunk(['addition', 'addition'])).size).toBe(0);
  });
});

describe('whitespace handling', () => {
  function repoWithWhitespaceChange(): string {
    const repo = createRepoWithHistory();
    writeFile(repo, 'code.txt', 'alpha\nbravo\ncharlie\n');
    git(repo, 'add', 'code.txt');
    git(repo, 'commit', '-m', 'feat: code');

    // One real change, one that is only indentation.
    writeFile(repo, 'code.txt', 'alpha\n    bravo\nCHARLIE\n');
    return repo;
  }

  it('shows whitespace-only changes by default', async () => {
    const repo = repoWithWhitespaceChange();
    const { body } = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'code.txt' })
      .expect(200);

    expect(body.file.additions).toBe(2);
  });

  it('hides them when asked, keeping the real change', async () => {
    const repo = repoWithWhitespaceChange();
    const { body } = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'code.txt', whitespace: 'ignore-all' })
      .expect(200);

    expect(body.file.additions).toBe(1);
    expect(body.file.hunks[0].lines.some((line: { content: string }) => line.content === 'CHARLIE')).toBe(
      true
    );
  });

  it('rejects a whitespace mode it does not implement', async () => {
    const repo = repoWithWhitespaceChange();
    await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'code.txt', whitespace: 'invent-some' })
      .expect(400);
  });

  it('applies a selection from the full diff, never the whitespace-hiding one', async () => {
    // The apply path re-reads with whitespace shown. If it did not, staging a
    // hunk chosen while whitespace was hidden would silently drop the
    // indentation change from the file.
    const repo = repoWithWhitespaceChange();

    const shown = await api(repo)
      .get('/api/git/diff/structured')
      .query({ path: 'code.txt' })
      .expect(200);

    await request(app)
      .post('/api/git/diff/apply-selection')
      .set('Host', '127.0.0.1')
      .set('x-repo-path', repo)
      .send({ action: 'stage', filePath: 'code.txt', hunkIds: [shown.body.file.hunks[0].id] })
      .expect(200);

    expect(git(repo, 'show', ':code.txt')).toBe('alpha\n    bravo\nCHARLIE\n');
  });
});

describe('comparing images and binaries', () => {
  it('recognises the extensions it can render', () => {
    expect(imageMimeType('logo.png')).toBe('image/png');
    expect(imageMimeType('photo.JPEG')).toBe('image/jpeg');
    expect(imageMimeType('notes.txt')).toBeNull();
  });

  it('returns both versions of a changed image as data URIs', async () => {
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'logo.png'), PNG_RED);
    git(repo, 'add', 'logo.png');
    git(repo, 'commit', '-m', 'feat: add logo');
    fs.writeFileSync(path.join(repo, 'logo.png'), PNG_BLUE);
    git(repo, 'add', 'logo.png');

    const { body } = await api(repo)
      .get('/api/git/diff/blobs')
      .query({ path: 'logo.png', source: 'index' })
      .expect(200);

    expect(body.isImage).toBe(true);
    expect(body.old.dataUri).toBe(`data:image/png;base64,${PNG_RED.toString('base64')}`);
    expect(body.new.dataUri).toBe(`data:image/png;base64,${PNG_BLUE.toString('base64')}`);
  });

  it('survives the round trip through git without corrupting the bytes', async () => {
    // The bug this guards: reading a blob as UTF-8 text replaces every invalid
    // sequence, so the image that comes back is not the image that went in.
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'logo.png'), PNG_RED);
    git(repo, 'add', 'logo.png');
    git(repo, 'commit', '-m', 'feat: add logo');
    fs.writeFileSync(path.join(repo, 'logo.png'), PNG_BLUE);

    const { body } = await api(repo)
      .get('/api/git/diff/blobs')
      .query({ path: 'logo.png', source: 'working-tree' })
      .expect(200);

    const decoded = Buffer.from((body.old.dataUri as string).split(',')[1] as string, 'base64');
    expect(decoded.equals(PNG_RED)).toBe(true);
  });

  it('says a side is absent for a newly added image', async () => {
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'new.png'), PNG_RED);
    git(repo, 'add', 'new.png');

    const { body } = await api(repo)
      .get('/api/git/diff/blobs')
      .query({ path: 'new.png', source: 'index' })
      .expect(200);

    expect(body.old.exists).toBe(false);
    expect(body.old.dataUri).toBeNull();
    expect(body.new.exists).toBe(true);
  });

  it('reports sizes for a binary it cannot render', async () => {
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.alloc(100, 1));
    git(repo, 'add', 'blob.bin');
    git(repo, 'commit', '-m', 'feat: blob');
    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.alloc(250, 2));

    const { body } = await api(repo)
      .get('/api/git/diff/blobs')
      .query({ path: 'blob.bin', source: 'working-tree' })
      .expect(200);

    expect(body.isImage).toBe(false);
    expect(body.old.sizeBytes).toBe(100);
    expect(body.new.sizeBytes).toBe(250);
    expect(body.sizeDelta).toBe(150);
  });
});

describe('cancelling a read', () => {
  it('reports a cancelled git command as cancelled, not as a failure', async () => {
    const { runProcess } = await import('../src/server/process/run');

    const controller = new AbortController();
    const running = runProcess('git', ['--version'], { signal: controller.signal });
    controller.abort();

    const result = await running;
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it('does not report an ordinary command as cancelled', async () => {
    const { runProcess } = await import('../src/server/process/run');

    const result = await runProcess('git', ['--version'], { signal: new AbortController().signal });
    expect(result.cancelled).toBe(false);
    expect(result.code).toBe(0);
  });

  it('registers a diff read as an operation that can be cancelled', async () => {
    const { operations } = await import('../src/server/operations/registry');
    operations.clear();

    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', '# Changed\n');

    await api(repo).get('/api/git/diff/structured').query({ path: 'README.md' }).expect(200);

    const diffOperations = operations.list().filter((entry) => entry.kind === 'diff');
    expect(diffOperations).toHaveLength(1);
    expect(diffOperations[0]?.cancellable).toBe(true);
    expect(diffOperations[0]?.state).toBe('succeeded');
  });
});

describe('searching stashes', () => {
  function repoWithStashes(): string {
    const repo = createRepoWithHistory();

    writeFile(repo, 'README.md', '# One\n');
    git(repo, 'stash', 'push', '-m', 'readme work');

    writeFile(repo, 'src/app.txt', 'alpha\nbravo\nchanged\n');
    git(repo, 'stash', 'push', '-m', 'app tweaks');

    return repo;
  }

  it('returns everything when no query is given', async () => {
    const repo = repoWithStashes();
    const { body } = await api(repo).get('/api/git/stash/search').expect(200);

    expect(body.stashes).toHaveLength(2);
  });

  it('matches the stash message', async () => {
    const repo = repoWithStashes();
    const { body } = await api(repo).get('/api/git/stash/search').query({ query: 'readme' }).expect(200);

    expect(body.stashes).toHaveLength(1);
    expect(body.stashes[0].message).toContain('readme work');
  });

  it('matches a path inside the stash, which the message never mentions', async () => {
    const repo = repoWithStashes();
    const { body } = await api(repo).get('/api/git/stash/search').query({ query: 'app.txt' }).expect(200);

    expect(body.stashes).toHaveLength(1);
    expect(body.stashes[0].matchedFiles).toEqual(['src/app.txt']);
  });

  it('answers with nothing when nothing matches', async () => {
    const repo = repoWithStashes();
    const { body } = await api(repo).get('/api/git/stash/search').query({ query: 'zzz' }).expect(200);

    expect(body.stashes).toEqual([]);
  });
});
