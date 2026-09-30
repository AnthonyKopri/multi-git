// What a failed clone tells the user.
//
// Asking git for progress fills stderr with every redraw of every status line,
// and stderr is where git says what went wrong, so an unfiltered failure shows
// the reason buried under thousands of lines of animation. The real git cannot
// be made to fail after a long download on demand, so this stands in for it with
// the output such a failure produces.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { GitError } from '../src/server/git/run';
import { operations } from '../src/server/operations/registry';
import { cleanupRepos, createTempDir } from './helpers/temp-repo';

const mocks = vi.hoisted(() => ({ runGitCommand: vi.fn() }));

vi.mock('../src/server/git/run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/git/run')>()),
  runGitCommand: mocks.runGitCommand
}));

const { createApp } = await import('../src/server/app');
const app = createApp();

/** What git writes on the way to failing at the very end of a clone. */
function noisyStderr(reason: string): string {
  const redraws = Array.from(
    { length: 400 },
    (_, index) => `Receiving objects:  ${index % 100}% (${index}/400), ${index} KiB | 1.00 MiB/s\r`
  ).join('');

  return [
    "Cloning into 'repo'...\n",
    'remote: Enumerating objects: 400, done.\n',
    redraws,
    'Receiving objects: 100% (400/400), 12.00 MiB | 1.00 MiB/s, done.\n',
    'Resolving deltas: 100% (5/5), done.\n',
    `${reason}\n`
  ].join('');
}

function post(body: Record<string, unknown>) {
  return request(app).post('/api/git/clone').set('Host', '127.0.0.1').send(body);
}

beforeEach(() => {
  operations.clear();
  mocks.runGitCommand.mockReset();
});

afterAll(() => {
  cleanupRepos();
});

describe('a failed clone', () => {
  it('shows the reason git gave, without the progress that came before it', async () => {
    mocks.runGitCommand.mockRejectedValue(
      new GitError('git exited with code 128', {
        stderr: noisyStderr('fatal: unable to access the repository'),
        exitCode: 128
      })
    );

    const response = await post({
      url: 'https://example.com/team/repo.git',
      parentDir: createTempDir(),
      folderName: 'repo'
    }).expect(500);

    expect(response.body.error).not.toMatch(/Receiving objects|Resolving deltas/);
    expect(response.body.error).toContain('fatal: unable to access the repository');
    expect(response.body.error).toContain("Cloning into 'repo'");
    expect(response.body.error.length).toBeLessThan(500);
  });

  it('keeps the status git failed with', async () => {
    mocks.runGitCommand.mockRejectedValue(
      new GitError('git clone timed out after 1800s', {
        stderr: noisyStderr('fatal: the remote end hung up unexpectedly'),
        statusCode: 504
      })
    );

    await post({
      url: 'https://example.com/team/repo.git',
      parentDir: createTempDir(),
      folderName: 'slow'
    }).expect(504);
  });

  it('is still recorded as a failure on the operation', async () => {
    mocks.runGitCommand.mockRejectedValue(
      new GitError('git exited with code 128', { stderr: noisyStderr('fatal: nope'), exitCode: 128 })
    );

    await post({
      url: 'https://example.com/team/repo.git',
      parentDir: createTempDir(),
      folderName: 'failed'
    }).expect(500);

    expect(operations.list()[0]).toMatchObject({
      kind: 'git.clone',
      state: 'failed',
      message: 'git exited with code 128'
    });
  });

  it('stops re-reading the time estimate once it has failed', async () => {
    const timers = vi.spyOn(globalThis, 'clearInterval');
    mocks.runGitCommand.mockRejectedValue(new GitError('git exited with code 128', { stderr: 'fatal: nope' }));

    await post({
      url: 'https://example.com/team/repo.git',
      parentDir: createTempDir(),
      folderName: 'timer'
    }).expect(500);

    expect(timers).toHaveBeenCalled();
    timers.mockRestore();
  });
});
