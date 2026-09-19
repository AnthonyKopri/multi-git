// Finding, starting and holding on to the one per-user backend.
//
// The desktop app, the terminal UI, the JSON CLI and the MCP server all talk to
// the same backend process, so there is one owner of the configuration file,
// one set of repository locks, one operations list and one unlocked vault. The
// first client to need it starts it; the rest find it through a discovery
// record in a private directory and prove it is the process the record names
// before trusting it.
//
// Clients hold a lease and renew it. The backend exits once no lease, request
// or operation has kept it busy for a minute, which also forgets the vault key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appVersion, fromAppRoot } from '../app-root';
import { terminalHome } from '../terminal/install';

/** Bumped when the control protocol or the HTTP API changes incompatibly. */
export const BACKEND_PROTOCOL = 1;

const LEASE_RENEW_MS = 15_000;
const IDENTIFY_TIMEOUT_MS = 1_000;
const START_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15 * 60_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export function runtimeDirectory(): string {
  return process.env['MULTI_GIT_RUNTIME_DIR'] ?? path.join(os.homedir(), '.multi-git', 'runtime');
}

/**
 * Where the private control channel listens: a named pipe on Windows, a
 * socket in the private runtime directory elsewhere. The pipe name is derived
 * from the directory so a test's own runtime directory gets its own pipe.
 */
export function controlAddress(): string {
  if (process.platform === 'win32') {
    const suffix = createHash('sha256').update(runtimeDirectory()).digest('hex').slice(0, 24);
    return `\\\\.\\pipe\\multi-git-${suffix}`;
  }
  return path.join(runtimeDirectory(), 'control.sock');
}

/** What a running backend writes for its clients to find it by. */
export interface BackendRecord {
  pid: number;
  token: string;
  origin: string;
  version: string;
  protocol: number;
}

export interface BackendConnection {
  /** The loopback HTTP origin of the backend's API and web UI. */
  origin: string;
  /** A call on the private control channel, for work the HTTP API does not expose. */
  call<T = unknown>(method: string, input?: unknown): Promise<T>;
  /**
   * Gives up this client's lease. With `exitIfIdle`, the backend exits now
   * rather than a minute from now when nothing else needs it, which is what
   * lets an installer replace its files straight after the desktop app quits.
   */
  close(options?: { exitIfIdle?: boolean }): Promise<void>;
}

/** Thrown when a backend of another version is busy and cannot be replaced. */
export class BackendVersionError extends Error {
  readonly code = 'BACKEND_VERSION_MISMATCH';

  constructor(readonly running: string, readonly wanted: string) {
    super(
      `Multi-Git ${running} is running in another window or terminal, and this is ${wanted}. ` +
        'Close the other Multi-Git sessions, then try again.'
    );
  }
}

/** One request and one response, newline-delimited JSON, on a fresh connection. */
export function controlCall<T>(
  record: Pick<BackendRecord, 'token'>,
  method: string,
  input: unknown = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(controlAddress());
    let buffer = '';
    let settled = false;

    const finish = (error: Error | null, value?: T): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(value as T);
      }
    };

    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () =>
      finish(new Error('The backend did not answer in time. Check Operations before retrying a change.'))
    );
    socket.on('error', (error) => finish(error));
    socket.on('connect', () => {
      socket.write(JSON.stringify({ token: record.token, method, input }) + '\n');
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_RESPONSE_BYTES) {
        finish(new Error('The backend response was too large.'));
        return;
      }
      const end = buffer.indexOf('\n');
      if (end === -1) {
        return;
      }
      try {
        const response = JSON.parse(buffer.slice(0, end)) as { data?: T; error?: string };
        if (typeof response.error === 'string') {
          finish(new Error(response.error));
        } else {
          finish(null, response.data as T);
        }
      } catch (error) {
        finish(error as Error);
      }
    });
    socket.on('close', () => finish(new Error('The backend closed the connection.')));
  });
}

export function recordPath(): string {
  return path.join(runtimeDirectory(), 'connection.json');
}

export function readBackendRecord(): BackendRecord | null {
  try {
    const value = JSON.parse(fs.readFileSync(recordPath(), 'utf8')) as Partial<BackendRecord>;
    if (
      !Number.isInteger(value.pid) ||
      typeof value.token !== 'string' ||
      typeof value.version !== 'string' ||
      !Number.isInteger(value.protocol) ||
      typeof value.origin !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin)
    ) {
      return null;
    }
    return value as BackendRecord;
  } catch {
    return null;
  }
}

/**
 * The Node to run the backend with: the terminal edition's own runtime when
 * there is one, otherwise this process's executable. Under Electron that is
 * the Electron binary, which ELECTRON_RUN_AS_NODE turns into a plain Node.
 */
export function runtimeExecutable(): string {
  const bundled = fromAppRoot('runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  return fs.existsSync(bundled) ? bundled : process.execPath;
}

/**
 * What to start the backend from. The installed terminal edition of this same
 * version when there is one: it lives in a per-user folder nothing replaces
 * while it runs, where this process may be an AppImage mount that disappears
 * when the app quits, or an installation an update is about to overwrite.
 * Otherwise this copy's own.
 */
function launchTarget(entry: string | undefined): { executable: string; entry: string } {
  if (entry) {
    return { executable: runtimeExecutable(), entry };
  }
  const installed = path.join(terminalHome(), 'versions', appVersion());
  const installedRuntime = path.join(installed, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  const installedEntry = path.join(installed, 'out', 'node', 'server', 'daemon.js');
  if (fs.existsSync(installedRuntime) && fs.existsSync(installedEntry)) {
    return { executable: installedRuntime, entry: installedEntry };
  }
  return { executable: runtimeExecutable(), entry: fromAppRoot('out', 'node', 'server', 'daemon.js') };
}

function launchBackend(target: { executable: string; entry: string }): void {
  fs.mkdirSync(runtimeDirectory(), { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(runtimeDirectory(), 'backend.log'), 'a', 0o600);
  try {
    const child = spawn(target.executable, [target.entry], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    // A failed spawn surfaces as the connection loop timing out, with the log
    // named in the error; there is nothing more useful to do with it here.
    child.on('error', () => {});
    child.unref();
  } finally {
    fs.closeSync(log);
  }
}

// Not unref'd: in the CLI this wait may be the only thing keeping the process
// alive, and letting it exit here would lose the command.
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks the recorded backend who it is, giving up quickly if nobody answers. */
async function identify(record: BackendRecord): Promise<BackendRecord | null> {
  try {
    const identity = await controlCall<BackendRecord>(record, 'identify', {}, IDENTIFY_TIMEOUT_MS);
    // A reused pipe name or a record left by another process is not proof.
    return identity.pid === record.pid && identity.token === record.token ? identity : null;
  } catch {
    return null;
  }
}

/** Takes a lease on the backend and keeps it renewed until closed. */
async function lease(record: BackendRecord): Promise<BackendConnection> {
  const id = randomUUID();
  // Taken before returning, so a backend about to go idle cannot exit under
  // a client that has just found it.
  await controlCall(record, 'lease', { id }, IDENTIFY_TIMEOUT_MS * 5);

  const renew = setInterval(() => {
    void controlCall(record, 'lease', { id }).catch(() => {});
  }, LEASE_RENEW_MS);
  renew.unref();

  return {
    origin: record.origin,
    call: (method, input) => controlCall(record, method, input),
    close: async (options = {}) => {
      clearInterval(renew);
      await controlCall(record, 'release', { id, exitIfIdle: options.exitIfIdle === true }).catch(
        () => {}
      );
    }
  };
}

export interface ConnectOptions {
  /**
   * Require a backend of exactly this version. The desktop app does, because
   * its windows load their pages from the backend. The terminal, the CLI and
   * MCP only need the same protocol, so an installed terminal edition keeps
   * working beside a desktop app that has just updated itself.
   */
  exactVersion?: boolean;
  /** Tests only: the bundle to start, and the version to expect. */
  entry?: string;
  version?: string;
}

/**
 * Connects to the running backend, starting one when there is none.
 *
 * A backend that will not do is asked to exit if nothing is using it, which
 * is the usual case straight after an update, and replaced. One that is busy
 * is left alone and reported: two backends writing one configuration file is
 * the thing this design exists to prevent.
 */
export async function connectBackend(options: ConnectOptions = {}): Promise<BackendConnection> {
  const wanted = options.version ?? appVersion();
  const deadline = Date.now() + START_TIMEOUT_MS;
  let launched = false;

  while (Date.now() < deadline) {
    const record = readBackendRecord();
    const identity = record ? await identify(record) : null;

    if (record && identity) {
      const compatible =
        identity.protocol === BACKEND_PROTOCOL && (options.exactVersion !== true || identity.version === wanted);
      if (compatible) {
        try { return await lease(record); }
        catch { launched = false; await sleep(100); continue; }
      }

      const stopped = await controlCall<boolean>(record, 'shutdown-if-idle', {}, IDENTIFY_TIMEOUT_MS * 5)
        .catch(() => false);
      if (!stopped) {
        throw new BackendVersionError(identity.version, wanted);
      }
      // Give it a moment to close its listeners before starting the new one.
      launched = false;
      await sleep(250);
      continue;
    }

    if (!launched) {
      launchBackend(launchTarget(options.entry));
      launched = true;
    }
    await sleep(100);
  }

  throw new Error(
    `The Multi-Git backend did not start. Its log is ${path.join(runtimeDirectory(), 'backend.log')}.`
  );
}
