// Which build is running, and therefore what an update means for it.
//
// electron-builder's portable target sets PORTABLE_EXECUTABLE_DIR in the
// process environment before the app starts (templates/nsis/portable.nsi), and
// the NSIS install does not. That is the only reliable discriminator, and it is
// why this takes the environment as an argument rather than reading
// process.env: the branch is then testable without an Electron build.

import type { InstallKind } from '../../shared/update-types';

export interface InstallEnvironment {
  platform: string;
  /** app.isPackaged. A dev run updates nothing. */
  isPackaged: boolean;
  env: Record<string, string | undefined>;
}

export function detectInstallKind(environment: InstallEnvironment): InstallKind {
  // An unpackaged run is a checkout that npm, not an installer, is
  // responsible for.
  if (!environment.isPackaged) {
    return 'unsupported';
  }
  // Releases carry a macOS disk image, whose copies are told about new
  // versions rather than updated in place. Nothing is published for Linux.
  if (environment.platform === 'darwin') {
    return 'macos';
  }
  if (environment.platform !== 'win32') {
    return 'unsupported';
  }

  const portableDir = environment.env['PORTABLE_EXECUTABLE_DIR'];
  return typeof portableDir === 'string' && portableDir.trim() !== ''
    ? 'portable'
    : 'installer';
}

/** Where the portable build's replacement is written: beside the running exe. */
export function portableDirectory(
  environment: InstallEnvironment
): string | null {
  const dir = environment.env['PORTABLE_EXECUTABLE_DIR'];
  return typeof dir === 'string' && dir.trim() !== '' ? dir : null;
}

export interface InstallCommand {
  file: string;
  args: string[];
}

/**
 * How the downloaded file is started.
 *
 * `/S` runs the NSIS installer silently, reusing the install directory it
 * recorded; `--force-run` is the flag electron-builder's generated script reads
 * to relaunch the app afterwards. The portable exe is simply started.
 */
export function installCommand(kind: InstallKind, filePath: string): InstallCommand {
  if (kind === 'installer') {
    return { file: filePath, args: ['/S', '--force-run'] };
  }
  if (kind === 'portable') {
    return { file: filePath, args: [] };
  }
  throw new Error('This build does not install updates.');
}
