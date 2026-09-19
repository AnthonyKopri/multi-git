// Installing the terminal edition for the current user.
//
// The desktop app carries the terminal edition inside it. Enabling it copies
// that payload to a per-user folder of its own and puts a stable `multi-git`
// command on PATH, so it keeps working when the desktop app moves, updates, or
// is uninstalled. `multi-git update` uses the same activation for a download.
//
// Layout, under terminalHome():
//
//   versions/<version>/   one immutable payload per version
//   current.txt           the version the launchers run; replaced atomically
//   previous.txt          the one before, kept for rollback
//   multi-git, .cmd       the launchers (scripts/terminal-package.cjs)
//   installation.json     what this installer changed, so removal undoes
//                         exactly that and nothing else
//
// Nothing outside that folder is touched except the three things the user is
// shown first: the user PATH on Windows; a launcher in ~/.local/bin and a
// marked block in the shell's startup files elsewhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { fromAppRoot } from '../app-root';
import { compareVersions, parseVersion } from '../../main/update/release-feed';
import type { TerminalInstallationStatus } from '../../shared/terminal-types';
import { payloadInUse } from './sessions';

const PRODUCT = 'multi-git-terminal';
const OWNERSHIP = 'installation.json';
const BLOCK_START = '# >>> multi-git terminal >>>';
const BLOCK_END = '# <<< multi-git terminal <<<';

interface Manifest {
  schemaVersion: number;
  product: string;
  version: string;
  platform: string;
  arch: string;
}

interface Ownership {
  product: typeof PRODUCT;
  /** The folder this installer added to the Windows user PATH, if it did. */
  pathEntry?: string;
  /** The ~/.local/bin launcher it wrote, and exactly what it wrote. */
  launcher?: { file: string; body: string };
  /** Startup files it added its block to. */
  profiles: string[];
}

/** Everything that reaches outside the installation folder, replaceable in tests. */
export interface InstallEnvironment {
  /** An extracted standalone archive updates in place without changing PATH. */
  portable?: boolean;
  platform: NodeJS.Platform;
  arch: string;
  home: string;
  root: string;
  /** Directories a newly opened terminal searches, in order. */
  searchPath: () => string[];
  /** The Windows user PATH, as stored, with its registry type. */
  readUserPath: () => { value: string; type: string };
  writeUserPath: (value: string, type: string) => void;
  /** Runs the staged copy once; resolves to what `--version` printed. */
  runVersion: (payload: string) => string;
  shell: string;
}

export function terminalHome(platform = process.platform, home = os.homedir()): string {
  const override = process.env['MULTI_GIT_TERMINAL_HOME'];
  if (override) {
    return override;
  }
  if (platform === 'win32') {
    return path.join(process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local'), 'Multi-Git', 'Terminal');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Multi-Git', 'Terminal');
  }
  return path.join(process.env['XDG_DATA_HOME'] || path.join(home, '.local', 'share'), 'multi-git', 'terminal');
}

function readRegistryPath(key: string): { value: string; type: string } {
  try {
    const output = execFileSync('reg.exe', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
    const match = /^\s+Path\s+(REG_\w+)\s+(.*)$/im.exec(output);
    return { type: match?.[1] ?? 'REG_EXPAND_SZ', value: match?.[2]?.trim() ?? '' };
  } catch {
    return { type: 'REG_EXPAND_SZ', value: '' };
  }
}

const expand = (value: string): string =>
  value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);

/** The real machine. */
export function defaultEnvironment(): InstallEnvironment {
  const platform = process.platform;
  return {
    platform,
    arch: process.arch,
    home: os.homedir(),
    root: terminalHome(),
    shell: process.env['SHELL'] ?? '',
    searchPath: () => {
      if (platform !== 'win32') {
        return (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
      }
      // What a terminal opened now gets, not what this process started with:
      // the machine PATH, then the user's, both read from where Windows keeps
      // them.
      const machine = readRegistryPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
      const user = readRegistryPath('HKCU\\Environment');
      return `${expand(machine.value)};${expand(user.value)}`.split(';').filter(Boolean);
    },
    readUserPath: () => readRegistryPath('HKCU\\Environment'),
    writeUserPath: (value, type) => {
      execFileSync('reg.exe', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', type, '/d', value, '/f'], {
        windowsHide: true
      });
      // reg.exe does not tell running programs the environment changed, so a
      // terminal started from Explorer would not see the new PATH until the
      // next sign-in. Clearing a variable through .NET broadcasts the change.
      // Best effort: where PowerShell is locked down, reopening still works.
      try {
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::SetEnvironmentVariable('MULTI_GIT_PATH_REFRESH', $null, 'User')"],
          { windowsHide: true, timeout: 15_000 }
        );
      } catch {
        // Reopening the terminal is the fallback the status already describes.
      }
    },
    runVersion: (payload) =>
      execFileSync(
        path.join(payload, 'runtime', platform === 'win32' ? 'node.exe' : 'node'),
        [path.join(payload, 'scripts', 'multi-git.cjs'), '--version'],
        { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } }
      ).trim()
  };
}

// ---------------------------------------------------------------------------
// Reading.

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** The payload inside this desktop build, or null in a development run without one. */
export function bundledPayload(): string | null {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    ...(resources ? [path.join(resources, 'terminal')] : []),
    // `npm run build:terminal` or a beforePack in this checkout.
    fromAppRoot('.terminal-bundle', process.arch)
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'terminal-manifest.json'))) ?? null;
}

/** Checks a payload is ours, and for this machine. Throws with the reason when it is not. */
export function payloadManifest(source: string, env: Pick<InstallEnvironment, 'platform' | 'arch'>): Manifest {
  const manifest = readJson<Manifest>(path.join(source, 'terminal-manifest.json'));
  const archOk = manifest?.arch === env.arch || (env.platform === 'darwin' && manifest?.arch === 'universal');
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.product !== PRODUCT ||
    !parseVersion(manifest.version) ||
    manifest.platform !== env.platform ||
    !archOk
  ) {
    throw new Error('That terminal package is not a Multi-Git terminal edition for this system.');
  }
  return manifest;
}

function installedVersion(root: string): string | null {
  try {
    const version = fs.readFileSync(path.join(root, 'current.txt'), 'utf8').trim();
    return parseVersion(version) ? version : null;
  } catch {
    return null;
  }
}

function ownership(root: string): Ownership | null {
  const value = readJson<Ownership>(path.join(root, OWNERSHIP));
  return value?.product === PRODUCT ? value : null;
}

function launcherFor(env: InstallEnvironment): string {
  if (env.portable) return path.join(env.root, env.platform === 'win32' ? 'multi-git.cmd' : 'multi-git');
  return env.platform === 'win32' ? path.join(env.root, 'multi-git.cmd') : path.join(env.home, '.local', 'bin', 'multi-git');
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return platform === 'win32' || platform === 'darwin' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * The directories a newly opened terminal searches. On macOS and Linux that is
 * this process's PATH, plus ~/.local/bin once our line is in a startup file:
 * a desktop app does not see what the shell's startup files add, and on macOS
 * a GUI app's PATH never has it.
 */
function newTerminalPath(env: InstallEnvironment): string[] {
  const directories = env.searchPath();
  if (env.platform === 'win32') {
    return directories;
  }
  const bin = binDirectory(env);
  const added = (ownership(env.root)?.profiles ?? []).some((file) => {
    try {
      return fs.readFileSync(file, 'utf8').includes(BLOCK_START);
    } catch {
      return false;
    }
  });
  return added && !directories.some((entry) => samePath(entry, bin, env.platform)) ? [...directories, bin] : directories;
}

/** The first `multi-git` a terminal would run, searching the way the shell does. */
function resolveCommand(env: InstallEnvironment): string | null {
  const names =
    env.platform === 'win32'
      ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => `multi-git${ext.toLowerCase()}`)
      : ['multi-git'];
  for (const directory of newTerminalPath(env)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // Not here.
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shell startup files (macOS and Linux).

function binDirectory(env: InstallEnvironment): string {
  return path.join(env.home, '.local', 'bin');
}

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

function profileBlock(file: string, env: InstallEnvironment): string {
  const bin = binDirectory(env);
  if (file.endsWith('.fish')) {
    return `${BLOCK_START}\nfish_add_path --append ${quote(bin)}\n${BLOCK_END}\n`;
  }
  return `${BLOCK_START}\ncase ":$PATH:" in *:${quote(bin)}:*) ;; *) export PATH="$PATH:"${quote(bin)} ;; esac\n${BLOCK_END}\n`;
}

/**
 * The startup files to add the PATH block to. Only for shells the user has:
 * the login shell, plus any other whose startup file already exists. None at
 * all when ~/.local/bin is already on PATH, which most Linux systems arrange.
 */
function profilesToEdit(env: InstallEnvironment): string[] {
  if (env.searchPath().some((entry) => samePath(entry, binDirectory(env), env.platform))) {
    return [];
  }
  const shell = path.basename(env.shell);
  const home = env.home;
  const files: string[] = [];
  const has = (file: string): boolean => fs.existsSync(file);

  if (shell === 'zsh' || has(path.join(home, '.zshrc'))) {
    files.push(path.join(home, '.zshrc'));
  }
  if (shell === 'bash' || has(path.join(home, '.bashrc'))) {
    files.push(path.join(home, '.bashrc'));
    // macOS starts bash as a login shell, which reads this and not .bashrc.
    if (env.platform === 'darwin' || has(path.join(home, '.bash_profile'))) {
      files.push(path.join(home, '.bash_profile'));
    }
  }
  const fishConfig = path.join(home, '.config', 'fish');
  if (shell === 'fish' || has(fishConfig)) {
    files.push(path.join(fishConfig, 'conf.d', 'multi-git.fish'));
  }
  return files;
}

/** Adds or refreshes our block. Idempotent, and never touches anything else in the file. */
function writeProfileBlock(file: string, block: string): void {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const start = current.indexOf(BLOCK_START);
  const end = current.indexOf(BLOCK_END);
  let next: string;
  if (start !== -1 && end > start) {
    next = current.slice(0, start) + block + current.slice(end + BLOCK_END.length).replace(/^\n/, '');
  } else {
    next = `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}\n${block}`;
  }
  if (next !== current) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next);
  }
}

function removeProfileBlock(file: string): void {
  if (!fs.existsSync(file)) {
    return;
  }
  const current = fs.readFileSync(file, 'utf8');
  const start = current.indexOf(BLOCK_START);
  const end = current.indexOf(BLOCK_END);
  if (start === -1 || end < start) {
    return;
  }
  const before = current.slice(0, start).replace(/\n\n$/, '\n');
  const next = before + current.slice(end + BLOCK_END.length).replace(/^\n/, '');
  if (next.trim() === '' && file.endsWith('multi-git.fish')) {
    fs.rmSync(file, { force: true });
  } else {
    fs.writeFileSync(file, next);
  }
}

// ---------------------------------------------------------------------------
// Status.

function setupChoiceFile(home: string): string {
  return path.join(home, '.multi-git', 'terminal-setup.json');
}

export function rememberSetupChoice(choice: 'enabled' | 'skipped', env = defaultEnvironment()): void {
  const file = setupChoiceFile(env.home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ choice, at: new Date().toISOString() }), { mode: 0o600 });
}

function plannedChanges(env: InstallEnvironment, bundled: string | null): string[] {
  const changes = [`Copy the terminal edition${bundled ? ` ${bundled}` : ''} to ${env.root}`];
  if (env.platform === 'win32') {
    const onPath = env.readUserPath().value.split(';').some((entry) => samePath(expand(entry), env.root, env.platform));
    if (!onPath) {
      changes.push(`Add ${env.root} to your user PATH`);
    }
  } else {
    changes.push(`Write the multi-git command to ${launcherFor(env)}`);
    for (const file of profilesToEdit(env)) {
      changes.push(`Add a marked PATH line for ${binDirectory(env)} to ${file}`);
    }
  }
  return changes;
}

function mcpConfig(env: InstallEnvironment): string {
  // The stable launcher, so the entry survives updates. On Windows through
  // cmd.exe: MCP clients start servers without a shell, and a .cmd file
  // cannot be started that way.
  const server =
    env.platform === 'win32'
      ? { command: 'cmd.exe', args: ['/d', '/c', launcherFor(env), 'mcp'] }
      : { command: launcherFor(env), args: ['mcp'] };
  return JSON.stringify({ mcpServers: { 'multi-git': server } }, null, 2);
}

export function terminalStatus(env = defaultEnvironment()): TerminalInstallationStatus {
  const bundledPath = bundledPayload();
  let bundled: string | null = null;
  if (bundledPath) {
    try {
      bundled = payloadManifest(bundledPath, env).version;
    } catch {
      bundled = null;
    }
  }

  const installed = installedVersion(env.root);
  const command = launcherFor(env);
  const resolved = resolveCommand(env);
  const choice = readJson<{ choice?: string }>(setupChoiceFile(env.home))?.choice;
  const setupChoice: TerminalInstallationStatus['setupChoice'] =
    choice === 'enabled' || choice === 'skipped' ? choice : null;
  const canUpgrade =
    bundled !== null && (installed === null || compareVersions(parseVersion(bundled)!, parseVersion(installed)!) > 0);

  const base = {
    bundledVersion: bundled,
    installedVersion: installed,
    canUpgrade,
    location: env.root,
    command,
    resolvedCommand: resolved,
    plannedChanges: plannedChanges(env, bundled),
    setupChoice,
    mcpConfig: installed ? mcpConfig(env) : null,
    skillsPath: installed ? path.join(env.root, 'versions', installed, 'skills') : null
  };

  if (!installed) {
    return bundled
      ? { ...base, state: 'not-installed', message: 'Not enabled. Enabling adds the multi-git command for your user account.' }
      : { ...base, state: 'unavailable', message: 'This build of the desktop app does not include the terminal edition.' };
  }

  const payload = path.join(env.root, 'versions', installed);
  const healthy =
    ownership(env.root) !== null &&
    fs.existsSync(path.join(payload, 'runtime', env.platform === 'win32' ? 'node.exe' : 'node')) &&
    fs.existsSync(path.join(payload, 'scripts', 'multi-git.cjs')) &&
    fs.existsSync(command) &&
    fs.existsSync(path.join(env.root, env.platform === 'win32' ? 'multi-git.cmd' : 'multi-git'));

  if (!healthy) {
    return { ...base, state: 'damaged', message: 'The installation is incomplete. Repair reinstalls it without touching your settings.' };
  }
  if (resolved === null) {
    return {
      ...base,
      state: 'reopen-terminal',
      message: 'Installed. Terminals that were already open do not see it yet: open a new one.'
    };
  }
  if (!samePath(resolved, command, env.platform)) {
    return {
      ...base,
      state: 'shadowed',
      message: `Installed, but ${resolved} comes first on your PATH, so "multi-git" runs that instead. Remove or rename it, or move it later in PATH.`
    };
  }
  // The command is ours, but only reachable once a new terminal sources the
  // profile line we wrote.  Check whether the launcher's directory is on the
  // process's *current* search path — if not, a new terminal is needed.
  if (env.platform !== 'win32') {
    const bin = path.dirname(command);
    if (!env.searchPath().some((entry) => samePath(entry, bin, env.platform))) {
      return {
        ...base,
        state: 'reopen-terminal',
        message: 'Installed. Terminals that were already open do not see it yet: open a new one.'
      };
    }
  }
  return {
    ...base,
    state: 'ready',
    message: 'Ready in any terminal opened from now on: type multi-git, or multi-git tui for the guided interface.'
  };
}

// ---------------------------------------------------------------------------
// Changing.

function withInstallLock<T>(root: string, work: () => T): T {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, '.install-lock');
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  } catch {
    const holder = Number.parseInt(fs.readFileSync(lock, 'utf8'), 10);
    let alive = false;
    try {
      process.kill(holder, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) {
      throw new Error('Another installation or update of the terminal edition is running. Try again when it finishes.');
    }
    // Left by one that crashed.
    fs.writeFileSync(lock, String(process.pid), { mode: 0o600 });
  }
  try {
    return work();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** Removes versions other than the current and previous, where nothing is still using them. */
function pruneVersions(root: string, keep: string[]): void {
  const versions = path.join(root, 'versions');
  if (!fs.existsSync(versions)) {
    return;
  }
  for (const name of fs.readdirSync(versions)) {
    const manifest = readJson<Manifest>(path.join(versions, name, 'terminal-manifest.json'));
    if (manifest?.product !== PRODUCT || manifest.version !== name) continue;
    if (keep.includes(name) || !parseVersion(name) || payloadInUse(root, name)) {
      continue;
    }
    try {
      fs.rmSync(path.join(versions, name), { recursive: true });
    } catch {
      // A running session still has it open; the next activation tries again.
    }
  }
}

/**
 * Installs, repairs or upgrades from a payload folder, and returns the new
 * status. A newer installed version is never replaced by an older one.
 *
 * The payload is copied to a staging folder beside its final place, run once
 * to prove it starts, and only then renamed into place and pointed at, so a
 * failure at any step leaves the working installation as it was.
 */
export function activatePayload(source: string, env = defaultEnvironment()): TerminalInstallationStatus {
  const manifest = payloadManifest(source, env);
  const root = env.root;

  const existing = installedVersion(root);
  if (existing && compareVersions(parseVersion(existing)!, parseVersion(manifest.version)!) > 0) {
    throw new Error(`Terminal edition ${existing} is installed, which is newer than ${manifest.version}. It was left as it is.`);
  }
  if (fs.existsSync(root) && fs.readdirSync(root).length > 0 && !ownership(root)) {
    throw new Error(`${root} has files Multi-Git did not put there, so nothing was changed. Move them, then try again.`);
  }

  return withInstallLock(root, () => {
    const owned: Ownership = ownership(root) ?? { product: PRODUCT, profiles: [] };
    fs.writeFileSync(path.join(root, OWNERSHIP), JSON.stringify(owned, null, 2), { mode: 0o600 });

    const destination = path.join(root, 'versions', manifest.version);
    let reusable =
      fs.existsSync(path.join(destination, 'terminal-manifest.json')) &&
      readJson<Manifest>(path.join(destination, 'terminal-manifest.json'))?.version === manifest.version &&
      fs.existsSync(path.join(destination, 'runtime', env.platform === 'win32' ? 'node.exe' : 'node')) &&
      fs.existsSync(path.join(destination, 'scripts', 'multi-git.cjs'));
    if (reusable) {
      try { reusable = env.runVersion(destination) === manifest.version; }
      catch { reusable = false; }
    }

    if (!reusable) {
      if (payloadInUse(root, manifest.version)) throw new Error('Close sessions using this version before repairing its files.');
      const staging = path.join(root, 'versions', `.staging-${manifest.version}-${process.pid}`);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(staging), { recursive: true });
      try {
        fs.cpSync(source, staging, { recursive: true, dereference: true, errorOnExist: true });
        if (env.platform === 'darwin' && process.platform === 'darwin') {
          // Copying keeps the quarantine flag of a downloaded app, and outside
          // the app bundle macOS would refuse to run the Node it marks.
          try {
            execFileSync('xattr', ['-dr', 'com.apple.quarantine', staging], { timeout: 30_000 });
          } catch {
            // Nothing was quarantined, or xattr is missing; the smoke run says.
          }
        }
        payloadManifest(staging, env);
        const reported = env.runVersion(staging);
        if (reported !== manifest.version) {
          throw new Error(`The copied terminal edition reports version "${reported}", not ${manifest.version}.`);
        }
        // A damaged copy of this version from an earlier attempt.
        fs.rmSync(destination, { recursive: true, force: true });
        fs.renameSync(staging, destination);
      } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
      }
    }

    // Snapshot precisely the small files activation changes. If PATH or a
    // profile is unwritable, restore the working pointers and shell setup.
    const files = [...new Set([
      ...['multi-git', 'multi-git.cmd', 'current.txt', 'previous.txt', OWNERSHIP].map((name) => path.join(root, name)),
      ...(!env.portable && env.platform !== 'win32' ? [launcherFor(env), ...profilesToEdit(env)] : []),
      ...(!env.portable ? [setupChoiceFile(env.home)] : [])
    ])];
    const snapshots = files.map((file) => ({ file, body: fs.existsSync(file) ? fs.readFileSync(file) : null,
      mode: fs.existsSync(file) ? fs.statSync(file).mode : 0o600 }));
    const priorPath = !env.portable && env.platform === 'win32' ? env.readUserPath() : null;
    try {
    // The launchers read current.txt, so they are the same for every version.
    const scripts = require(fromAppRoot('scripts', 'terminal-package.cjs')) as {
      launcherFiles(): Record<string, string>;
    };
    for (const [name, body] of Object.entries(scripts.launcherFiles())) {
      fs.writeFileSync(path.join(root, name), body, { mode: 0o755 });
    }

    if (env.portable) {
      // Standalone archives retain their location and never edit shell setup.
    } else if (env.platform === 'win32') {
      const current = env.readUserPath();
      const entries = current.value.split(';').filter(Boolean);
      if (!entries.some((entry) => samePath(expand(entry), root, env.platform))) {
        env.writeUserPath([...entries, root].join(';'), current.type);
        owned.pathEntry = root;
      }
    } else {
      const launcher = launcherFor(env);
      const body = `#!/bin/sh\n# Written by Multi-Git; removed when the terminal edition is.\nexec ${quote(path.join(root, 'multi-git'))} "$@"\n`;
      if (fs.existsSync(launcher)) {
        const found = fs.readFileSync(launcher, 'utf8');
        if (found !== body && found !== owned.launcher?.body) {
          throw new Error(`${launcher} already exists and is not Multi-Git's. It was left as it is; move it, then try again.`);
        }
      }
      fs.mkdirSync(path.dirname(launcher), { recursive: true });
      fs.writeFileSync(launcher, body, { mode: 0o755 });
      owned.launcher = { file: launcher, body };

      for (const file of profilesToEdit(env)) {
        writeProfileBlock(file, profileBlock(file, env));
        if (!owned.profiles.includes(file)) {
          owned.profiles.push(file);
        }
      }
    }
    fs.writeFileSync(path.join(root, OWNERSHIP), JSON.stringify(owned, null, 2), { mode: 0o600 });

    // The switch itself: one rename.
    if (existing && existing !== manifest.version) {
      fs.writeFileSync(path.join(root, 'previous.txt'), `${existing}\n`);
    }
    fs.writeFileSync(path.join(root, 'current.txt.new'), `${manifest.version}\n`);
    fs.renameSync(path.join(root, 'current.txt.new'), path.join(root, 'current.txt'));

    if (!env.portable) rememberSetupChoice('enabled', env);
    } catch (error) {
      const failures: string[] = [];
      for (const snapshot of snapshots.reverse()) {
        try {
          if (snapshot.body === null) fs.rmSync(snapshot.file, { force: true });
          else fs.writeFileSync(snapshot.file, snapshot.body, { mode: snapshot.mode });
        } catch { failures.push(snapshot.file); }
      }
      if (priorPath) {
        try {
          const currentPath = env.readUserPath();
          if (currentPath.value !== priorPath.value) env.writeUserPath(priorPath.value, priorPath.type);
        } catch { failures.push('Windows user PATH'); }
      }
      if (failures.length) throw new Error(`${String(error)} Rollback could not restore: ${failures.join(', ')}. Use Repair before continuing.`);
      throw error;
    }
    pruneVersions(root, [manifest.version, ...(existing ? [existing] : [])]);
    return terminalStatus(env);
  });
}

/** Enables, repairs or upgrades from the payload this desktop build carries. */
export function installBundledTerminal(env = defaultEnvironment()): TerminalInstallationStatus {
  const source = bundledPayload();
  if (!source) {
    throw new Error('This build of the desktop app does not include the terminal edition.');
  }
  return activatePayload(source, env);
}

/** Switch back to the retained payload, after proving it still starts. */
export function rollbackTerminal(env = defaultEnvironment()): TerminalInstallationStatus {
  if (!ownership(env.root)) throw new Error('This copy is not an owned terminal installation.');
  return withInstallLock(env.root, () => {
    const current = installedVersion(env.root);
    const previousFile = path.join(env.root, 'previous.txt');
    const previous = fs.existsSync(previousFile) ? fs.readFileSync(previousFile, 'utf8').trim() : '';
    if (!current || !parseVersion(previous) || previous === current) throw new Error('There is no previous terminal version to restore.');
    const payload = path.join(env.root, 'versions', previous);
    if (payloadManifest(payload, env).version !== previous || env.runVersion(payload) !== previous) throw new Error('The previous terminal version did not pass its startup check.');
    fs.writeFileSync(path.join(env.root, 'current.txt.new'), `${previous}\n`);
    fs.renameSync(path.join(env.root, 'current.txt.new'), path.join(env.root, 'current.txt'));
    fs.writeFileSync(previousFile, `${current}\n`);
    return terminalStatus(env);
  });
}

/**
 * Undoes what enabling did: the PATH entry, the launcher and the startup-file
 * blocks, each only if it is still ours, and the installed versions. Settings,
 * the vault and repositories are not part of the installation and stay.
 */
export function removeTerminal(env = defaultEnvironment()): TerminalInstallationStatus {
  const root = env.root;
  const owned = ownership(root);
  if (!owned) {
    throw new Error('There is no terminal edition installed by Multi-Git to remove.');
  }

  withInstallLock(root, () => {
    if (env.platform === 'win32' && owned.pathEntry) {
      const current = env.readUserPath();
      const kept = current.value.split(';').filter((entry) => entry && !samePath(expand(entry), owned.pathEntry!, env.platform));
      env.writeUserPath(kept.join(';'), current.type);
    }
    if (owned.launcher && fs.existsSync(owned.launcher.file) && fs.readFileSync(owned.launcher.file, 'utf8') === owned.launcher.body) {
      fs.rmSync(owned.launcher.file, { force: true });
    }
    for (const file of owned.profiles) {
      removeProfileBlock(file);
    }
    for (const name of ['multi-git', 'multi-git.cmd', 'current.txt', 'previous.txt']) {
      fs.rmSync(path.join(root, name), { force: true });
    }
    pruneVersions(root, []);

    // Kept only while a running session still holds files, so the folder is
    // still recognised as ours next time.
    const left = fs.existsSync(path.join(root, 'versions')) ? fs.readdirSync(path.join(root, 'versions')) : [];
    fs.writeFileSync(path.join(root, OWNERSHIP), JSON.stringify({ product: PRODUCT, profiles: [] } satisfies Ownership, null, 2));
    if (left.length === 0) {
      fs.rmSync(path.join(root, 'versions'), { recursive: true, force: true });
    }
  });

  if (fs.existsSync(root) && fs.readdirSync(root).every((name) => name === OWNERSHIP)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return terminalStatus(env);
}

/**
 * A runtime and entry point to start the terminal UI with: the installed
 * version, or else the one inside this desktop build, so the button works
 * before the command has been enabled.
 */
export function launchableEntry(env = defaultEnvironment()): { runtime: string; script: string } {
  const version = installedVersion(env.root);
  const payload = version ? path.join(env.root, 'versions', version) : bundledPayload();
  if (!payload) {
    throw new Error('This build of the desktop app does not include the terminal edition.');
  }
  return {
    runtime: path.join(payload, 'runtime', env.platform === 'win32' ? 'node.exe' : 'node'),
    script: path.join(payload, 'scripts', 'multi-git.cjs')
  };
}
