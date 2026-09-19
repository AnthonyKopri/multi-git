// The MCP server, driven the way an agent drives it: JSON-RPC over stdio.
//
// Pinned here: which tools exist with and without --allow-write, that stdout
// carries nothing but protocol messages, and that a workflow needing the user
// answers with an explicit decision error instead of guessing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

import { createApp } from '../src/server/app';
import { commands } from '../src/server/agent-cli/commands';
import { cleanupRepos, createRepoWithHistory, git } from './helpers/temp-repo';

const ROOT = path.join(__dirname, '..');
let entry: string;
let server: Server;
let origin: string;

interface RpcMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/** Starts `multi-git mcp`, sends each request in turn, and returns every reply. */
async function session(args: string[], requests: object[]): Promise<{ messages: RpcMessage[]; stdout: string }> {
  const child = spawn(process.execPath, [entry, 'mcp', '--server', origin, ...args], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (stdout += chunk));

  const expected = requests.filter((request) => 'id' in request).length;
  const send = (message: object): void => {
    child.stdin.write(JSON.stringify(message) + '\n');
  };

  send({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  for (const request of requests) {
    send({ jsonrpc: '2.0', ...request });
  }

  const deadline = Date.now() + 20_000;
  const replies = (): RpcMessage[] =>
    stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RpcMessage);
  while (replies().filter((message) => message.id !== undefined).length < expected + 1) {
    if (Date.now() > deadline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.stdin.end();
  await new Promise((resolve) => child.once('exit', resolve));
  return { messages: replies(), stdout };
}

const reply = (messages: RpcMessage[], id: number): RpcMessage => messages.find((message) => message.id === id)!;
const toolNames = (message: RpcMessage): string[] =>
  (message.result!['tools'] as { name: string }[]).map((tool) => tool.name).sort();

let bundleDir: string;

beforeAll(async () => {
  // Inside the repository: the server reports the app's version, which it
  // reads from the package.json it finds above itself.
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'mcp-'));
  entry = path.join(bundleDir, 'agent-cli.cjs');
  await build({
    entryPoints: ['src/server/agent-cli/main.ts'],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22.12',
    logLevel: 'error'
  });
  server = await new Promise<Server>((resolve) => {
    const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(() => {
  server.close();
  cleanupRepos();
  fs.rmSync(bundleDir, { recursive: true, force: true });
});

describe('multi-git mcp', () => {
  it('offers only reading tools unless writes are allowed', async () => {
    const { messages, stdout } = await session([], [{ id: 1, method: 'tools/list' }]);

    const reading = Object.entries(commands)
      .filter(([, spec]) => !spec.effects.mutates)
      .map(([name]) => name.replaceAll('.', '_'))
      .sort();
    expect(toolNames(reply(messages, 1))).toEqual(reading);

    // Nothing but protocol on stdout, or the client cannot parse it.
    for (const line of stdout.split('\n').filter(Boolean)) {
      expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0');
    }
  });

  it('adds the core changing tools with --allow-write, and never a way to force-push', async () => {
    const { messages } = await session(['--allow-write'], [{ id: 1, method: 'tools/list' }]);
    const names = toolNames(reply(messages, 1));

    expect(names).toEqual(expect.arrayContaining(['commit', 'stage', 'sync_fetch', 'sync_push', 'pull', 'ssh_select']));
    // The legacy push keeps its CLI contract; agents get the guided one.
    expect(names).not.toContain('push');
    const tools = reply(messages, 1).result!['tools'] as { name: string; inputSchema: { properties: object } }[];
    for (const tool of tools) {
      expect(Object.keys(tool.inputSchema.properties)).not.toContain('force');
    }
  });

  it('answers with the same envelope as the CLI, as structured content', async () => {
    const repo = createRepoWithHistory();
    const { messages } = await session(
      [],
      [{ id: 1, method: 'tools/call', params: { name: 'status', arguments: { repo } } }]
    );

    const result = reply(messages, 1).result!;
    expect(result['isError']).toBeUndefined();
    expect(result['structuredContent']).toMatchObject({
      schemaVersion: 1,
      success: true,
      command: 'status',
      data: { branch: git(repo, 'branch', '--show-current').trim() }
    });
  });

  it('needs an absolute repository path', async () => {
    const { messages } = await session(
      [],
      [{ id: 1, method: 'tools/call', params: { name: 'status', arguments: { repo: 'relative/path' } } }]
    );
    const failed = reply(messages, 1);
    // Rejected by the input schema, before anything runs.
    expect(JSON.stringify(failed)).toContain('absolute');
  });

  it('asks for a decision rather than taking one', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'remote', 'add', 'origin', 'git@github.com:owner/repo.git');

    const { messages } = await session(
      ['--allow-write'],
      [{ id: 1, method: 'tools/call', params: { name: 'remote_toggle', arguments: { repo } } }]
    );

    const result = reply(messages, 1).result!;
    expect(result['isError']).toBe(true);
    expect(JSON.stringify(result['content'])).toContain('DECISION_REQUIRED');
    expect(git(repo, 'remote', 'get-url', 'origin').trim()).toBe('git@github.com:owner/repo.git');
  });

  it('previews a change without making it', async () => {
    const repo = createRepoWithHistory();
    const { messages } = await session(
      ['--allow-write'],
      [{ id: 1, method: 'tools/call', params: { name: 'commit', arguments: { repo, message: 'x', dryRun: true } } }]
    );

    expect(reply(messages, 1).result!['structuredContent']).toMatchObject({
      success: true,
      data: { note: 'Preview only; server validation and execution have not run.' }
    });
  });
});
