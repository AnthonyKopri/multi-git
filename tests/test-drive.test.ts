// What `npm run test-drive` builds, on each platform.
//
// The plan is decided without touching the machine, so what a Mac or a Linux
// box would build is checked here on whichever computer runs the suite.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface Plan {
  help?: true;
  platformName?: string;
  kinds?: string[];
  builderArgs?: string[];
  skipped?: string[];
}

const require = createRequire(import.meta.url);
const { planTestDrive, PLATFORMS } = require('../scripts/test-drive.js') as {
  planTestDrive(input: { platform: string; argv: string[]; hasCommand: (name: string) => boolean }): Plan;
  PLATFORMS: Record<string, { builds: Record<string, unknown> }>;
};
const { RELEASE_ASSETS } = require('../scripts/release-assets.js') as {
  RELEASE_ASSETS: Record<string, unknown>;
};

const everything = (_name: string) => true;
const plan = (platform: string, argv: string[] = [], hasCommand: (name: string) => boolean = everything) =>
  planTestDrive({ platform, argv, hasCommand });

describe('npm run test-drive', () => {
  it('builds both Windows executables on Windows, as the release names them', () => {
    expect(plan('win32')).toEqual({
      platformName: 'Windows',
      kinds: ['installer', 'portable'],
      builderArgs: ['--win', 'nsis', 'portable', '--x64'],
      skipped: []
    });
  });

  it('builds the ad-hoc signed disk image on a Mac', () => {
    expect(plan('darwin')).toEqual({
      platformName: 'macOS',
      kinds: ['macos'],
      builderArgs: ['--mac', '-c.mac.identity=-'],
      skipped: []
    });
  });

  it('builds all three Linux packages on Linux', () => {
    expect(plan('linux')).toMatchObject({
      kinds: ['appimage', 'deb', 'rpm'],
      builderArgs: ['--linux', 'AppImage', 'deb', 'rpm', '--x64']
    });
  });

  it('builds only what is named', () => {
    expect(plan('win32', ['portable'])).toMatchObject({
      kinds: ['portable'],
      builderArgs: ['--win', 'portable', '--x64']
    });
    expect(plan('linux', ['DEB', 'appimage', 'deb'])).toMatchObject({
      kinds: ['deb', 'appimage'],
      builderArgs: ['--linux', 'deb', 'AppImage', '--x64']
    });
    expect(plan('darwin', ['dmg'])).toMatchObject({ kinds: ['macos'] });
  });

  it('says where to get another platform’s build, instead of starting one that fails', () => {
    expect(() => plan('win32', ['dmg'])).toThrow(/only be built on macOS.*build-macos/);
    expect(() => plan('darwin', ['portable'])).toThrow(/only be built on Windows.*build-windows/);
    expect(() => plan('win32', ['deb'])).toThrow(/only be built on Linux.*build-linux/);
  });

  it('leaves out the .rpm without rpmbuild, and says so', () => {
    const noRpmbuild = (name: string) => name !== 'rpmbuild';

    expect(plan('linux', [], noRpmbuild)).toMatchObject({
      kinds: ['appimage', 'deb'],
      builderArgs: ['--linux', 'AppImage', 'deb', '--x64'],
      skipped: ['.rpm package (needs rpmbuild)']
    });
    // Asked for by name, it is an error rather than a silent skip.
    expect(() => plan('linux', ['rpm'], noRpmbuild)).toThrow(/needs rpmbuild/);
  });

  it('refuses what it does not know', () => {
    expect(() => plan('win32', ['zip'])).toThrow(/Unknown build "zip"/);
    expect(() => plan('freebsd')).toThrow(/nothing to build on freebsd/);
    expect(plan('win32', ['--help'])).toEqual({ help: true });
  });

  it('covers every build a release carries, each on exactly one platform', () => {
    const covered = Object.values(PLATFORMS).flatMap((platform) => Object.keys(platform.builds));

    expect([...covered].sort()).toEqual(Object.keys(RELEASE_ASSETS).sort());
  });
});
