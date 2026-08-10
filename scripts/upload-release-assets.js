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

const ROOT = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const OUTPUT_DIR = path.join(ROOT, 'dist');

function parseArgs(argv) {
  const options = {
    tag: null,
    repo: null,
    dryRun: false,
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
  --help, -h        show this message
`);
}

function quoteForDisplay(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  // Releases are built on Windows. PowerShell single quotes keep spaces,
  // backslashes, parentheses, and # labels literal; embedded quotes double.
  return `'${value.replace(/'/g, "''")}'`;
}

function runGh(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: false,
      windowsHide: true
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
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nRelease upload failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, quoteForDisplay, runGh };
