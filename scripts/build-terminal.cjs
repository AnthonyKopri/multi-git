'use strict';

// Builds the standalone terminal edition archives into dist/.
//
//   node scripts/build-terminal.cjs                  this machine's platform
//   node scripts/build-terminal.cjs linux arm64      one named target
//   node scripts/build-terminal.cjs all              all six
//
// Any runner can build any target: the payload is JavaScript plus an official
// Node build downloaded and checked against nodejs.org's checksums, and the
// ZIPs are written without a zip program. Run `npm run compile` first.
//
// Each archive unpacks to the same layout an installation has, so it can be
// used where it is unpacked, or activated by the desktop app or `multi-git
// update`:
//
//   multi-git, multi-git.cmd     launchers that run the version in current.txt
//   current.txt
//   versions/<version>/          the payload
const fs = require('node:fs');
const path = require('node:path');
const tar = require('tar');

const { buildPayload, launcherFiles, writeZip } = require('./terminal-package.cjs');
const { TERMINAL_ASSETS, terminalBasename } = require('./release-assets.js');

const ROOT = path.resolve(__dirname, '..');
const STAGING = path.join(ROOT, '.terminal-bundle');

async function buildArchive(platform, arch) {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const name = terminalBasename(version, platform, arch);
  const staging = path.join(STAGING, `archive-${platform}-${arch}`);
  const output = path.join(ROOT, 'dist', name);

  // Only ever this script's own folder under .terminal-bundle.
  fs.rmSync(staging, { recursive: true, force: true });
  await buildPayload(path.join(staging, 'versions', version), platform, arch);
  fs.writeFileSync(path.join(staging, 'current.txt'), `${version}\n`);
  fs.writeFileSync(path.join(staging, 'installation.json'), JSON.stringify({ product: 'multi-git-terminal', profiles: [], portable: true }));
  for (const [launcher, body] of Object.entries(launcherFiles())) {
    fs.writeFileSync(path.join(staging, launcher), body, { mode: 0o755 });
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.rmSync(output, { force: true });
  if (platform === 'win32') {
    writeZip(staging, output);
  } else {
    await tar.c({ file: output, cwd: staging, gzip: { level: 9 }, portable: true }, fs.readdirSync(staging));
  }
  fs.rmSync(staging, { recursive: true, force: true });

  console.log(`Built dist/${name} (${(fs.statSync(output).size / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  const [first, second] = process.argv.slice(2);
  const targets =
    first === 'all'
      ? Object.values(TERMINAL_ASSETS).map((spec) => [spec.platform, spec.nodeArch])
      : [[first || process.platform, second || process.arch]];

  // One at a time: each downloads and unpacks a Node build of its own.
  for (const [platform, arch] of targets) {
    await buildArchive(platform, arch);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
