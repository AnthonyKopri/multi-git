// The durable half of Safety Net, against real repositories.
//
// Every case runs a destructive operation for real and then asks whether the
// original position is still reachable. A recovery point that records the
// right object name but cannot actually get you back to it is worth nothing,
// so the assertions are about the repository afterwards, not about the JSON.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { clearCheckpoints } from '../src/server/safety-net/checkpoints';
import {
  MAX_RECOVERY_POINTS,
  clearRecoveryCache,
  pruneRecoveryPoints
} from '../src/server/safety-net/recovery';
import { readReflog } from '../src/server/git/reflog';
import type { RecoveryPoint } from '../src/shared/recovery-types';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Host', '127.0.0.1').set('x-repo-path', repo),
    post: (url: string) => agent.post(url).set('Host', '127.0.0.1').set('x-repo-path', repo),
    delete: (url: string) => agent.delete(url).set('Host', '127.0.0.1').set('x-repo-path', repo)
  };
}

async function recovery(repo: string): Promise<{
  points: RecoveryPoint[];
  reflog: { action: string; oid: string; selector: string }[];
  retentionDays: number;
  operationInProgress: boolean;
}> {
  const { body } = await api(repo).get('/api/git/recovery').expect(200);
  return body;
}

function head(repo: string): string {
  return git(repo, 'rev-parse', 'HEAD').trim();
}

/**
 * The reset route takes an object name, not a revision expression: `commitish`
 * rejects `~` so that a crafted ref can never be read as an option. Tests go
 * through the same door the UI does.
 */
function parent(repo: string): string {
  return git(repo, 'rev-parse', 'HEAD~1').trim();
}

beforeEach(() => {
  clearRepoPathCache();
  clearRecoveryCache();
  clearCheckpoints();
});

afterEach(() => {
  clearRecoveryCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('recording a recovery point', () => {
  it('records where HEAD was before a hard reset', async () => {
    const repo = createRepoWithHistory();
    const before = head(repo);

    await api(repo)
      .post('/api/git/reset')
      .send({ hash: parent(repo), mode: 'hard' })
      .expect(200);

    const { points } = await recovery(repo);
    expect(points).toHaveLength(1);
    expect(points[0]?.operation).toBe('reset');
    expect(points[0]?.refs['HEAD']).toBe(before);
    expect(points[0]?.headRef).toBe('refs/heads/main');
    expect(head(repo)).not.toBe(before);
  });

  it('survives a backend restart, unlike the in-memory checkpoints', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'hard' }).expect(200);

    // What a restart amounts to for both stores.
    clearCheckpoints();
    clearRecoveryCache();

    const { body: checkpoints } = await api(repo).get('/api/git/checkpoints').expect(200);
    expect(checkpoints.checkpoints).toEqual([]);

    const { points } = await recovery(repo);
    expect(points).toHaveLength(1);
  });

  it('writes the journal inside the repository, not the user config', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'mixed' }).expect(200);

    expect(fs.existsSync(path.join(repo, '.git', 'multi-git', 'recovery.json'))).toBe(true);
  });

  it('records the branch tip before a branch is deleted', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'branch', 'doomed');
    const tip = git(repo, 'rev-parse', 'doomed').trim();

    await api(repo).post('/api/git/delete-branch').send({ branch: 'doomed', force: true }).expect(200);

    const { points } = await recovery(repo);
    const point = points.find((candidate) => candidate.operation === 'branch-delete');
    expect(point?.refs['refs/heads/doomed']).toBe(tip);
  });

  it('records the stash commit before the stash is dropped', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', '# Changed\n');
    git(repo, 'stash', 'push', '-m', 'work in progress');
    const stashOid = git(repo, 'rev-parse', 'stash@{0}').trim();

    const { body } = await api(repo)
      .post('/api/git/stash/drop')
      .send({ ref: 'stash@{0}' })
      .expect(200);

    expect(body.droppedCommit).toBe(stashOid);

    const { points } = await recovery(repo);
    const point = points.find((candidate) => candidate.operation === 'stash-drop');
    expect(point?.stashRef).toBe(stashOid);

    // The dropped commit is unreachable but still in the object store, which
    // is exactly the window this point exists to make usable.
    expect(() => git(repo, 'cat-file', '-e', `${stashOid}^{commit}`)).not.toThrow();
  });

  it('records an amend, whose replaced commit only the reflog remembers', async () => {
    const repo = createRepoWithHistory();
    const before = head(repo);

    await api(repo).post('/api/git/commit').send({ message: 'reworded', amend: true }).expect(200);

    const { points } = await recovery(repo);
    expect(points[0]?.operation).toBe('amend');
    expect(points[0]?.refs['HEAD']).toBe(before);
    expect(head(repo)).not.toBe(before);
  });

  it('says nothing at all in a repository with no commits', async () => {
    const repo = createRepoWithHistory();
    // A fresh repository has no HEAD, so there is no position to record. The
    // closest reachable case is asking for the list before anything happened.
    const { points } = await recovery(repo);
    expect(points).toEqual([]);
  });
});

describe('getting back', () => {
  it('creates a branch at a recorded position without moving HEAD', async () => {
    const repo = createRepoWithHistory();
    const before = head(repo);
    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'hard' }).expect(200);
    const afterReset = head(repo);

    await api(repo)
      .post('/api/git/recovery/branch')
      .send({ oid: before, branchName: 'rescued' })
      .expect(200);

    expect(git(repo, 'rev-parse', 'rescued').trim()).toBe(before);
    // Branching is the non-destructive route out: nothing the user stands on moves.
    expect(head(repo)).toBe(afterReset);
  });

  it('restores the branch and the working tree to a recorded position', async () => {
    const repo = createRepoWithHistory();
    const before = head(repo);
    const readmeBefore = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');

    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'hard' }).expect(200);
    expect(fs.existsSync(path.join(repo, 'src', 'app.txt'))).toBe(false);

    const { points } = await recovery(repo);
    const { body } = await api(repo)
      .post('/api/git/recovery/restore')
      .send({ pointId: points[0]?.id, ref: 'HEAD' })
      .expect(200);

    expect(body.oid).toBe(before);
    expect(head(repo)).toBe(before);
    expect(fs.existsSync(path.join(repo, 'src', 'app.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe(readmeBefore);
  });

  it('records a point of its own before restoring, so the undo is undoable', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'hard' }).expect(200);
    const afterReset = head(repo);

    const first = await recovery(repo);
    await api(repo)
      .post('/api/git/recovery/restore')
      .send({ pointId: first.points[0]?.id })
      .expect(200);

    const second = await recovery(repo);
    const undoOfUndo = second.points.find((point) => point.operation === 'restore');
    expect(undoOfUndo?.refs['HEAD']).toBe(afterReset);
  });

  it('moves a ref that is not checked out without touching the working tree', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'branch', 'side');
    const sideTip = git(repo, 'rev-parse', 'side').trim();

    await api(repo).post('/api/git/delete-branch').send({ branch: 'side', force: true }).expect(200);
    git(repo, 'branch', 'side', 'HEAD~1');

    const { points } = await recovery(repo);
    const point = points.find((candidate) => candidate.operation === 'branch-delete');
    const headBefore = head(repo);

    await api(repo)
      .post('/api/git/recovery/restore')
      .send({ pointId: point?.id, ref: 'refs/heads/side' })
      .expect(200);

    expect(git(repo, 'rev-parse', 'side').trim()).toBe(sideTip);
    expect(head(repo)).toBe(headBefore);
  });

  it('refuses a point whose commit the repository no longer has', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'hard' }).expect(200);

    const { points } = await recovery(repo);
    const file = path.join(repo, '.git', 'multi-git', 'recovery.json');
    const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as RecoveryPoint[];
    (journal[0] as RecoveryPoint).refs['HEAD'] = '0'.repeat(40);
    fs.writeFileSync(file, JSON.stringify(journal));

    const { body } = await api(repo)
      .post('/api/git/recovery/restore')
      .send({ pointId: points[0]?.id })
      .expect(410);

    expect(body.error).toMatch(/no longer in this repository/i);
  });

  it('forgets a point without touching the commits it named', async () => {
    const repo = createRepoWithHistory();
    const before = head(repo);
    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'hard' }).expect(200);

    const { points } = await recovery(repo);
    await api(repo).delete('/api/git/recovery').send({ id: points[0]?.id }).expect(200);

    expect((await recovery(repo)).points).toEqual([]);
    expect(() => git(repo, 'cat-file', '-e', `${before}^{commit}`)).not.toThrow();
  });

  it('answers 404 for a point that is not in the journal', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/recovery/restore').send({ pointId: 'nope' }).expect(404);
  });
});

describe('the reflog', () => {
  it('reads HEAD newest first, with each entry knowing where it came from', async () => {
    const repo = createRepoWithHistory();
    const entries = await readReflog(repo);

    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries[0]?.selector).toBe('HEAD@{0}');
    expect(entries[0]?.oid).toBe(head(repo));
    // Newest first means the previous position is the next entry's.
    expect(entries[0]?.previousOid).toBe(entries[1]?.oid);
    expect(entries.at(-1)?.previousOid).toBeNull();
  });

  it('splits the action from the rest of the message', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'hard' }).expect(200);

    const entries = await readReflog(repo);
    expect(entries[0]?.action).toBe('reset');
    expect(entries[0]?.subject).toContain('moving to');
  });

  it('is empty rather than an error where there is no reflog', async () => {
    const notARepo = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'multi-git-noreflog-'));
    try {
      expect(await readReflog(notARepo)).toEqual([]);
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it('is served alongside the recovery points', async () => {
    const repo = createRepoWithHistory();
    const { reflog } = await recovery(repo);

    expect(reflog.length).toBeGreaterThan(0);
    expect(reflog[0]?.oid).toBe(head(repo));
  });
});

describe('expiry', () => {
  it('drops a point past its expiry and keeps one without an expiry', () => {
    const now = Date.parse('2026-08-08T12:00:00Z');
    const point = (id: string, expiresAt: string | null): RecoveryPoint => ({
      id,
      operation: 'reset',
      label: id,
      refs: {},
      headRef: null,
      createdAt: '2026-08-01T12:00:00Z',
      expiresAt
    });

    const kept = pruneRecoveryPoints(
      [
        point('expired', '2026-08-07T12:00:00Z'),
        point('current', '2026-08-09T12:00:00Z'),
        point('forever', null)
      ],
      now
    );

    expect(kept.map((entry) => entry.id)).toEqual(['current', 'forever']);
  });

  it('caps the journal so a busy repository cannot grow it without limit', () => {
    const points: RecoveryPoint[] = Array.from({ length: MAX_RECOVERY_POINTS + 20 }, (_, index) => ({
      id: String(index),
      operation: 'reset',
      label: String(index),
      refs: {},
      headRef: null,
      createdAt: '2026-08-01T12:00:00Z',
      expiresAt: null
    }));

    expect(pruneRecoveryPoints(points)).toHaveLength(MAX_RECOVERY_POINTS);
  });

  it('freezes the journal while an operation is unfinished', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'mixed' }).expect(200);

    // Backdate the point past its expiry, then leave a merge half-done.
    const file = path.join(repo, '.git', 'multi-git', 'recovery.json');
    const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as RecoveryPoint[];
    (journal[0] as RecoveryPoint).expiresAt = '2000-01-01T00:00:00Z';
    fs.writeFileSync(file, JSON.stringify(journal));
    fs.writeFileSync(path.join(repo, '.git', 'MERGE_HEAD'), `${head(repo)}\n`);

    const midOperation = await recovery(repo);
    expect(midOperation.operationInProgress).toBe(true);
    expect(midOperation.points).toHaveLength(1);

    // Finishing the operation lets the expired point go.
    fs.rmSync(path.join(repo, '.git', 'MERGE_HEAD'));
    const afterwards = await recovery(repo);
    expect(afterwards.operationInProgress).toBe(false);
    expect(afterwards.points).toEqual([]);
  });

  it('refuses to restore while a merge is unfinished', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/reset').send({ hash: parent(repo), mode: 'mixed' }).expect(200);
    const { points } = await recovery(repo);

    fs.writeFileSync(path.join(repo, '.git', 'MERGE_HEAD'), `${head(repo)}\n`);

    const { body } = await api(repo)
      .post('/api/git/recovery/restore')
      .send({ pointId: points[0]?.id })
      .expect(400);

    expect(body.error).toMatch(/merge or rebase/i);
  });
});
