// Builds the spec's demo world inside the fake home (/home/jane): three repos
// with a believable history, SSH keys, the app config, and the exact working
// state the storyboard depends on. No network. Idempotent: the fake home is
// wiped and rebuilt, and every date is fixed relative to the start of the
// current UTC day, so re-running on the same day gives the same hashes.
//
//   node capture/make-demo-world.mjs          build the world (server stopped)
//   node capture/make-demo-world.mjs --seed   also seed Safety Net via the API
//                                             (needs start-app.mjs running)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { HOME, CODE, REPOS, WORKTREES, isolatedEnv, git, api } from './lib.mjs';

const ANCHOR = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();
const H = 3600e3;
const when = (hoursAgo) => `@${Math.floor((ANCHOR - hoursAgo * H) / 1000)} +0000`;

const JANE_WORK = { name: 'Jane Doe', email: 'jane@acme.example' };
const JANE_HOME = { name: 'Jane Doe', email: 'jane@example.com' };
const SAM = { name: 'Sam Rivera', email: 'sam@acme.example' };
const PRIYA = { name: 'Priya Nair', email: 'priya@acme.example' };

// ---------------------------------------------------------------- PNG logo --
// A tiny deterministic PNG encoder, so the image diff needs no ImageMagick.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// An "A" monogram on a rounded square: the Acme logo.
function logoPng(bg, fg = '#ffffff', size = 256) {
  const [br, bgc, bb] = hex(bg), [fr, fgc, fb] = hex(fg);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const S = 3; // supersampling
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cover = 0, ink = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
        const qx = Math.max(Math.abs(u - 0.5) - 0.34, 0), qy = Math.max(Math.abs(v - 0.5) - 0.34, 0);
        if (Math.hypot(qx, qy) <= 0.12) {
          cover++;
          const stroke = Math.min(segDist(u, v, 0.5, 0.24, 0.3, 0.76), segDist(u, v, 0.5, 0.24, 0.7, 0.76), segDist(u, v, 0.38, 0.58, 0.62, 0.58));
          if (stroke < 0.055) ink++;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4, k = ink / Math.max(cover, 1);
      raw[o] = Math.round(br + (fr - br) * k); raw[o + 1] = Math.round(bgc + (fgc - bgc) * k);
      raw[o + 2] = Math.round(bb + (fb - bb) * k); raw[o + 3] = Math.round((cover / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------ git helpers --
function write(repo, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(repo, rel);
    if (content === null) { fs.rmSync(file, { force: true }); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}
function commit(repo, message, who, hoursAgo, files = {}) {
  write(repo, files);
  git(repo, ['add', '-A']);
  const d = when(hoursAgo);
  git(repo, ['commit', '-q', '--no-verify', '-m', message], {
    GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_AUTHOR_DATE: d,
    GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email, GIT_COMMITTER_DATE: d,
  });
  return git(repo, ['rev-parse', 'HEAD']);
}
function merge(repo, branch, who, hoursAgo) {
  const d = when(hoursAgo);
  git(repo, ['merge', '-q', '--no-ff', '--no-edit', '-m', `Merge branch '${branch}'`, branch], {
    GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_AUTHOR_DATE: d,
    GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email, GIT_COMMITTER_DATE: d,
  });
}
function tag(repo, name, message, who, hoursAgo) {
  const d = when(hoursAgo);
  git(repo, ['tag', '-a', name, '-m', message], {
    GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email, GIT_COMMITTER_DATE: d,
  });
}
function initRepo(repo, origin) {
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'tag.gpgsign', 'false']);
  git(repo, ['remote', 'add', 'origin', origin]);
}
function track(repo, branch, remoteSha) {
  git(repo, ['update-ref', `refs/remotes/origin/${branch}`, remoteSha]);
  git(repo, ['config', `branch.${branch}.remote`, 'origin']);
  git(repo, ['config', `branch.${branch}.merge`, `refs/heads/${branch}`]);
}

// --------------------------------------------------------------- contents --
const AUTH_HEAD = `import type { Session, Token } from './types';
import { fetchToken, revokeToken } from './token';
import { SESSION_TTL_MS } from './config';

const sessions = new Map<string, Session>();

export function createSession(userId: string, token: Token): Session {
  const session: Session = { id: crypto.randomUUID(), userId, token, createdAt: Date.now() };
  sessions.set(session.id, session);
  return session;
}

export async function getSession(id: string): Promise<Session | undefined> {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

export async function refreshToken(session: Session): Promise<Token> {
  const next = await fetchToken(session.token.refreshToken);
  session.token = next;
  return next;
}

export async function signOut(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  await revokeToken(session.token);
  sessions.delete(id);
}
`;
// Scene B: three meaningful lines (one per hunk) plus two console.log lines.
const AUTH_WORK = AUTH_HEAD
  .replace("import { fetchToken, revokeToken } from './token';",
    "import { fetchToken, revokeToken } from './token';\nimport { expiresSoon } from './token';")
  .replace('  if (!session) return undefined;\n',
    "  if (!session) return undefined;\n  console.log('session', session.id, session.token.expiresAt);\n  if (expiresSoon(session.token)) await refreshToken(session);\n")
  .replace('  session.token = next;\n',
    "  console.log('refreshed', next.expiresAt);\n  session.token = next;\n  session.refreshedAt = Date.now();\n");
const AUTH_V1 = `import type { Session } from './types';
import { SESSION_TTL_MS } from './config';

const sessions = new Map<string, Session>();

export function getSession(id: string): Session | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  return Date.now() - session.createdAt > SESSION_TTL_MS ? undefined : session;
}
`;
const TYPES = (extra = '') => `export interface Token {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface Session {
  id: string;
  userId: string;
  token: Token;
  createdAt: number;${extra}
}
`;
const TOKEN_TS = `import type { Token } from './types';

const REFRESH_MARGIN_MS = 60_000;

export async function fetchToken(refreshToken: string): Promise<Token> {
  const res = await fetch('/oauth/token', { method: 'POST', body: JSON.stringify({ refreshToken }) });
  if (!res.ok) throw new Error(\`token refresh failed: \${res.status}\`);
  return res.json();
}

export async function revokeToken(token: Token): Promise<void> {
  await fetch('/oauth/revoke', { method: 'POST', body: JSON.stringify({ token: token.accessToken }) });
}

export function expiresSoon(token: Token): boolean {
  return token.expiresAt - Date.now() < REFRESH_MARGIN_MS;
}
`;
const pkg = (express, jest) => JSON.stringify({
  name: 'acme-api', version: '1.1.0', private: true, type: 'module',
  scripts: { dev: 'tsx watch src/index.ts', test: 'jest' },
  dependencies: { express },
  devDependencies: { jest, tsx: '^4.19.0', typescript: '^5.6.0' },
}, null, 2) + '\n';
const ROUTES = (extra = '') => `import { Router } from 'express';
import { health } from './handlers/health';
import { notFound } from './handlers/not-found';

export const routes = Router();
routes.get('/health', health);${extra}
routes.use(notFound);
`;

// ------------------------------------------------------------------ world --
export function makeDemoWorld() {
  if (!HOME.startsWith('/home/') || HOME.split('/').length !== 3) throw new Error(`Refusing to wipe ${HOME}`);
  fs.rmSync(HOME, { recursive: true, force: true });
  for (const dir of ['.ssh', 'gh', 'code', '.tmp', 'Desktop', 'Documents', 'Downloads']) fs.mkdirSync(path.join(HOME, dir), { recursive: true });
  fs.chmodSync(path.join(HOME, '.ssh'), 0o700);
  fs.writeFileSync(path.join(HOME, '.gitconfig'),
    '[user]\n\tname = Jane Doe\n\temail = jane@example.com\n[init]\n\tdefaultBranch = main\n' +
    '[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n[advice]\n\tdetachedHead = false\n');
  for (const [name, comment] of [['personal', 'jane@example.com'], ['work', 'jane@acme.example']]) {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', path.join(HOME, '.ssh', `id_ed25519_${name}`)],
      { env: isolatedEnv(), stdio: 'ignore' });
  }

  // ---- acme-api --------------------------------------------------------
  const r = REPOS.api;
  initRepo(r, 'git@github.com:acme/api.git');
  commit(r, 'chore: initial commit', JANE_WORK, 21 * 24 - 2, {
    'README.md': '# acme-api\n\nThe Acme HTTP API.\n',
    'package.json': pkg('^4.19.0', '^29.7.0'),
    '.gitignore': 'node_modules/\ndist/\n*.log\n',
    'src/index.ts': "import express from 'express';\nimport { routes } from './routes';\n\nconst app = express();\napp.use(express.json());\napp.use(routes);\napp.listen(Number(process.env.PORT ?? 3000));\n",
    'public/logo.png': logoPng('#2563eb'),
  });
  commit(r, 'feat(api): add health endpoint', SAM, 20 * 24 - 5, {
    'src/routes.ts': ROUTES(),
    'src/handlers/health.ts': "import type { Request, Response } from 'express';\n\nexport const health = (_req: Request, res: Response) => res.json({ ok: true });\n",
    'src/handlers/not-found.ts': "import type { Request, Response } from 'express';\n\nexport const notFound = (_req: Request, res: Response) => res.status(200).end();\n",
  });
  commit(r, 'chore(deps): bump express', SAM, 19 * 24 - 3, { 'package.json': pkg('^4.21.0', '^29.7.0') });
  commit(r, 'feat(auth): add session store', JANE_WORK, 18 * 24 - 6, {
    'src/auth.ts': AUTH_V1, 'src/types.ts': TYPES(), 'src/config.ts': 'export const SESSION_TTL_MS = 30 * 60_000;\n',
  });
  commit(r, 'chore: add prettier config', PRIYA, 17 * 24 - 1, { '.prettierrc': '{ "singleQuote": true, "printWidth": 100 }\n' });
  commit(r, 'refactor(api): split handlers', PRIYA, 16 * 24 - 4, {
    'src/handlers/index.ts': "export * from './health';\nexport * from './not-found';\n",
  });
  commit(r, 'test(api): cover health endpoint', SAM, 15 * 24 - 7, {
    'test/health.test.ts': "import { health } from '../src/handlers/health';\n\ntest('health answers ok', () => {\n  const json = jest.fn();\n  health({} as never, { json } as never);\n  expect(json).toHaveBeenCalledWith({ ok: true });\n});\n",
  });
  const v100 = commit(r, 'docs: describe local setup', PRIYA, 15 * 24 - 9, {
    'README.md': '# acme-api\n\nThe Acme HTTP API.\n\n## Local setup\n\n```sh\nnpm install\nnpm run dev\n```\n',
  });
  tag(r, 'v1.0.0', 'Release 1.0.0', JANE_WORK, 15 * 24 - 10);
  git(r, ['notes', 'add', '-m', 'Reviewed by Sam Rivera: ship it.', v100], { GIT_COMMITTER_NAME: SAM.name, GIT_COMMITTER_EMAIL: SAM.email, GIT_COMMITTER_DATE: when(15 * 24 - 11) });

  git(r, ['switch', '-q', '-c', 'feature/search']);
  commit(r, 'feat(search): index titles', PRIYA, 14 * 24 - 2, {
    'src/search/index.ts': "export function indexTitles(items: { id: string; title: string }[]) {\n  return new Map(items.map((i) => [i.title.toLowerCase(), i.id]));\n}\n",
  });
  commit(r, 'feat(search): add a query parser', PRIYA, 13 * 24 - 4, {
    'src/search/query.ts': "export function parseQuery(q: string): string[] {\n  return q.trim().toLowerCase().split(/\\s+/).filter(Boolean);\n}\n",
  });
  git(r, ['switch', '-q', 'main']);
  commit(r, 'fix(api): return 404 for unknown routes', SAM, 14 * 24 - 5, {
    'src/handlers/not-found.ts': "import type { Request, Response } from 'express';\n\nexport const notFound = (_req: Request, res: Response) => res.status(404).json({ error: 'not found' });\n",
  });
  commit(r, 'ci: run tests on pull requests', SAM, 13 * 24 - 1, {
    '.github/workflows/test.yml': 'name: test\non: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci && npm test\n',
  });
  merge(r, 'feature/search', JANE_WORK, 12 * 24 - 3);

  git(r, ['switch', '-q', '-c', 'fix/token-refresh']);
  commit(r, 'fix(auth): retry the token fetch once', JANE_WORK, 11 * 24 - 6, {
    'src/auth.ts': AUTH_V1 + "\nexport async function withRetry<T>(fn: () => Promise<T>): Promise<T> {\n  try { return await fn(); } catch { return fn(); }\n}\n",
  });
  commit(r, 'test(auth): cover the token retry', SAM, 10 * 24 - 8, {
    'test/auth.test.ts': "import { withRetry } from '../src/auth';\n\ntest('retries once', async () => {\n  const fn = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(1);\n  await expect(withRetry(fn)).resolves.toBe(1);\n});\n",
  });
  git(r, ['switch', '-q', 'main']);
  commit(r, 'chore(deps): bump jest', SAM, 11 * 24 - 2, { 'package.json': pkg('^4.21.0', '^29.7.1') });
  commit(r, 'feat(api): add request logging', PRIYA, 10 * 24 - 3, {
    'src/middleware/log.ts': "import type { NextFunction, Request, Response } from 'express';\n\nexport function log(req: Request, _res: Response, next: NextFunction) {\n  console.info(req.method, req.path);\n  next();\n}\n",
  });
  merge(r, 'fix/token-refresh', JANE_WORK, 10 * 24 - 5);
  tag(r, 'v1.1.0', 'Release 1.1.0', JANE_WORK, 10 * 24 - 6);

  git(r, ['switch', '-q', 'feature/search']);
  commit(r, 'feat(search): rank by recency', PRIYA, 9 * 24 - 2, {
    'src/search/rank.ts': "export const byRecency = <T extends { updatedAt: number }>(a: T, b: T) => b.updatedAt - a.updatedAt;\n",
  });
  commit(r, 'perf(search): cache results', PRIYA, 8 * 24 - 7, {
    'src/search/cache.ts': "const cache = new Map<string, string[]>();\n\nexport function cached(q: string, run: (q: string) => string[]) {\n  if (!cache.has(q)) cache.set(q, run(q));\n  return cache.get(q)!;\n}\n",
  });
  git(r, ['switch', '-q', 'main']);

  // The rebase range (main~5..main): five linear commits, one a fixup!.
  commit(r, 'feat(api): add rate limiting', SAM, 8 * 24 - 1, {
    'src/middleware/rate-limit.ts': "const hits = new Map<string, number>();\n\nexport function rateLimit(ip: string, limit = 100): boolean {\n  const n = (hits.get(ip) ?? 0) + 1;\n  hits.set(ip, n);\n  return n <= limit;\n}\n",
  });
  const tokenHelpers = commit(r, 'refactor(auth): extract the token helpers', JANE_WORK, 6 * 24 - 4, {
    'src/auth.ts': AUTH_HEAD, 'src/token.ts': TOKEN_TS,
  });
  const highlight = commit(r, 'feat(search): highlight matched terms', PRIYA, 4 * 24 - 3, {
    'src/search/highlight.ts': "export function highlight(text: string, terms: string[]): string {\n  return terms.reduce((out, t) => out.replaceAll(t, `<mark>${t}</mark>`), text);\n}\n",
  });
  git(r, ['branch', 'feature/login']); // forks here: main then gets two more
  commit(r, 'fixup! feat(search): highlight matched terms', PRIYA, 2 * 24 - 6, {
    'src/search/highlight.ts': "const escape = (s: string) => s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');\n\nexport function highlight(text: string, terms: string[]): string {\n  return terms.reduce((out, t) => out.replace(new RegExp(escape(t), 'gi'), (m) => `<mark>${m}</mark>`), text);\n}\n",
  });
  commit(r, 'docs: add API usage', PRIYA, 1 * 24 - 2, {
    'docs/usage.md': '# Using the API\n\n- `GET /health` answers `{ ok: true }`.\n- Sessions expire after 30 minutes.\n',
  });

  git(r, ['switch', '-q', 'feature/login']);
  commit(r, 'feat(auth): add login form', JANE_WORK, 3 * 24 - 5, {
    'src/login/form.ts': "export function renderLoginForm(): string {\n  return '<form id=\"login\"><input name=\"email\"><input name=\"password\" type=\"password\"></form>';\n}\n",
    'src/login/form.css': '#login { display: grid; gap: 12px; max-width: 320px; }\n',
  });
  const loginRemote = commit(r, 'feat(auth): validate the login fields', JANE_WORK, 2 * 24 - 3, {
    'src/login/validate.ts': "export const validEmail = (s: string) => /^[^@\\s]+@[^@\\s]+$/.test(s);\n",
    'src/login/form.ts': "import { validEmail } from './validate';\n\nexport function renderLoginForm(): string {\n  return '<form id=\"login\" novalidate><input name=\"email\"><input name=\"password\" type=\"password\"></form>';\n}\n\nexport { validEmail };\n",
  });
  commit(r, 'test(auth): cover the login form', SAM, 1 * 24 - 5, {
    'test/login.test.ts': "import { validEmail } from '../src/login/validate';\n\ntest('rejects a bare name', () => expect(validEmail('jane')).toBe(false));\n",
    'src/routes.ts': ROUTES("\nroutes.get('/login', (_req, res) => res.send('login'));"),
  });
  git(r, ['switch', '-q', 'main']);

  // A throwaway branch the seed step deletes, so Safety Net has a recovery point.
  git(r, ['branch', 'spike/old-cache', tokenHelpers]);

  // Fake remote-tracking refs (no network): main is 2 ahead of origin,
  // feature/login 1 ahead, feature/search in sync, plus a remote-only branch.
  track(r, 'main', highlight);
  track(r, 'feature/login', loginRemote);
  track(r, 'feature/search', git(r, ['rev-parse', 'feature/search']));
  track(r, 'fix/token-refresh', git(r, ['rev-parse', 'fix/token-refresh']));
  const d = when(5 * 24);
  const exportTree = git(r, ['rev-parse', `${tokenHelpers}^{tree}`]);
  const exportSha = git(r, ['commit-tree', exportTree, '-p', tokenHelpers, '-m', 'feat(api): export CSV reports'], {
    GIT_AUTHOR_NAME: SAM.name, GIT_AUTHOR_EMAIL: SAM.email, GIT_AUTHOR_DATE: d,
    GIT_COMMITTER_NAME: SAM.name, GIT_COMMITTER_EMAIL: SAM.email, GIT_COMMITTER_DATE: d,
  });
  git(r, ['update-ref', 'refs/remotes/origin/feature/export', exportSha]);
  git(r, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);

  // Worktrees for feature/login and feature/search.
  fs.mkdirSync(path.dirname(WORKTREES.login), { recursive: true });
  git(r, ['worktree', 'add', '-q', WORKTREES.login, 'feature/login']);
  git(r, ['worktree', 'add', '-q', WORKTREES.search, 'feature/search']);

  // One stash.
  write(r, { 'src/config.ts': 'export const SESSION_TTL_MS = 15 * 60_000;\n' });
  git(r, ['stash', 'push', '-q', '-m', 'WIP: try a shorter session timeout'], {
    GIT_COMMITTER_NAME: JANE_WORK.name, GIT_COMMITTER_EMAIL: JANE_WORK.email, GIT_COMMITTER_DATE: when(20),
    GIT_AUTHOR_NAME: JANE_WORK.name, GIT_AUTHOR_EMAIL: JANE_WORK.email, GIT_AUTHOR_DATE: when(20),
  });

  // Scene B's working tree: auth.ts with three hunks and two console.logs, a
  // staged types.ts, an untracked note, and the recoloured logo.
  write(r, { 'src/types.ts': TYPES('\n  refreshedAt?: number;') });
  git(r, ['add', 'src/types.ts']);
  write(r, {
    'src/auth.ts': AUTH_WORK,
    'docs/token-refresh.md': '# Token refresh\n\nRefresh a minute before expiry, never after.\n',
    'public/logo.png': logoPng('#f97316'),
    // Discarded through the API by the seed step (Recently Discarded).
    'docs/usage.md': '# Using the API\n\n- `GET /health` answers `{ ok: true }`.\n- Sessions expire after 30 minutes.\n- TODO: rate limits\n',
  });

  // ---- acme-web ---------------------------------------------------------
  const w = REPOS.web;
  initRepo(w, 'git@github.com:acme/web.git');
  commit(w, 'chore: initial commit', JANE_WORK, 16 * 24 - 3, { 'README.md': '# acme-web\n\nThe Acme web app.\n', 'index.html': '<!doctype html>\n<title>Acme</title>\n' });
  commit(w, 'feat(ui): add the landing page', PRIYA, 12 * 24 - 2, { 'src/landing.ts': "export const landing = () => '<h1>Acme</h1>';\n" });
  commit(w, 'feat(ui): add the login screen', JANE_WORK, 7 * 24 - 4, { 'src/login.ts': "export const login = () => '<form id=\"login\"></form>';\n" });
  commit(w, 'fix(ui): align the header', PRIYA, 3 * 24 - 1, { 'src/header.css': 'header { display: flex; align-items: center; }\n' });
  const webHead = commit(w, 'chore(deps): bump vite', SAM, 2 * 24 - 2, { 'package.json': '{ "name": "acme-web", "private": true, "devDependencies": { "vite": "^6.0.0" } }\n' });
  track(w, 'main', webHead);

  // ---- dotfiles ---------------------------------------------------------
  const f = REPOS.dotfiles;
  initRepo(f, 'git@github.com:jane/dotfiles.git');
  commit(f, 'chore: initial commit', JANE_HOME, 30 * 24, { '.zshrc': 'export EDITOR=vim\n' });
  commit(f, 'feat(zsh): add git aliases', JANE_HOME, 9 * 24, { '.zshrc': 'export EDITOR=vim\nalias gs="git status"\nalias gl="git log --oneline"\n' });
  const dotHead = commit(f, 'chore(vim): tidy the vimrc', JANE_HOME, 5 * 24, { '.vimrc': 'set number\nset expandtab\n' });
  track(f, 'main', dotHead);

  // ---- app config (seeded before the server starts; §3.3) ---------------
  const agent = (id, label, promptMode) => ({ id, label, executable: id, args: [], terminal: 'system-terminal', enabled: true, promptMode, catalogueId: id });
  const config = {
    recentRepos: [REPOS.api, REPOS.web, REPOS.dotfiles],
    sshProfiles: [
      { id: 'personal', label: 'Personal', privateKeyPath: path.join(HOME, '.ssh', 'id_ed25519_personal'),
        userName: 'Jane Doe', userEmail: 'jane@example.com', verifiedAccount: 'jane-personal' },
      { id: 'work', label: 'Work', privateKeyPath: path.join(HOME, '.ssh', 'id_ed25519_work'),
        userName: 'Jane Doe', userEmail: 'jane@acme.example', verifiedAccount: 'jane-acme' },
    ],
    accountRules: [
      { id: 'r1', match: 'github.com/acme/', profileId: 'work' },
      { id: 'r2', match: 'github.com/jane/', profileId: 'personal' },
    ],
    repoSettings: {},
    settings: { manageSshConfig: false, checkForUpdates: false, restoreWindowsOnStartup: false, autoPull: false },
    repoGroups: [{ id: 'g1', label: 'Acme', order: 0, repos: [] }],
    externalAgents: [agent('claude', 'Claude Code', 'argument'), agent('codex', 'Codex', 'argument'), agent('gemini', 'Gemini CLI', 'flag')],
  };
  fs.writeFileSync(path.join(HOME, '.multi-git-client-config.json'), JSON.stringify(config, null, 2) + '\n');
  return { anchor: new Date(ANCHOR).toISOString() };
}

// What the header's SSH Key dropdown does (src/renderer/features/accounts):
// point the repo at the profile's key, then set the profile's commit identity.
// (POST /api/config/ssh/repo-setup is only a read-only preflight.)
export async function selectAccount(repoPath, profileId) {
  const email = profileId === 'work' ? 'jane@acme.example' : 'jane@example.com';
  await api('POST', '/api/config/ssh/apply-ssh-config', { body: { profileId, repoPath } });
  await api('POST', '/api/git/identity', { repo: repoPath, body: { name: 'Jane Doe', email, scope: 'local' } });
  // The backend's own record of the choice (what the TUI and CLI read).
  await api('POST', '/api/workflows/ssh', { repo: repoPath, body: { profileId, confirmed: true } });
}

// Needs the server. Fills the canonical-identity keyed parts of the config and
// seeds Safety Net: one recovery point and one Recently Discarded entry.
export async function seedThroughApi({ profileForApi = 'work' } = {}) {
  for (const repo of Object.values(REPOS)) await api('POST', '/api/config/repo', { body: { repoPath: repo } });
  for (const repo of [REPOS.api, REPOS.web]) {
    await api('POST', '/api/config/repo-settings', { body: { repoPath: repo, intendedAccount: 'jane-acme' } });
  }
  await selectAccount(REPOS.web, 'work');
  await selectAccount(REPOS.dotfiles, 'personal');
  await selectAccount(REPOS.api, profileForApi);
  await api('POST', '/api/repo-groups', { body: { id: 'g1', label: 'Acme', order: 0, repos: [REPOS.api, REPOS.web] } });
  await api('POST', '/api/git/delete-branch', { repo: REPOS.api, body: { branch: 'spike/old-cache' } });
  await api('POST', '/api/git/discard', { repo: REPOS.api, body: { filePath: 'docs/usage.md' } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const info = makeDemoWorld();
  console.log(`demo world built in ${CODE} (dates anchored to ${info.anchor})`);
  if (process.argv.includes('--seed')) {
    await seedThroughApi();
    console.log('seeded Safety Net and account settings through the API');
  }
}
