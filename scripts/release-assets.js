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

const RELEASE_ASSETS = Object.freeze({
  installer: Object.freeze({
    label: 'Windows installer (recommended)',
    basename: (version) => `Multi-Git-Client-Setup-${version}.exe`
  }),
  portable: Object.freeze({
    label: 'Portable Windows executable',
    basename: (version) => `Multi-Git-Client-Portable-${version}.exe`
  })
});

const TARGET_ASSET_KINDS = Object.freeze({
  installer: Object.freeze(['installer']),
  portable: Object.freeze(['portable']),
  both: Object.freeze(['installer', 'portable'])
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
    throw new Error(`Invalid release target "${targetName}"; expected installer, portable, or both.`);
  }
  return [...keys];
}

function resolveReleaseAssets({ version, targetName, outputDir = DEFAULT_OUTPUT_DIR }) {
  assertVersion(version);
  const resolvedOutputDir = path.resolve(outputDir);

  return selectedAssetKinds(targetName).map((key) => {
    const spec = RELEASE_ASSETS[key];
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
  repo
}) {
  if (typeof tag !== 'string' || tag.trim() === '') {
    throw new Error('GitHub release tag must be a non-empty string.');
  }

  const artifacts = resolveReleaseAssets({ version, targetName: 'both', outputDir });
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

  return args;
}

module.exports = {
  RELEASE_ASSETS,
  CHECKSUM_BASENAME,
  CHECKSUM_LABEL,
  selectedAssetKinds,
  resolveReleaseAssets,
  writeChecksumManifest,
  releaseTag,
  buildGhUploadArgs
};
