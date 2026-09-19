// The one per-user backend every client shares.
//
// Real processes, because what matters is between processes: two clients
// starting at once must end up on one backend, a backend must not exit under a
// client, and a backend left over from another version must be replaced when
// idle and never when busy.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

import {
  BACKEND_PROTOCOL,
  BackendVersionError,
  connectBackend,
  controlAddress,
  readBackendRecord,
  recordPath
} from '../src/server/runtime/connection';
import { appVersion } from '../src/server/app-root';

const ROOT = path.join(__dirname, '..');
let bundleDir: string;
let entry: string;
let runtimeDir: string;
let home: string;
const saved: Record<string, string | undefined> = {};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the backend.');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeAll(async () => {
  // Inside the repository, so the bundle finds the app root and node_modules
  // the way the real one does.
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'shared-backend-'));
  entry = path.join(bundleDir, 'daemon.js');
  await build({
    entryPoints: [path.join(ROOT, 'src/server/runtime/daemon.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22.12',
    packages: 'external',
    logLevel: 'error'
  });
}, 60_000);

afterAll(() => {
  fs.rmSync(bundleDir, { recursive: true, force: true });
});

beforeEach(() => {
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-runtime-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-home-'));
  // The spawned backend inherits these, so it never reads the real
  // configuration or joins a real backend.
  for (const name of ['MULTI_GIT_RUNTIME_DIR', 'HOME', 'USERPROFILE']) {
    saved[name] = process.env[name];
  }
  process.env['MULTI_GIT_RUNTIME_DIR'] = runtimeDir;
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;
});

afterEach(async () => {
  const record = readBackendRecord();
  if (record && isAlive(record.pid)) {
    process.kill(record.pid, 'SIGKILL');
    await waitFor(() => !isAlive(record.pid)).catch(() => {});
  }
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe('shared backend', () => {
  it('starts once for clients that arrive together, and serves both', async () => {
    const [first, second] = await Promise.all([connectBackend({ entry }), connectBackend({ entry })]);

    expect(first.origin).toBe(second.origin);
    const info = (await (await fetch(`${first.origin}/api/app-info`)).json()) as { version: string };
    expect(info.version).toBe(appVersion());

    // The record is private to this user.
    if (process.platform !== 'win32') {
      expect(fs.statSync(recordPath()).mode & 0o077).toBe(0);
    }

    await first.close();
    await second.close();
  }, 30_000);

  it('stays while any client holds a lease, and leaves at once when told the last one is done', async () => {
    const first = await connectBackend({ entry });
    const second = await connectBackend({ entry });
    const { pid } = readBackendRecord()!;

    await first.close({ exitIfIdle: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(isAlive(pid)).toBe(true);

    await second.close({ exitIfIdle: true });
    await waitFor(() => !isAlive(pid));
    // Nothing left behind to be mistaken for a live backend.
    expect(fs.existsSync(recordPath())).toBe(false);
    expect(fs.existsSync(path.join(runtimeDir, 'owner.json'))).toBe(false);
  }, 30_000);

  it('refuses a client without the token', async () => {
    const connection = await connectBackend({ entry });
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(controlAddress());
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => (data += chunk));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
      socket.write(JSON.stringify({ token: 'guess', method: 'config.read' }) + '\n');
    });
    expect(JSON.parse(reply)).toEqual({ error: 'Unauthorized backend client.' });
    await connection.close();
  }, 30_000);

  it('recovers from a backend that died without cleaning up', async () => {
    const connection = await connectBackend({ entry });
    const { pid } = readBackendRecord()!;
    process.kill(pid, 'SIGKILL');
    await waitFor(() => !isAlive(pid));
    await connection.close();

    const replacement = await connectBackend({ entry });
    expect(readBackendRecord()!.pid).not.toBe(pid);
    await replacement.close();
  }, 30_000);
});

describe('a backend of another version', () => {
  /** Stands in for a backend another release started. */
  function foreignBackend(answer: { shutdown: boolean; protocol?: number }): Promise<net.Server> {
    const record = {
      // Not a process of ours: the clean-up after each test kills the pid the
      // record names.
      pid: 2_147_483_000,
      token: 'foreign-token',
      origin: 'http://127.0.0.1:1',
      version: '0.0.1',
      protocol: answer.protocol ?? BACKEND_PROTOCOL
    };
    fs.writeFileSync(recordPath(), JSON.stringify(record));

    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.once('data', (chunk: string) => {
        const { method } = JSON.parse(chunk.split('\n')[0]!) as { method: string };
        if (method === 'identify') {
          socket.end(JSON.stringify({ data: record }) + '\n');
        } else if (method === 'lease' || method === 'release') {
          socket.end(JSON.stringify({ data: true }) + '\n');
        } else if (method === 'shutdown-if-idle') {
          socket.end(JSON.stringify({ data: answer.shutdown }) + '\n');
          if (answer.shutdown) {
            fs.rmSync(recordPath(), { force: true });
            server.close();
          }
        } else {
          socket.end(JSON.stringify({ error: 'unexpected' }) + '\n');
        }
      });
    });
    return new Promise((resolve) => server.listen(controlAddress(), () => resolve(server)));
  }

  it('is replaced for the desktop app when nothing is using it', async () => {
    await foreignBackend({ shutdown: true });

    const connection = await connectBackend({ entry, exactVersion: true });
    expect(readBackendRecord()!.version).toBe(appVersion());
    await connection.close();
  }, 30_000);

  it('is left alone, and reported to the desktop app, while it is busy', async () => {
    const server = await foreignBackend({ shutdown: false });
    try {
      await expect(connectBackend({ entry, exactVersion: true })).rejects.toBeInstanceOf(BackendVersionError);
      await expect(connectBackend({ entry, exactVersion: true })).rejects.toThrow('Multi-Git 0.0.1 is running');
    } finally {
      server.close();
    }
  }, 30_000);

  it('is used by the terminal and agents when it speaks the same protocol', async () => {
    // An installed terminal edition keeps working after the desktop app updated.
    const server = await foreignBackend({ shutdown: false });
    try {
      const connection = await connectBackend({ entry });
      expect(connection.origin).toBe('http://127.0.0.1:1');
      await connection.close();
    } finally {
      server.close();
    }
  }, 30_000);

  it('is refused by everyone when its protocol differs and it is busy', async () => {
    const server = await foreignBackend({ shutdown: false, protocol: BACKEND_PROTOCOL + 1 });
    try {
      await expect(connectBackend({ entry })).rejects.toBeInstanceOf(BackendVersionError);
    } finally {
      server.close();
    }
  }, 30_000);
});
