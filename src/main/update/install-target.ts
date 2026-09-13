// Which build is running, and therefore what an update means for it.
//
// electron-builder's portable target sets PORTABLE_EXECUTABLE_DIR in the
// process environment before the app starts (templates/nsis/portable.nsi), and
// the NSIS install does not. That is the only reliable discriminator, and it is
// why this takes the environment as an argument rather than reading
// process.env: the branch is then testable without an Electron build.
//
// Linux has three builds and no such variable for two of them. The AppImage
// runtime sets APPIMAGE and APPDIR; a .deb or .rpm is recognised by the package
// manager's records, which is why the file system is an argument too.

import path from 'node:path';

import type { InstallKind } from '../../shared/update-types';

export interface InstallEnvironment {
  platform: string;
  /** app.isPackaged. A dev run updates nothing. */
  isPackaged: boolean;
  env: Record<string, string | undefined>;
  /** process.execPath, which tells a running AppImage from a leaked APPIMAGE. */
  execPath?: string;
  /** fs.existsSync. Without it no Linux package is recognised. */
  exists?: (filePath: string) => boolean;
}

/**
 * The package name of the .deb and .rpm.
 *
 * electron-builder takes it from package.json `name`; tests/packaging.test.ts
 * holds the two together.
 */
export const LINUX_PACKAGE_NAME = 'multi-git';

/**
 * dpkg's list of the files a package installed, which exists exactly while the
 * package is installed. The Release workflow checks it appears after
 * installing the .deb, so a change to dpkg's layout fails there.
 */
export const DPKG_FILE_LIST = `/var/lib/dpkg/info/${LINUX_PACKAGE_NAME}.list`;

/**
 * Where rpm keeps its database: the traditional path, and the one Fedora and
 * openSUSE have since moved it to.
 *
 * Unlike dpkg's, the database is not readable without rpm itself, so this
 * only says the system is rpm-based. Checked after dpkg, a copy that is
 * neither an AppImage nor a .deb on such a system is taken to be the .rpm.
 */
export const RPM_DATABASES: readonly string[] = ['/var/lib/rpm', '/usr/lib/sysimage/rpm'];

function nonBlank(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The AppImage file this copy runs from, or null when it is not one.
 *
 * APPIMAGE alone is not enough: it is inherited by everything a running
 * AppImage starts, including a terminal opened from this app and whatever is
 * launched from that. The AppImage runtime mounts the image at APPDIR and runs
 * the app from inside it, so the executable being under APPDIR is what shows
 * that this process is the AppImage the variable names.
 */
export function appImageFile(environment: InstallEnvironment): string | null {
  if (environment.platform !== 'linux' || !environment.isPackaged) {
    return null;
  }

  const file = environment.env['APPIMAGE'];
  const mount = environment.env['APPDIR'];
  const executable = environment.execPath;
  if (!nonBlank(file) || !nonBlank(mount) || !nonBlank(executable)) {
    return null;
  }
  if (!path.posix.isAbsolute(file) || !path.posix.isAbsolute(mount)) {
    return null;
  }

  const inside = path.posix.relative(mount, executable);
  const underMount =
    inside !== '' && inside !== '..' && !inside.startsWith('../') && !path.posix.isAbsolute(inside);
  return underMount ? file : null;
}

export function detectInstallKind(environment: InstallEnvironment): InstallKind {
  // An unpackaged run is a checkout that npm, not an installer, is
  // responsible for.
  if (!environment.isPackaged) {
    return 'unsupported';
  }
  // Releases carry a macOS disk image, whose copies are told about new
  // versions rather than updated in place.
  if (environment.platform === 'darwin') {
    return 'macos';
  }
  if (environment.platform === 'linux') {
    return detectLinuxKind(environment);
  }
  if (environment.platform !== 'win32') {
    return 'unsupported';
  }

  return nonBlank(environment.env['PORTABLE_EXECUTABLE_DIR']) ? 'portable' : 'installer';
}

function detectLinuxKind(environment: InstallEnvironment): InstallKind {
  if (appImageFile(environment) !== null) {
    return 'appimage';
  }

  const exists = environment.exists ?? (() => false);
  if (exists(DPKG_FILE_LIST)) {
    return 'deb';
  }
  if (RPM_DATABASES.some((database) => exists(database))) {
    return 'rpm';
  }
  // Unpacked by hand, or converted to another package format: nothing
  // published matches it, so nothing is offered.
  return 'unsupported';
}

/** Where the portable build's replacement is written: beside the running exe. */
export function portableDirectory(
  environment: InstallEnvironment
): string | null {
  const dir = environment.env['PORTABLE_EXECUTABLE_DIR'];
  return nonBlank(dir) ? dir : null;
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
 * to relaunch the app afterwards. The portable exe is simply started, and so
 * is an AppImage, which by then has already replaced the one running.
 */
export function installCommand(kind: InstallKind, filePath: string): InstallCommand {
  if (kind === 'installer') {
    return { file: filePath, args: ['/S', '--force-run'] };
  }
  if (kind === 'portable' || kind === 'appimage') {
    return { file: filePath, args: [] };
  }
  throw new Error('This build does not install updates.');
}
