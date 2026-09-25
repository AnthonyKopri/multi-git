// Shared helpers for the capture scripts: paths, the isolated environment the
// app runs in, a tiny API client, and starting/stopping browser mode.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(PROMO, '..');
export const HOME = process.env.MG_FAKE_HOME ?? '/home/jane';
export const PORT = Number(process.env.MG_PORT ?? 4173);
export const BASE = `http://127.0.0.1:${PORT}`;
export const CODE = path.join(HOME, 'code');
export const REPOS = {
  api: path.join(CODE, 'acme-api'),
  web: path.join(CODE, 'acme-web'),
  dotfiles: path.join(CODE, 'dotfiles'),
};
export const WORKTREES = {
  login: path.join(CODE, 'acme-api.worktrees', 'login'),
  search: path.join(CODE, 'acme-api.worktrees', 'search'),
};
export const CAPTURES = path.join(PROMO, 'assets', 'captures');
export const CACHE = path.join(PROMO, '.cache');

// The same isolation scripts/gui-smoke.mjs uses, with HOME set to the fake home.
export function isolatedEnv(extra = {}) {
  const env = {
    ...process.env,
    HOME, USERPROFILE: HOME, GH_CONFIG_DIR: path.join(HOME, 'gh'),
    GH_TOKEN: '', GITHUB_TOKEN: '', GH_ENTERPRISE_TOKEN: '', GITHUB_ENTERPRISE_TOKEN: '',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(HOME, '.gitconfig'),
    SSH_AUTH_SOCK: '', GIT_TERMINAL_PROMPT: '0',
    // Safety Net's Recently Discarded lives in os.tmpdir(): keep it in the fake home.
    TMPDIR: path.join(HOME, '.tmp'), TMP: path.join(HOME, '.tmp'), TEMP: path.join(HOME, '.tmp'),
    TZ: 'UTC', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    ...extra,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export const git = (cwd, args, extraEnv = {}) =>
  execFileSync('git', args, { cwd, env: isolatedEnv(extraEnv), encoding: 'utf8', windowsHide: true }).trim();

export async function api(method, route, { body, repo, query } = {}) {
  const url = new URL(route, BASE);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const headers = { 'content-type': 'application/json', origin: BASE };
  if (repo) headers['x-repo-path'] = repo;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/app-info`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`The app did not answer on ${BASE} within ${timeoutMs} ms`);
}

// Starts browser mode (node out/node/server/cli.js) with the isolated env.
export async function startServer() {
  const cli = path.join(ROOT, 'out', 'node', 'server', 'cli.js');
  if (!fs.existsSync(cli)) throw new Error('Run `npm ci && npm run compile` at the repository root first.');
  fs.mkdirSync(CACHE, { recursive: true });
  const log = fs.openSync(path.join(CACHE, 'server.log'), 'a');
  const child = spawn(process.execPath, [cli], {
    cwd: HOME, env: isolatedEnv({ PORT: String(PORT) }), stdio: ['ignore', log, log], windowsHide: true,
  });
  child.unref();
  fs.writeFileSync(path.join(CACHE, 'server.pid'), String(child.pid));
  await waitForServer();
  return child;
}

export async function stopServer() {
  const pidFile = path.join(CACHE, 'server.pid');
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  for (let i = 0; i < 40; i++) {
    try { process.kill(pid, 0); await sleep(100); } catch { break; }
  }
  fs.rmSync(pidFile, { force: true });
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
