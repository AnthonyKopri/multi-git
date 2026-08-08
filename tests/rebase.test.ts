// Interactive rebase against real repositories.
//
// The point of every case here is that git actually ran. `git rebase -i` will
// happily hang forever waiting for an editor, so a test that only checked the
// plan would prove nothing about the part most likely to be wrong.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { clearRecoveryCache } from '../src/server/safety-net/recovery';
import { applyAutosquash, clearRebaseCache, renderTodo, validatePlan } from '../src/server/git/rebase';
import type { RebasePlan, RebaseTodoItem } from '../src/shared/rebase-types';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Host', '127.0.0.1').set('x-repo-path', repo),
    post: (url: string) => agent.post(url).set('Host', '127.0.0.1').set('x-repo-path', repo)
  };
}

/** Subjects from oldest to newest, which is the order a plan is written in. */
function subjects(repo: string, range = 'HEAD~4..HEAD'): string[] {
  return git(repo, 'log', '--reverse', '--pretty=%s', range)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function commit(repo: string, file: string, contents: string, message: string): void {
  writeFile(repo, file, contents);
  git(repo, 'add', file);
  git(repo, 'commit', '-m', message);
}

/** A base commit plus four on top of it, each touching its own file. */
function repoWithFour(): { repo: string; base: string } {
  const repo = createRepoWithHistory();
  const base = git(repo, 'rev-parse', 'HEAD').trim();

  commit(repo, 'a.txt', 'a\n', 'feat: first');
  commit(repo, 'b.txt', 'b\n', 'feat: second');
  commit(repo, 'c.txt', 'c\n', 'feat: third');
  commit(repo, 'd.txt', 'd\n', 'feat: fourth');

  return { repo, base };
}

async function planFor(repo: string, base: string, autosquash = false): Promise<RebasePlan> {
  const { body } = await api(repo)
    .get('/api/git/rebase/plan')
    .query({ onto: base, autosquash: autosquash ? 'true' : 'false' })
    .expect(200);
  return body.plan as RebasePlan;
}

function withActions(
  plan: RebasePlan,
  changes: Record<string, RebaseTodoItem['action']>
): RebasePlan {
  return {
    ...plan,
    items: plan.items.map((item) =>
      changes[item.subject] ? { ...item, action: changes[item.subject] as RebaseTodoItem['action'] } : item
    )
  };
}

beforeEach(() => {
  clearRepoPathCache();
  clearRecoveryCache();
  clearRebaseCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('building and validating a plan', () => {
  it('lists the commits oldest first, all picked', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    expect(plan.items.map((item) => item.subject)).toEqual([
      'feat: first',
      'feat: second',
      'feat: third',
      'feat: fourth'
    ]);
    expect(plan.items.every((item) => item.action === 'pick')).toBe(true);
    expect(plan.onto).toBe(base);
  });

  it('reports how much of the range is already published', async () => {
    const { repo, base } = repoWithFour();
    git(repo, 'remote', 'add', 'origin', 'https://example.invalid/repo.git');
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD~1');
    git(repo, 'branch', '--set-upstream-to=origin/main', 'main');

    const { body } = await api(repo)
      .get('/api/git/rebase/plan')
      .query({ onto: base })
      .expect(200);

    expect(body.warning.upstream).toBe('origin/main');
    // Three of the four are on the remote, so rewriting them costs something.
    expect(body.warning.publishedCommits).toBe(3);
  });

  it('rejects a duplicated commit and a commit from outside the range', () => {
    const original: RebaseTodoItem[] = [
      { oid: 'aaaa1111', action: 'pick', subject: 'one', author: '', date: '' },
      { oid: 'bbbb2222', action: 'pick', subject: 'two', author: '', date: '' }
    ];

    const duplicated = validatePlan(
      { onto: 'base', autosquash: false, items: [original[0] as RebaseTodoItem, original[0] as RebaseTodoItem] },
      original
    );
    expect(duplicated.valid).toBe(false);
    expect(duplicated.errors.join(' ')).toMatch(/more than once/);

    const foreign = validatePlan(
      {
        onto: 'base',
        autosquash: false,
        items: [{ oid: 'cccc3333', action: 'pick', subject: 'three', author: '', date: '' }]
      },
      original
    );
    expect(foreign.valid).toBe(false);
    expect(foreign.errors.join(' ')).toMatch(/not one of the commits/);
  });

  it('refuses a plan whose first surviving commit is a squash', () => {
    const original: RebaseTodoItem[] = [
      { oid: 'aaaa1111', action: 'pick', subject: 'one', author: '', date: '' }
    ];

    const result = validatePlan(
      {
        onto: 'base',
        autosquash: false,
        items: [{ oid: 'aaaa1111', action: 'squash', subject: 'one', author: '', date: '' }]
      },
      original
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/nothing before it/);
  });

  it('refuses a plan that drops everything', () => {
    const original: RebaseTodoItem[] = [
      { oid: 'aaaa1111', action: 'pick', subject: 'one', author: '', date: '' }
    ];

    const result = validatePlan(
      { onto: 'base', autosquash: false, items: [{ ...original[0] as RebaseTodoItem, action: 'drop' }] },
      original
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/nothing to rebase/);
  });

  it('warns rather than fails when a commit was left out of the plan', () => {
    const original: RebaseTodoItem[] = [
      { oid: 'aaaa1111', action: 'pick', subject: 'one', author: '', date: '' },
      { oid: 'bbbb2222', action: 'pick', subject: 'two', author: '', date: '' }
    ];

    const result = validatePlan(
      { onto: 'base', autosquash: false, items: [original[0] as RebaseTodoItem] },
      original
    );

    expect(result.valid).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/was removed from the plan/);
  });
});

describe('the todo git is handed', () => {
  it('writes one line per surviving commit, and drops the dropped', () => {
    const plan: RebasePlan = {
      onto: 'base',
      autosquash: false,
      items: [
        { oid: 'aaaa1111', action: 'pick', subject: 'one', author: '', date: '' },
        { oid: 'bbbb2222', action: 'drop', subject: 'two', author: '', date: '' },
        { oid: 'cccc3333', action: 'fixup', subject: 'three', author: '', date: '' }
      ]
    };

    expect(renderTodo(plan)).toBe('pick aaaa1111 one\nfixup cccc3333 three\n');
  });

  it('writes a reword as an edit, because the message is applied at the stop', () => {
    const plan: RebasePlan = {
      onto: 'base',
      autosquash: false,
      items: [{ oid: 'aaaa1111', action: 'reword', subject: 'one', author: '', date: '', message: 'new' }]
    };

    expect(renderTodo(plan)).toBe('edit aaaa1111 one\n');
  });

  it('cannot be made to forge a second line from a commit subject', () => {
    const plan: RebasePlan = {
      onto: 'base',
      autosquash: false,
      items: [
        { oid: 'aaaa1111', action: 'pick', subject: 'one\nexec rm -rf /', author: '', date: '' }
      ]
    };

    expect(renderTodo(plan)).toBe('pick aaaa1111 one exec rm -rf /\n');
  });
});

describe('autosquash', () => {
  it('moves a fixup under the commit it names', () => {
    const items: RebaseTodoItem[] = [
      { oid: '1', action: 'pick', subject: 'feat: thing', author: '', date: '' },
      { oid: '2', action: 'pick', subject: 'feat: other', author: '', date: '' },
      { oid: '3', action: 'pick', subject: 'fixup! feat: thing', author: '', date: '' }
    ];

    const squashed = applyAutosquash(items);

    expect(squashed.map((item) => `${item.action} ${item.subject}`)).toEqual([
      'pick feat: thing',
      'fixup fixup! feat: thing',
      'pick feat: other'
    ]);
  });

  it('keeps a marker whose target is not there rather than losing it', () => {
    const items: RebaseTodoItem[] = [
      { oid: '1', action: 'pick', subject: 'feat: thing', author: '', date: '' },
      { oid: '2', action: 'pick', subject: 'squash! feat: missing', author: '', date: '' }
    ];

    const squashed = applyAutosquash(items);

    expect(squashed).toHaveLength(2);
    expect(squashed[1]).toMatchObject({ oid: '2', action: 'pick' });
  });

  it('previews the reordering through the plan endpoint', async () => {
    const { repo, base } = repoWithFour();
    commit(repo, 'a.txt', 'a fixed\n', 'fixup! feat: first');

    const plan = await planFor(repo, base, true);

    expect(plan.items.map((item) => item.action)).toEqual([
      'pick',
      'fixup',
      'pick',
      'pick',
      'pick'
    ]);
    expect(plan.items[1]?.subject).toBe('fixup! feat: first');
  });
});

describe('running a rebase', () => {
  it('reorders commits', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    // Move the last commit to the front.
    const reordered: RebasePlan = {
      ...plan,
      items: [plan.items[3] as RebaseTodoItem, ...plan.items.slice(0, 3)]
    };

    const { body } = await api(repo).post('/api/git/rebase/start').send({ plan: reordered }).expect(200);

    expect(body.stopped).toBe(false);
    expect(subjects(repo)).toEqual([
      'feat: fourth',
      'feat: first',
      'feat: second',
      'feat: third'
    ]);
  });

  it('drops a commit and the file it added', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: second': 'drop' }) })
      .expect(200);

    expect(subjects(repo, 'HEAD~3..HEAD')).toEqual([
      'feat: first',
      'feat: third',
      'feat: fourth'
    ]);
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(false);
  });

  it('squashes two commits into one', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: second': 'squash' }) })
      .expect(200);

    const messages = git(repo, 'log', '--reverse', '--pretty=%B', `${base}..HEAD`);
    expect(subjects(repo, 'HEAD~3..HEAD')).toEqual(['feat: first', 'feat: third', 'feat: fourth']);
    // A squash keeps both messages; a fixup would not.
    expect(messages).toContain('feat: second');
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(true);
  });

  it('fixes up, keeping the change and discarding the message', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: second': 'fixup' }) })
      .expect(200);

    const messages = git(repo, 'log', '--pretty=%B', `${base}..HEAD`);
    expect(messages).not.toContain('feat: second');
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(true);
  });

  it('rewords a commit without stopping for a human', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    const reworded: RebasePlan = {
      ...plan,
      items: plan.items.map((item) =>
        item.subject === 'feat: second'
          ? { ...item, action: 'reword' as const, message: 'feat: renamed second' }
          : item
      )
    };

    const { body } = await api(repo).post('/api/git/rebase/start').send({ plan: reworded }).expect(200);

    expect(body.stopped).toBe(false);
    expect(subjects(repo)).toEqual([
      'feat: first',
      'feat: renamed second',
      'feat: third',
      'feat: fourth'
    ]);
  });

  it('stops at an edit and reports where it is', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    const { body } = await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: second': 'edit' }) })
      .expect(200);

    expect(body.stopped).toBe(true);
    expect(body.status.inProgress).toBe(true);
    expect(body.status.stoppedSubject).toBe('feat: second');
    expect(body.status.canSplit).toBe(true);

    // The session survives a fresh read, which is what a restart amounts to.
    clearRebaseCache();
    const status = await api(repo).get('/api/git/rebase/status').expect(200);
    expect(status.body.status.inProgress).toBe(true);
    expect(status.body.status.plan.items).toHaveLength(4);

    await api(repo).post('/api/git/rebase/step').send({ step: 'continue' }).expect(200);
    expect(subjects(repo)).toHaveLength(4);
  });

  it('records a recovery point before it starts', async () => {
    const { repo, base } = repoWithFour();
    const before = git(repo, 'rev-parse', 'HEAD').trim();
    const plan = await planFor(repo, base);

    await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: second': 'drop' }) })
      .expect(200);

    const { body } = await api(repo).get('/api/git/recovery').expect(200);
    const point = body.points.find((entry: { operation: string }) => entry.operation === 'rebase');
    expect(point.refs['HEAD']).toBe(before);
  });

  it('refuses to start a second rebase over a running one', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: second': 'edit' }) })
      .expect(200);

    await api(repo).post('/api/git/rebase/start').send({ plan }).expect(409);

    await api(repo).post('/api/git/rebase/step').send({ step: 'abort' }).expect(200);
  });

  it('reports a rebase git refused as a failure, not as one that finished', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);
    const before = git(repo, 'rev-parse', 'HEAD').trim();

    // Git will not rebase over an unstaged change. Nothing runs, and the
    // danger is that "no rebase in progress afterwards" looks exactly like a
    // rebase that completed.
    writeFile(repo, 'a.txt', 'a modified\n');

    const { body } = await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: second': 'drop' }) })
      .expect(400);

    expect(body.error).toMatch(/unstaged|cannot rebase/i);
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(before);
    expect(subjects(repo)).toHaveLength(4);

    // And no session is left claiming a rebase that never began.
    const status = await api(repo).get('/api/git/rebase/status').expect(200);
    expect(status.body.status.inProgress).toBe(false);
  });

  it('refuses a plan that no longer matches the commits that are there', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    const bogus: RebasePlan = {
      ...plan,
      items: [{ ...(plan.items[0] as RebaseTodoItem), oid: 'f'.repeat(40) }]
    };

    const { body } = await api(repo).post('/api/git/rebase/start').send({ plan: bogus }).expect(400);
    expect(body.error).toMatch(/not one of the commits/);
    // Nothing ran, so history is untouched.
    expect(subjects(repo)).toHaveLength(4);
  });
});

describe('conflicts', () => {
  /** Two commits that both change the same line, reordered so they clash. */
  function conflictingRepo(): { repo: string; base: string } {
    const repo = createRepoWithHistory();
    const base = git(repo, 'rev-parse', 'HEAD').trim();

    commit(repo, 'shared.txt', 'one\n', 'feat: add shared');
    commit(repo, 'shared.txt', 'two\n', 'feat: change to two');
    commit(repo, 'shared.txt', 'three\n', 'feat: change to three');

    return { repo, base };
  }

  it('stops with the conflicted file named, and aborts back to where it was', async () => {
    const { repo, base } = conflictingRepo();
    const before = git(repo, 'rev-parse', 'HEAD').trim();
    const plan = await planFor(repo, base);

    // Putting the third commit before the second makes them collide.
    const reordered: RebasePlan = {
      ...plan,
      items: [plan.items[0] as RebaseTodoItem, plan.items[2] as RebaseTodoItem, plan.items[1] as RebaseTodoItem]
    };

    const { body } = await api(repo).post('/api/git/rebase/start').send({ plan: reordered }).expect(200);

    expect(body.stopped).toBe(true);
    expect(body.status.conflictedFiles).toEqual(['shared.txt']);
    expect(body.status.canSplit).toBe(false);

    const aborted = await api(repo).post('/api/git/rebase/step').send({ step: 'abort' }).expect(200);
    expect(aborted.body.status.inProgress).toBe(false);
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(before);
  });

  it('continues once each conflict is resolved, one stop at a time', async () => {
    const { repo, base } = conflictingRepo();
    const plan = await planFor(repo, base);

    const reordered: RebasePlan = {
      ...plan,
      items: [plan.items[0] as RebaseTodoItem, plan.items[2] as RebaseTodoItem, plan.items[1] as RebaseTodoItem]
    };
    await api(repo).post('/api/git/rebase/start').send({ plan: reordered }).expect(200);

    // Both reordered commits rewrite the same line, so resolving the first
    // conflict leads straight into the second rather than to the end.
    writeFile(repo, 'shared.txt', 'resolved once\n');
    git(repo, 'add', 'shared.txt');

    const first = await api(repo).post('/api/git/rebase/step').send({ step: 'continue' }).expect(200);
    expect(first.body.status.inProgress).toBe(true);
    expect(first.body.status.conflictedFiles).toEqual(['shared.txt']);

    writeFile(repo, 'shared.txt', 'resolved twice\n');
    git(repo, 'add', 'shared.txt');

    const second = await api(repo).post('/api/git/rebase/step').send({ step: 'continue' }).expect(200);
    expect(second.body.status.inProgress).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'shared.txt'), 'utf8')).toBe('resolved twice\n');
  });

  it('skips a commit that conflicts', async () => {
    const { repo, base } = conflictingRepo();
    const plan = await planFor(repo, base);

    const reordered: RebasePlan = {
      ...plan,
      items: [plan.items[0] as RebaseTodoItem, plan.items[2] as RebaseTodoItem, plan.items[1] as RebaseTodoItem]
    };
    await api(repo).post('/api/git/rebase/start').send({ plan: reordered }).expect(200);

    const { body } = await api(repo).post('/api/git/rebase/step').send({ step: 'skip' }).expect(200);

    // Skipping drops "change to three" entirely, so the commit after it —
    // which turns "one" into "two" — applies cleanly and has the last word.
    expect(body.status.inProgress).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'shared.txt'), 'utf8')).toBe('two\n');
    expect(subjects(repo, `${base}..HEAD`)).toEqual([
      'feat: add shared',
      'feat: change to two'
    ]);
  });

  it('says there is nothing to step when no rebase is running', async () => {
    const { repo } = repoWithFour();
    await api(repo).post('/api/git/rebase/step').send({ step: 'continue' }).expect(409);
  });
});

describe('splitting a commit', () => {
  it('resets the stopped commit into the working tree and resumes after', async () => {
    const repo = createRepoWithHistory();
    const base = git(repo, 'rev-parse', 'HEAD').trim();

    writeFile(repo, 'one.txt', 'one\n');
    writeFile(repo, 'two.txt', 'two\n');
    git(repo, 'add', 'one.txt', 'two.txt');
    git(repo, 'commit', '-m', 'feat: two things at once');
    commit(repo, 'after.txt', 'after\n', 'feat: after');

    const plan = await planFor(repo, base);
    await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: two things at once': 'edit' }) })
      .expect(200);

    const { body } = await api(repo).post('/api/git/rebase/split').expect(200);

    // Both files are back in the working tree, nothing staged.
    expect(body.status.splitInProgress).toBe(true);
    expect(body.remainder.staged).toBe(0);
    expect(body.remainder.clean).toBe(false);
    expect(git(repo, 'log', '--pretty=%s', '-1').trim()).not.toBe('feat: two things at once');

    // The user's half of the work: two commits instead of one.
    git(repo, 'add', 'one.txt');
    git(repo, 'commit', '-m', 'feat: one thing');
    git(repo, 'add', 'two.txt');
    git(repo, 'commit', '-m', 'feat: the other thing');

    const finished = await api(repo)
      .post('/api/git/rebase/step')
      .send({ step: 'continue' })
      .expect(200);

    expect(finished.body.status.inProgress).toBe(false);
    expect(subjects(repo, `${base}..HEAD`)).toEqual([
      'feat: one thing',
      'feat: the other thing',
      'feat: after'
    ]);
  });

  it('refuses to split while there are conflicts to resolve', async () => {
    const repo = createRepoWithHistory();
    const base = git(repo, 'rev-parse', 'HEAD').trim();

    commit(repo, 'shared.txt', 'one\n', 'feat: add shared');
    commit(repo, 'shared.txt', 'two\n', 'feat: change to two');
    commit(repo, 'shared.txt', 'three\n', 'feat: change to three');

    const plan = await planFor(repo, base);
    const reordered: RebasePlan = {
      ...plan,
      items: [plan.items[0] as RebaseTodoItem, plan.items[2] as RebaseTodoItem, plan.items[1] as RebaseTodoItem]
    };
    await api(repo).post('/api/git/rebase/start').send({ plan: reordered }).expect(200);

    await api(repo).post('/api/git/rebase/split').expect(500);
    await api(repo).post('/api/git/rebase/step').send({ step: 'abort' }).expect(200);
  });

  it('says there is nothing to split when no rebase is running', async () => {
    const { repo } = repoWithFour();
    await api(repo).post('/api/git/rebase/split').expect(500);
  });
});

describe('the editor bridge', () => {
  it('leaves no temporary directory behind once the rebase finishes', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    const before = fs
      .readdirSync(require('node:os').tmpdir())
      .filter((entry) => entry.startsWith('multi-git-rebase-')).length;

    await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: second': 'drop' }) })
      .expect(200);

    const after = fs
      .readdirSync(require('node:os').tmpdir())
      .filter((entry) => entry.startsWith('multi-git-rebase-')).length;

    expect(after).toBeLessThanOrEqual(before);
  });

  it('removes the session file when the rebase ends', async () => {
    const { repo, base } = repoWithFour();
    const plan = await planFor(repo, base);

    await api(repo)
      .post('/api/git/rebase/start')
      .send({ plan: withActions(plan, { 'feat: second': 'edit' }) })
      .expect(200);
    expect(fs.existsSync(path.join(repo, '.git', 'multi-git', 'rebase-session.json'))).toBe(true);

    await api(repo).post('/api/git/rebase/step').send({ step: 'abort' }).expect(200);
    expect(fs.existsSync(path.join(repo, '.git', 'multi-git', 'rebase-session.json'))).toBe(false);
  });
});

describe('long repository paths on Windows', () => {
  it('asks for core.longpaths only where it means something', async () => {
    const { rebaseGitArgs } = await import('../src/server/git/rebase');
    const args = rebaseGitArgs(['rebase', '-i', 'HEAD~3']);

    if (process.platform === 'win32') {
      // Per invocation, never written to the user's configuration.
      expect(args.slice(0, 2)).toEqual(['-c', 'core.longpaths=true']);
      expect(args.slice(2)).toEqual(['rebase', '-i', 'HEAD~3']);
    } else {
      expect(args).toEqual(['rebase', '-i', 'HEAD~3']);
    }
  });

  it('does not mutate the arguments it was given', async () => {
    const { rebaseGitArgs } = await import('../src/server/git/rebase');
    const original = ['rebase', '--continue'];

    rebaseGitArgs(original);
    expect(original).toEqual(['rebase', '--continue']);
  });

  const onWindows = process.platform === 'win32' ? it : it.skip;

  onWindows('rebases in a repository whose path is long enough to break git', async () => {
    // Git names its rebase bookkeeping after the commit range: two 40-character
    // object names and three dots, 83 characters before the directory holding
    // them. The fixture aims for a repository path long enough that this
    // crosses Windows' 260-character limit, but short enough that ordinary
    // object writes still work -- otherwise the setup fails rather than the
    // thing under test.
    const os = require('node:os') as typeof import('node:os');

    // Long enough that the repository path plus git's 83-character range
    // filename crosses 260, short enough that `.git/objects/xx/<38>` -- 55
    // characters -- still fits, so the fixture itself can be built.
    const TARGET_LENGTH = 190;

    const root = path.join(os.tmpdir(), 'mg-lp');
    const padding = TARGET_LENGTH - root.length - 1;

    // A single component is capped at 255 on Windows, and too little padding
    // would not reproduce the failure at all.
    if (padding < 40 || padding > 250) {
      return;
    }

    const deep = path.join(root, 'd'.repeat(padding));
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(deep, { recursive: true });

    try {
      git(deep, 'init', '--initial-branch=main');
      git(deep, 'config', 'user.name', 'Test User');
      git(deep, 'config', 'user.email', 'test@example.com');
      git(deep, 'config', 'commit.gpgsign', 'false');
      git(deep, 'config', 'core.autocrlf', 'false');

      // A seed plus four, so the base is a commit outside the range being
      // rewritten -- the same shape as every other fixture here.
      for (const name of ['seed', 'one', 'two', 'three', 'four']) {
        writeFile(deep, `${name}.txt`, `${name}` + String.fromCharCode(10));
        git(deep, 'add', `${name}.txt`);
        git(deep, 'commit', '-m', `feat: add ${name}`);
      }

      const base = git(deep, 'rev-parse', 'HEAD~4').trim();

      // The premise: without the configuration, git refuses outright. If this
      // ever stops being true the test below proves nothing, so it is asserted
      // rather than assumed.
      let refused = '';
      try {
        execFileSync('git', ['rebase', '-i', base], {
          cwd: deep,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, GIT_SEQUENCE_EDITOR: 'true', GIT_EDITOR: 'true' }
        });
      } catch (error) {
        refused = String((error as { stderr?: string }).stderr ?? '');
      }
      expect(refused).toMatch(/Filename too long/i);

      clearRepoPathCache();
      clearRebaseCache();

      const planned = await api(deep).get('/api/git/rebase/plan').query({ onto: base }).expect(200);
      const plan = planned.body.plan as RebasePlan;

      const { body } = await api(deep)
        .post('/api/git/rebase/start')
        .send({
          plan: {
            ...plan,
            items: plan.items.map((item) =>
              item.subject === 'feat: add two' ? { ...item, action: 'drop' } : item
            )
          }
        })
        .expect(200);

      expect(body.stopped).toBe(false);
      expect(
        git(deep, 'log', '--reverse', '--pretty=%s', `${base}..HEAD`)
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      ).toEqual(['feat: add one', 'feat: add three', 'feat: add four']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
