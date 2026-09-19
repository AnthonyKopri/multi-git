// `multi-git update`: the terminal edition updating itself, when asked.
//
// Never automatic. `--check` only reports. Without it, the newest stable
// release carrying this platform's package is downloaded, checked against the
// release's SHA256SUMS.txt, unpacked with the same refusals the desktop's
// installer applies, run once from a staging folder, and only then switched
// to. A session already running keeps the version it started with.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  RELEASES_URL,
  compareVersions,
  findAsset,
  lookupChecksum,
  parseChecksumManifest,
  parseVersion,
  usableReleases
} from '../../main/update/release-feed';
import { appRoot, appVersion, fromAppRoot } from '../app-root';
import { activatePayload, defaultEnvironment, rollbackTerminal } from './install';
import type { TerminalInstallationStatus } from '../../shared/terminal-types';

const PACKAGE_LIMIT = 512 * 1024 * 1024;

interface PackageScripts {
  download(url: string, file: string, limit?: number): Promise<string>;
  extractArchive(file: string, target: string): Promise<void>;
}

/** The package name for this machine, as scripts/release-assets.js spells it. */
export function terminalPackageName(version: string, platform = process.platform, arch = process.arch): string {
  const os = ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' } as Record<string, string>)[platform];
  if (!os || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`There is no terminal edition package for ${platform}-${arch}.`);
  }
  return `Multi-Git-Terminal-${version}-${os}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
}

export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
}

function installationEnvironment() {
  const env = defaultEnvironment();
  const root = path.dirname(path.dirname(appRoot()));
  let owned: { product?: string; portable?: boolean } = {};
  try { owned = JSON.parse(fs.readFileSync(path.join(root, 'installation.json'), 'utf8')) as typeof owned; } catch { /* Source or desktop copy. */ }
  if (path.basename(path.dirname(appRoot())) !== 'versions' || path.basename(appRoot()) !== appVersion() || owned.product !== 'multi-git-terminal') {
    throw new Error('This copy is not an installed terminal edition. Enable it in desktop Settings or run the launcher from an extracted terminal archive.');
  }
  env.root = root;
  env.portable = owned.portable === true;
  return env;
}

export function rollbackUpdate(): TerminalInstallationStatus {
  return rollbackTerminal(installationEnvironment());
}

export async function updateTerminal(checkOnly: boolean): Promise<UpdateCheck | (UpdateCheck & { installed: TerminalInstallationStatus })> {
  const current = parseVersion(appVersion());
  if (!current) {
    throw new Error('Only stable versions update themselves. Install a release from the downloads page.');
  }

  const response = await fetch(RELEASES_URL, {
    headers: { 'User-Agent': 'multi-git-terminal', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw new Error(`Could not read the releases from GitHub (HTTP ${response.status}).`);
  }

  const candidates = usableReleases(await response.json())
    .filter((release) => compareVersions(parseVersion(release.version)!, current) > 0)
    .filter((release) => findAsset(release, terminalPackageName(release.version)) && findAsset(release, 'SHA256SUMS.txt'))
    .sort((a, b) => compareVersions(parseVersion(b.version)!, parseVersion(a.version)!));
  const release = candidates[0];

  const check: UpdateCheck = {
    currentVersion: appVersion(),
    latestVersion: release?.version ?? appVersion(),
    available: release !== undefined
  };
  if (!release || checkOnly) {
    return check;
  }

  // Updating replaces what the launchers point at, so it only makes sense for
  // the installation those launchers belong to.
  const env = installationEnvironment();

  const scripts = require(fromAppRoot('scripts', 'terminal-package.cjs')) as PackageScripts;
  const name = terminalPackageName(release.version);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-update-'));
  try {
    const sums = await fetch(findAsset(release, 'SHA256SUMS.txt')!.browser_download_url, {
      headers: { 'User-Agent': 'multi-git-terminal' },
      signal: AbortSignal.timeout(30_000)
    });
    if (!sums.ok) {
      throw new Error('Could not read the release checksums. Nothing was changed.');
    }
    const expected = lookupChecksum(parseChecksumManifest(await sums.text()), name);

    const archive = path.join(scratch, name);
    const actual = await scripts.download(findAsset(release, name)!.browser_download_url, archive, PACKAGE_LIMIT);
    if (actual !== expected) {
      throw new Error(`${name} does not match its published checksum. Nothing was changed.`);
    }

    const unpacked = path.join(scratch, 'unpacked');
    await scripts.extractArchive(archive, unpacked);
    const installed = activatePayload(path.join(unpacked, 'versions', release.version), env);
    return { ...check, installed };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
