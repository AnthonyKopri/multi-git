// The shared backend process: the HTTP API every client uses, plus a private
// control channel for what must not be on a loopback port anyone can reach.
//
// Started detached by the first client that needs it (runtime/connection.ts)
// and never by hand. It owns the configuration file, the repository locks, the
// operations list and the unlocked vault for the whole user session, and it
// exits a minute after the last client lets go.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../app';
import { appVersion } from '../app-root';
import { lockVault } from '../vault/vault';
import { unloadSessionKeys } from '../ssh/agent-session';
import { operations } from '../operations/registry';
import {
  BACKEND_PROTOCOL,
  controlAddress,
  controlCall,
  readBackendRecord,
  recordPath,
  runtimeDirectory
} from './connection';
import type { BackendRecord } from './connection';
import { privateMethod } from './private-methods';
import { holdPayloadSession } from '../terminal/sessions';

const IDLE_EXIT_MS = 60_000;
const LEASE_EXPIRY_MS = 45_000;
/** How long a starting backend may hold the lock before it has to answer. */
const STARTUP_GRACE_MS = 30_000;
const MAX_REQUEST_BYTES = 1024 * 1024;

interface OwnerRecord {
  pid: number;
  token: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes the single-owner lock, or reports that a live backend holds it.
 *
 * A dead owner's lock is taken over. So is one whose pid is alive but whose
 * backend does not answer once it has had time to start: on Windows a pid is
 * soon reused, and a crashed backend's pid may by then be some other program.
 */
async function claimOwnership(lockPath: string, token: string): Promise<boolean> {
  const mine = JSON.stringify({ pid: process.pid, token } satisfies OwnerRecord);

  try {
    fs.writeFileSync(lockPath, mine, { flag: 'wx', mode: 0o600 });
    return true;
  } catch {
    // Held, or left behind. Decide which below.
  }

  let previous: OwnerRecord;
  let age: number;
  try {
    previous = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as OwnerRecord;
    age = Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch {
    return false;
  }

  if (isAlive(previous.pid)) {
    // A backend writes its record only once it is listening, so an owner with
    // a record has finished starting and must answer. One without a record is
    // either still starting, which gets a grace period, or died before it got
    // that far.
    const record = readBackendRecord();
    if (record?.pid === previous.pid) {
      const answered = await controlCall<BackendRecord>(record, 'identify', {}, 1_000)
        .then((identity) => identity.pid === previous.pid)
        .catch(() => false);
      if (answered) {
        return false;
      }
    } else if (age < STARTUP_GRACE_MS) {
      return false;
    }
    // A slow or wedged live backend can still own Git/configuration work.
    // Never replace it merely because an IPC deadline expired. A stale PID
    // that has been reused is reported for manual recovery rather than risk
    // creating a second writer.
    return false;
  }

  // Only remove the lock that was judged stale, never a newer owner's.
  try {
    const current = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as OwnerRecord;
    if (current.token !== previous.token) {
      return false;
    }
    fs.unlinkSync(lockPath);
    fs.writeFileSync(lockPath, mine, { flag: 'wx', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export async function runDaemon(): Promise<void> {
  holdPayloadSession();
  // Set only so the Electron binary would start as Node. Left in the
  // environment, it would reach every program this process launches, and an
  // editor that is itself Electron (VS Code) would then start as Node too.
  delete process.env['ELECTRON_RUN_AS_NODE'];

  const directory = runtimeDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, 'owner.json');
  const token = randomBytes(32).toString('hex');

  if (!(await claimOwnership(lockPath, token))) {
    // Another backend is running or starting; its clients will find it.
    return;
  }

  const leases = new Map<string, number>();
  let lastActive = Date.now();
  let requests = 0;
  let controlRequests = 0;
  let closing = false;
  let shutdownScheduled = false;

  const app = createApp();
  const http = createServer((req, res) => {
    requests++;
    lastActive = Date.now();
    res.once('close', () => {
      requests--;
      lastActive = Date.now();
    });
    app(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    // Loopback only. This API runs git commands and reads files.
    http.listen(0, '127.0.0.1', resolve);
  });

  const record: BackendRecord = {
    pid: process.pid,
    token,
    protocol: BACKEND_PROTOCOL,
    version: appVersion(),
    origin: `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  };

  const busy = (): boolean =>
    requests > 0 ||
    operations.list().some((entry) => entry.state === 'running' || entry.state === 'queued');

  /** Everything except the caller's own request, which is still open. */
  const idle = (): boolean => leases.size === 0 && controlRequests <= 1 && !busy();

  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    clearInterval(timer);

    lockVault();
    await unloadSessionKeys().catch(() => {});

    http.closeAllConnections();
    http.close();
    control.close();

    try {
      const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as OwnerRecord;
      if (owner.token === token) {
        fs.rmSync(recordPath(), { force: true });
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Already gone; nothing of ours to clean up.
    }
  };

  const dispatch = async (method: string, input: Record<string, unknown>): Promise<unknown> => {
    if (closing || shutdownScheduled) throw new Error('The backend is shutting down. Reconnect to continue.');
    switch (method) {
      case 'identify':
        return record;
      case 'lease':
        if (typeof input['id'] !== 'string' || input['id'].length > 100) {
          throw new Error('A lease needs an id.');
        }
        leases.set(input['id'], Date.now());
        return true;
      case 'release':
        leases.delete(String(input['id']));
        if (input['exitIfIdle'] === true && idle()) {
          shutdownScheduled = true;
          setImmediate(() => void shutdown());
        }
        return true;
      case 'shutdown-if-idle':
        // Asked by a client of another version, usually right after an update.
        if (!idle()) {
          return false;
        }
        shutdownScheduled = true;
        setImmediate(() => void shutdown());
        return true;
      default:
        return privateMethod(method, input);
    }
  };

  if (process.platform !== 'win32') {
    fs.rmSync(controlAddress(), { force: true });
  }

  const control = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(15 * 60_000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      const end = buffer.indexOf('\n');
      if (end === -1) {
        return;
      }
      socket.removeAllListeners('data');

      void (async () => {
        let reply: unknown;
        try {
          const message = JSON.parse(buffer.slice(0, end)) as {
            token?: unknown;
            method?: unknown;
            input?: unknown;
          };
          const provided = Buffer.from(String(message.token ?? ''));
          const expected = Buffer.from(token);
          if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
            throw new Error('Unauthorized backend client.');
          }

          controlRequests++;
          try {
            const input =
              message.input && typeof message.input === 'object' && !Array.isArray(message.input)
                ? (message.input as Record<string, unknown>)
                : {};
            reply = { data: await dispatch(String(message.method), input) };
          } finally {
            controlRequests--;
            lastActive = Date.now();
          }
        } catch (error) {
          reply = { error: error instanceof Error ? error.message : String(error) };
        }
        socket.end(JSON.stringify(reply) + '\n');
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    control.once('error', reject);
    control.listen(controlAddress(), resolve);
  });
  if (process.platform !== 'win32') {
    fs.chmodSync(controlAddress(), 0o600);
  }

  // Written last and atomically, so a client never finds a record for a
  // backend that is not yet listening.
  fs.writeFileSync(`${recordPath()}.tmp`, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(`${recordPath()}.tmp`, recordPath());

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, renewed] of leases) {
      if (now - renewed > LEASE_EXPIRY_MS) {
        leases.delete(id);
      }
    }
    if (stopRequested && operationsIdle()) {
      void shutdown();
    } else if (leases.size > 0 || controlRequests > 0 || busy()) {
      lastActive = now;
    } else if (now - lastActive >= IDLE_EXIT_MS) {
      void shutdown();
    }
  }, 1000);

  // Asked to stop: at once when nothing is running, otherwise as soon as the
  // running operations finish, so a push is never cut off halfway.
  let stopRequested = false;
  const operationsIdle = (): boolean =>
    controlRequests === 0 && !busy();
  const requestStop = (): void => {
    stopRequested = true;
    if (operationsIdle()) {
      void shutdown();
    }
  };
  process.on('SIGTERM', requestStop);
  process.on('SIGINT', requestStop);
}

void runDaemon().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
