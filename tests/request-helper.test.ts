// The request helper the integration tests are built on. If `.expect` stopped
// failing on a wrong status, every test using it would pass vacuously.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

import request from './helpers/request';

/** Answers with what it received, so a test can see what was sent. */
function echo(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const status = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('status') ?? 200);
    res.writeHead(status, { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] });
    res.end(JSON.stringify({
      method: req.method,
      url: req.url,
      host: req.headers.host,
      contentType: req.headers['content-type'] ?? null,
      body: Buffer.concat(chunks).toString('utf8')
    }));
  });
}

describe('the test request helper', () => {
  it('fails when the status is not the expected one, and says what it got', async () => {
    await expect(request(echo).get('/?status=500').expect(200)).rejects.toThrow(
      /expected 200 "OK", got 500 "Internal Server Error"/
    );
  });

  it('resolves without checking when no status is expected', async () => {
    const response = await request(echo).get('/?status=404');
    expect(response.status).toBe(404);
  });

  it('sends an object as JSON and parses a JSON reply', async () => {
    const { body } = await request(echo).post('/thing').send({ a: 1 }).expect(200);
    expect(body).toMatchObject({ method: 'POST', contentType: 'application/json', body: '{"a":1}' });
  });

  it('sends a string as it is, under the Content-Type that was set', async () => {
    const { body } = await request(echo).post('/').set('Content-Type', 'text/plain').send('raw').expect(200);
    expect(body).toMatchObject({ contentType: 'text/plain', body: 'raw' });
  });

  it('encodes query parameters and keeps the Host that was set', async () => {
    const { body } = await request(echo)
      .delete('/items?keep=1')
      .set('Host', '127.0.0.1')
      .query({ ref: 'stash@{0}', n: 2 })
      .expect(200);
    expect(body.method).toBe('DELETE');
    expect(body.host).toBe('127.0.0.1');
    expect(new URL(body.url, 'http://x').searchParams.get('ref')).toBe('stash@{0}');
    expect(body.url).toMatch(/^\/items\?keep=1&ref=.*&n=2$/);
  });

  it('joins a header sent more than once', async () => {
    const { headers } = await request(echo).get('/').expect(200);
    expect(headers['set-cookie']).toBe('a=1, b=2');
  });
});
