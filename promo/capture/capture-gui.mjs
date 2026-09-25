// Captures the real Multi-Git UI (browser mode) with Puppeteer: WebP plates
// plus the rendered DOM of each region, which the film's rebuild reuses.
// Viewport 1600x1000 at deviceScaleFactor 2. Google Fonts requests are
// answered from local npm/font files, so captures need no network.
//
//   node capture/capture-gui.mjs            all steps (needs start-app + seed)
//   node capture/capture-gui.mjs --only=a,b just those steps
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import { PROMO, BASE, REPOS, CAPTURES, api, git, sleep, writeJson } from './lib.mjs';
import { selectAccount } from './make-demo-world.mjs';

const DOM = path.join(CAPTURES, 'dom');
const DATA = path.join(CAPTURES, 'data');
fs.mkdirSync(DOM, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
const manifestFile = path.join(CAPTURES, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { files: [] };
const record = (entry) => {
  manifest.files = manifest.files.filter((f) => f.file !== entry.file);
  manifest.files.push({ ...entry, capturedAt: new Date().toISOString() });
};
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);

// ---------------------------------------------------------------- fonts --
const nm = (...p) => path.join(PROMO, 'node_modules', ...p);
const FONT_FILES = {
  'inter-latin.woff2': path.join(PROMO, 'public', 'fonts', 'InterVariable-latin.woff2'),
  'inter-latin-ext.woff2': path.join(PROMO, 'public', 'fonts', 'InterVariable-latin-ext.woff2'),
  'jbm-400.woff2': path.join(PROMO, 'public', 'fonts', 'JetBrainsMono-Regular.woff2'),
  'jbm-500.woff2': path.join(PROMO, 'public', 'fonts', 'JetBrainsMono-Medium.woff2'),
  'material-symbols-outlined.woff2': nm('material-symbols', 'material-symbols-outlined.woff2'),
};
const G = 'https://fonts.gstatic.com/mg/';
const TEXT_CSS = `
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url(${G}inter-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url(${G}inter-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400;font-display:block;src:url(${G}jbm-400.woff2) format('woff2')}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:500;font-display:block;src:url(${G}jbm-500.woff2) format('woff2')}`;
const ICON_CSS = `
@font-face{font-family:'Material Symbols Outlined';font-style:normal;font-weight:100 700;font-display:block;src:url(${G}material-symbols-outlined.woff2) format('woff2')}
.material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;-webkit-font-feature-settings:'liga';font-feature-settings:'liga';-webkit-font-smoothing:antialiased}`;

async function interceptFonts(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith('data:')) return req.continue();
    const cors = { 'access-control-allow-origin': '*' };
    if (url.startsWith('https://fonts.googleapis.com/css2')) {
      return req.respond({ status: 200, headers: cors, contentType: 'text/css', body: url.includes('Material+Symbols') ? ICON_CSS : TEXT_CSS });
    }
    if (url.startsWith(G)) {
      const file = FONT_FILES[url.slice(G.length)];
      if (file) return req.respond({ status: 200, headers: cors, contentType: 'font/woff2', body: fs.readFileSync(file) });
    }
    return req.abort();
  });
}

// ------------------------------------------------------------- helpers --
let page;
const click = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error(`missing ${s}`); el.click(); }, sel);
const visible = (sel, timeout = 8000) => page.waitForSelector(sel, { visible: true, timeout });
const escape = async (n = 2) => { for (let i = 0; i < n; i++) { await page.keyboard.press('Escape'); await sleep(150); } };
async function chord(...keys) {
  for (const k of keys.slice(0, -1)) await page.keyboard.down(k);
  await page.keyboard.press(keys[keys.length - 1]);
  for (const k of keys.slice(0, -1).reverse()) await page.keyboard.up(k);
}
async function palette(title) {
  await chord('Control', 'k');
  await visible('#palette-input');
  await page.type('#palette-input', title);
  await sleep(250);
  await page.keyboard.press('Enter');
  await sleep(700);
}
async function openRepo(repo = REPOS.api) {
  await page.goto(`${BASE}/?repo=${encodeURIComponent(repo)}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelectorAll('#commit-history-list [data-hash], #commit-history-list li').length > 5 && document.querySelectorAll('#unstaged-files-list .file-item').length > 0, { timeout: 15000 }).catch(() => console.log('openRepo: rows not found'));
  await page.evaluate(() => document.fonts.ready);
  await sleep(600);
}
async function expandSection(name) {
  await page.evaluate((n) => {
    const s = document.querySelector(`.sidebar-section[data-section="${n}"]`);
    const t = s?.querySelector('.section-toggle');
    if (t && t.getAttribute('aria-expanded') === 'false') t.click();
  }, name);
  await sleep(300);
}
async function rectOf(sel, pad = 0) {
  return page.evaluate((s, p) => {
    const el = document.querySelector(s); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - p), y: Math.max(0, r.y - p), width: Math.min(1600, r.width + 2 * p), height: Math.min(1000, r.height + 2 * p) };
  }, sel, pad);
}
async function shot(name, shows, { sel, clip, pad = 12 } = {}) {
  const region = clip ?? (sel ? await rectOf(sel, pad) : null);
  const file = `${name}.webp`;
  await page.screenshot({ path: path.join(CAPTURES, file), type: 'webp', quality: 82, ...(region ? { clip: region } : {}) });
  record({ file, shows, how: `Puppeteer, browser mode, 1600x1000 viewport at 2x${sel ? `, clipped to ${sel}` : ''}`, region: region ?? { x: 0, y: 0, width: 1600, height: 1000 } });
}
async function dom(name, selectors, shows) {
  const parts = await page.evaluate((sels) => sels.map((s) => {
    const el = document.querySelector(s);
    return el ? `<!-- ${s} -->\n${el.outerHTML}` : `<!-- ${s}: missing -->`;
  }), selectors);
  const file = `dom/${name}.html`;
  fs.writeFileSync(path.join(CAPTURES, file), parts.join('\n'));
  record({ file, shows, how: 'outerHTML of the live app after the step, for the rebuild' });
}
async function data(name, value, shows, how) {
  writeJson(path.join(DATA, `${name}.json`), value);
  record({ file: `data/${name}.json`, shows, how });
}

async function readBacklog() {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/logs/stream`, { headers: { origin: BASE }, signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const block of buf.split('\n\n').slice(0, -1)) {
      const ev = /^event: (.*)$/m.exec(block)?.[1];
      const payload = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (ev === 'backlog') { ctrl.abort(); return JSON.parse(payload); }
    }
  }
  return [];
}

// Added lines whose text matches, from a GET /api/git/diff/structured answer.
function addedLineIds(answer, re) {
  const ids = [];
  for (const h of answer.file?.hunks ?? answer.hunks ?? []) {
    for (const l of h.lines ?? []) {
      const text = Object.values(l).filter((v) => typeof v === 'string').join(' ');
      if (l.kind !== 'context' && l.kind !== 'del' && l.kind !== 'deleted' && l.kind !== 'remove' && re.test(text)) ids.push(l.id);
    }
  }
  return ids;
}

// --------------------------------------------------------------- steps --
const steps = {
  async data() {
    const repo = REPOS.api;
    const get = (route, query) => api('GET', route, { repo, query }).catch((err) => ({ error: err.message }));
    await data('status', await get('/api/git/status'), 'Working tree status of acme-api (scene B state)', 'GET /api/git/status');
    await data('history', await get('/api/git/log', { limit: 40 }), 'History of acme-api, newest first', 'GET /api/git/log?limit=40');
    await data('branches', await get('/api/git/branches'), 'Local and remote branches', 'GET /api/git/branches');
    await data('worktrees', await get('/api/worktrees'), 'Worktrees of acme-api', 'GET /api/worktrees');
    await data('rebase-plan', await get('/api/git/rebase/plan', { onto: git(repo, ['rev-parse', 'HEAD~5']), autosquash: 'true' }), 'Rebase plan for HEAD~5 with autosquash', 'GET /api/git/rebase/plan');
    await data('recovery', await get('/api/git/recovery'), 'Recovery points and reflog (seeded)', 'GET /api/git/recovery');
    await data('trash', await get('/api/git/trash'), 'Recently Discarded (seeded)', 'GET /api/git/trash');
    await data('checkpoints', await get('/api/git/checkpoints'), 'Undoable operations', 'GET /api/git/checkpoints');
    await data('auth-diff-pristine', await get('/api/git/diff/structured', { path: 'src/auth.ts', source: 'working-tree' }), 'Structured diff of src/auth.ts before any action', 'GET /api/git/diff/structured');
  },
  async workspace() {
    await openRepo();
    const icons = await page.evaluate(() => {
      const el = document.querySelector('.material-symbols-outlined');
      const r = el?.getBoundingClientRect();
      return { fontOk: document.fonts.check('24px "Material Symbols Outlined"'), iconWidth: r?.width, iconHeight: r?.height, text: el?.textContent };
    });
    console.log('icon check', JSON.stringify(icons));
    await shot('workspace', 'The workspace mid-work: header, sidebar, Staging Area and History lanes (Work account)');
    const html = await page.evaluate(() => {
      const c = document.body.cloneNode(true);
      c.querySelectorAll('script').forEach((s) => s.remove());
      return c.innerHTML;
    });
    fs.writeFileSync(path.join(DOM, 'workspace-body.html'), html);
    record({ file: 'dom/workspace-body.html', shows: 'The whole rendered body (all regions and hidden dialogs) in the workspace state', how: 'body innerHTML without scripts' });
  },
  async filediff() {
    await openRepo();
    await click('#tab-diff');
    await sleep(700);
    await click('#diff-files-list li[data-path="src/auth.ts"]');
    await sleep(1200);
    const label = await page.$eval('#btn-diff-layout-label', (e) => e.textContent.trim()).catch(() => '');
    if (label === 'Split') { await click('#btn-diff-layout'); await sleep(700); }
    await dom('filediff-unselected', ['#diff-view'], 'File Diff for src/auth.ts in split view, nothing selected');
    const picked = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-line-id]')];
      const want = ["import { expiresSoon }", 'if (expiresSoon(', 'session.refreshedAt ='];
      const hits = [];
      for (const w of want) {
        const row = rows.find((r) => r.textContent.includes(w));
        if (row) { row.click(); hits.push(w); }
      }
      return hits;
    });
    await sleep(500);
    console.log('selected lines', picked.length);
    await shot('filediff-selected', 'File Diff, split view, 3 added lines selected, with the selection bar');
    await dom('filediff-selected', ['#diff-view'], 'File Diff with 3 lines selected and the selection bar');
  },
  async worddiff() {
    await openRepo();
    await click('#tab-diff');
    await sleep(700);
    await click('#diff-files-list li[data-path="src/handlers/health.ts"]');
    await sleep(1200);
    const label = await page.$eval('#btn-diff-layout-label', (e) => e.textContent.trim()).catch(() => '');
    if (label === 'Split') { await click('#btn-diff-layout'); await sleep(700); }
    await shot('worddiff', 'Split File Diff of src/handlers/health.ts: one modified line with word-level highlights');
    await dom('worddiff', ['#diff-view'], 'Split diff with word-level highlights');
  },
  async imagediff() {
    await openRepo();
    await click('#tab-diff');
    await sleep(700);
    await click('#diff-files-list li[data-path="public/logo.png"]');
    await sleep(1800);
    await shot('imagediff', 'The before/after image diff of public/logo.png');
    await dom('imagediff', ['#diff-view'], 'Image diff markup');
  },
  async sshdropdownWork() {
    await openRepo();
    await click('#profile-segment');
    await visible('#profile-dropdown');
    await sleep(500);
    await shot('ssh-dropdown-work', 'SSH Key dropdown on acme-api with Work selected: Should use / Using jane-acme, identity', { sel: '#profile-dropdown', pad: 16 });
    await dom('ssh-dropdown-work', ['#profile-segment-wrapper'], 'SSH Key segment and dropdown, Work selected');
    await escape();
  },
  async sshWindow() {
    await openRepo();
    await palette('Manage SSH profiles');
    await visible('#ssh-modal');
    await page.evaluate(() => {
      const h = [...document.querySelectorAll('#ssh-modal h2, #ssh-modal h3, #ssh-modal h4')].find((e) => /Auto-select rules/i.test(e.textContent));
      h?.scrollIntoView({ block: 'start' });
    });
    await sleep(500);
    await shot('ssh-window-rules', 'The SSH window scrolled to Auto-select rules (github.com/acme/ -> Work)');
    await dom('ssh-window', ['#ssh-modal'], 'Manage SSH profiles window');
    await escape();
  },
  async palette() {
    await openRepo();
    await chord('Control', 'k');
    await visible('#palette-input');
    await sleep(500);
    await shot('palette', 'The command palette (Ctrl+K) with its full list');
    await dom('palette', ['#palette-modal'], 'Command palette');
    await escape();
  },
  async mergePreview() {
    await openRepo();
    await expandSection('integrate');
    await page.select('#integrate-branch-select', 'feature/login').catch(() => {});
    await click('#btn-merge');
    await visible('#confirm-modal');
    await sleep(500);
    await shot('merge-preview', 'The merge preview: Merge feature/login? with commits, files and the recovery-point note', { sel: '#confirm-modal .modal-content, #confirm-modal > *', pad: 16 });
    await dom('merge-preview', ['#confirm-modal'], 'Merge preview dialog');
    await click('#btn-confirm-cancel');
  },
  async repoHub() {
    await openRepo();
    await click('#btn-repo-hub');
    await visible('#repo-hub-modal');
    for (const tab of ['remotes', 'lfs', 'bisect', 'submodules', 'notes']) {
      await click(`#hub-tab-${tab}`);
      await sleep(900);
      await shot(`hub-${tab}`, `Repository hub: ${tab} tab`);
      await dom(`hub-${tab}`, ['#repo-hub-modal'], `Repository hub, ${tab} tab`);
    }
    await escape();
  },
  async worktrees() {
    await openRepo();
    await expandSection('worktrees');
    await page.evaluate(() => document.querySelector('#section-worktrees')?.scrollIntoView({ block: 'center' }));
    await sleep(500);
    await shot('worktrees-section', 'Sidebar Worktrees section: main, feature/login, feature/search', { sel: '#section-worktrees', pad: 40 });
    await dom('worktrees-section', ['.sidebar-section[data-section="worktrees"]'], 'Worktrees section');
    await click('#btn-worktree-manage');
    await visible('#worktree-modal');
    await sleep(800);
    await shot('worktrees-window', 'The Manage worktrees window');
    await dom('worktrees-window', ['#worktree-modal'], 'Manage worktrees window');
    await escape();
  },
  async agentLaunch() {
    // Browser mode has no desktop bridge, so the dialog refuses to open. Stub
    // only the launch function for this step: the dialog itself is the real
    // one, and nothing is ever launched (the step never presses Launch).
    const { identifier } = await page.evaluateOnNewDocument(() => {
      window.desktopApi = Object.assign(window.desktopApi ?? {}, { launchAgent: async () => ({ success: true }) });
    });
    try {
      await openRepo();
      await palette('Launch a coding agent here');
      await visible('#agent-launch-modal', 5000);
      await sleep(600);
      await shot('agent-launch', 'The Launch a coding agent window (Claude Code, Codex, Gemini CLI)');
      await dom('agent-launch', ['#agent-launch-modal'], 'Launch a coding agent window');
      await escape();
    } finally {
      await page.removeScriptToEvaluateOnNewDocument(identifier);
    }
  },
  async rebasePlanner() {
    await openRepo();
    await palette('Interactive rebase (plan commit by commit)');
    await visible('#rebase-modal');
    const onto5 = git(REPOS.api, ['rev-parse', 'HEAD~5']);
    await page.evaluate((hash) => {
      const onto = document.querySelector('#rebase-onto');
      if (onto && 'value' in onto) { onto.value = hash; onto.dispatchEvent(new Event('input', { bubbles: true })); onto.dispatchEvent(new Event('change', { bubbles: true })); }
      const auto = document.querySelector('#rebase-autosquash');
      if (auto && !auto.checked) auto.click();
    }, onto5);
    await sleep(600);
    await click('#btn-rebase-reload').catch(() => {});
    await sleep(1200);
    await shot('rebase-planner', 'The rebase planner: rows with action selects, Move earlier/later, Autosquash');
    await dom('rebase-planner', ['#rebase-modal'], 'Rebase planner with rows');
    await escape();
  },
  async safetyNet() {
    await openRepo();
    await expandSection('safety-net');
    await page.evaluate(() => document.querySelector('#section-safety-net')?.scrollIntoView({ block: 'center' }));
    await sleep(500);
    await shot('safety-net', 'Sidebar Safety Net: Undoable Operations, Recently Discarded, Recovery Points', { sel: '#section-safety-net', pad: 40 });
    await dom('safety-net', ['.sidebar-section[data-section="safety-net"]'], 'Safety Net section');
    await palette('Recovery points and reflog');
    await visible('#recovery-modal');
    await sleep(800);
    await shot('recovery-window', 'Recovery points and reflog window');
    await dom('recovery-window', ['#recovery-modal'], 'Recovery points window');
    await escape();
  },
  async accountMismatch() {
    await openRepo();
    await click('#profile-segment');
    await visible('#profile-dropdown');
    await click('#profile-dropdown-list [data-profile-id="personal"]');
    await sleep(900);
    if (await page.$eval('#confirm-modal', (e) => !e.classList.contains('hidden')).catch(() => false)) {
      await dom('profile-switch-confirm', ['#confirm-modal'], 'The confirm shown when switching the repo to Personal');
      await click('#btn-confirm-ok');
      await sleep(1200);
    }
    await escape();
    await click('#profile-segment');
    await visible('#profile-dropdown');
    await sleep(600);
    await shot('ssh-dropdown-personal', 'SSH Key dropdown with Personal selected on acme-api, showing the repo account note', { sel: '#profile-dropdown', pad: 16 });
    await dom('ssh-dropdown-personal', ['#profile-segment-wrapper'], 'SSH Key dropdown, Personal selected, account note');
    await escape();
    await chord('Control', 'Alt', 'u');
    await visible('#confirm-modal');
    await sleep(500);
    await shot('account-mismatch', 'The real Account mismatch dialog (Cancel / Push Anyway)');
    await dom('account-mismatch', ['#confirm-modal'], 'Account mismatch dialog');
    await click('#btn-confirm-cancel');
    await sleep(500);
    await selectAccount(REPOS.api, 'work');
  },
  // --- state-changing: scene-like actions for the Terminal panel records --
  async records() {
    const repo = REPOS.api;
    await selectAccount(repo, 'work');
    const diff = await api('GET', '/api/git/diff/structured', { repo, query: { path: 'src/auth.ts', source: 'working-tree' } });
    await data('auth-diff-structured', diff, 'Structured diff of src/auth.ts (working tree) before staging', 'GET /api/git/diff/structured');
    const keep = addedLineIds(diff, /import \{ expiresSoon \}|if \(expiresSoon\(|session\.refreshedAt =/);
    if (keep.length !== 3) throw new Error(`expected 3 lines to stage, found ${keep.length}`);
    await api('POST', '/api/git/diff/apply-selection', { repo, body: { action: 'stage', filePath: 'src/auth.ts', lineIds: keep, hunkIds: [] } });
    const diff2 = await api('GET', '/api/git/diff/structured', { repo, query: { path: 'src/auth.ts', source: 'working-tree' } });
    const logs = addedLineIds(diff2, /console\.log/);
    if (logs.length !== 2) throw new Error(`expected 2 console.log lines, found ${logs.length}`);
    await api('POST', '/api/git/diff/apply-selection', { repo, body: { action: 'discard', filePath: 'src/auth.ts', lineIds: logs, hunkIds: [] } });
    await api('POST', '/api/git/commit', { repo, body: { message: 'fix(auth): refresh the token before expiry' } });
    const before = git(repo, ['rev-parse', 'HEAD']);
    const target = git(repo, ['rev-parse', 'HEAD~3']);
    await api('POST', '/api/git/reset', { repo, body: { hash: target, mode: 'hard' } });
    const rec = await api('GET', '/api/git/recovery', { repo });
    await data('recovery-after-reset', rec, 'Recovery points and reflog right after the hard reset', 'GET /api/git/recovery');
    // The real Restore confirm for that point, from the GUI.
    await openRepo();
    await palette('Recovery points and reflog');
    await visible('#recovery-modal');
    await sleep(800);
    await shot('recovery-after-reset', 'Recovery points after git reset --hard HEAD~3');
    await dom('recovery-after-reset', ['#recovery-modal'], 'Recovery points window after the reset');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#recovery-points-list button')].find((x) => /Restore/i.test(x.textContent));
      b?.click();
    });
    await visible('#confirm-modal');
    await sleep(500);
    await shot('restore-confirm', 'The real Restore confirm for the reset');
    await dom('restore-confirm', ['#confirm-modal'], 'Restore confirm dialog');
    await click('#btn-confirm-cancel');
    await escape();
    const point = (rec.points ?? []).find((p) => p.operation === 'reset' || /reset/i.test(p.label)) ?? rec.points?.[0];
    await api('POST', '/api/git/recovery/restore', { repo, body: { pointId: point.id, ref: point.headRef ?? 'refs/heads/main' } });
    console.log('restored to', git(repo, ['rev-parse', 'HEAD']) === before ? 'the pre-reset HEAD' : 'somewhere else');
    await api('POST', '/api/worktrees', { repo, body: { targetPath: path.join(path.dirname(repo), 'acme-api.worktrees', 'hotfix'), branchMode: 'new', branch: 'fix/rate-limit' } });
    const backlog = await readBacklog();
    await data('terminal-backlog', backlog, 'The Terminal panel backlog (all LogEntry records) after the scene-like actions', 'GET /api/logs/stream, first "backlog" event');
    const writes = backlog.filter((e) => e.command?.kind === 'write');
    await data('terminal-writes', writes, 'Only kind "write" commands: what the panel shows with Reads off (scene F)', 'filtered from terminal-backlog');
    console.log('write commands', writes.length, 'of', backlog.length);
    await openRepo();
    await click('#btn-terminal-toggle');
    await visible('#terminal-panel', 5000).catch(() => {});
    await page.evaluate(() => { const r = document.querySelector('#terminal-show-reads'); if (r && r.checked) r.click(); });
    await sleep(800);
    await shot('terminal-panel', 'The Terminal panel with Reads off, after the scene-like actions');
    await dom('terminal-panel', ['#terminal-panel'], 'Terminal panel with Reads off');
  },
  async split() {
    await openRepo();
    await palette('Interactive rebase (plan commit by commit)');
    await visible('#rebase-modal');
    await page.evaluate((hash) => {
      const onto = document.querySelector('#rebase-onto');
      if (onto && 'value' in onto) { onto.value = hash; onto.dispatchEvent(new Event('input', { bubbles: true })); onto.dispatchEvent(new Event('change', { bubbles: true })); }
    }, git(REPOS.api, ['rev-parse', 'HEAD~3']));
    await click('#btn-rebase-reload').catch(() => {});
    await sleep(1200);
    await page.evaluate(() => {
      const sel = document.querySelector('#rebase-plan-list select');
      if (sel) { sel.value = 'edit'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(300);
    await click('#btn-rebase-start');
    await sleep(1800);
    if (await page.$eval('#confirm-modal', (e) => !e.classList.contains('hidden')).catch(() => false)) { await click('#btn-confirm-ok'); await sleep(1800); }
    await shot('rebase-edit-stop', 'The rebase stopped at an edit row, with Split this commit');
    await dom('rebase-edit-stop', ['#rebase-modal'], 'Rebase modal at the edit stop');
    await click('#btn-rebase-split');
    await visible('#confirm-modal');
    await sleep(500);
    await shot('split-confirm', 'The real Split commit confirm');
    await dom('split-confirm', ['#confirm-modal'], 'Split commit confirm');
    await click('#btn-confirm-cancel');
    await sleep(300);
    await click('#btn-rebase-abort').catch(() => {});
    await sleep(800);
    if (await page.$eval('#confirm-modal', (e) => !e.classList.contains('hidden')).catch(() => false)) await click('#btn-confirm-ok');
    await sleep(800);
  },
};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.MG_CHROME || undefined,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none'],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});
page = await browser.newPage();
await interceptFonts(page);
page.on('pageerror', (e) => console.log('pageerror:', String(e.message).slice(0, 160)));
const results = {};
for (const [name, fn] of Object.entries(steps)) {
  if (only.length && !only.includes(name)) continue;
  try {
    await fn();
    results[name] = 'ok';
  } catch (err) {
    results[name] = `FAILED: ${String(err.message).split('\n')[0].slice(0, 160)}`;
    await escape(3).catch(() => {});
  }
  console.log(name.padEnd(16), results[name]);
}
await browser.close();
manifest.files.sort((a, b) => a.file.localeCompare(b.file));
writeJson(manifestFile, manifest);
