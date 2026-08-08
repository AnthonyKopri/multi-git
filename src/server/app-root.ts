// Resolves the application root: the directory that holds package.json,
// templates/, and the shipped static assets.
//
// This cannot be derived from a fixed number of `..` segments. The same code
// runs from three different depths:
//
//   <root>/src/server/app-root.ts             (vitest, ts sources)
//   <root>/out/node/server/app-root.js        (built, run from the repo)
//   app.asar/out/node/server/app-root.js      (packaged by electron-builder)
//
// So instead of counting segments, walk up from this file until we find the
// package.json that belongs to this application. Matching on the package name
// means a stray package.json inside node_modules can never be mistaken for the
// application root, and the walk stops at the asar boundary because the asar
// root is where the real package.json lives.
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_NAME = 'multi-git';

/** Product name shown in window titles, before the version. */
export const APP_DISPLAY_NAME = 'Multi-Git Client';

function readManifest(directory: string): Record<string, unknown> | null {
  const manifest = path.join(directory, 'package.json');
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Missing, unreadable, or malformed: this is not the directory we want.
    return null;
  }
}

function isAppRoot(directory: string): boolean {
  return readManifest(directory)?.['name'] === PACKAGE_NAME;
}

/**
 * Walks up from `startDirectory` looking for the application's package.json.
 * Exported for tests, which exercise the dev, built, and asar layouts against
 * a synthetic tree rather than relying on wherever this file happens to sit.
 */
export function findAppRoot(startDirectory: string): string | null {
  let current = path.resolve(startDirectory);

  // path.dirname() of a filesystem root returns the root itself, which is the
  // termination condition rather than an infinite loop.
  for (;;) {
    if (isAppRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

let cachedRoot: string | null = null;

/** The application root directory. Resolved once, then cached. */
export function appRoot(): string {
  if (cachedRoot === null) {
    const resolved = findAppRoot(__dirname);
    if (resolved === null) {
      throw new Error(
        `Could not locate the "${PACKAGE_NAME}" application root by walking up from ${__dirname}. ` +
          'The package.json that identifies the app is missing from the build or the packaged asar.'
      );
    }
    cachedRoot = resolved;
  }

  return cachedRoot;
}

/** Resolves a path relative to the application root. */
export function fromAppRoot(...segments: string[]): string {
  return path.join(appRoot(), ...segments);
}

let cachedVersion: string | null = null;

/**
 * The version from the application's own package.json.
 *
 * package.json is already packaged (electron-builder needs it), and it is the
 * single source the installer, the About text and the window title all agree
 * on. Returns an empty string only if the manifest somehow has no version, so
 * a title falls back to the bare product name rather than showing "undefined".
 */
export function appVersion(): string {
  if (cachedVersion === null) {
    const version = readManifest(appRoot())?.['version'];
    cachedVersion = typeof version === 'string' ? version : '';
  }

  return cachedVersion;
}

/** Product name with the version appended, e.g. `Multi-Git Client v2.3.0`. */
export function appTitle(suffix?: string): string {
  const version = appVersion();
  const name = version === '' ? APP_DISPLAY_NAME : `${APP_DISPLAY_NAME} v${version}`;
  return suffix === undefined ? name : `${name} - ${suffix}`;
}

/** Directory holding the license and .gitignore template bodies. */
export function templatesDir(): string {
  return fromAppRoot('templates');
}

/**
 * Directory the HTTP server serves static assets from. Prefers the built
 * bundle and falls back to the un-built sources, so `node out/node/server`
 * and a source checkout both work.
 */
export function staticDir(): string {
  const built = fromAppRoot('out', 'web');
  return fs.existsSync(path.join(built, 'index.html')) ? built : fromAppRoot('public');
}
