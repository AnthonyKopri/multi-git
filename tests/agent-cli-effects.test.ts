import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { build } from 'esbuild';
import { commands, type CommandEffects } from '../src/server/agent-cli/commands';
import { executeRequest, prepareRequest } from '../src/server/agent-cli/client';
import { cleanupRepos, createTempDir } from './helpers/temp-repo';

// This is a public contract: additions or changes require an explicit review.
const expectedEffects: Record<string, CommandEffects> = {
  'app.info': { mutates: false, local: [], remote: 'none' },
  'repositories.list': { mutates: false, local: [], remote: 'read' },
  'repo.clone': { mutates: true, local: ['repository-create'], remote: 'read' },
  'repo.remember': { mutates: true, local: ['app-config'], remote: 'none' },
  'status': { mutates: false, local: [], remote: 'none' },
  'branches.list': { mutates: false, local: [], remote: 'none' },
  'branches.create': { mutates: true, local: ['local-refs', 'head', 'index', 'working-tree', 'repo-config'], remote: 'none' },
  'branches.checkout': { mutates: true, local: ['local-refs', 'head', 'index', 'working-tree', 'repo-config'], remote: 'none' },
  'diff': { mutates: false, local: [], remote: 'none' },
  'stage': { mutates: true, local: ['index'], remote: 'none' },
  'unstage': { mutates: true, local: ['index'], remote: 'none' },
  'commit': { mutates: true, local: ['index', 'local-history'], remote: 'none' },
  'fetch': { mutates: true, local: ['object-database', 'local-refs', 'ref-prune'], remote: 'read' },
  'push': { mutates: true, local: ['local-refs', 'repo-config'], remote: 'write' },
  'worktrees.list': { mutates: false, local: [], remote: 'none' },
  'worktrees.create': { mutates: true, local: ['worktree-create', 'local-refs', 'repo-config'], remote: 'none' },
  'recovery.list': { mutates: false, local: [], remote: 'none' },
  'agents.list': { mutates: false, local: [], remote: 'none' },
  'repositories.local': { mutates: false, local: [], remote: 'none' },
  'history': { mutates: false, local: [], remote: 'none' },
  'sync.fetch': { mutates: true, local: ['object-database', 'local-refs', 'ref-prune', 'head', 'index', 'working-tree'], remote: 'read' },
  'pull': { mutates: true, local: ['object-database', 'local-refs', 'head', 'index', 'working-tree', 'local-history'], remote: 'read' },
  'sync.push': { mutates: true, local: ['local-refs', 'repo-config', 'app-config'], remote: 'write' },
  'auto-pull.get': { mutates: false, local: [], remote: 'none' },
  'auto-pull.set': { mutates: true, local: ['app-config'], remote: 'none' },
  'ssh.profiles': { mutates: false, local: [], remote: 'none' },
  'ssh.inspect': { mutates: false, local: [], remote: 'none' },
  'ssh.select': { mutates: true, local: ['app-config', 'repo-config', 'ssh-agent'], remote: 'none' },
  'ssh.verify': { mutates: true, local: ['app-config'], remote: 'read' },
  'remote.inspect': { mutates: false, local: [], remote: 'none' },
  'remote.toggle': { mutates: true, local: ['repo-config'], remote: 'none' },
  'operations.list': { mutates: false, local: [], remote: 'none' },
  'operations.cancel': { mutates: true, local: ['operation-control'], remote: 'none' },
  'doctor': { mutates: false, local: [], remote: 'none' }
};

describe('agent CLI effect metadata', () => {
  it('classifies every exposed command with the reviewed effect contract', () => {
    expect(Object.fromEntries(Object.entries(commands).map(([name, spec]) => [name, spec.effects])))
      .toEqual(expectedEffects);
  });

  it.each(Object.entries(commands))('%s preserves its HTTP-based write gate and offline preview', async (name, spec) => {
    const args = [name, '--server', 'http://127.0.0.1:1', ...(spec.repo ? ['--repo', '.'] : [])];
    expect(spec.effects.mutates).toBe(spec.method === 'POST');
    if (spec.method === 'POST') {
      expect(() => prepareRequest(args)).toThrow(expect.objectContaining({ code: 'WRITE_NOT_ALLOWED', exitCode: 2 }));
      expect(prepareRequest([...args, '--allow-write']).method).toBe('POST');
    } else {
      expect(prepareRequest(args).method).toBe('GET');
    }

    const fetcher = vi.fn();
    const request = prepareRequest([...args, '--dry-run']);
    expect(request).not.toHaveProperty('effects');
    expect(await executeRequest(request, fetcher)).toEqual({
      request,
      effects: expectedEffects[name],
      note: 'Preview only; server validation and execution have not run.'
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not allow descriptive metadata to bypass the write gate', () => {
    const stage = commands['stage']!;
    const originalEffects = stage.effects;
    try {
      stage.effects = { mutates: false, local: [], remote: 'none' };
      expect(() => prepareRequest(['stage', '--repo', '.'])).toThrow('changes state');
    } finally {
      stage.effects = originalEffects;
    }
  });

  it('keeps effects out of live requests and preserves API responses', async () => {
    const request = prepareRequest(['stage', '--repo', '.', '--allow-write'], { files: ['a.txt'] });
    const payload = { success: true, stdout: '', stderr: '' };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    expect(await executeRequest(request, fetcher)).toEqual(payload);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(request.url, {
      method: 'POST', headers: request.headers, body: JSON.stringify({ files: ['a.txt'] }),
      redirect: 'error', signal: expect.any(AbortSignal)
    });
  });
});

describe('compiled agent CLI output', () => {
  let entry: string;
  beforeAll(async () => {
    entry = path.join(createTempDir('multi-git-cli-effects-'), 'agent-cli.cjs');
    await build({
      entryPoints: ['src/server/agent-cli/main.ts'], outfile: entry,
      bundle: true, platform: 'node', format: 'cjs', target: 'node22.12'
    });
  });
  afterAll(cleanupRepos);

  it.each([[], ['help'], ['--help'], ['-h']])('prints a complete one-line catalogue offline for %j', (...args) => {
    const result = spawnSync(process.execPath, [entry, ...args], {
      encoding: 'utf8', timeout: 10_000,
      // Even an invalid server setting must not be consulted by help.
      env: { ...process.env, MULTI_GIT_URL: 'invalid-server' }
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    const output = JSON.parse(result.stdout);
    expect(output).toEqual({
      schemaVersion: 1, success: true,
      usage: 'multi-git <command> [--repo path] [--input file|-] [--server http://127.0.0.1:3000] [--dry-run] [--allow-write]',
      input: 'UTF-8 JSON object; - reads stdin. JSON output is always enabled. GET input becomes query parameters.',
      commands,
      modes: expect.objectContaining({ tui: expect.any(String), mcp: expect.any(String), update: expect.any(String) }),
      inputSchemas: expect.any(Object)
    });
    // One JSON Schema per command, closed to fields the command does not take.
    expect(Object.keys(output.inputSchemas).sort()).toEqual(Object.keys(commands).sort());
    for (const schema of Object.values(output.inputSchemas) as { type: string; additionalProperties: boolean }[]) {
      expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });

  it('prints effects alongside the unchanged dry-run request and note', () => {
    const result = spawnSync(process.execPath, [entry, 'stage', '--repo', '.', '--input', '-', '--dry-run', '--server', 'http://127.0.0.1:1'], {
      encoding: 'utf8', timeout: 10_000, input: JSON.stringify({ files: ['a.txt'] })
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    const output = JSON.parse(result.stdout);
    expect(output).toEqual({
      schemaVersion: 1, success: true, command: 'stage', data: {
        request: prepareRequest(['stage', '--repo', '.', '--dry-run', '--server', 'http://127.0.0.1:1'], { files: ['a.txt'] }),
        effects: expectedEffects['stage'],
        note: 'Preview only; server validation and execution have not run.'
      }
    });
  });
});
