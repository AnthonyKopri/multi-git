// Version bump + Windows build + checksum driver. Run with `npm run release`.
//
// Prompts for the new version and which artifacts to produce, then hands off
// to electron-builder. Every prompt can be answered up front with a flag so
// the same script works in CI:
//
//   node scripts/release.js --bump patch --target both --yes
//   node scripts/release.js --bump 2.0.0 --target installer
//   node scripts/release.js --bump none --target portable
//   node scripts/release.js --dry-run
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveReleaseAssets, writeChecksumManifest } = require('./release-assets');

const ROOT = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const PACKAGE_LOCK = path.join(ROOT, 'package-lock.json');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

const TARGETS = {
  installer: { label: 'Installer only (NSIS .exe setup)', args: ['--win', 'nsis'] },
  portable: { label: 'Portable only (single .exe)', args: ['--win', 'portable'] },
  both: { label: 'Installer and portable', args: ['--win', 'nsis', 'portable'] }
};

function parseArgs(argv) {
  const options = { bump: null, target: null, yes: false, dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, null];
    const nextValue = () => {
      if (inlineValue !== null) return inlineValue;
      i += 1;
      return argv[i];
    };

    if (flag === '--bump') options.bump = nextValue();
    else if (flag === '--target') options.target = nextValue();
    else if (flag === '--yes' || flag === '-y') options.yes = true;
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/release.js [options]

  --bump <spec>     patch | minor | major | x.y.z | none
  --target <name>   installer | portable | both
  --yes, -y         accept defaults instead of prompting (patch, both)
  --dry-run         bump nothing, just print the build command
  --help, -h        show this message
`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Keeps the file's existing line endings and trailing newline. Without this a
// version bump on a CRLF checkout rewrites every line of package-lock.json.
function writeJson(file, value) {
  const usesCrlf = fs.readFileSync(file, 'utf8').includes('\r\n');
  let text = `${JSON.stringify(value, null, 2)}\n`;
  if (usesCrlf) {
    text = text.replace(/\n/g, '\r\n');
  }
  fs.writeFileSync(file, text, 'utf8');
}

function nextVersion(current, spec) {
  if (spec === 'none') return current;
  if (SEMVER.test(spec)) return spec;

  const match = current.match(SEMVER);
  if (!match) {
    throw new Error(`Current version "${current}" is not a semantic version; pass an explicit x.y.z.`);
  }

  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (spec === 'major') return `${major + 1}.0.0`;
  if (spec === 'minor') return `${major}.${minor + 1}.0`;
  if (spec === 'patch') return `${major}.${minor}.${patch + 1}`;

  throw new Error(`Invalid version spec "${spec}". Use patch, minor, major, x.y.z, or none.`);
}

// package-lock.json repeats the version in two places; leaving either behind
// makes the next `npm install` rewrite the lock file on its own.
function applyVersion(version) {
  const pkg = readJson(PACKAGE_JSON);
  pkg.version = version;
  writeJson(PACKAGE_JSON, pkg);

  if (!fs.existsSync(PACKAGE_LOCK)) return ['package.json'];

  const lock = readJson(PACKAGE_LOCK);
  lock.version = version;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = version;
  }
  writeJson(PACKAGE_LOCK, lock);
  return ['package.json', 'package-lock.json'];
}

function resolveElectronBuilder() {
  const packageDir = path.join(ROOT, 'node_modules', 'electron-builder');
  const manifest = path.join(packageDir, 'package.json');
  if (!fs.existsSync(manifest)) return null;

  const bin = readJson(manifest).bin;
  const relative = typeof bin === 'string' ? bin : bin && bin['electron-builder'];
  if (!relative) return null;

  const entry = path.join(packageDir, relative);
  return fs.existsSync(entry) ? entry : null;
}

function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) => new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
  return { ask, close: () => rl.close() };
}

async function promptVersion(ask, current) {
  console.log(`\nCurrent version: ${current}`);
  console.log(`  1) patch  -> ${nextVersion(current, 'patch')}`);
  console.log(`  2) minor  -> ${nextVersion(current, 'minor')}`);
  console.log(`  3) major  -> ${nextVersion(current, 'major')}`);
  console.log('  4) custom version');
  console.log('  5) keep the current version');

  for (;;) {
    const answer = (await ask('Version [1]: ')) || '1';
    if (answer === '1' || answer === 'patch') return 'patch';
    if (answer === '2' || answer === 'minor') return 'minor';
    if (answer === '3' || answer === 'major') return 'major';
    if (answer === '5' || answer === 'none' || answer === 'keep') return 'none';
    if (answer === '4' || answer === 'custom') {
      const custom = await ask('New version (x.y.z): ');
      if (SEMVER.test(custom)) return custom;
      console.log('  That is not a semantic version.');
      continue;
    }
    if (SEMVER.test(answer)) return answer;
    console.log('  Choose 1-5, or type a version like 1.2.3.');
  }
}

async function promptTarget(ask) {
  console.log('\nWhat should be built?');
  console.log(`  1) ${TARGETS.installer.label}`);
  console.log(`  2) ${TARGETS.portable.label}`);
  console.log(`  3) ${TARGETS.both.label}`);

  for (;;) {
    const answer = (await ask('Target [3]: ')) || '3';
    if (answer === '1' || answer === 'installer') return 'installer';
    if (answer === '2' || answer === 'portable') return 'portable';
    if (answer === '3' || answer === 'both') return 'both';
    console.log('  Choose 1, 2, or 3.');
  }
}

function runNode(entry, args, failureMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: ROOT,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${failureMessage} (exit code ${code})`));
    });
  });
}

/**
 * Compiles the TypeScript sources into out/.
 *
 * This has to happen here rather than in the npm script, because release.js
 * invokes electron-builder directly and BUILDING.md documents calling this
 * file straight from node. out/ is gitignored, so a fresh checkout has none of
 * it, and electron-builder would package an asar with no entry point.
 */
function runCompile() {
  console.log('Compiling sources...\n');
  return runNode(path.join(ROOT, 'scripts', 'build.mjs'), [], 'Compilation failed');
}

function runBuild(builderEntry, args) {
  // electron-builder publishes to GitHub Releases on its own when the npm
  // lifecycle event is named "release", which every script here is. That
  // demands a GH_TOKEN and fails without one — and it fails *after* packaging
  // has succeeded, so the artifacts sit finished in dist/ while the command
  // reports failure and the version bump is rolled back.
  //
  // This driver builds; uploading a release is a separate, deliberate step.
  return runNode(builderEntry, ['--publish', 'never', ...args], 'electron-builder failed');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const current = readJson(PACKAGE_JSON).version;
  const interactive = process.stdin.isTTY && !options.yes;

  let bumpSpec = options.bump;
  let targetName = options.target;

  if (!bumpSpec || !targetName) {
    if (interactive) {
      const prompt = createPrompt();
      try {
        if (!bumpSpec) bumpSpec = await promptVersion(prompt.ask, current);
        if (!targetName) targetName = await promptTarget(prompt.ask);
      } finally {
        prompt.close();
      }
    } else {
      // Non-interactive and unanswered: fall back to the safest useful pair.
      bumpSpec = bumpSpec || 'patch';
      targetName = targetName || 'both';
    }
  }

  if (!TARGETS[targetName]) {
    throw new Error(`Invalid target "${targetName}". Use installer, portable, or both.`);
  }

  const version = nextVersion(current, bumpSpec);
  const target = TARGETS[targetName];

  if (options.dryRun) {
    console.log(`\nDry run — nothing was written.`);
    console.log(`  version: ${current}${version === current ? ' (unchanged)' : ` -> ${version}`}`);
    console.log(`  target:  ${target.label}`);
    console.log(`  command: electron-builder ${target.args.join(' ')}`);
    for (const asset of resolveReleaseAssets({ version, targetName })) {
      console.log(`  artifact: ${path.relative(ROOT, asset.path)}`);
    }
    console.log(`  checksums: ${path.join('dist', 'SHA256SUMS.txt')}`);
    return;
  }

  // Check what can be checked before touching any file, so a missing tool
  // fails without having renamed the project first.
  const builderEntry = resolveElectronBuilder();
  if (!builderEntry) {
    throw new Error(
      'electron-builder is not installed. Run "npm install" (with dev dependencies) before building.'
    );
  }

  if (version !== current) {
    const written = applyVersion(version);
    console.log(`\nVersion ${current} -> ${version} (updated ${written.join(', ')})`);
  } else {
    console.log(`\nVersion stays at ${current}`);
  }

  // The version has to be written before packaging, because electron-builder
  // reads it to name the artifact. That means a failure from here on leaves a
  // bump behind for a release that never happened, so it is rolled back.
  try {
    // Compile before packaging: electron-builder only copies what already
    // exists on disk.
    await runCompile();

    console.log(`Building: ${target.label}\n`);
    await runBuild(builderEntry, target.args);

    console.log('\nCalculating SHA-256 checksums...');
    const checksum = await writeChecksumManifest({ version, targetName });
    console.log(checksum.contents.trimEnd());
    console.log(`Wrote ${path.relative(ROOT, checksum.manifestPath)}`);
  } catch (error) {
    if (version !== current) {
      applyVersion(current);
      console.error(`\nRelease failed. Version rolled back to ${current}.`);
    }
    throw error;
  }

  console.log(`\nDone. Artifacts and SHA256SUMS.txt for ${version} are in dist/.`);
  if (version !== current) {
    console.log('The version bump is not committed or tagged — do that yourself when the build looks right.');
  }
  if (targetName === 'both') {
    console.log('After the tag and draft GitHub release exist, run "npm run release:upload".');
  }
}

main().catch((err) => {
  console.error(`\nRelease failed: ${err.message}`);
  process.exit(1);
});
