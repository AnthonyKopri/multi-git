'use strict';

// Makes the commit a release is cut from: the version bump and the changelog
// section for it, together.
//
//   npm run release:prepare -- --bump minor
//
// Merged to main, that commit is what the Release workflow builds, and the
// version in package.json is the release it makes. Nothing here builds,
// commits, or talks to GitHub.
const fs = require('fs');
const path = require('path');

const { nextVersion, applyVersion } = require('./release');
const { releaseTag } = require('./release-assets');
const { releaseChangelog } = require('./changelog');

const ROOT = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

function parseArgs(argv) {
  const options = { bump: null, dryRun: false, help: false };

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

    if (flag === '--bump') options.bump = nextValue();
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}. Run with --help for the list.`);
  }

  if (!options.help && options.bump === null) {
    throw new Error('Say which version to prepare: --bump patch, minor, major, or x.y.z.');
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run release:prepare -- --bump <spec> [--dry-run]

Bumps the version in package.json and package-lock.json, and moves the
Unreleased entries in CHANGELOG.md under a heading for it.

  --bump <spec>     patch, minor, major, or an explicit x.y.z
  --dry-run         say what would change, and change nothing
  --help, -h        show this message

Commit the result, merge it to main, then run the Release workflow.
`);
}

/**
 * What preparing `spec` from `current` would do, without doing any of it.
 *
 * @returns {{version: string, tag: string, changelog: {changed: boolean, contents: string, reason: string}}}
 */
function plan({ current, spec, changelog }) {
  const version = nextVersion(current, spec);
  if (version === current) {
    // `none` is a real spec for release.js, which rebuilds; here it would
    // prepare a release that already exists.
    throw new Error(`The version is already ${current}. Prepare a version after it.`);
  }

  const tag = releaseTag(version);
  return { version, tag, changelog: releaseChangelog(changelog, { version, tag }) };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const current = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version;
  const result = plan({ current, spec: options.bump, changelog: fs.readFileSync(CHANGELOG, 'utf8') });

  console.log(`${options.dryRun ? 'Would prepare' : 'Preparing'} ${result.version} (${result.tag}).`);
  console.log(`  version:   ${current} -> ${result.version}`);
  console.log(
    `  changelog: ${result.changelog.changed ? result.changelog.reason : `left alone, because ${result.changelog.reason}`}`
  );

  if (!result.changelog.changed) {
    console.log(
      '\n  The release notes are written from the changelog, so this release would\n' +
        '  have nothing to say. Add entries under Unreleased first if it should.'
    );
  }

  if (options.dryRun) {
    return;
  }

  applyVersion(result.version);
  if (result.changelog.changed) {
    fs.writeFileSync(CHANGELOG, result.changelog.contents, 'utf8');
  }

  console.log(`
Next:
  1. Commit this on a branch and merge it to main through a pull request.
  2. Run the Release workflow on main: Actions > Release > Run workflow, or
       gh workflow run release.yml
     It waits for CI on that commit, then builds, uploads and publishes.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Could not prepare the release: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, plan };
