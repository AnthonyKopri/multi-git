// Prepares disposable repositories and optionally starts a separate desktop instance.
// Run from a shell, never by typing commands into the UI under test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== '--launch')) throw new Error('Usage: node scripts/gui-smoke.mjs [--launch]');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-gui-'));
const home = path.join(fixtureRoot, 'home');
const seed = path.join(fixtureRoot, 'source repo');
const working = path.join(fixtureRoot, '工作 tree');
const destination = path.join(fixtureRoot, 'clone destination');
for (const folder of [home, seed, destination, ...['.ssh', 'gh', 'Desktop', 'Documents', 'Downloads'].map((name) => path.join(home, name))]) fs.mkdirSync(folder, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home, GH_CONFIG_DIR: path.join(home, 'gh'),
  GH_TOKEN: '', GITHUB_TOKEN: '', GH_ENTERPRISE_TOKEN: '', GITHUB_ENTERPRISE_TOKEN: '',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), SSH_AUTH_SOCK: '',
  GIT_TERMINAL_PROMPT: '0' };
delete env.ELECTRON_RUN_AS_NODE;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
git(seed, 'init', '-b', 'main');
git(seed, 'config', 'user.name', 'GUI Smoke');
git(seed, 'config', 'user.email', 'gui-smoke@example.invalid');
git(seed, 'config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(seed, 'README.md'), '# GUI smoke fixture\n\nOriginal line.\n');
git(seed, 'add', '--', 'README.md');
git(seed, 'commit', '-m', 'test: seed GUI fixture');
git(fixtureRoot, 'clone', '--', seed, working);
git(working, 'config', 'user.name', 'GUI Smoke');
git(working, 'config', 'user.email', 'gui-smoke@example.invalid');
git(working, 'config', 'commit.gpgsign', 'false');
fs.appendFileSync(path.join(working, 'README.md'), '\nChanged line for visual staging.\n');
fs.writeFileSync(path.join(working, 'new file.txt'), 'Untracked smoke fixture.\n');
fs.writeFileSync(path.join(home, '.multi-git-client-config.json'), JSON.stringify({
  recentRepos: [], sshProfiles: [], accountRules: [], repoSettings: {},
  settings: { manageSshConfig: false, checkForUpdates: false, restoreWindowsOnStartup: false, autoPull: false }
}, null, 2));
const manifest = { fixtureRoot, home, seed, working, destination, createdAt: new Date().toISOString(),
  note: 'GitHub credentials and Multi-Git profiles are isolated. Use local fixture URLs only; do not test SSH agent operations. GitHub browsing failure is expected. Never push to the non-bare seed repository.' };
if (flags.includes('--launch')) {
  const executable = process.platform === 'win32' ? path.join(root, 'node_modules/electron/dist/electron.exe')
    : process.platform === 'darwin' ? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(root, 'node_modules/electron/dist/electron');
  if (!fs.existsSync(path.join(root, 'out/node/main/main.js'))) throw new Error('Run npm run compile before --launch.');
  if (!fs.existsSync(executable)) throw new Error('Run node scripts/ensure-electron.mjs before --launch.');
  const log = fs.openSync(path.join(fixtureRoot, 'desktop.log'), 'a');
  const child = spawn(executable, [root, `--user-data-dir=${path.join(home, 'chromium')}`], {
    // This is the interactive app under test, so its native window must be visible.
    cwd: root, env, detached: true, windowsHide: false, stdio: ['ignore', log, log]
  });
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.unref();
  fs.closeSync(log);
  manifest.pid = child.pid;
}
fs.writeFileSync(path.join(fixtureRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
