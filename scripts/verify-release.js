'use strict';

// Checks a published GitHub release the way an installed copy of the app will.
//
// Everything that decides whether an update is discoverable — the tag format,
// the draft and prerelease flags, the asset names, the checksum manifest — is
// set by hand at release time and fails *silently* when it is wrong. A typo in
// the tag does not error anywhere; the release simply becomes invisible to
// every installed copy, nobody updates, and nothing reports it.
//
// This runs the same checks as src/main/update/release-feed.ts against the real
// API and says which one failed. Run it straight after publishing.

const fs = require('fs');
const path = require('path');

const {
  RELEASE_ASSETS,
  CHECKSUM_BASENAME,
  releaseTag
} = require('./release-assets');

const ROOT = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'dist');

/** The repository the app checks. Keep in step with release-feed.ts UPDATE_REPO. */
const DEFAULT_REPO = 'AnthonyKopri/multi-git';

/**
 * Must stay identical to RELEASE_TAG in src/main/update/release-feed.ts.
 *
 * tests/verify-release.test.ts asserts the two agree, so a change to one that
 * is not made to the other fails the suite rather than shipping a verifier that
 * approves releases the app cannot see.
 */
const RELEASE_TAG = /^Release_v(\d+)\.(\d+)\.(\d+)$/;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const USER_AGENT = 'Multi-Git-Client';

function releasesUrl(repo) {
  return `https://api.github.com/repos/${repo}/releases?per_page=30`;
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    const takesValue = arg === '--tag' || arg === '--repo' || arg === '--version';
    if (takesValue) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`${arg} needs a value.`);
      }
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option "${arg}". Try --help.`);
  }

  return options;
}

function usage() {
  console.log(`Usage: node scripts/verify-release.js [options]

Checks that a published release is discoverable by the in-app updater.

  --version X.Y.Z   Version to check. Defaults to the one in package.json.
  --tag TAG         Release tag. Defaults to Release_v<version>.
  --repo OWNER/REPO Repository to query. Defaults to ${DEFAULT_REPO}.
  --help, -h        Show this message.

Exits non-zero when the release would not be offered to an installed copy.`);
}

function readVersion() {
  const manifest = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const version = manifest.version;
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`package.json has no usable version (found ${String(version)}).`);
  }
  return version;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' }
  });

  if (response.status === 403 || response.status === 429) {
    throw new Error(
      'GitHub rate limit reached. Unauthenticated requests are capped at 60 an hour; wait and retry.'
    );
  }
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for ${url}.`);
  }

  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for ${url}.`);
  }
  return response.text();
}

/** Records a pass or a failure, and what to do about the failure. */
function createReport() {
  const lines = [];
  let failures = 0;

  return {
    pass(message) {
      lines.push(`  ok    ${message}`);
    },
    fail(message, remedy) {
      failures += 1;
      lines.push(`  FAIL  ${message}`);
      if (remedy) {
        lines.push(`        -> ${remedy}`);
      }
    },
    note(message) {
      lines.push(`        ${message}`);
    },
    get failures() {
      return failures;
    },
    print() {
      console.log(lines.join('\n'));
    }
  };
}

function assetNames(release) {
  return new Set((release.assets ?? []).map((asset) => asset.name));
}

/** Parses `<sha256>  <basename>` lines, as writeChecksumManifest emits them. */
function parseChecksumManifest(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+(\S.*)$/.exec(line.trim());
    if (match) {
      entries.set(match[2].trim(), match[1].toLowerCase());
    }
  }
  return entries;
}

async function verify(options) {
  const version = options.version ?? readVersion();
  if (!SEMVER.test(version)) {
    throw new Error(`"${version}" is not a version like 3.2.0.`);
  }

  const repo = options.repo ?? DEFAULT_REPO;
  const tag = options.tag ?? releaseTag(version);
  const report = createReport();

  console.log(`Checking ${repo} for the release an installed copy would find.`);
  console.log(`  version ${version}`);
  console.log(`  tag     ${tag}\n`);

  const releases = await getJson(releasesUrl(repo));
  if (!Array.isArray(releases)) {
    throw new Error('GitHub did not return a release list.');
  }

  // 1. Visible at all. Drafts are never returned to unauthenticated callers,
  //    which is exactly what the app is, so "missing" and "still a draft" are
  //    the same observation from here.
  const release = releases.find((entry) => entry?.tag_name === tag);
  if (!release) {
    report.fail(
      `No published release is tagged ${tag}.`,
      'Publish the draft, or correct the tag. Check for a typo: the tag is case-sensitive.'
    );
    const nearby = releases
      .map((entry) => entry?.tag_name)
      .filter((name) => typeof name === 'string')
      .slice(0, 5);
    if (nearby.length > 0) {
      report.note(`The most recent published tags are: ${nearby.join(', ')}`);
    }
    report.print();
    return report.failures;
  }
  report.pass(`Release ${tag} is published and visible.`);

  // 2. Tag format. The single most likely thing to be wrong, and the one that
  //    fails most quietly.
  const parsed = RELEASE_TAG.exec(tag);
  if (!parsed) {
    report.fail(
      `The tag ${tag} does not match Release_vX.Y.Z, so the updater ignores it.`,
      'Retag as Release_v<version>. A prerelease suffix is excluded on purpose.'
    );
  } else if (parsed.slice(1, 4).join('.') !== version) {
    report.fail(
      `The tag says ${parsed.slice(1, 4).join('.')} but the version is ${version}.`,
      'Assets are named from package.json and looked up from the tag, so a mismatch hides the release.'
    );
  } else {
    report.pass('The tag matches Release_vX.Y.Z and agrees with the version.');
  }

  // 3. Prerelease flag.
  if (release.prerelease === true) {
    report.fail(
      'The release is marked as a pre-release, so no installed copy will offer it.',
      'Untick "Set as a pre-release" if this was meant to be a stable release.'
    );
  } else {
    report.pass('The release is not marked as a pre-release.');
  }

  // 4. Assets, by the exact names the updater looks for.
  const names = assetNames(release);
  const expected = {
    installer: RELEASE_ASSETS.installer.basename(version),
    portable: RELEASE_ASSETS.portable.basename(version)
  };

  for (const [kind, basename] of Object.entries(expected)) {
    if (names.has(basename)) {
      report.pass(`${basename} is attached.`);
    } else {
      report.fail(
        `${basename} is missing, so ${kind} users will not be offered this release.`,
        'Upload with "npm run release:upload", which always attaches both builds together.'
      );
    }
  }

  if (names.has(CHECKSUM_BASENAME)) {
    report.pass(`${CHECKSUM_BASENAME} is attached.`);
  } else {
    report.fail(
      `${CHECKSUM_BASENAME} is missing, so the release cannot be verified and is skipped entirely.`,
      'Upload with "npm run release:upload", which regenerates it from the files it uploads.'
    );
  }

  // 5. The manifest actually describes these binaries. Catches a stale
  //    SHA256SUMS.txt uploaded after the binaries were rebuilt.
  const checksumAsset = (release.assets ?? []).find((asset) => asset.name === CHECKSUM_BASENAME);
  if (checksumAsset) {
    const manifest = parseChecksumManifest(await getText(checksumAsset.browser_download_url));

    for (const basename of Object.values(expected)) {
      if (manifest.has(basename)) {
        report.pass(`${CHECKSUM_BASENAME} lists ${basename}.`);
      } else {
        report.fail(
          `${CHECKSUM_BASENAME} has no entry for ${basename}, so the download is refused.`,
          'Re-run "npm run release:upload" against the built artifacts.'
        );
      }
    }

    // If the artifacts that produced this release are still here, the published
    // manifest and the local one must agree. They will not if anything was
    // rebuilt between generating the checksums and uploading them.
    const localManifest = path.join(DEFAULT_OUTPUT_DIR, CHECKSUM_BASENAME);
    if (fs.existsSync(localManifest)) {
      const local = parseChecksumManifest(fs.readFileSync(localManifest, 'utf8'));
      const drifted = [...local].filter(
        ([basename, digest]) => manifest.has(basename) && manifest.get(basename) !== digest
      );

      if (drifted.length > 0) {
        report.fail(
          `The published checksums differ from dist/${CHECKSUM_BASENAME} for: ${drifted
            .map(([basename]) => basename)
            .join(', ')}.`,
          'The uploaded binaries are not the ones built here. Rebuild and re-upload together.'
        );
      } else {
        report.pass(`The published checksums match dist/${CHECKSUM_BASENAME}.`);
      }
    }
  }

  // 6. The end-to-end question: would an older installed copy actually be
  //    offered this, once every filter above has been applied?
  const offered = highestOffer(releases, version);
  if (offered === tag) {
    report.pass(`An older installed copy would be offered ${version}.`);
  } else if (offered === null) {
    report.fail(
      'No release in the list passes every check, so nobody would be offered an update.',
      'Fix the failures above.'
    );
  } else {
    report.fail(
      `An older copy would be offered ${offered}, not ${tag}.`,
      'A higher version is already published. That is fine if intended.'
    );
  }

  report.print();
  return report.failures;
}

/**
 * The tag the updater would settle on, applying every filter it applies.
 *
 * Compared from a version below the one being checked, so the release under
 * test is genuinely a candidate.
 */
function highestOffer(releases, version) {
  let best = null;
  let bestParts = null;

  for (const release of releases) {
    if (release?.draft === true || release?.prerelease === true) {
      continue;
    }

    const match = RELEASE_TAG.exec(String(release?.tag_name ?? ''));
    if (!match) {
      continue;
    }

    const candidate = match.slice(1, 4).join('.');
    const names = assetNames(release);
    const hasBoth =
      names.has(RELEASE_ASSETS.installer.basename(candidate)) &&
      names.has(RELEASE_ASSETS.portable.basename(candidate)) &&
      names.has(CHECKSUM_BASENAME);

    if (!hasBoth) {
      continue;
    }

    const parts = match.slice(1, 4).map(Number);
    if (!bestParts || compare(parts, bestParts) > 0) {
      best = release.tag_name;
      bestParts = parts;
    }
  }

  // Only meaningful if it beats the version we are checking against.
  return bestParts && compare(bestParts, version.split(/[.-]/).slice(0, 3).map(Number)) >= 0
    ? best
    : null;
}

function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    usage();
    return;
  }

  try {
    const failures = await verify(options);
    console.log('');

    if (failures === 0) {
      console.log('This release is discoverable by the in-app updater.');
      return;
    }

    console.log(
      `${failures} check${failures === 1 ? '' : 's'} failed. Installed copies will not offer this release.`
    );
    process.exitCode = 1;
  } catch (error) {
    console.error(`\nCould not verify the release: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = { parseArgs, parseChecksumManifest, highestOffer, RELEASE_TAG };
