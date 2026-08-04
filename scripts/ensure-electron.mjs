// Downloads the Electron runtime if it is not already unpacked.
//
// The `electron` package has no postinstall script: it exposes the download as
// an explicit `install-electron` bin instead, so a plain `npm install` leaves
// node_modules/electron with a cli.js that immediately fails with "Electron
// failed to install correctly". That message names the symptom, not the fix.
//
// electron-builder is unaffected — it fetches its own runtime through
// @electron/get and its own cache — so only the `desktop` script needs this.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON_DIR = path.join(ROOT, 'node_modules', 'electron');
const INSTALLER = path.join(ELECTRON_DIR, 'install.js');

/**
 * True when the runtime is unpacked.
 *
 * path.txt is written by the installer and holds the executable's name
 * relative to dist/, which is how electron's own cli.js locates it.
 */
function isInstalled() {
  const pathFile = path.join(ELECTRON_DIR, 'path.txt');
  if (!fs.existsSync(pathFile)) {
    return false;
  }

  const executable = fs.readFileSync(pathFile, 'utf8').trim();
  return executable !== '' && fs.existsSync(path.join(ELECTRON_DIR, 'dist', executable));
}

if (!fs.existsSync(INSTALLER)) {
  console.error('electron is not installed. Run "npm install" (with dev dependencies) first.');
  process.exit(1);
}

if (isInstalled()) {
  process.exit(0);
}

console.log('Electron runtime is not downloaded yet. Fetching it (this is a large download)...');

const result = spawnSync(process.execPath, [INSTALLER], { cwd: ROOT, stdio: 'inherit' });

if (result.error) {
  console.error(`Could not run the Electron installer: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
