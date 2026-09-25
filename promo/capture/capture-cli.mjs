// Captures the terminal edition against the running browser-mode backend
// (MULTI_GIT_URL): the JSON CLI, the TUI in tmux (120x34) as ANSI spans, and an
// MCP transcript (initialize, tools/list, one tools/call).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { ROOT, BASE, REPOS, CAPTURES, isolatedEnv, sleep, writeJson } from './lib.mjs';
import { ansiToSpans } from './ansi-to-spans.mjs';

const DATA = path.join(CAPTURES, 'data');
const manifestFile = path.join(CAPTURES, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { files: [] };
const record = (file, shows, how) => {
  manifest.files = manifest.files.filter((f) => f.file !== file);
  manifest.files.push({ file, shows, how, capturedAt: new Date().toISOString() });
};
const CLI = path.join(ROOT, 'scripts', 'multi-git.cjs');
const env = isolatedEnv({ MULTI_GIT_URL: BASE, TERM: 'xterm-256color' });
const repo = REPOS.api;

// ---- JSON CLI -------------------------------------------------------------
function cli(name, args, input) {
  const shown = ['multi-git', ...args.map((a) => (a === repo ? '~/code/acme-api' : a))];
  let out;
  try {
    out = execFileSync(process.execPath, [CLI, ...args], { env, input: input ? JSON.stringify(input) : undefined, encoding: 'utf8', cwd: repo });
  } catch (err) {
    out = String(err.stdout ?? '');
  }
  let json;
  try { json = JSON.parse(out); } catch { json = { raw: out.slice(0, 4000) }; }
  writeJson(path.join(DATA, `cli-${name}.json`), { command: shown.join(' '), input: input ?? null, output: json });
  record(`data/cli-${name}.json`, `JSON CLI: ${shown.join(' ')}`, 'node scripts/multi-git.cjs with MULTI_GIT_URL');
  console.log(`cli ${name}: ${out.length} bytes`);
}
cli('status', ['status', '--repo', repo]);
cli('history', ['history', '--repo', repo, '--input', '-'], { limit: 8 });
cli('ssh-inspect', ['ssh.inspect', '--repo', repo]);
cli('ssh-select-dry-run', ['ssh.select', '--repo', repo, '--dry-run', '--input', '-'], { profileId: 'personal' });

// ---- TUI in tmux ------------------------------------------------------------
const tmux = (...args) => execFileSync('tmux', ['-L', 'mgpromo', ...args], { env, encoding: 'utf8' });
try { tmux('kill-server'); } catch { /* none running */ }
tmux('new-session', '-d', '-s', 'tui', '-x', '120', '-y', '34', `${process.execPath} ${CLI} tui --repo ${repo}`);
const states = [];
const grab = async (name, keys, wait = 900) => {
  if (keys) tmux('send-keys', '-t', 'tui', ...keys);
  await sleep(wait);
  const ansi = tmux('capture-pane', '-p', '-e', '-t', 'tui');
  states.push({ name, keys: keys ?? [], lines: ansiToSpans(ansi) });
  console.log(`tui ${name}: ${ansi.split('\n').length} lines`);
};
await grab('normal', null, 3500);
await grab('space-menu', ['Space']);
await grab('menu-closed', ['Escape']);
await grab('after-j', ['j']);
await grab('after-k', ['k']);
await grab('after-v', ['v']);
try { tmux('kill-server'); } catch { /* gone */ }
writeJson(path.join(DATA, 'tui.json'), { size: { cols: 120, rows: 34 }, command: 'multi-git tui --repo ~/code/acme-api', states });
record('data/tui.json', 'multi-git tui at 120x34: NORMAL, Space menu, j, k, v (ANSI converted to spans)', 'tmux -L mgpromo capture-pane -p -e, then capture/ansi-to-spans.mjs');

// ---- MCP transcript ---------------------------------------------------------
const transcript = [];
const child = spawn(process.execPath, [CLI, 'mcp'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const waiting = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    transcript.push({ from: 'server', message: msg });
    waiting.get(msg.id)?.(msg);
  }
});
const send = (msg) => {
  transcript.push({ from: 'client', message: msg });
  child.stdin.write(JSON.stringify(msg) + '\n');
  if (msg.id === undefined) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    waiting.set(msg.id, resolve);
    setTimeout(() => reject(new Error(`MCP timeout on ${msg.method}`)), 15000);
  });
};
try {
  await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'promo-capture', version: '1.0.0' } } });
  await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const list = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = list?.result?.tools ?? [];
  const status = tools.find((t) => t.name === 'status') ?? tools.find((t) => /status/.test(t.name));
  const props = Object.keys(status?.inputSchema?.properties ?? {});
  const repoKey = props.find((k) => /repo/i.test(k)) ?? 'repo';
  await send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: status?.name ?? 'status', arguments: { [repoKey]: repo } } });
  console.log(`mcp: ${tools.length} tools, called ${status?.name}`);
} catch (err) {
  console.log('mcp failed:', err.message);
}
child.kill();
writeJson(path.join(DATA, 'mcp-transcript.json'), transcript);
record('data/mcp-transcript.json', 'MCP over stdio: initialize, notifications/initialized, tools/list, tools/call status', 'node scripts/multi-git.cjs mcp (read-only), JSON-RPC lines');

manifest.files.sort((a, b) => a.file.localeCompare(b.file));
writeJson(manifestFile, manifest);
