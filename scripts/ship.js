'use strict';

// The whole release, one step at a time, asking before each one.
//
// Shipping a release was six commands from BUILDING.md, run in an order that
// matters, with two of them easy to forget: the version bump is deliberately
// not committed by the build, and the changelog rewrite is deliberately not
// committed by the upload. Both are correct on their own and both are a step
// somebody has to remember.
//
// This drives them in order and stops at each one to ask. It does not replace
// any of them: every step here is the documented command, spawned, with its
// own output passed straight through. Running them by hand still works, and a
// step that is already done is detected and skipped rather than repeated —
// which is what makes this safe to re-run after a failure partway through.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const {
  CHECKSUM_BASENAME,
  MACOS_CHECKSUM_BASENAME,
  RELEASE_ASSETS,
  releaseTag
} = require('./release-assets');
const { spawnSpec } = require('./command-path');
const { versionAnchor, repoUrlFromLinks } = require('./changelog');

const ROOT = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const PACKAGE_LOCK = path.join(ROOT, 'package-lock.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

function parseArgs(argv) {
  const options = {
    bump: null,
    tag: null,
    repo: null,
    yes: false,
    dryRun: false,
    publish: false,
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

    if (flag === '--bump') options.bump = nextValue();
    else if (flag === '--tag') options.tag = nextValue();
    else if (flag === '--repo' || flag === '-R') options.repo = nextValue();
    else if (flag === '--yes' || flag === '-y') options.yes = true;
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--publish') options.publish = true;
    // Belongs to the upload step, which this passes it to. Accepted here so
    // that the flag means the same thing whichever command is reached for.
    else if (flag === '--no-changelog') options.changelog = false;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}. Run with --help for the list.`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/ship.js [options]

Runs the release end to end, asking before each step:

  1. build the artifacts and checksums   (scripts/release.js)
  2. commit and push the version bump
  3. push the exact tag and create the GitHub release as a draft
  4. upload the assets, verify them, and close the changelog
  5. commit and push the changelog
  6. publish the draft

Each step is skipped when it is already done, so this is safe to re-run after
one of them fails.

  --bump <spec>     patch, minor, major, x.y.z, or none (default: ask)
  --tag <tag>       release tag (default: Release_v<version>)
  --repo, -R <repo> GitHub repository in OWNER/REPO form
  --publish         also publish the draft at the end
  --no-changelog    upload without closing the Unreleased section
  --yes, -y         do not ask; run every step
  --dry-run         print what each step would run and change nothing
  --help, -h        show this message
`);
}

// ---------- running things ----------

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    // Resolved rather than passed through: on Windows `gh` may be a .cmd shim,
    // which spawn cannot run by bare name. See scripts/command-path.js.
    const spec = spawnSpec(command, args);

    const child = spawn(spec.file, spec.args, {
      cwd: ROOT,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
      windowsHide: true,
      ...spec.options
    });

    let stdout = '';
    if (capture) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', () => {});
    }

    child.on('error', (error) => {
      reject(
        error && error.code === 'ENOENT'
          ? new Error(`${command} is not installed or is not on PATH.`)
          : error
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${args[0] ?? ''} failed (exit code ${code}).`));
    });
  });
}

/** Runs a command for its answer, resolving to null when it fails. */
async function read(command, args) {
  try {
    return await run(command, args, { capture: true });
  } catch {
    return null;
  }
}

const git = (...args) => run('git', args);
const readGit = (...args) => read('git', args);
const captureGit = (...args) => run('git', args, { capture: true });

function version() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version;
}

// ---------- asking ----------

/**
 * What an answer to a step prompt means.
 *
 * Anything that is not clearly yes, skip, or quit is treated as none of them,
 * so a mistyped answer asks again rather than shipping something.
 */
function answerToAction(answer) {
  // Only a real empty string is Enter. Anything that is not a string at all is
  // a bug reaching this, and defaulting a release step to yes on a bug is the
  // wrong direction to fail in.
  if (typeof answer !== 'string') return 'unclear';

  const value = answer.trim().toLowerCase();

  if (value === '' || value === 'y' || value === 'yes') return 'run';
  if (value === 's' || value === 'skip' || value === 'n' || value === 'no') return 'skip';
  if (value === 'q' || value === 'quit' || value === 'a' || value === 'abort') return 'quit';
  return 'unclear';
}

class Asker {
  constructor({ yes }) {
    this.yes = yes;
    this.rl = null;
  }

  ask(question) {
    if (this.yes) {
      return Promise.resolve('');
    }
    if (!process.stdin.isTTY) {
      throw new Error('Nothing is attached to answer the prompts. Re-run with --yes.');
    }

    this.rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => this.rl.question(question, (answer) => resolve(answer)));
  }

  /** Asks whether to run a step. Returns 'run', 'skip', or 'quit'. */
  async step(description) {
    if (this.yes) {
      return 'run';
    }

    for (;;) {
      const action = answerToAction(await this.ask(`\n${description}\n  [Y]es / [s]kip / [q]uit: `));
      if (action !== 'unclear') {
        return action;
      }
      console.log('Please answer y, s, or q.');
    }
  }

  /**
   * Closes the prompt, and forgets it.
   *
   * Forgetting is the point: step 1 closes this so `release.js` can own the
   * terminal for its own questions, and every step after that has to be able
   * to ask again. Leaving the closed interface in place made the next
   * question throw "readline was closed" — after the build had succeeded.
   */
  close() {
    this.rl?.close();
    this.rl = null;
  }
}

// ---------- the steps ----------

/** True when the working tree has changes to `file`, or to anything at all. */
async function isDirty(file) {
  const status = await readGit('status', '--porcelain', ...(file ? ['--', file] : []));
  return (status ?? '').trim() !== '';
}

/** Either half of the version pair must be committed before tagging. */
async function packageFilesNeedCommit(check = isDirty) {
  return (await check(PACKAGE_JSON)) || (await check(PACKAGE_LOCK));
}

/**
 * Changes that cannot be residue from an interrupted release.
 *
 * The package files may hold a built-but-uncommitted version bump, while the
 * changelog may hold the upload step's generated section. Anything else would
 * make the Windows artifacts differ from the commit tagged for Mac builders.
 */
async function unexpectedDirtyStatus() {
  return (
    (await readGit(
      'status',
      '--porcelain',
      '--',
      '.',
      ':(exclude)package.json',
      ':(exclude)package-lock.json',
      ':(exclude)CHANGELOG.md'
    )) ?? ''
  ).trim();
}

async function currentBranch() {
  return (await readGit('branch', '--show-current') ?? '').trim();
}

/**
 * The branch releases are cut from, as the remote reports it.
 *
 * Falls back to `main` when there is no `origin/HEAD` to ask, which is the
 * case in a fresh clone that has never run `git remote set-head`.
 */
async function defaultBranch() {
  const ref = (await readGit('symbolic-ref', '--short', 'refs/remotes/origin/HEAD') ?? '').trim();
  return ref.replace(/^origin[/]/, '') || 'main';
}

/** Commit a lightweight or annotated remote tag ultimately resolves to. */
function remoteTagCommit(output, tag) {
  if (typeof output !== 'string' || output.trim() === '') return null;

  const direct = `refs/tags/${tag}`;
  const peeled = `${direct}^{}`;
  const rows = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/, 2));
  return (
    rows.find(([, ref]) => ref === peeled)?.[0] ??
    rows.find(([, ref]) => ref === direct)?.[0] ??
    null
  );
}

function githubRepoFromRemote(remoteUrl) {
  if (typeof remoteUrl !== 'string') return null;
  const value = remoteUrl.trim();
  const match = value.match(
    /^(?:git@github[.]com:|https?:\/\/github[.]com\/|ssh:\/\/git@github[.]com\/)([^/]+\/[^/]+?)(?:[.]git)?$/i
  );
  return match?.[1] ?? null;
}

async function resolvedHead(operations) {
  const head = ((await operations.readGit('rev-parse', 'HEAD')) ?? '').trim();
  if (head === '') throw new Error('Could not resolve the current Git commit.');
  return head;
}

async function localTagCommit(tag, operations) {
  return (
    ((await operations.readGit('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)) ?? '').trim() ||
    null
  );
}

async function readRemoteTagCommit(tag, operations) {
  const output = await operations.captureGit(
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`
  );
  return remoteTagCommit(output, tag);
}

/**
 * Creates the exact release tag and proves origin resolves it to a commit with
 * this version in the current branch's ancestry. Existing tags remain valid
 * after the later changelog commit, but can never be moved or recreated.
 */
async function ensureReleaseTagAtHead(
  { tag, shipping, dryRun = false, would = () => {} },
  operations = { readGit, captureGit, git }
) {
  const head = await resolvedHead(operations);
  let local = await localTagCommit(tag, operations);
  const remote = await readRemoteTagCommit(tag, operations);

  if (local !== null && remote !== null && local !== remote) {
    throw new Error(`${tag} differs locally (${local}) and on origin (${remote}).`);
  }

  if (remote !== null && local === null && !dryRun) {
    const ref = `refs/tags/${tag}`;
    await operations.git('fetch', '--no-tags', 'origin', `${ref}:${ref}`);
    local = await localTagCommit(tag, operations);
    if (local !== remote) {
      throw new Error(`Fetched ${tag}, but it did not resolve to origin's ${remote}.`);
    }
  }

  const canonical = remote ?? local ?? head;
  const packageText = await operations.readGit('show', `${canonical}:package.json`);
  if (packageText === null) {
    throw new Error(`Could not read package.json from release commit ${canonical}.`);
  }
  let taggedVersion;
  try {
    taggedVersion = JSON.parse(packageText).version;
  } catch {
    throw new Error(`package.json at release commit ${canonical} is not valid JSON.`);
  }
  if (taggedVersion !== shipping) {
    throw new Error(
      `${tag} would identify package version ${taggedVersion}, not the built version ${shipping}.`
    );
  }
  if ((await operations.readGit('merge-base', '--is-ancestor', canonical, head)) === null) {
    throw new Error(`${tag} resolves to ${canonical}, which is not an ancestor of HEAD ${head}.`);
  }

  // A completed upload may add one changelog commit after the immutable tag.
  // No executable or dependency source may differ: Windows is built at HEAD,
  // while the native Mac workflow checks out the tag itself.
  if (canonical !== head) {
    const changedSource = await operations.readGit(
      'diff',
      '--name-only',
      `${canonical}..${head}`,
      '--',
      '.',
      ':(exclude)CHANGELOG.md'
    );
    if (changedSource === null) {
      throw new Error(`Could not compare HEAD ${head} with release commit ${canonical}.`);
    }
    if (changedSource.trim() !== '') {
      throw new Error(
        `${tag} is behind application source at HEAD; only CHANGELOG.md may change after the tag:\n${changedSource.trim()}`
      );
    }
  }

  if (remote === null) {
    const ref = `refs/tags/${tag}`;
    if (dryRun) {
      if (local === null) would(`git tag ${tag} ${head}`);
      would(`git push origin ${ref}:${ref}`);
      return canonical;
    }
    if (local === null) {
      await operations.git('tag', '--', tag, head);
    }
    await operations.git('push', 'origin', `${ref}:${ref}`);

    const confirmed = await readRemoteTagCommit(tag, operations);
    if (confirmed !== canonical) {
      throw new Error(`origin did not resolve ${tag} to release commit ${canonical}.`);
    }
  }

  return canonical;
}

/** True when a release for the tag already exists, so it is not created twice. */
async function releaseExists(tag, repo) {
  const args = ['release', 'view', tag, '--json', 'tagName'];
  if (repo) args.push('--repo', repo);
  return (await read('gh', args)) !== null;
}

/**
 * Draft state for an existing release. Null deliberately means unknown or
 * absent: a remote tag still makes that state resumable, which fails safer
 * than bumping twice when GitHub is temporarily unreadable.
 */
async function releaseDraftStatus(tag, repo, readCommand = read) {
  const args = ['release', 'view', tag, '--json', 'isDraft'];
  if (repo) args.push('--repo', repo);
  const raw = await readCommand('gh', args);
  if (raw === null) return null;

  let value;
  try {
    value = JSON.parse(raw).isDraft;
  } catch (error) {
    throw new Error(`Could not read ${tag}'s draft state.`, { cause: error });
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Could not read ${tag}'s draft state.`);
  }
  return value;
}

/** True only for the exact version commit produced by this driver's Step 2. */
async function isReleaseCommitAtHead(shipping, readOperation = readGit) {
  const subject = await readOperation('log', '-1', '--format=%s');
  if (subject === null || subject.trim() !== `chore: release ${shipping}`) {
    return false;
  }

  const names = await readOperation('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD');
  if (names === null) {
    throw new Error('Could not inspect the current release commit.');
  }
  const changed = names
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  return (
    changed.includes('package.json') &&
    changed.every((name) => name === 'package.json' || name === 'package-lock.json')
  );
}

/**
 * Decides whether Step 1 must rebuild the current version instead of applying
 * the requested bump again. Invalid residue is rejected before any build.
 */
function releaseResumeDecision({
  packageDirty,
  changelogDirty,
  tagCommit,
  draftStatus,
  releaseCommit = false
}) {
  if (packageDirty && tagCommit !== null) {
    throw new Error(
      'package.json or package-lock.json is dirty after the current release tag already exists. ' +
        'Reconcile those files without moving the tag before retrying.'
    );
  }
  if (changelogDirty && tagCommit === null && draftStatus !== true) {
    throw new Error(
      'CHANGELOG.md is dirty, but there is no current draft/tag to resume. Commit or restore it first.'
    );
  }
  if (changelogDirty && draftStatus === false) {
    throw new Error(
      'CHANGELOG.md still needs committing for the already-published current release. Commit it before starting another release.'
    );
  }

  if (packageDirty) {
    return { resume: true, reason: 'an uncommitted package version' };
  }
  if (draftStatus === true) {
    return { resume: true, reason: 'the existing draft release' };
  }
  if (tagCommit !== null && draftStatus !== false) {
    return { resume: true, reason: 'the existing unpublished release tag' };
  }
  if (releaseCommit && tagCommit === null && draftStatus === null) {
    return { resume: true, reason: 'the already-pushed version commit' };
  }
  if (changelogDirty) {
    return { resume: true, reason: 'the pending release changelog commit' };
  }
  return { resume: false, reason: null };
}

function effectiveReleaseBump(requestedBump, resume) {
  return resume ? 'none' : requestedBump;
}

/**
 * The body of the release, pointing at this version's changelog entry.
 *
 * Built rather than written, so it names the right version and the right
 * anchor every time. The repository URL comes from the changelog's own link
 * definitions, so a fork links to itself.
 */
function releaseNotes(shipping, branch) {
  let source = '';
  try {
    source = fs.readFileSync(CHANGELOG, 'utf8');
  } catch {
    // No changelog to link to; the note below still stands on its own.
  }

  const repoUrl = repoUrlFromLinks(source);
  const changelog = repoUrl
    ? `[the ${shipping} entry in the changelog](${repoUrl}/blob/${branch}/CHANGELOG.md#${versionAnchor(source, shipping)})`
    : 'CHANGELOG.md';

  return [
    `### What changed`,
    ``,
    `See ${changelog}.`,
    ``,
    `### Verifying your download`,
    ``,
    '`SHA256SUMS.txt` and `SHA256SUMS-macOS.txt` below list the SHA-256 of every native package.'
  ].join('\n');
}

function releaseCreateArgs(tag, shipping, branch, repo) {
  const args = [
    'release',
    'create',
    tag,
    '--draft',
    // Never let GitHub silently create this tag from a newer default-branch
    // tip. ensureReleaseTagAtHead creates and verifies the exact ref first.
    '--verify-tag',
    '--title',
    `Multi-Git v${shipping}`,
    '--notes',
    releaseNotes(shipping, branch)
  ];
  if (repo) args.push('--repo', repo);
  return args;
}

function requiredMacAssetNames(shipping) {
  return [
    RELEASE_ASSETS.macDmgArm64.basename(shipping),
    RELEASE_ASSETS.macZipArm64.basename(shipping),
    RELEASE_ASSETS.macDmgX64.basename(shipping),
    RELEASE_ASSETS.macZipX64.basename(shipping),
    MACOS_CHECKSUM_BASENAME
  ];
}

function requiredReleaseAssetNames(shipping) {
  return [
    RELEASE_ASSETS.installer.basename(shipping),
    RELEASE_ASSETS.portable.basename(shipping),
    CHECKSUM_BASENAME,
    ...requiredMacAssetNames(shipping)
  ];
}

/** Refuses to publish a draft whose complete native asset set is not present. */
async function requireReleaseAssets(tag, shipping, repo) {
  const args = ['release', 'view', tag, '--json', 'assets'];
  if (repo) args.push('--repo', repo);
  const raw = await read('gh', args);
  if (raw === null) {
    throw new Error(`Could not inspect ${tag} before publishing it.`);
  }

  let names;
  try {
    names = new Set((JSON.parse(raw).assets ?? []).map((asset) => asset.name));
  } catch (error) {
    throw new Error(`Could not read ${tag}'s asset list.`, { cause: error });
  }
  const missing = requiredReleaseAssetNames(shipping).filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to publish an incomplete cross-platform release: missing ${missing.join(', ')}.`
    );
  }
}

async function preflight(options) {
  console.log('Checking the repository...\n');

  const branch = await currentBranch();
  const expected = await defaultBranch();

  console.log(`  branch:  ${branch || '(detached)'}`);
  console.log(`  version: ${version()}`);

  const gh = await read('gh', ['auth', 'status']);
  console.log(`  gh:      ${gh === null ? 'not signed in — steps 3 to 6 will fail' : 'signed in'}`);

  if (branch !== expected) {
    throw new Error(
      `Releases must be cut from ${expected}, not ${branch || 'a detached HEAD'}.`
    );
  }

  const unexpected = await unexpectedDirtyStatus();
  if (unexpected !== '') {
    throw new Error(
      `Source changes would make the Windows artifacts differ from the release tag:\n${unexpected}`
    );
  }

  const head = ((await readGit('rev-parse', 'HEAD')) ?? '').trim();
  const remoteOutput = await captureGit('ls-remote', '--heads', 'origin', `refs/heads/${expected}`);
  const remote = remoteOutput.trim().split(/\s+/, 1)[0] || null;
  if (head === '' || remote === null) {
    throw new Error(`Could not resolve HEAD and origin/${expected}. Check Git and network access.`);
  }
  if (head !== remote) {
    throw new Error(
      `Local ${expected} is ${head}, but origin/${expected} is ${remote}. Pull or push before releasing.`
    );
  }

  if (options.repo) {
    const originUrl = await readGit('remote', 'get-url', 'origin');
    const originRepo = githubRepoFromRemote(originUrl);
    if (originRepo === null || originRepo.toLowerCase() !== options.repo.toLowerCase()) {
      throw new Error(
        `--repo ${options.repo} does not match Git origin (${originUrl?.trim() || 'unresolved'}).`
      );
    }
  }

  if (await isDirty()) {
    console.log(
      '\n  Found only resumable release state in package files or CHANGELOG.md.\n' +
        '  No application source changes are present.'
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const asker = new Asker({ yes: options.yes });
  const say = (message) => console.log(`\n${message}`);
  const would = (command) => console.log(`  would run: ${command}`);

  try {
    await preflight(options);

    const beforeBuild = version();
    const beforeBuildTag = releaseTag(beforeBuild);
    const packageDirty = await packageFilesNeedCommit();
    const changelogDirty = await isDirty(CHANGELOG);
    const tagCommit = await readRemoteTagCommit(beforeBuildTag, { captureGit });
    const draftStatus = await releaseDraftStatus(beforeBuildTag, options.repo);
    const releaseCommit = await isReleaseCommitAtHead(beforeBuild);
    const resume = releaseResumeDecision({
      packageDirty,
      changelogDirty,
      tagCommit,
      draftStatus,
      releaseCommit
    });
    const effectiveBump = effectiveReleaseBump(options.bump, resume.resume);
    if (resume.resume) {
      say(
        `Resuming ${beforeBuildTag} from ${resume.reason}; Step 1 will rebuild ${beforeBuild} without bumping again.`
      );
    }

    // 1. Build. release.js owns the version bump, the compile, electron-builder
    //    and the checksums; this only decides whether to start it.
    const bumpArgs = effectiveBump
      ? ['--bump', effectiveBump, '--target', 'both', '--yes']
      : [];
    const buildLabel = resume.resume
      ? `Rebuild the current ${beforeBuild} artifacts without another version bump.`
      : options.bump
        ? `Build the artifacts, bumping the version (${options.bump}).`
        : 'Build the artifacts. You will be asked for the version bump.';

    switch (await asker.step(`Step 1/6 — ${buildLabel}`)) {
      case 'quit':
        return say('Stopped. Nothing was built.');
      case 'skip':
        say('Skipped the build. Using whatever is already in dist/.');
        break;
      default:
        if (options.dryRun) {
          would(`node scripts/release.js ${bumpArgs.join(' ') || '(interactive)'}`);
        } else {
          // Prompts of its own when no bump was given, so the asker steps aside.
          asker.close();
          await run(process.execPath, [path.join(ROOT, 'scripts', 'release.js'), ...bumpArgs]);
        }
    }

    const shipping = version();
    const tag = options.tag ?? releaseTag(shipping);
    const expectedTag = releaseTag(shipping);
    if (tag !== expectedTag) {
      throw new Error(`The built version ${shipping} must use the exact tag ${expectedTag}, not ${tag}.`);
    }
    say(`Shipping ${shipping} as ${tag}.`);

    // 2. Commit the bump. release.js deliberately leaves it uncommitted so the
    //    build can be thrown away; that only works if something commits it later.
    // Whether either package file is dirty, not whether this run changed it: a
    // re-run after a failure has the bump already applied and still uncommitted,
    // and skipping it there would strand exactly the step this exists for.
    if (await packageFilesNeedCommit()) {
      switch (await asker.step(`Step 2/6 — Commit and push the version bump to ${shipping}.`)) {
        case 'quit':
          return say(`Stopped. ${shipping} is built but the bump is uncommitted.`);
        case 'skip':
          return say('Stopped. The version bump must be committed before the release tag is made.');
        default:
          if (options.dryRun) {
            would(`git commit -m "chore: release ${shipping}" && git push`);
          } else {
            await git('add', 'package.json', 'package-lock.json');
            await git('commit', '-m', `chore: release ${shipping}`);
            await git('push');
          }
      }
    } else {
      say('Step 2/6 — Nothing uncommitted in package.json or package-lock.json. Skipping.');
    }

    const unexpectedAfterBuild = await unexpectedDirtyStatus();
    if (unexpectedAfterBuild !== '') {
      throw new Error(
        `The build changed source outside the version/changelog files:\n${unexpectedAfterBuild}`
      );
    }

    // 3. The draft release. A draft first, because names and labels cannot be
    //    changed after publication when immutable releases are enabled.
    if (await releaseExists(tag, options.repo)) {
      await ensureReleaseTagAtHead({ tag, shipping, dryRun: options.dryRun, would });
      say(`Step 3/6 — ${tag} already exists. Skipping.`);
    } else {
      switch (
        await asker.step(`Step 3/6 — Push the exact ${tag} tag and create its draft release.`)
      ) {
        case 'quit':
          return say('Stopped. No release was created.');
        case 'skip':
          say('Skipped. The upload needs a release to exist, so it will fail.');
          break;
        default: {
          const args = releaseCreateArgs(tag, shipping, await defaultBranch(), options.repo);

          if (options.dryRun) {
            await ensureReleaseTagAtHead({ tag, shipping, dryRun: true, would });
            would(`gh ${args.join(' ')}`);
          } else {
            await ensureReleaseTagAtHead({ tag, shipping });
            await run('gh', args);
          }
        }
      }
    }

    // 4. Upload. Also verifies what arrived and closes the changelog.
    const uploadArgs = ['--tag', tag];
    if (options.repo) uploadArgs.push('--repo', options.repo);
    if (!options.changelog) uploadArgs.push('--no-changelog');
    if (options.dryRun) uploadArgs.push('--dry-run');

    const uploadLabel = options.changelog
      ? 'Upload the assets, verify them, and close the changelog.'
      : 'Upload the assets and verify them, leaving the changelog alone.';

    switch (await asker.step(`Step 4/6 — ${uploadLabel}`)) {
      case 'quit':
        return say(`Stopped. ${tag} exists but has no assets.`);
      case 'skip':
        say('Skipped the upload.');
        break;
      default:
        await run(process.execPath, [
          path.join(ROOT, 'scripts', 'upload-release-assets.js'),
          ...uploadArgs
        ]);
    }

    // 5. Commit the changelog the upload just rewrote.
    if (!options.dryRun && (await isDirty(CHANGELOG))) {
      say('CHANGELOG.md was rewritten:');
      await git('--no-pager', 'diff', '--stat', '--', 'CHANGELOG.md');

      switch (await asker.step('Step 5/6 — Commit and push that changelog change.')) {
        case 'quit':
          return say('Stopped. The changelog edit is still in your working tree.');
        case 'skip':
          say('Skipped. The changelog edit is still in your working tree.');
          break;
        default:
          await git('add', 'CHANGELOG.md');
          await git('commit', '-m', `docs: close the changelog for ${shipping}`);
          await git('push');
      }
    } else {
      say('Step 5/6 — No changelog change to commit. Skipping.');
    }

    // 6. Publish. Off unless asked for, because this is the irreversible one:
    //    it is what makes the release public.
    if (!options.publish) {
      say(`Step 6/6 — Leaving ${tag} as a draft. Publish it when you are ready:`);
      console.log(`  gh release edit ${tag} --draft=false`);
    } else {
      switch (await asker.step(`Step 6/6 — Publish ${tag}. This makes the release public.`)) {
        case 'quit':
        case 'skip':
          say(`Left ${tag} as a draft.`);
          break;
        default: {
          const args = ['release', 'edit', tag, '--draft=false'];
          if (options.repo) args.push('--repo', options.repo);

          if (options.dryRun) {
            would(`gh ${args.join(' ')}`);
          } else {
            // The draft must exist before the separate native Mac workflow can
            // attach its packages. Enforce the complete cross-platform set at
            // the irreversible boundary, immediately before publication.
            await ensureReleaseTagAtHead({ tag, shipping });
            await requireReleaseAssets(tag, shipping, options.repo);
            await run('gh', args);
          }
        }
      }
    }

    say(options.dryRun ? 'Dry run finished. Nothing was changed.' : `Done. ${shipping} is out.`);
  } finally {
    asker.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nRelease stopped: ${error.message}`);
    console.error('Nothing after this point ran. Fix it and run the command again;');
    console.error('the steps that already succeeded are detected and skipped.');
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  answerToAction,
  printHelp,
  Asker,
  requiredMacAssetNames,
  requiredReleaseAssetNames,
  remoteTagCommit,
  githubRepoFromRemote,
  releaseCreateArgs,
  ensureReleaseTagAtHead,
  packageFilesNeedCommit,
  releaseDraftStatus,
  isReleaseCommitAtHead,
  releaseResumeDecision,
  effectiveReleaseBump
};
