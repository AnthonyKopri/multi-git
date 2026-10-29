// Sends requests to the Express app from the integration tests.
//
// This replaces supertest, which brought sixteen packages (superagent,
// formidable, cookiejar and their types) for the part of it these tests use:
// send a request, check the status, read the body. The API is the same
// subset, so a test reads exactly as it did:
//
//   const { body } = await request(app).post('/api/x').set('Host', '127.0.0.1').send({ a: 1 }).expect(200);
//
// Like supertest, each request starts the app on an ephemeral loopback port
// and stops it once the response is in.
import http from 'node:http';
import type { IncomingHttpHeaders, RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Response {
  status: number;
  /** Lowercase names; a header sent more than once (Set-Cookie) is joined with ", ". */
  headers: Record<string, string>;
  /** The body as UTF-8 text. */
  text: string;
  /**
   * The body parsed as JSON when the response says it is JSON, otherwise `{}`.
   * Untyped, as supertest's was: each test knows the shape it asked for.
   */
  body: any;
}

type Method = 'GET' | 'POST' | 'DELETE';

/** One request, built up with `set`, `query` and `send`, and sent when awaited. */
export class Test implements PromiseLike<Response> {
  private readonly headers: Record<string, string> = {};
  private readonly search = new URLSearchParams();
  private payload: Buffer | undefined;
  private expected: { status: number; callSite: Error } | undefined;
  private response: Promise<Response> | undefined;

  constructor(
    private readonly app: RequestListener,
    private readonly method: Method,
    private readonly path: string
  ) {}

  set(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  query(params: Record<string, string | number | boolean>): this {
    for (const [name, value] of Object.entries(params)) {
      this.search.append(name, String(value));
    }
    return this;
  }

  /** An object is sent as JSON; a string or Buffer as it is, under whatever Content-Type was set. */
  send(body: unknown): this {
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      this.payload = Buffer.from(body);
    } else {
      this.payload = Buffer.from(JSON.stringify(body));
      this.headers['content-type'] ??= 'application/json';
    }
    return this;
  }

  /** Fails the request unless the response has this status. */
  expect(status: number): this {
    // Created here so that a failure's stack points at the test, not at this file.
    this.expected = { status, callSite: new Error() };
    return this;
  }

  then<Fulfilled = Response, Rejected = never>(
    onFulfilled?: ((response: Response) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null
  ): Promise<Fulfilled | Rejected> {
    this.response ??= this.run();
    return this.response.then(onFulfilled, onRejected);
  }

  private async run(): Promise<Response> {
    const server = http.createServer(this.app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    let response: Response;
    try {
      response = await this.exchange((server.address() as AddressInfo).port);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }

    if (this.expected && response.status !== this.expected.status) {
      const { status, callSite } = this.expected;
      callSite.message =
        `expected ${status} "${http.STATUS_CODES[status]}", got ${response.status} ` +
        `"${http.STATUS_CODES[response.status]}"\n${response.text.slice(0, 500)}`;
      throw callSite;
    }
    return response;
  }

  private exchange(port: number): Promise<Response> {
    const query = this.search.toString();
    const path = query ? `${this.path}${this.path.includes('?') ? '&' : '?'}${query}` : this.path;
    const headers = { ...this.headers };
    if (this.payload) {
      headers['content-length'] = String(this.payload.length);
    }

    return new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, method: this.method, path, headers, agent: false }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('error', reject);
        incoming.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const isJson = /\bjson\b/i.test(incoming.headers['content-type'] ?? '');
          try {
            resolve({
              status: incoming.statusCode ?? 0,
              headers: flatten(incoming.headers),
              text,
              body: isJson && text ? JSON.parse(text) : {}
            });
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
      request.end(this.payload);
    });
  }
}

function flatten(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      flat[name] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return flat;
}

/** Requests against `app`, which can be an Express app or any Node request listener. */
export default function request(app: RequestListener) {
  return {
    get: (path: string) => new Test(app, 'GET', path),
    post: (path: string) => new Test(app, 'POST', path),
    delete: (path: string) => new Test(app, 'DELETE', path)
  };
}
