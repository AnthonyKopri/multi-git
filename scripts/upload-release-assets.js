'use strict';

// Uploads an already-built release to an existing GitHub release. This is
// intentionally separate from `npm run release`: local packaging stays
// reversible and offline, while the public write is always explicit.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  buildGhUploadArgs,
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
    dryRun: false,
    changelog: true,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, null];
    const nextValue = () => {
      if (inlineValue !== null) return inlineValue;
      index += 1;
      if (index >= argv.length || argv[index].startsWith('-')) {
        throw new Error(`${flag} requires a value.`);
      }
      return argv[index];
    };

    if (flag === '--tag') options.tag = nextValue();
    else if (flag === '--repo' || flag === '-R') options.repo = nextValue();
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--no-changelog') options.changelog = false;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/upload-release-assets.js [options]

Uploads both Windows binaries and SHA256SUMS.txt to an existing GitHub release.

  --tag <tag>       release tag (default: Release_v<package version>)
  --repo, -R <repo> GitHub repository in OWNER/REPO form
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
  // Releases are built on Windows. PowerShell single quotes keep spaces,
  // backslashes, parentheses, and # labels literal; embedded quotes double.
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Runs gh and returns its stdout, for the reads rather than the writes.
 *
 * Resolves to null on any failure. Every caller is checking on work that has
 * already happened, so not being able to look is worth reporting but never
 * worth failing a release that already succeeded.
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
    repo: options.repo ?? undefined
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
    targetName: 'both',
    outputDir: OUTPUT_DIR
  });
  console.log(`Updated ${path.relative(ROOT, checksum.manifestPath)} from the files being uploaded.`);
  console.log(`Uploading release assets to ${tag}...\n`);
  await runGh(uploadArgs);
  console.log(`\nUploaded ${checksum.assets.length} executable(s) and SHA256SUMS.txt with display labels.`);

  const localSize = (filePath) => fs.statSync(filePath).size;
  const verified = await verifyUpload({
    tag,
    repo: options.repo ?? undefined,
    assets: [
      ...checksum.assets.map((asset) => ({
        basename: asset.basename,
        size: localSize(asset.path)
      })),
      {
        basename: path.basename(checksum.manifestPath),
        size: localSize(checksum.manifestPath)
      }
    ]
  });

  if (!options.changelog) {
    return;
  }

  // After the upload and its check, never before: a changelog saying a
  // version shipped is wrong if its assets did not arrive intact.
  if (verified === 'mismatch') {
    console.log('Left CHANGELOG.md alone until the assets on the release are right.');
    return;
  }

  updateChangelog({ version, tag });
}

/**
 * Confirms the release now holds each asset, at its full size.
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
  const args = ['release', 'view', tag, '--json', 'assets'];
  if (repo !== undefined) args.push('--repo', repo);

  const output = await read(args);
  if (output === null) {
    out.warn('Could not read the release back, so the upload was not verified.');
    return 'unknown';
  }

  let published;
  try {
    published = new Map(
      (JSON.parse(output).assets ?? []).map((asset) => [asset.name, asset])
    );
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

    out.log(`  ${asset.basename} — ${found.size} bytes, ${found.state ?? 'uploaded'}`);
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
  verifyUpload,
  previewChangelog,
  updateChangelog
};
