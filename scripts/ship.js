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

const { releaseTag } = require('./release-assets');
const { spawnSpec } = require('./command-path');

const ROOT = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
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
  3. create the GitHub release as a draft
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

/** True when a release for the tag already exists, so it is not created twice. */
async function releaseExists(tag, repo) {
  const args = ['release', 'view', tag, '--json', 'tagName'];
  if (repo) args.push('--repo', repo);
  return (await read('gh', args)) !== null;
}

async function preflight() {
  console.log('Checking the repository...\n');

  const branch = await currentBranch();
  const expected = await defaultBranch();

  console.log(`  branch:  ${branch || '(detached)'}`);
  console.log(`  version: ${version()}`);

  const gh = await read('gh', ['auth', 'status']);
  console.log(`  gh:      ${gh === null ? 'not signed in — steps 3 to 6 will fail' : 'signed in'}`);

  // A release cut from the wrong branch builds the wrong code and tags it as
  // the real thing. Worth saying loudly, and worth saying before the build
  // rather than after twenty minutes of electron-builder.
  if (branch !== expected) {
    console.log(
      `
  This is not ${expected}, which is where releases are cut from.
` +
        `  Building here would package whatever ${branch || 'this detached HEAD'} contains,
` +
        `  and steps 2 and 5 would push it there. Switch to ${expected} unless you
` +
        '  mean to release from here.'
    );
  }

  if (await isDirty()) {
    console.log(
      '\n  Uncommitted changes are present. The build bumps package.json and the\n' +
        '  upload rewrites CHANGELOG.md, and both are easier to review from a clean\n' +
        '  tree. Commit or stash first if you can.'
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
    await preflight();

    // 1. Build. release.js owns the version bump, the compile, electron-builder
    //    and the checksums; this only decides whether to start it.
    const bumpArgs = options.bump ? ['--bump', options.bump, '--target', 'both', '--yes'] : [];
    const buildLabel = options.bump
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
    say(`Shipping ${shipping} as ${tag}.`);

    // 2. Commit the bump. release.js deliberately leaves it uncommitted so the
    //    build can be thrown away; that only works if something commits it later.
    // Whether package.json is dirty, not whether this run is what changed it: a
    // re-run after a failure has the bump already applied and still uncommitted,
    // and skipping it there would strand exactly the step this exists for.
    if (await isDirty(PACKAGE_JSON)) {
      switch (await asker.step(`Step 2/6 — Commit and push the version bump to ${shipping}.`)) {
        case 'quit':
          return say(`Stopped. ${shipping} is built but the bump is uncommitted.`);
        case 'skip':
          say('Skipped. Remember to commit package.json yourself.');
          break;
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
      say(`Step 2/6 — Nothing uncommitted in package.json. Skipping.`);
    }

    // 3. The draft release. A draft first, because names and labels cannot be
    //    changed after publication when immutable releases are enabled.
    if (await releaseExists(tag, options.repo)) {
      say(`Step 3/6 — ${tag} already exists. Skipping.`);
    } else {
      switch (await asker.step(`Step 3/6 — Create the GitHub release ${tag} as a draft.`)) {
        case 'quit':
          return say('Stopped. No release was created.');
        case 'skip':
          say('Skipped. The upload needs a release to exist, so it will fail.');
          break;
        default: {
          const args = ['release', 'create', tag, '--draft', '--title', tag, '--notes', 'See CHANGELOG.md'];
          if (options.repo) args.push('--repo', options.repo);

          if (options.dryRun) {
            would(`gh ${args.join(' ')}`);
          } else {
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

module.exports = { parseArgs, answerToAction, printHelp, Asker };
