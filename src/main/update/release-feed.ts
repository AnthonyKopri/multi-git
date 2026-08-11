// Choosing which GitHub release, if any, this copy should update to.
//
// No I/O: this module is handed the parsed JSON and returns a decision, so the
// interesting part — which tags count, which asset belongs to which build, and
// what the checksum manifest says — is testable without a network or Electron.
//
// The tag pattern is the whole beta story. Releases are tagged `Release_v1.2.3`
// by scripts/release-assets.js, so a prerelease would be tagged
// `Release_v1.2.3-beta.1`, which this rejects structurally. Nothing has to
// trust GitHub's `prerelease` flag being set correctly — though that flag is
// honoured too, as a second filter.

/** The repository releases are read from. A constant: never configurable. */
export const UPDATE_REPO = 'AnthonyKopri/multi-git';

export const RELEASES_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=30`;

/** Basename of the checksum manifest scripts/release-assets.js uploads. */
export const CHECKSUM_ASSET = 'SHA256SUMS.txt';

/**
 * Exactly the tags scripts/release-assets.js `releaseTag()` produces.
 *
 * Anchored and with no prerelease branch on purpose. `Release_v3.2.0-beta.1`,
 * `v3.2.0`, and the stray bare `Releases` tag in this repository's history all
 * fail to match, which is how betas stay out of the update path.
 */
const RELEASE_TAG = /^Release_v(\d+)\.(\d+)\.(\d+)$/;

/**
 * The version this build reports about itself.
 *
 * Lenient about a prerelease suffix where the tag pattern is strict, because
 * scripts/release.js accepts `x.y.z-prerelease` as a version to build. Someone
 * running `3.2.0-beta.1` must still be offered `3.2.0`, so the suffix is
 * captured rather than rejected — see `isPrereleaseBuild`.
 */
const BARE_VERSION = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

export type Version = readonly [number, number, number];

export interface GithubAsset {
  name: string;
  browser_download_url: string;
}

export interface GithubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

export interface ReleaseCandidate {
  version: string;
  parsed: Version;
  tag: string;
  name: string;
  notes: string;
  htmlUrl: string;
  assets: GithubAsset[];
}

export function parseReleaseTag(tag: unknown): Version | null {
  if (typeof tag !== 'string') {
    return null;
  }
  const match = RELEASE_TAG.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Parses the running app's own version, which carries no tag prefix. */
export function parseVersion(version: unknown): Version | null {
  if (typeof version !== 'string') {
    return null;
  }
  const match = BARE_VERSION.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True for a running version like `3.2.0-beta.1`, which 3.2.0 supersedes. */
export function isPrereleaseBuild(version: unknown): boolean {
  if (typeof version !== 'string') {
    return false;
  }
  const match = BARE_VERSION.exec(version.trim());
  return match?.[4] !== undefined;
}

/** Field by field and numerically, so 3.10.0 sorts above 3.9.0. */
export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function formatVersion(version: Version): string {
  return version.join('.');
}

function toAssets(raw: unknown): GithubAsset[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const assets: GithubAsset[] = [];
  for (const entry of raw) {
    const record = entry as { name?: unknown; browser_download_url?: unknown };
    if (typeof record?.name === 'string' && typeof record?.browser_download_url === 'string') {
      assets.push({ name: record.name, browser_download_url: record.browser_download_url });
    }
  }
  return assets;
}

/** The releases that are stable, correctly tagged, and worth comparing. */
export function usableReleases(releases: unknown): ReleaseCandidate[] {
  if (!Array.isArray(releases)) {
    return [];
  }

  const candidates: ReleaseCandidate[] = [];
  for (const entry of releases as GithubRelease[]) {
    if (entry?.draft === true || entry?.prerelease === true) {
      continue;
    }

    const parsed = parseReleaseTag(entry?.tag_name);
    if (!parsed) {
      continue;
    }

    const tag = entry.tag_name as string;
    candidates.push({
      version: formatVersion(parsed),
      parsed,
      tag,
      name: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : tag,
      notes: typeof entry.body === 'string' ? entry.body : '',
      htmlUrl: typeof entry.html_url === 'string' ? entry.html_url : '',
      assets: toAssets(entry.assets)
    });
  }

  return candidates;
}

export interface SelectUpdateInput {
  releases: unknown;
  currentVersion: string;
  /** Which artifact this build needs, so a release without it is skipped. */
  installKind: 'installer' | 'portable';
  /** Version the user chose to skip, if any. */
  skippedVersion?: string | undefined;
}

/**
 * Whether this release is usable by this build.
 *
 * `npm run release` can publish one target at a time (`release:installer`,
 * `release:portable`), so a release carrying only the installer is a real,
 * shipped shape. A portable user must fall through to the newest release that
 * actually has a portable exe rather than being offered one it cannot use.
 *
 * The checksum manifest is required for the same reason the download verifies
 * against it: without one there is nothing to check, and an unverifiable
 * release is not an update this app will offer.
 */
function hasNeededAssets(
  candidate: ReleaseCandidate,
  installKind: 'installer' | 'portable'
): boolean {
  return (
    findAsset(candidate, assetBasename(installKind, candidate.version)) !== null &&
    findAsset(candidate, CHECKSUM_ASSET) !== null
  );
}

/**
 * The highest stable release newer than the running one, or null.
 *
 * By version, not by publication date: re-publishing an old release, or a
 * patch to an older line landing after a newer one, must not offer a downgrade.
 */
export function selectUpdate(input: SelectUpdateInput): ReleaseCandidate | null {
  const current = parseVersion(input.currentVersion);
  if (!current) {
    return null;
  }

  // A `3.2.0-beta.1` build is superseded by the release of 3.2.0 itself, which
  // compares equal. Every other build needs a strictly higher version.
  const prerelease = isPrereleaseBuild(input.currentVersion);

  let best: ReleaseCandidate | null = null;
  for (const candidate of usableReleases(input.releases)) {
    const difference = compareVersions(candidate.parsed, current);
    if (difference < 0 || (difference === 0 && !prerelease)) {
      continue;
    }
    if (!hasNeededAssets(candidate, input.installKind)) {
      continue;
    }
    if (!best || compareVersions(candidate.parsed, best.parsed) > 0) {
      best = candidate;
    }
  }

  if (best && input.skippedVersion !== undefined && best.version === input.skippedVersion) {
    return null;
  }

  return best;
}

/** Basenames must match scripts/release-assets.js RELEASE_ASSETS exactly. */
export function assetBasename(kind: 'installer' | 'portable', version: string): string {
  return kind === 'installer'
    ? `Multi-Git-Client-Setup-${version}.exe`
    : `Multi-Git-Client-Portable-${version}.exe`;
}

/** Looks an asset up by exact name; a near-miss is a failure, not a guess. */
export function findAsset(release: ReleaseCandidate, basename: string): GithubAsset | null {
  return release.assets.find((asset) => asset.name === basename) ?? null;
}

/** `<sha256>  <basename>` per line, as writeChecksumManifest() emits it. */
export function parseChecksumManifest(text: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+(\S.*)$/.exec(line.trim());
    if (match) {
      entries.set(match[2]!.trim(), match[1]!.toLowerCase());
    }
  }

  return entries;
}

/** Throws rather than returning undefined: a missing entry must stop the install. */
export function lookupChecksum(manifest: Map<string, string>, basename: string): string {
  const digest = manifest.get(basename);
  if (!digest) {
    throw new Error(`The release's checksum list has no entry for ${basename}.`);
  }
  return digest;
}
