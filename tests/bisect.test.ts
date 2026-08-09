// Bisect against real repositories, with a scripted test command.
//
// The session half is integration, because every claim about it is a claim
// about git's own state machine — that `bisect start` checks something out,
// that a verdict advances, that the session survives being read again, that
// reset puts the branch back.
//
// The automated run is scripted, because it exists to execute a program and a
// test that ran a real one would be testing the machine it happened to run on.
// What matters there is the exit-code mapping and that a non-zero exit is a
// verdict rather than a crash.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import { readSession, runBisect, setBisectRunner } from '../src/server/git/bisect';
import { FakeRunner } from './helpers/fake-runner';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

const app: Express = createApp();

function api(repo: string) {
  const agent = request(app);
  const headers = (req: request.Test): request.Test =>
    req.set('Host', '127.0.0.1').set('x-repo-path', repo);

  return {
    get: (url: string) => headers(agent.get(url)),
    post: (url: string) => headers(agent.post(url))
  };
}

/**
 * A repository with a known break: commit 3 of 6 introduces it.
 *
 * Returns the oids so a test can assert bisect found the right one rather than
 * merely that it found something.
 */
function repoWithABreak(): { repo: string; good: string; bad: string; culprit: string } {
  const repo = createRepoWithHistory();
  const oids: string[] = [];

  for (let index = 1; index <= 6; index += 1) {
    writeFile(repo, `step-${index}.txt`, index >= 3 ? 'broken' : 'fine');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', `step ${index}`);
    oids.push(git(repo, 'rev-parse', 'HEAD').trim());
  }

  return {
    repo,
    good: oids[0] as string,
    bad: oids[5] as string,
    culprit: oids[2] as string
  };
}

beforeEach(() => {
  clearRepoPathCache();
});

afterEach(() => {
  setBisectRunner();
});

afterAll(() => {
  cleanupRepos();
});

describe('the session', () => {
  it('reports none for a repository that is not bisecting', async () => {
    const response = await api(createRepoWithHistory()).get('/api/bisect').expect(200);

    expect(response.body.session.state).toBe('none');
  });

  it('starts, and checks out a commit to judge', async () => {
    const { repo, good, bad } = repoWithABreak();

    const response = await api(repo)
      .post('/api/bisect/start')
      .send({ goodRef: good, badRef: bad })
      .expect(200);

    expect(response.body.session.state).toBe('active');
    expect(response.body.session.currentOid).toBeTruthy();
    // The estimate is what tells the user how much is left to do.
    expect(response.body.session.stepsRemaining).toBeGreaterThanOrEqual(0);
  });

  it('refuses to start a second one over the first', async () => {
    const { repo, good, bad } = repoWithABreak();
    await api(repo).post('/api/bisect/start').send({ goodRef: good, badRef: bad }).expect(200);

    const response = await api(repo)
      .post('/api/bisect/start')
      .send({ goodRef: good, badRef: bad })
      .expect(409);

    expect(response.body.error).toMatch(/already in progress/i);
  });

  it('refuses a ref git would read as an option', async () => {
    const { repo, bad } = repoWithABreak();

    await api(repo)
      .post('/api/bisect/start')
      .send({ goodRef: '--upload-pack=id', badRef: bad })
      .expect(400);
  });

  it('survives being read again, because the state is git’s and not this process’s', async () => {
    const { repo, good, bad } = repoWithABreak();
    await api(repo).post('/api/bisect/start').send({ goodRef: good, badRef: bad }).expect(200);

    // A fresh read with nothing cached: this is what a restart looks like.
    expect((await readSession(repo)).state).toBe('active');
  });

  it('refuses a verdict when nothing is in progress', async () => {
    await api(createRepoWithHistory())
      .post('/api/bisect/mark')
      .send({ verdict: 'good' })
      .expect(409);
  });

  it('refuses a verdict that is not one of the three', async () => {
    const { repo, good, bad } = repoWithABreak();
    await api(repo).post('/api/bisect/start').send({ goodRef: good, badRef: bad }).expect(200);

    await api(repo).post('/api/bisect/mark').send({ verdict: 'maybe' }).expect(400);
  });

  it('resets even when this process never started one', async () => {
    // The case someone actually needs it for: a session left behind by a crash.
    const { repo, good, bad } = repoWithABreak();
    git(repo, 'bisect', 'start', bad, good);

    const response = await api(repo).post('/api/bisect/reset').send({}).expect(200);

    expect(response.body.session.state).toBe('none');
  });
});

describe('an automated run', () => {
  /** Judges by reading a file the fixture wrote at each commit. */
  function runnerReturning(exitCodes: number[]): FakeRunner {
    let call = 0;
    return new FakeRunner().otherwise({ exitCode: 0 }).on(
      () => true,
      () => ({ exitCode: exitCodes[call++] ?? 0 })
    );
  }

  it('maps exit codes to verdicts the way git does', async () => {
    const { repo, good, bad } = repoWithABreak();
    git(repo, 'bisect', 'start', bad, good);

    // 0 good, 125 skip, anything else bad.
    setBisectRunner(runnerReturning([1, 0, 125, 1, 0, 1, 0]));

    const outcome = await runBisect(
      repo,
      { id: 'c1', label: 'test', executable: 'node', args: ['test.js'] },
      { maxSteps: 8 }
    );

    const verdicts = outcome.steps.map((step) => step.verdict);
    expect(verdicts[0]).toBe('bad');
    expect(verdicts[1]).toBe('good');
    expect(verdicts.includes('skip') || verdicts.length < 3).toBe(true);
  });

  it('honours a configured skip code instead of 125', async () => {
    const { repo, good, bad } = repoWithABreak();
    git(repo, 'bisect', 'start', bad, good);
    setBisectRunner(runnerReturning([77]));

    const outcome = await runBisect(
      repo,
      { id: 'c1', label: 'test', executable: 'node', args: [], skipExitCode: 77 },
      { maxSteps: 1 }
    );

    expect(outcome.steps[0]?.verdict).toBe('skip');
  });

  it('records the exit code alongside the verdict', async () => {
    const { repo, good, bad } = repoWithABreak();
    git(repo, 'bisect', 'start', bad, good);
    setBisectRunner(runnerReturning([3]));

    const outcome = await runBisect(
      repo,
      { id: 'c1', label: 'test', executable: 'node', args: [] },
      { maxSteps: 1 }
    );

    // The user needs to be able to tell a failing test from a crashing one.
    expect(outcome.steps[0]).toMatchObject({ exitCode: 3, verdict: 'bad' });
  });

  it('runs the command argv-only, with no shell', async () => {
    const { repo, good, bad } = repoWithABreak();
    git(repo, 'bisect', 'start', bad, good);

    const runner = runnerReturning([0]);
    setBisectRunner(runner);

    await runBisect(
      repo,
      { id: 'c1', label: 'test', executable: 'npm', args: ['run', 'test'] },
      { maxSteps: 1 }
    );

    const call = runner.calls[0];
    expect(call?.executable).toBe('npm');
    // Separate values all the way through, never a joined command line.
    expect(call?.args).toEqual(['run', 'test']);
    expect(call?.options.cwd).toBe(repo);
  });

  it('says so plainly when the command is not installed', async () => {
    const { repo, good, bad } = repoWithABreak();
    git(repo, 'bisect', 'start', bad, good);
    setBisectRunner(new FakeRunner().otherwise({ spawnError: true }));

    await expect(
      runBisect(repo, { id: 'c1', label: 'test', executable: 'nope', args: [] })
    ).rejects.toThrow(/could not be started/i);
  });

  it('stops when cancelled, and reports the steps already judged', async () => {
    const { repo, good, bad } = repoWithABreak();
    git(repo, 'bisect', 'start', bad, good);
    setBisectRunner(runnerReturning([0, 0, 0, 0]));

    const controller = new AbortController();
    controller.abort();

    const outcome = await runBisect(
      repo,
      { id: 'c1', label: 'test', executable: 'node', args: [] },
      { signal: controller.signal }
    );

    expect(outcome.cancelled).toBe(true);
    expect(outcome.steps).toEqual([]);
  });

  it('refuses to run before a bisect has been started', async () => {
    const repo = createRepoWithHistory();
    setBisectRunner(runnerReturning([0]));

    await expect(
      runBisect(repo, { id: 'c1', label: 'test', executable: 'node', args: [] })
    ).rejects.toThrow(/start a bisect/i);
  });

  it('stops at the step ceiling rather than looping forever', async () => {
    const { repo, good, bad } = repoWithABreak();
    git(repo, 'bisect', 'start', bad, good);
    // Always "skip": git never narrows, so nothing ends the loop on its own.
    setBisectRunner(new FakeRunner().otherwise({ exitCode: 125 }));

    const outcome = await runBisect(
      repo,
      { id: 'c1', label: 'test', executable: 'node', args: [] },
      { maxSteps: 3 }
    );

    expect(outcome.steps.length).toBeLessThanOrEqual(3);
  });
});

describe('the boundary around running a command', () => {
  it('offers no HTTP route that runs one', async () => {
    const { repo } = repoWithABreak();

    // Starting a program lives behind the Electron IPC bridge, exactly as agent
    // launch does. A header claiming to be the desktop app would not be a
    // boundary: anything that can reach the port can set one.
    await api(repo).post('/api/bisect/run').send({ commandId: 'c1' }).expect(404);
  });

  it('saves a definition without running it', async () => {
    const { repo } = repoWithABreak();

    const response = await api(repo)
      .post('/api/bisect/commands')
      .send({ label: 'Unit tests', executable: 'npm', args: ['test'] })
      .expect(200);

    expect(response.body.commands.some((entry: { label: string }) => entry.label === 'Unit tests')).toBe(
      true
    );
  });

  it('refuses a definition with no executable', async () => {
    const { repo } = repoWithABreak();

    await api(repo).post('/api/bisect/commands').send({ label: 'Broken' }).expect(400);
  });
});
