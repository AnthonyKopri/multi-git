import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app';
import { CliError, executeRequest, prepareRequest, serverOrigin } from '../src/server/agent-cli/client';
import { cleanupRepos, createRepoWithHistory, git, writeFile } from './helpers/temp-repo';

afterAll(cleanupRepos);
describe('agent CLI contract', () => {
  it.each(['https://localhost:3000', 'http://example.com', 'http://localhost.evil', 'http://user:pass@localhost', 'http://localhost/api', 'http://localhost?x=1'])('rejects unsafe server %s', (origin) => {
    expect(() => serverOrigin(origin)).toThrow(CliError);
  });
  it.each([['unknown'], ['constructor'], ['status'], ['status', '--repo', 'x', '--force'], ['status', '--repo', 'x', '--repo', 'y']])('rejects invalid arguments %s', (...args) => {
    expect(() => prepareRequest(args)).toThrow(CliError);
  });
  it('encodes Unicode paths and scalar query values', () => {
    const request = prepareRequest(['diff', '--repo', '/tmp/工作 tree'], { path: 'a & b.txt', source: 'index' });
    expect(Buffer.from(request.headers['x-repo-path']!, 'base64').toString()).toContain('工作 tree');
    expect(new URL(request.url).searchParams.get('path')).toBe('a & b.txt');
  });
  it('refuses writes and unsupported fields including force', () => {
    expect(() => prepareRequest(['stage', '--repo', '.'], { files: ['a'] })).toThrow('changes state');
    expect(() => prepareRequest(['push', '--repo', '.', '--allow-write'], { force: true })).toThrow('Unknown input field');
  });
  it('previews writes without issuing a request', async () => {
    const fetcher = vi.fn();
    const result = await executeRequest(prepareRequest(['stage', '--repo', '.', '--dry-run'], { files: ['a'] }), fetcher);
    expect(result).toHaveProperty('note');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports transport, HTTP and invalid JSON failures', async () => {
    const request = prepareRequest(['app.info']);
    await expect(executeRequest(request, vi.fn().mockRejectedValue(new Error()))).rejects.toMatchObject({ code: 'CONNECTION_FAILED', exitCode: 1 });
    await expect(executeRequest(request, vi.fn().mockResolvedValue(new Response('{"error":"bad repo"}', { status: 400 })))).rejects.toThrow('bad repo');
    await expect(executeRequest(request, vi.fn().mockResolvedValue(new Response('<html>')))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('disallows redirects in transport', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    await executeRequest(prepareRequest(['app.info']), fetcher);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });
  it('drives status, staging, unstage, branch creation and commit through the real API', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'agent.txt', 'agent CLI test\n');
    const server = createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const run = (command: string, input = {}) => executeRequest(prepareRequest([command, '--repo', repo, '--server', origin, '--allow-write'], input));
    try {
      expect(await run('status')).toHaveProperty('branch', 'main');
      await run('branches.create', { branchName: 'agent-test' });
      await run('stage', { files: ['agent.txt'] });
      expect(git(repo, 'diff', '--cached', '--name-only')).toContain('agent.txt');
      await run('unstage', { files: ['agent.txt'] });
      expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('');
      await run('stage', { files: ['agent.txt'] });
      await run('commit', { message: 'test: agent CLI' });
      expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('test: agent CLI');
      expect(await run('status')).toMatchObject({ branch: 'agent-test', staged: [], unstaged: [] });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
