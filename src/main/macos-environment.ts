// Environment repair for applications launched from Finder.
//
// A macOS GUI application is started by launchd rather than by the user's
// interactive shell. Its PATH is commonly only /usr/bin:/bin:/usr/sbin:/sbin,
// which makes a perfectly healthy Homebrew Git, gh, GPG, editor or coding
// agent look uninstalled. Running a login shell to recover PATH would execute
// arbitrary shell startup files during application boot and can hang on an
// interactive prompt, so this uses the small set of conventional executable
// directories instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface MacPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  isDirectory?: (candidate: string) => boolean;
}

/** Conventional locations used by macOS package and language managers. */
export function macExecutableDirectories(homeDirectory: string): string[] {
  const inHome = (...segments: string[]): string =>
    path.posix.join(homeDirectory.replace(/\\/g, '/'), ...segments);

  return [
    // Homebrew on Apple Silicon and Intel, then MacPorts.
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/opt/local/bin',
    '/opt/local/sbin',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin',
    '/Applications/Cursor.app/Contents/Resources/app/bin',
    // Common per-user installers used by Git tooling and coding agents.
    inHome('.local', 'bin'),
    inHome('bin'),
    inHome('.volta', 'bin'),
    inHome('.cargo', 'bin'),
    inHome('.bun', 'bin'),
    inHome('.npm-global', 'bin'),
    inHome('Library', 'pnpm'),
    inHome('Library', 'Application Support', 'JetBrains', 'Toolbox', 'scripts'),
    // Always-available OS fallbacks also make an absent inherited PATH safe.
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];
}

function directoryExists(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Returns the PATH a Finder-launched process should use.
 *
 * Conventional tool directories that actually exist are promoted once, so
 * package-manager tools win over old Apple-provided copies. Other inherited
 * entries retain their relative order, and OS directories remain fallbacks.
 */
export function macExecutablePath(options: MacPathOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform !== 'darwin') {
    return env['PATH'];
  }

  const exists = options.isDirectory ?? directoryExists;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const original = (env['PATH'] ?? '').split(':').filter((entry) => entry !== '');
  const result: string[] = [];
  const seen = new Set<string>();
  const systemFallbacks = new Set(['/usr/bin', '/bin', '/usr/sbin', '/sbin']);
  const candidates = macExecutableDirectories(homeDirectory);

  const add = (candidate: string): void => {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  };

  for (const candidate of candidates) {
    if (systemFallbacks.has(candidate) || !exists(candidate)) {
      continue;
    }
    add(candidate);
  }

  for (const candidate of original) {
    add(candidate);
  }

  for (const candidate of systemFallbacks) {
    if (exists(candidate)) {
      add(candidate);
    }
  }

  return result.join(':');
}

/** Repairs process.env in place, and is a no-op away from macOS. */
export function bootstrapMacOSPath(options: MacPathOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  const next = macExecutablePath({ ...options, env });

  if ((options.platform ?? process.platform) === 'darwin' && next !== undefined) {
    env['PATH'] = next;
  }

  return next;
}
