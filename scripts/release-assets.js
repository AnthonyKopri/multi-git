'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'dist');
const CHECKSUM_BASENAME = 'SHA256SUMS.txt';
const CHECKSUM_LABEL = 'SHA-256 checksums';
// Keep this in step with the release driver's accepted version format.
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// The desktop builds. The desktop updater looks for exactly these names, so a
// rename here is a rename every installed copy has to be taught about first.
//
// `os`, `arch` and `format` are what the release notes' download tables show;
// `label` is what GitHub lists the file as.
const RELEASE_ASSETS = Object.freeze({
  installer: Object.freeze({
    edition: 'desktop',
    os: 'Windows',
    arch: 'x64',
    format: 'Installer (.exe)',
    label: 'Windows installer (recommended)',
    basename: (version) => `Multi-Git-Client-Setup-${version}.exe`
  }),
  portable: Object.freeze({
    edition: 'desktop',
    os: 'Windows',
    arch: 'x64',
    format: 'Portable (.exe)',
    label: 'Portable Windows executable',
    basename: (version) => `Multi-Git-Client-Portable-${version}.exe`
  }),
  // Built on GitHub Actions, on a Mac. Must match build.dmg.artifactName in
  // package.json.
  macos: Object.freeze({
    edition: 'desktop',
    os: 'macOS',
    arch: 'Apple silicon + Intel',
    format: 'Disk image (.dmg)',
    label: 'macOS disk image (Apple silicon and Intel)',
    basename: (version) => `Multi-Git-Client-macOS-${version}.dmg`
  }),
  // The three Linux builds, also made on GitHub Actions. Each must match the
  // artifactName under build.appImage, build.deb and build.rpm in
  // package.json. The architecture is in the name the way each format spells
  // it, so the file a user downloads says what it is for.
  appimage: Object.freeze({
    edition: 'desktop',
    os: 'Linux',
    arch: 'x64',
    format: 'AppImage (any distribution)',
    // The label is what the release page lists the file as, which is the one
    // place to warn before it is run: an AppImage without FUSE 2 fails before
    // any of the app's own code starts, silently when double-clicked.
    label: 'Linux AppImage (x86_64, any distribution; needs FUSE 2)',
    note:
      'The AppImage needs FUSE 2, which Ubuntu 22.04 and later do not install by default: ' +
      'run `sudo apt install libfuse2t64` first (`libfuse2` on 22.04), or use the .deb instead.',
    basename: (version) => `Multi-Git-Client-Linux-${version}-x86_64.AppImage`
  }),
  deb: Object.freeze({
    edition: 'desktop',
    os: 'Linux',
    arch: 'x64',
    format: '.deb (Debian, Ubuntu, Linux Mint)',
    label: 'Linux .deb package (Debian, Ubuntu, Linux Mint; amd64)',
    basename: (version) => `Multi-Git-Client-Linux-${version}-amd64.deb`
  }),
  rpm: Object.freeze({
    edition: 'desktop',
    os: 'Linux',
    arch: 'x64',
    format: '.rpm (Fedora, RHEL, openSUSE)',
    label: 'Linux .rpm package (Fedora, RHEL, openSUSE; x86_64)',
    basename: (version) => `Multi-Git-Client-Linux-${version}-x86_64.rpm`
  })
});

/** The spelling each operating system has in a terminal package's name. */
const TERMINAL_OS = Object.freeze({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' });
const TERMINAL_ARCH_LABEL = Object.freeze({ x64: 'x64', arm64: 'ARM64' });

/** The terminal package name for a platform, shared with its self-update. */
function terminalBasename(version, platform, arch) {
  const os = TERMINAL_OS[platform];
  if (!os || !Object.hasOwn(TERMINAL_ARCH_LABEL, arch)) {
    throw new Error(`No terminal package for ${platform}-${arch}.`);
  }
  return `Multi-Git-Terminal-${version}-${os}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
}

// The terminal edition: the CLI, the terminal UI and the MCP server with their
// own Node runtime, one archive per operating system and architecture. Not
// something the desktop updater looks at; `multi-git update` finds its own.
const TERMINAL_ASSETS = Object.freeze(
  Object.fromEntries(
    Object.keys(TERMINAL_OS).flatMap((platform) =>
      Object.keys(TERMINAL_ARCH_LABEL).map((arch) => [
        `terminal-${platform}-${arch}`,
        Object.freeze({
          edition: 'terminal',
          os: TERMINAL_OS[platform],
          arch: TERMINAL_ARCH_LABEL[arch],
          platform,
          nodeArch: arch,
          format: platform === 'win32' ? 'ZIP' : 'tar.gz',
          label: `Terminal edition for ${TERMINAL_OS[platform]} (${TERMINAL_ARCH_LABEL[arch]})`,
          basename: (version) => terminalBasename(version, platform, arch)
        })
      ])
    )
  )
);

/** Every file a release carries, desktop first. */
const ASSET_CATALOGUE = Object.freeze({ ...RELEASE_ASSETS, ...TERMINAL_ASSETS });

// `installer`, `portable` and `both` are what release.js can build. `release`
// is everything a release carries, and is what the upload attaches.
const TARGET_ASSET_KINDS = Object.freeze({
  installer: Object.freeze(['installer']),
  portable: Object.freeze(['portable']),
  both: Object.freeze(['installer', 'portable']),
  terminal: Object.freeze(Object.keys(TERMINAL_ASSETS)),
  release: Object.freeze([...Object.keys(RELEASE_ASSETS), ...Object.keys(TERMINAL_ASSETS)])
});

function assertVersion(version) {
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`Invalid release version "${version}"; expected x.y.z or an x.y.z-prerelease.`);
  }
}

function selectedAssetKinds(targetName) {
  const keys = Object.hasOwn(TARGET_ASSET_KINDS, targetName)
    ? TARGET_ASSET_KINDS[targetName]
    : undefined;
  if (!keys) {
    throw new Error(
      `Invalid release target "${targetName}"; expected installer, portable, both, terminal, or release.`
    );
  }
  return [...keys];
}

function resolveReleaseAssets({ version, targetName, outputDir = DEFAULT_OUTPUT_DIR }) {
  assertVersion(version);
  const resolvedOutputDir = path.resolve(outputDir);

  return selectedAssetKinds(targetName).map((key) => {
    const spec = ASSET_CATALOGUE[key];
    const basename = spec.basename(version);
    return Object.freeze({
      key,
      basename,
      label: spec.label,
      path: path.join(resolvedOutputDir, basename)
    });
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);

    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function writeFileAtomic(filePath, contents) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  );

  try {
    fs.writeFileSync(tempPath, Buffer.from(contents, 'ascii'), { flag: 'wx' });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // A leftover temp file is less important than the original write error.
    }
    throw error;
  }
}

async function writeChecksumManifest({ version, targetName, outputDir = DEFAULT_OUTPUT_DIR }) {
  const artifacts = resolveReleaseAssets({ version, targetName, outputDir });

  for (const artifact of artifacts) {
    let stat;
    try {
      stat = fs.statSync(artifact.path);
    } catch (error) {
      throw new Error(`Expected release artifact is missing: ${artifact.path}`, { cause: error });
    }
    if (!stat.isFile()) {
      throw new Error(`Expected release artifact is not a file: ${artifact.path}`);
    }
  }

  const entries = [];
  for (const artifact of artifacts) {
    let sha256;
    try {
      sha256 = await sha256File(artifact.path);
    } catch (error) {
      throw new Error(`Could not hash release artifact: ${artifact.path}`, { cause: error });
    }
    entries.push(Object.freeze({ ...artifact, sha256 }));
  }

  const contents = `${entries.map((entry) => `${entry.sha256}  ${entry.basename}`).join('\n')}\n`;
  const manifestPath = path.join(path.resolve(outputDir), CHECKSUM_BASENAME);
  writeFileAtomic(manifestPath, contents);
  return Object.freeze({
    manifestPath,
    contents,
    assets: Object.freeze(entries)
  });
}

function releaseTag(version) {
  assertVersion(version);
  return `Release_v${version}`;
}

function buildGhUploadArgs({
  tag,
  version,
  outputDir = DEFAULT_OUTPUT_DIR,
  repo,
  clobber = false
}) {
  if (typeof tag !== 'string' || tag.trim() === '') {
    throw new Error('GitHub release tag must be a non-empty string.');
  }

  const artifacts = resolveReleaseAssets({ version, targetName: 'release', outputDir });
  const checksumPath = path.join(path.resolve(outputDir), CHECKSUM_BASENAME);
  const args = [
    'release',
    'upload',
    tag,
    ...artifacts.map((artifact) => `${artifact.path}#${artifact.label}`),
    `${checksumPath}#${CHECKSUM_LABEL}`
  ];

  if (repo !== undefined) {
    if (typeof repo !== 'string' || repo.trim() === '') {
      throw new Error('GitHub repository must be a non-empty OWNER/REPO string.');
    }
    args.push('--repo', repo);
  }

  // Only ever asked for when re-running onto a draft, where nobody can have
  // downloaded the asset being replaced.
  if (clobber) {
    args.push('--clobber');
  }

  return args;
}

module.exports = {
  RELEASE_ASSETS,
  TERMINAL_ASSETS,
  ASSET_CATALOGUE,
  terminalBasename,
  CHECKSUM_BASENAME,
  CHECKSUM_LABEL,
  selectedAssetKinds,
  resolveReleaseAssets,
  writeChecksumManifest,
  releaseTag,
  buildGhUploadArgs
};
