'use strict';

// Builds this computer's platform, to try main before releasing it. Run with
// `npm run test-drive`.
//
//   npm run test-drive                  every build this computer can make
//   npm run test-drive -- portable      only the portable Windows executable
//   npm run test-drive -- appimage deb  only those two Linux packages
//
// The version is left as it is, nothing is committed, tagged or uploaded, and
// no prompt is shown, so it is one command after merging a pull request.
//
// Each platform's builds can only be made on that platform: Windows on
// Windows, the disk image on a Mac, the Linux packages on Linux. Asking for
// another platform's build says so and where to get one, rather than starting
// a build that fails halfway through.

const fs = require('fs');
const path = require('path');

const { findExecutable } = require('./command-path');
const { resolveReleaseAssets } = require('./release-assets');
const { resolveElectronBuilder, runBuild, runCompile } = require('./release');

const ROOT = path.join(__dirname, '..');

/** The builds each platform makes, keyed like RELEASE_ASSETS. */
const PLATFORMS = Object.freeze({
  win32: Object.freeze({
    name: 'Windows',
    builds: Object.freeze({
      installer: { flag: 'nsis', label: 'installer' },
      portable: { flag: 'portable', label: 'portable executable' }
    }),
    // The architecture the release's file names describe.
    args: (flags) => ['--win', ...flags, '--x64']
  }),
  darwin: Object.freeze({
    name: 'macOS',
    builds: Object.freeze({
      macos: { flag: 'dmg', label: 'disk image' }
    }),
    // Ad-hoc signed, as the Release workflow signs without a certificate:
    // enough for the app to run on the Mac that built it.
    args: () => ['--mac', '-c.mac.identity=-']
  }),
  linux: Object.freeze({
    name: 'Linux',
    builds: Object.freeze({
      appimage: { flag: 'AppImage', label: 'AppImage' },
      deb: { flag: 'deb', label: '.deb package' },
      rpm: { flag: 'rpm', label: '.rpm package', needs: 'rpmbuild' }
    }),
    args: (flags) => ['--linux', ...flags, '--x64']
  })
});

/** What each build is called on the command line. */
const ALIASES = Object.freeze({
  installer: 'installer',
  setup: 'installer',
  portable: 'portable',
  dmg: 'macos',
  mac: 'macos',
  macos: 'macos',
  appimage: 'appimage',
  deb: 'deb',
  rpm: 'rpm'
});

/** The platform key, among PLATFORMS, that makes a build. */
function platformOf(kind) {
  return Object.keys(PLATFORMS).find((key) => Object.hasOwn(PLATFORMS[key].builds, kind));
}

function usage() {
  return `Usage: npm run test-drive -- [build...]

Builds what this computer's platform can make into dist/, at the current
version, without changing or uploading anything.

  Windows  installer, portable
  macOS    dmg
  Linux    appimage, deb, rpm   (rpm needs rpmbuild)

With no build named, makes every one this computer can.`;
}

/**
 * Decides what to build. No I/O: the platform and whether a tool is installed
 * are passed in, so every branch is testable on any computer.
 *
 * @param {{ platform: string, argv: string[], hasCommand: (name: string) => boolean }} input
 * @returns {{ help: true } | { platformName: string, kinds: string[], builderArgs: string[], skipped: string[] }}
 */
function planTestDrive({ platform, argv, hasCommand }) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const host = PLATFORMS[platform];
  if (!host) {
    throw new Error(`There is nothing to build on ${platform}. Builds are made on Windows, macOS and Linux.`);
  }

  const requested = [];
  for (const arg of argv) {
    const kind = ALIASES[arg.toLowerCase()];
    if (!kind) {
      throw new Error(`Unknown build "${arg}".\n\n${usage()}`);
    }
    if (!requested.includes(kind)) {
      requested.push(kind);
    }
  }

  for (const kind of requested) {
    const owner = platformOf(kind);
    if (owner !== platform) {
      const other = PLATFORMS[owner];
      const artifact = other.name === 'macOS' ? 'build-macos' : `build-${other.name.toLowerCase()}`;
      throw new Error(
        `The ${other.builds[kind].label} can only be built on ${other.name}, and this is ${host.name}. ` +
          `To try one, run the Release workflow with "dry run" ticked and download ${artifact} from the run.`
      );
    }
  }

  const explicit = requested.length > 0;
  const kinds = explicit ? requested : Object.keys(host.builds);
  const skipped = [];
  const buildable = kinds.filter((kind) => {
    const tool = host.builds[kind].needs;
    if (!tool || hasCommand(tool)) {
      return true;
    }
    if (explicit) {
      throw new Error(`The ${host.builds[kind].label} needs ${tool}, which is not installed.`);
    }
    skipped.push(`${host.builds[kind].label} (needs ${tool})`);
    return false;
  });

  return {
    platformName: host.name,
    kinds: buildable,
    builderArgs: host.args(buildable.map((kind) => host.builds[kind].flag)),
    skipped
  };
}

async function main() {
  const plan = planTestDrive({
    platform: process.platform,
    argv: process.argv.slice(2),
    hasCommand: (name) => findExecutable(name) !== null
  });

  if ('help' in plan) {
    console.log(usage());
    return;
  }

  const builderEntry = resolveElectronBuilder();
  if (!builderEntry) {
    throw new Error('electron-builder is not installed. Run npm ci first.');
  }

  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  console.log(`Test drive: ${plan.platformName} build of ${version}\n`);
  for (const note of plan.skipped) {
    console.log(`Skipping the ${note}.`);
  }

  await runCompile();
  await runBuild(builderEntry, plan.builderArgs);

  // Checked by name, as the release checks them, so a build that came out
  // under another name is reported here rather than found missing later.
  const built = resolveReleaseAssets({ version, targetName: 'release' }).filter((asset) =>
    plan.kinds.includes(asset.key)
  );
  const missing = built.filter((asset) => !fs.existsSync(asset.path));
  if (missing.length > 0) {
    throw new Error(`electron-builder did not produce ${missing.map((asset) => asset.basename).join(', ')}.`);
  }

  console.log('\nReady to try:');
  for (const asset of built) {
    console.log(`  ${path.relative(ROOT, asset.path)}`);
  }
  console.log('\nNothing was committed or uploaded. Releases are made by the Release workflow; see BUILDING.md.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nTest drive failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { planTestDrive, PLATFORMS };
