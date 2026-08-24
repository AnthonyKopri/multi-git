'use strict';

// Uploads an already-built release to an existing GitHub release. This is
// intentionally separate from `npm run release`: local packaging stays
// reversible and offline, while the public write is always explicit.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  buildGhUploadArgs,
  checksumSpecForTarget,
  releaseTag,
  writeChecksumManifest
} = require('./release-assets');
const { releaseChangelog } = require('./changelog');
const { spawnSpec } = require('./command-path');

const ROOT = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const OUTPUT_DIR = path.join(ROOT, 'dist');

function parseArgs(argv) {
  const options = {
    tag: null,
    repo: null,
    target: 'both',
    dryRun: false,
    changelog: true,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, null];
    const nextValue = () => {
      const value = inlineValue !== null ? inlineValue : argv[++index];
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new Error(`${flag} requires a value.`);
      }
      return value;
    };

    if (flag === '--tag') options.tag = nextValue();
    else if (flag === '--repo' || flag === '-R') options.repo = nextValue();
    else if (flag === '--target') options.target = nextValue();
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--no-changelog') options.changelog = false;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/upload-release-assets.js [options]

Uploads one platform's artifacts and checksum manifest to an existing GitHub release.

  --tag <tag>       release tag (default: Release_v<package version>)
  --repo, -R <repo> GitHub repository in OWNER/REPO form
  --target <name>   both | macos (default: both, the two Windows artifacts)
  --dry-run         print the gh command without writing or uploading
  --no-changelog    leave CHANGELOG.md alone
  --help, -h        show this message

After a successful upload, the Unreleased entries in CHANGELOG.md are moved
under a heading for this version, and the release's compare link is added.
The edit is left in the working tree for you to review and commit.
`);
}

function quoteForDisplay(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  // The display form is valid in PowerShell and POSIX shells for the paths and
  // GitHub asset labels this script produces; embedded quotes are doubled.
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Runs gh and returns its stdout, for the reads rather than the writes.
 *
 * Resolves to null on any failure. Verification can report that uncertainty;
 * the pre-upload inventory check treats it as fatal so it never guesses that
 * an existing asset is safe to replace or skip.
 */
function readGh(args) {
  return new Promise((resolve) => {
    const spec = spawnSpec('gh', args);
    const child = spawn(spec.file, spec.args, {
      cwd: ROOT,
      shell: false,
      windowsHide: true,
      ...spec.options
    });
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? stdout : null));
  });
}

function releaseAssetViewArgs(tag, repo) {
  const args = ['release', 'view', tag, '--json', 'assets'];
  if (repo !== undefined) args.push('--repo', repo);
  return args;
}

/** Parses the authoritative asset inventory returned by `gh release view`. */
function parseReleaseAssetInventory(output) {
  let assets;
  try {
    assets = JSON.parse(output).assets;
  } catch (error) {
    throw new Error(`Could not parse the release asset inventory: ${error.message}`, {
      cause: error
    });
  }

  if (!Array.isArray(assets)) {
    throw new Error('The release asset inventory did not contain an assets array.');
  }

  const published = new Map();
  for (const asset of assets) {
    if (
      asset === null ||
      typeof asset !== 'object' ||
      typeof asset.name !== 'string' ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0
    ) {
      throw new Error('The release asset inventory contained an invalid name or size.');
    }
    if (published.has(asset.name)) {
      throw new Error(`The release asset inventory listed ${asset.name} more than once.`);
    }
    published.set(asset.name, asset);
  }
  return published;
}

/** Accepts GitHub's `sha256:<hex>` form and the raw local hash form. */
function normalizedSha256(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(?:sha256:)?([0-9a-f]{64})$/i);
  return match?.[1].toLowerCase() ?? null;
}

/**
 * Selects only absent assets for upload and refuses to overwrite uncertainty.
 *
 * GitHub rejects duplicate release asset names unless `--clobber` is used.
 * Matching names, sizes, and GitHub's authoritative SHA-256 digest mean a prior
 * run completed that exact asset. Anything else needs deliberate human cleanup.
 */
async function selectMissingAssets({ tag, repo, assets, read = readGh }) {
  const output = await read(releaseAssetViewArgs(tag, repo));
  if (output === null) {
    throw new Error(`Could not inspect ${tag}'s existing assets before uploading.`);
  }

  const published = parseReleaseAssetInventory(output);
  const missing = [];

  for (const asset of assets) {
    const found = published.get(asset.basename);
    if (!found) {
      missing.push(asset);
      continue;
    }
    if (found.size !== asset.size) {
      throw new Error(
        `Refusing to replace ${asset.basename}: the release has ${found.size} bytes, ` +
          `but the local file has ${asset.size}. Delete the remote asset deliberately before retrying.`
      );
    }
    const localDigest = normalizedSha256(asset.sha256);
    const remoteDigest = normalizedSha256(found.digest);
    if (localDigest === null) {
      throw new Error(`Could not calculate a valid local SHA-256 for ${asset.basename}.`);
    }
    if (remoteDigest === null) {
      throw new Error(
        `Refusing to skip ${asset.basename}: GitHub did not return its SHA-256 digest. ` +
          'Update GitHub CLI, or inspect and delete the remote asset deliberately before retrying.'
      );
    }
    if (remoteDigest !== localDigest) {
      throw new Error(
        `Refusing to replace ${asset.basename}: its release SHA-256 differs from the local file. ` +
          'Delete the remote asset deliberately before retrying.'
      );
    }
  }

  return missing;
}

/** Builds a labeled gh command for the selected subset, never with clobber. */
function buildSelectedUploadArgs({ tag, repo, assets }) {
  const args = [
    'release',
    'upload',
    tag,
    ...assets.map((asset) => `${asset.path}#${asset.label}`)
  ];
  if (repo !== undefined) args.push('--repo', repo);
  return args;
}

function runGh(args) {
  return new Promise((resolve, reject) => {
    // On Windows `gh` may be a .cmd shim, which spawn cannot run by bare name.
    const spec = spawnSpec('gh', args);

    const child = spawn(spec.file, spec.args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      ...spec.options
    });

    child.on('error', (error) => {
      if (error && error.code === 'ENOENT') {
        reject(new Error('GitHub CLI (gh) is not installed or is not on PATH.'));
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`gh release upload failed (exit code ${code}).`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const version = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version;
  const tag = options.tag ?? releaseTag(version);
  const uploadArgs = buildGhUploadArgs({
    tag,
    version,
    outputDir: OUTPUT_DIR,
    repo: options.repo ?? undefined,
    targetName: options.target
  });

  if (options.dryRun) {
    console.log('Dry run — nothing was written or uploaded.');
    console.log(['gh', ...uploadArgs].map(quoteForDisplay).join(' '));

    if (options.changelog) {
      console.log(`CHANGELOG.md: ${previewChangelog({ version, tag })}`);
    }
    return;
  }

  const checksum = await writeChecksumManifest({
    version,
    targetName: options.target,
    outputDir: OUTPUT_DIR
  });
  console.log(`Updated ${path.relative(ROOT, checksum.manifestPath)} from the files being uploaded.`);

  const localSize = (filePath) => fs.statSync(filePath).size;
  const checksumSpec = checksumSpecForTarget(options.target);
  const manifestSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(checksum.manifestPath))
    .digest('hex');
  const expectedAssets = [
    ...checksum.assets.map((asset) => ({
      basename: asset.basename,
      label: asset.label,
      path: asset.path,
      size: localSize(asset.path),
      sha256: asset.sha256
    })),
    {
      basename: checksumSpec.basename,
      label: checksumSpec.label,
      path: checksum.manifestPath,
      size: localSize(checksum.manifestPath),
      sha256: manifestSha256
    }
  ];
  const missing = await selectMissingAssets({
    tag,
    repo: options.repo ?? undefined,
    assets: expectedAssets
  });

  if (missing.length > 0) {
    console.log(`Uploading ${missing.length} missing release asset(s) to ${tag}...\n`);
    await runGh(
      buildSelectedUploadArgs({
        tag,
        repo: options.repo ?? undefined,
        assets: missing
      })
    );
    console.log(`\nUploaded ${missing.map((asset) => asset.basename).join(', ')}.`);
  } else {
    console.log(`All ${expectedAssets.length} release assets already match; nothing to upload.`);
  }

  const verified = await verifyUpload({
    tag,
    repo: options.repo ?? undefined,
    assets: expectedAssets
  });

  if (verified !== 'ok') {
    throw new Error(
      'The complete release asset set could not be verified; the changelog was left alone.'
    );
  }

  if (!options.changelog) {
    return;
  }

  // After the upload and its check, never before: a changelog saying a
  // version shipped is wrong if its assets did not arrive intact.
  updateChangelog({ version, tag });
}

/**
 * Confirms the release now holds each asset at its full size and SHA-256.
 *
 * Worth the extra request because GitHub's own release editor lies about this:
 * assets uploaded through the API or the CLI are shown there as "Upload
 * failed. Delete and try uploading this file again", however completely they
 * uploaded. Following that advice deletes a working download. The API's own
 * view of the release is the truth, so this asks for it and prints it.
 *
 * @returns {Promise<'ok' | 'mismatch' | 'unknown'>}
 */
async function verifyUpload({ tag, repo, assets, read = readGh, out = console }) {
  const output = await read(releaseAssetViewArgs(tag, repo));
  if (output === null) {
    out.warn('Could not read the release back, so the upload was not verified.');
    return 'unknown';
  }

  let published;
  try {
    published = parseReleaseAssetInventory(output);
  } catch (error) {
    out.warn(`Could not read the release back: ${error.message}`);
    return 'unknown';
  }

  const problems = [];
  out.log('\nOn the release now:');

  for (const asset of assets) {
    const found = published.get(asset.basename);

    if (!found) {
      problems.push(`${asset.basename} is not on the release.`);
      out.log(`  ${asset.basename} — missing`);
      continue;
    }
    if (found.size !== asset.size) {
      problems.push(
        `${asset.basename} is ${found.size} bytes on the release but ${asset.size} locally.`
      );
      out.log(`  ${asset.basename} — ${found.size} bytes, expected ${asset.size}`);
      continue;
    }

    const expectedDigest = normalizedSha256(asset.sha256);
    const publishedDigest = normalizedSha256(found.digest);
    if (expectedDigest === null) {
      problems.push(`${asset.basename} has no valid local SHA-256.`);
      out.log(`  ${asset.basename} — local SHA-256 unavailable`);
      continue;
    }
    if (publishedDigest === null) {
      problems.push(`${asset.basename} has no verifiable SHA-256 on the release.`);
      out.log(`  ${asset.basename} — release SHA-256 unavailable`);
      continue;
    }
    if (publishedDigest !== expectedDigest) {
      problems.push(`${asset.basename} has different local and release SHA-256 digests.`);
      out.log(`  ${asset.basename} — SHA-256 mismatch`);
      continue;
    }

    out.log(
      `  ${asset.basename} — ${found.size} bytes, SHA-256 verified, ${found.state ?? 'uploaded'}`
    );
  }

  if (problems.length > 0) {
    out.warn(`\n${problems.join('\n')}`);
    out.warn('Delete those assets on the release and upload again.');
    return 'mismatch';
  }

  out.log(
    "\nAll assets are complete. GitHub's release editor may still show them as" +
      ' "Upload failed" — that is the editor not recognising a CLI upload, not a' +
      ' broken asset. Do not delete them.'
  );
  return 'ok';
}

/** What the changelog step would do, without doing any of it. */
function previewChangelog({ version, tag }) {
  try {
    const result = releaseChangelog(fs.readFileSync(CHANGELOG, 'utf8'), { version, tag });
    return result.changed ? `would have ${result.reason}` : `would be left alone: ${result.reason}`;
  } catch (error) {
    return `could not be read: ${error.message}`;
  }
}

/**
 * Closes the Unreleased section for the release that was just uploaded.
 *
 * Never fatal. The release is already public by the time this runs, so a
 * changelog that could not be rewritten is a note to the person running it,
 * not a failed release they might be tempted to retry.
 */
function updateChangelog({ version, tag }) {
  let source;
  try {
    source = fs.readFileSync(CHANGELOG, 'utf8');
  } catch (error) {
    console.warn(`Left CHANGELOG.md alone: ${error.message}`);
    return;
  }

  const result = releaseChangelog(source, { version, tag });

  if (!result.changed) {
    console.log(`Left CHANGELOG.md alone: ${result.reason}.`);
    return;
  }

  fs.writeFileSync(CHANGELOG, result.contents, 'utf8');
  console.log(`Updated CHANGELOG.md: ${result.reason}.`);
  console.log('Review and commit that change; it is not committed for you.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nRelease upload failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  quoteForDisplay,
  runGh,
  readGh,
  parseReleaseAssetInventory,
  normalizedSha256,
  selectMissingAssets,
  buildSelectedUploadArgs,
  verifyUpload,
  previewChangelog,
  updateChangelog
};
