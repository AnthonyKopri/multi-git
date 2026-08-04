// The operation endpoints, driven through the real Express app.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { operations } from '../src/server/operations/registry';

const app: Express = createApp();

/** Every request needs a Host the localhost guard accepts. */
function api() {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Host', '127.0.0.1'),
    post: (url: string) => agent.post(url).set('Host', '127.0.0.1')
  };
}

beforeEach(() => {
  operations.clear();
});

describe('GET /api/operations', () => {
  it('reports nothing when nothing is running', async () => {
    const response = await api().get('/api/operations').expect(200);

    expect(response.body).toEqual({ success: true, operations: [] });
  });

  it('lists an operation in flight', async () => {
    const handle = operations.begin({ kind: 'git.fetch', repoPath: '/repo' });
    handle.start('Fetching');

    const response = await api().get('/api/operations').expect(200);

    expect(response.body.operations).toEqual([
      {
        id: handle.id,
        kind: 'git.fetch',
        repoPath: '/repo',
        state: 'running',
        message: 'Fetching',
        cancellable: true
      }
    ]);
  });
});

describe('POST /api/operations/cancel', () => {
  it('aborts the signal the operation is watching', async () => {
    const handle = operations.begin({ kind: 'git.push' });
    handle.start();

    const response = await api()
      .post('/api/operations/cancel')
      .send({ id: handle.id })
      .expect(200);

    expect(response.body).toEqual({ success: true, cancelled: true });
    expect(handle.signal.aborted).toBe(true);
  });

  it('answers cancelled:false for an unknown id rather than failing', async () => {
    const response = await api()
      .post('/api/operations/cancel')
      .send({ id: 'no-such-operation' })
      .expect(200);

    expect(response.body).toEqual({ success: true, cancelled: false });
  });

  it('rejects a request with no id', async () => {
    await api().post('/api/operations/cancel').send({}).expect(400);
    await api().post('/api/operations/cancel').send({ id: 42 }).expect(400);
  });
});

describe('the development sleep operation', () => {
  afterEach(() => {
    delete process.env['MULTI_GIT_DEV_OPERATIONS'];
  });

  it('is not reachable unless it was deliberately enabled', async () => {
    // It runs an arbitrary sleep on demand. Harmless, but it has no business
    // being reachable in a shipped build.
    expect(process.env['MULTI_GIT_DEV_OPERATIONS']).not.toBe('1');

    await api().post('/api/operations/dev/sleep').send({ seconds: 1 }).expect(404);
  });

  it('runs until cancelled, then reports cancelled', async () => {
    // This is the end-to-end path the phase asks to be verifiable by hand:
    // start something long, cancel it, and see the operation reach a cancelled
    // state rather than a failure.
    process.env['MULTI_GIT_DEV_OPERATIONS'] = '1';

    const started = await api()
      .post('/api/operations/dev/sleep')
      .send({ seconds: 120 })
      .expect(200);

    const id = started.body.id as string;
    expect(operations.get(id)).toMatchObject({ kind: 'dev.sleep', state: 'running' });

    await api().post('/api/operations/cancel').send({ id }).expect(200);

    // The process tree takes a moment to come down; the state lands after it.
    const deadline = Date.now() + 15_000;
    while (operations.get(id)?.state === 'running' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(operations.get(id)).toMatchObject({ state: 'cancelled' });
  });
});

describe('GET /api/operations/stream', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  let abort: AbortController;

  afterEach(() => {
    abort?.abort();
  });

  /** Reads the event stream until `predicate` is satisfied by the text so far. */
  async function readUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    predicate: (text: string) => boolean
  ): Promise<string> {
    const decoder = new TextDecoder();
    let text = '';

    while (!predicate(text)) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }

    return text;
  }

  it('opens with a snapshot of what is already running', async () => {
    const handle = operations.begin({ kind: 'git.clone', total: 100 });
    handle.start('Cloning');

    abort = new AbortController();
    const response = await fetch(`${origin}/api/operations/stream`, { signal: abort.signal });

    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const text = await readUntil(reader, (seen) => seen.includes('\n\n'));

    expect(text).toContain('event: snapshot');
    expect(text).toContain(handle.id);
    expect(text).toContain('"state":"running"');

    await reader.cancel();
  });

  it('pushes each state change as it happens', async () => {
    abort = new AbortController();
    const response = await fetch(`${origin}/api/operations/stream`, { signal: abort.signal });
    const reader = response.body!.getReader();

    // Drain the opening snapshot before making a change to observe.
    await readUntil(reader, (seen) => seen.includes('event: snapshot'));

    const handle = operations.begin({ kind: 'git.push' });
    handle.start('Pushing');
    handle.succeed('Pushed');

    const text = await readUntil(reader, (seen) => seen.includes('"state":"succeeded"'));

    expect(text).toContain(handle.id);
    expect(text).toContain('"state":"succeeded"');
    expect(text).toContain('Pushed');

    await reader.cancel();
  });

  it('stops writing once the client disconnects', async () => {
    abort = new AbortController();
    const response = await fetch(`${origin}/api/operations/stream`, { signal: abort.signal });
    const reader = response.body!.getReader();
    await readUntil(reader, (seen) => seen.includes('event: snapshot'));

    await reader.cancel();
    abort.abort();

    // A subscriber left registered against a closed response would throw on
    // the next publish and, before the try/catch in the registry, take the
    // publishing loop down with it.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(() => operations.begin({ kind: 'git.fetch' }).succeed()).not.toThrow();
  });
});
