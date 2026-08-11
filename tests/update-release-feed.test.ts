import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  CHECKSUM_ASSET,
  assetBasename,
  compareVersions,
  findAsset,
  isPrereleaseBuild,
  lookupChecksum,
  parseChecksumManifest,
  parseReleaseTag,
  parseVersion,
  selectUpdate,
  usableReleases
} from '../src/main/update/release-feed';

/** A release as the GitHub API returns it, with both artifacts and checksums. */
function release(
  version: string,
  overrides: Record<string, unknown> = {},
  assetNames?: string[]
): Record<string, unknown> {
  const names = assetNames ?? [
    `Multi-Git-Client-Setup-${version}.exe`,
    `Multi-Git-Client-Portable-${version}.exe`,
    CHECKSUM_ASSET
  ];

  return {
    tag_name: `Release_v${version}`,
    name: `Multi-Git ${version}`,
    body: 'Notes.',
    draft: false,
    prerelease: false,
    html_url: `https://github.com/AnthonyKopri/multi-git/releases/tag/Release_v${version}`,
    assets: names.map((name) => ({
      name,
      browser_download_url: `https://github.com/AnthonyKopri/multi-git/releases/download/Release_v${version}/${name}`
    })),
    ...overrides
  };
}

function pick(releases: unknown[], currentVersion: string, kind: 'installer' | 'portable' = 'installer') {
  return selectUpdate({ releases, currentVersion, installKind: kind });
}

describe('release tag parsing', () => {
  it('accepts exactly the tags the release script produces', () => {
    expect(parseReleaseTag('Release_v3.2.0')).toEqual([3, 2, 0]);
    expect(parseReleaseTag('Release_v10.0.14')).toEqual([10, 0, 14]);
  });

  it('rejects prerelease tags structurally, without needing the prerelease flag', () => {
    expect(parseReleaseTag('Release_v3.2.0-beta.1')).toBeNull();
    expect(parseReleaseTag('Release_v3.2.0-rc1')).toBeNull();
    expect(parseReleaseTag('Release_v3.2.0-alpha')).toBeNull();
  });

  it('rejects tags that are not this project’s format', () => {
    // `Releases` is a real tag in this repository's history.
    expect(parseReleaseTag('Releases')).toBeNull();
    expect(parseReleaseTag('v3.2.0')).toBeNull();
    expect(parseReleaseTag('3.2.0')).toBeNull();
    expect(parseReleaseTag('Release_v3.2')).toBeNull();
    expect(parseReleaseTag('xRelease_v3.2.0')).toBeNull();
    expect(parseReleaseTag(42)).toBeNull();
  });
});

describe('version comparison', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions([3, 10, 0], [3, 9, 0])).toBeGreaterThan(0);
    expect(compareVersions([3, 2, 10], [3, 2, 9])).toBeGreaterThan(0);
    expect(compareVersions([3, 1, 1], [3, 1, 1])).toBe(0);
  });

  it('parses the running version, prerelease suffix and all', () => {
    expect(parseVersion('3.1.1')).toEqual([3, 1, 1]);
    expect(parseVersion('3.2.0-beta.1')).toEqual([3, 2, 0]);
    expect(parseVersion('not-a-version')).toBeNull();
    expect(isPrereleaseBuild('3.2.0-beta.1')).toBe(true);
    expect(isPrereleaseBuild('3.2.0')).toBe(false);
  });
});

describe('selecting an update', () => {
  it('offers a strictly higher release', () => {
    expect(pick([release('3.2.0')], '3.1.1')?.version).toBe('3.2.0');
  });

  it('offers nothing when the running version is current or ahead', () => {
    expect(pick([release('3.1.1')], '3.1.1')).toBeNull();
    expect(pick([release('3.0.0')], '3.1.1')).toBeNull();
  });

  it('picks the highest version, not the one listed first', () => {
    const releases = [release('3.2.0'), release('3.10.0'), release('3.9.0')];
    expect(pick(releases, '3.1.1')?.version).toBe('3.10.0');
  });

  it('drops drafts and releases flagged prerelease even when the tag looks stable', () => {
    expect(pick([release('3.2.0', { draft: true })], '3.1.1')).toBeNull();
    expect(pick([release('3.2.0', { prerelease: true })], '3.1.1')).toBeNull();
  });

  it('drops beta tags that were published as normal releases', () => {
    const beta = release('3.2.0', { tag_name: 'Release_v3.2.0-beta.1' });
    expect(pick([beta], '3.1.1')).toBeNull();
  });

  it('offers the stable release to someone running its prerelease', () => {
    expect(pick([release('3.2.0')], '3.2.0-beta.1')?.version).toBe('3.2.0');
  });

  it('skips a release that has no artifact for this build, and takes the next one down', () => {
    const installerOnly = release('3.3.0', {}, [
      'Multi-Git-Client-Setup-3.3.0.exe',
      CHECKSUM_ASSET
    ]);
    const both = release('3.2.0');

    expect(pick([installerOnly, both], '3.1.1', 'installer')?.version).toBe('3.3.0');
    // A portable user cannot use 3.3.0, so 3.2.0 is the honest answer.
    expect(pick([installerOnly, both], '3.1.1', 'portable')?.version).toBe('3.2.0');
  });

  it('refuses a release that published no checksum manifest', () => {
    const unverifiable = release('3.2.0', {}, ['Multi-Git-Client-Setup-3.2.0.exe']);
    expect(pick([unverifiable], '3.1.1')).toBeNull();
  });

  it('honours a skipped version, and stops honouring it once a higher one lands', () => {
    const skipped = { installKind: 'installer' as const, skippedVersion: '3.2.0' };
    expect(selectUpdate({ releases: [release('3.2.0')], currentVersion: '3.1.1', ...skipped })).toBeNull();
    expect(
      selectUpdate({
        releases: [release('3.2.0'), release('3.3.0')],
        currentVersion: '3.1.1',
        ...skipped
      })?.version
    ).toBe('3.3.0');
  });

  it('survives a response that is not a release list at all', () => {
    expect(usableReleases(null)).toEqual([]);
    expect(usableReleases({ message: 'Not Found' })).toEqual([]);
    expect(pick([{ tag_name: null }, 'nonsense', 7], '3.1.1')).toBeNull();
  });
});

describe('asset matching', () => {
  it('matches by exact name, so a lookalike is not selected', () => {
    const candidate = usableReleases([
      release('3.2.0', {}, [
        'Multi-Git-Client-Setup-3.2.0.exe.sig',
        'evil-Multi-Git-Client-Setup-3.2.0.exe',
        'Multi-Git-Client-Setup-3.2.0.exe',
        CHECKSUM_ASSET
      ])
    ])[0]!;

    const asset = findAsset(candidate, assetBasename('installer', '3.2.0'));
    expect(asset?.name).toBe('Multi-Git-Client-Setup-3.2.0.exe');
    expect(findAsset(candidate, 'Multi-Git-Client-Portable-3.2.0.exe')).toBeNull();
  });
});

describe('checksum manifest', () => {
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

  it('reads what writeChecksumManifest emits, CRLF included', () => {
    const manifest = parseChecksumManifest(
      `${digest}  Multi-Git-Client-Setup-3.2.0.exe\r\n\r\n${digest}  SHA256SUMS.txt\r\n`
    );
    expect(lookupChecksum(manifest, 'Multi-Git-Client-Setup-3.2.0.exe')).toBe(digest);
  });

  it('normalises case and ignores lines that are not entries', () => {
    const manifest = parseChecksumManifest(
      `# a comment\n${digest.toUpperCase()}  Multi-Git-Client-Setup-3.2.0.exe\nnot-a-digest  x.exe\n`
    );
    expect(lookupChecksum(manifest, 'Multi-Git-Client-Setup-3.2.0.exe')).toBe(digest);
    expect(manifest.has('x.exe')).toBe(false);
  });

  it('throws rather than returning nothing when the artifact is not listed', () => {
    const manifest = parseChecksumManifest(`${digest}  something-else.exe\n`);
    expect(() => lookupChecksum(manifest, 'Multi-Git-Client-Setup-3.2.0.exe')).toThrow(
      /no entry for Multi-Git-Client-Setup-3\.2\.0\.exe/
    );
  });
});

describe('agreement with the release pipeline', () => {
  // The single most important test here. The updater recognises releases by
  // names that scripts/release-assets.js decides. If a rename lands on one side
  // only, updates break for everyone already running an older build — which is
  // the one class of bug that shipping a new release cannot fix.
  const require = createRequire(import.meta.url);
  const releaseAssets = require('../scripts/release-assets.js') as {
    RELEASE_ASSETS: Record<'installer' | 'portable', { basename(version: string): string }>;
    CHECKSUM_BASENAME: string;
    releaseTag(version: string): string;
  };

  it('expects the artifact names the release script actually writes', () => {
    for (const version of ['3.2.0', '10.0.14']) {
      expect(assetBasename('installer', version)).toBe(
        releaseAssets.RELEASE_ASSETS.installer.basename(version)
      );
      expect(assetBasename('portable', version)).toBe(
        releaseAssets.RELEASE_ASSETS.portable.basename(version)
      );
    }
  });

  it('expects the checksum manifest name the release script uploads', () => {
    expect(CHECKSUM_ASSET).toBe(releaseAssets.CHECKSUM_BASENAME);
  });

  it('parses the tag format the release script produces', () => {
    expect(parseReleaseTag(releaseAssets.releaseTag('3.2.0'))).toEqual([3, 2, 0]);
  });
});
