import { describe, expect, it } from 'vitest';
import { browseGithubRepositories } from '../src/server/providers/github-repositories';
import { FakeRunner } from './helpers/fake-runner';

const row = { nameWithOwner: 'team/repo', description: '<img src=x>', url: 'https://github.com/team/repo', sshUrl: 'git@github.com:team/repo.git', isPrivate: true, isArchived: false };

describe('GitHub repository browsing', () => {
  it('uses authenticated gh with bounded, structured output and separate arguments', async () => {
    const runner = new FakeRunner();
    runner.otherwise({ stdout: JSON.stringify([row]) });
    expect(await browseGithubRepositories('team', runner)).toEqual({ success: true, repositories: [row], limit: 100, atLimit: false });
    expect(runner.calls[0]?.args).toEqual(['repo', 'list', 'team', '--limit', '100', '--json', 'nameWithOwner,description,url,sshUrl,isPrivate,isArchived']);
  });
  it('defaults to the signed-in owner and reports truncation', async () => {
    const runner = new FakeRunner();
    runner.otherwise({ stdout: JSON.stringify(Array(100).fill(row)) });
    expect((await browseGithubRepositories('', runner)).atLimit).toBe(true);
    expect(runner.calls[0]?.args[2]).toBe('--limit');
  });
  it.each(['--help', 'team/repo', 'a b', ['owner']])('rejects invalid owner %s without invoking gh', async (owner) => {
    const runner = new FakeRunner();
    await expect(browseGithubRepositories(owner, runner)).rejects.toThrow('user or organization');
    expect(runner.calls).toHaveLength(0);
  });
  it.each(['not JSON', '{}', '[null]', '[{"nameWithOwner":"bad"}]'])('rejects malformed output %s', async (stdout) => {
    const runner = new FakeRunner(); runner.otherwise({ stdout });
    await expect(browseGithubRepositories('', runner)).rejects.toThrow('invalid repository data');
  });
  it('explains missing gh and authentication failures', async () => {
    const runner = new FakeRunner(); runner.otherwise({ spawnError: true });
    await expect(browseGithubRepositories('', runner)).rejects.toThrow('paste a repository URL');
    runner.otherwise({ exitCode: 1, stderr: 'Run gh auth login' });
    await expect(browseGithubRepositories('', runner)).rejects.toThrow('gh auth login');
  });
});
