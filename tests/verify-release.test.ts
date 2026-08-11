// The release verifier.
//
// Its whole value is that it agrees with the updater. A verifier that approves
// releases the app cannot see is worse than none: it converts a silent failure
// into a confidently wrong "all clear". Most of this file is that agreement.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { CHECKSUM_ASSET, assetBasename, parseReleaseTag } from '../src/main/update/release-feed';

interface VerifyScriptApi {
  parseArgs(argv: string[]): Record<string, string | boolean>;
  parseChecksumManifest(text: string): Map<string, string>;
  highestOffer(releases: unknown[], version: string): string | null;
  RELEASE_TAG: RegExp;
}

const require = createRequire(import.meta.url);
const verify = require('../scripts/verify-release.js') as VerifyScriptApi;

const DIGEST = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function release(version: string, overrides: Record<string, unknown> = {}, assetNames?: string[]) {
  const names = assetNames ?? [
    assetBasename('installer', version),
    assetBasename('portable', version),
    CHECKSUM_ASSET
  ];

  return {
    tag_name: `Release_v${version}`,
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({ name, browser_download_url: `https://github.com/${name}` })),
    ...overrides
  };
}

describe('agreement with the updater', () => {
  const tags = [
    'Release_v3.2.0',
    'Release_v10.0.14',
    'Release_v3.2.0-beta.1',
    'Release_v3.2.0-rc1',
    'Release_v3.2',
    'Releases',
    'v3.2.0',
    '3.2.0',
    'release_v3.2.0',
    'Release_V3.2.0',
    'xRelease_v3.2.0',
    ' Release_v3.2.0'
  ];

  it('accepts and rejects exactly the tags the updater does', () => {
    for (const tag of tags) {
      expect(
        verify.RELEASE_TAG.test(tag),
        `verify-release.js and release-feed.ts disagree about "${tag}"`
      ).toBe(parseReleaseTag(tag) !== null);
    }
  });

  it('reads the checksum manifest the same way the updater does', () => {
    const text = `${DIGEST.toUpperCase()}  Multi-Git-Client-Setup-3.2.0.exe\r\n\r\nnope  x.exe\n`;
    const parsed = verify.parseChecksumManifest(text);

    expect(parsed.get('Multi-Git-Client-Setup-3.2.0.exe')).toBe(DIGEST);
    expect(parsed.has('x.exe')).toBe(false);
  });
});

describe('working out what would be offered', () => {
  it('names the release an older copy would get', () => {
    expect(verify.highestOffer([release('3.2.0')], '3.2.0')).toBe('Release_v3.2.0');
  });

  it('picks the highest version, not the one listed first', () => {
    const releases = [release('3.2.0'), release('3.10.0'), release('3.9.0')];
    expect(verify.highestOffer(releases, '3.2.0')).toBe('Release_v3.10.0');
  });

  it('ignores drafts, prereleases, and beta tags', () => {
    expect(verify.highestOffer([release('3.2.0', { draft: true })], '3.2.0')).toBeNull();
    expect(verify.highestOffer([release('3.2.0', { prerelease: true })], '3.2.0')).toBeNull();
    expect(
      verify.highestOffer([release('3.2.0', { tag_name: 'Release_v3.2.0-beta.1' })], '3.2.0')
    ).toBeNull();
  });

  it('ignores a release that is missing an artifact or its checksums', () => {
    const noPortable = release('3.2.0', {}, [assetBasename('installer', '3.2.0'), CHECKSUM_ASSET]);
    const noChecksums = release('3.2.0', {}, [
      assetBasename('installer', '3.2.0'),
      assetBasename('portable', '3.2.0')
    ]);

    expect(verify.highestOffer([noPortable], '3.2.0')).toBeNull();
    expect(verify.highestOffer([noChecksums], '3.2.0')).toBeNull();
  });

  it('spots a tag whose version does not match its assets', () => {
    // Tagged 3.3.0, but built from a package.json still saying 3.2.0.
    const mismatched = release('3.3.0', { tag_name: 'Release_v3.3.0' }, [
      assetBasename('installer', '3.2.0'),
      assetBasename('portable', '3.2.0'),
      CHECKSUM_ASSET
    ]);

    expect(verify.highestOffer([mismatched], '3.3.0')).toBeNull();
  });
});

describe('argument parsing', () => {
  it('reads the options it documents', () => {
    expect(verify.parseArgs(['--tag', 'Release_v3.2.0', '--repo', 'o/r'])).toEqual({
      tag: 'Release_v3.2.0',
      repo: 'o/r'
    });
    expect(verify.parseArgs(['--help'])).toEqual({ help: true });
    expect(verify.parseArgs([])).toEqual({});
  });

  it('refuses an option with no value, rather than reading the next flag as one', () => {
    expect(() => verify.parseArgs(['--tag'])).toThrow(/needs a value/);
    expect(() => verify.parseArgs(['--tag', '--repo'])).toThrow(/needs a value/);
    expect(() => verify.parseArgs(['--nope'])).toThrow(/Unknown option/);
  });
});
