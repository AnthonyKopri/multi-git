# Building And Releasing Multi-Git

How to run the project from source, check it, and produce the two Windows
artifacts: the **NSIS installer** and the **portable executable**.

For contribution rules and coding conventions see [CONTRIBUTING.md](CONTRIBUTING.md).
For what the app does see [README.md](README.md).

## Contents

- [Prerequisites](#prerequisites)
- [First-time setup](#first-time-setup)
- [Running from source](#running-from-source)
- [Checks](#checks)
- [Releasing a new version](#releasing-a-new-version)
- [Build targets in detail](#build-targets-in-detail)
- [Build output](#build-output)
- [Troubleshooting builds](#troubleshooting-builds)

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22.12 or newer | `node --version`; also the floor in `package.json` `engines` |
| npm | ships with Node | `npm --version` |
| Git | any recent release | must be on `PATH`; the app shells out to it |
| OpenSSH | `ssh`, `ssh-add`, and `ssh-keygen` on `PATH` | needed at runtime, not to build |
| Windows | 10 or 11 | required to build the Windows artifacts |

Building the Windows targets on macOS or Linux is not supported by this
project's configuration. Develop anywhere; cut releases on Windows.

The GitHub CLI (`gh`) is optional. It is used at runtime by the new-repository
dialog and the pull-request creator, and by `npm run release:upload`. Local
builds and checksum generation do not need it.

## First-time setup

```bash
npm install
```

This installs Express (the only runtime dependency) plus Electron and
Electron Builder as dev dependencies.

`npm install` does **not** unpack the Electron runtime. The `electron` package
has no postinstall script; it exposes the download as an explicit
`install-electron` bin instead. `npm run desktop` detects the missing runtime
and fetches it (a large download, so the first run takes noticeably longer),
and you can also run it yourself:

```bash
npx install-electron
```

Packaging does not need it. Electron Builder downloads its own runtime through
its own cache, so `npm run build-win` and `npm run release` work on a checkout
that has never run `install-electron`.

## Running from source

Two ways to run, depending on what you are working on.

Browser mode — fastest loop for UI and API work. Starts the local server on
port 3000 and opens your browser:

```bash
npm run dev
```

Desktop mode — runs the real Electron shell, which is what ships. Use this
whenever you touch `main.js`, `preload.js`, window behaviour, or the native
folder picker:

```bash
npm run desktop
```

The desktop shell asks the OS for a free port instead of using 3000, so both
can run at the same time.

## Checks

`npm test` type-checks every TypeScript source and runs the Vitest suite:

```bash
npm test
```

It verifies that:

- every TypeScript source passes `tsc --noEmit` under `strict`, and every
  remaining JavaScript file still parses;
- the Git output parsers, path containment, argument guards, and vault
  encryption behave as specified;
- every license and `.gitignore` template in the catalogue can be read and
  rendered, and that declared placeholders are actually substituted;
- every element id the client looks up exists in `public/index.html`;
- `package.json` `build.files` still lists everything the packaged app needs,
  and the version is a valid semantic version.

Run it before every release. Vitest reports every failure rather than stopping
at the first one.

To type-check without running the suite, use `npm run typecheck`.

Renderer tests run against the real `public/index.html` in a `happy-dom`
environment, declared per file with a `// @vitest-environment happy-dom`
comment. A renamed element id therefore fails the suite rather than only
failing in the app. Everything else runs in the default Node environment.

Nothing in the suite needs a GitHub account, an SSH agent, a loaded key, or a
network connection: `gh`, `ssh-add` and `ssh-keygen` are all reached through the
injectable runner in `src/server/process/runner.ts`, and the tests script them.

`npm run lint:links` checks that every relative link and heading anchor in the
project's Markdown resolves. External URLs are not fetched, so it never fails
because a third-party site was briefly down.

CI runs both, plus a packaging smoke test, on every pull request. See
[.github/workflows/ci.yml](.github/workflows/ci.yml). The matrix covers Windows
and Linux on Node 22.12 and Node 24 — Windows because the published artifacts
are Windows-only and because process-tree termination, case-folded repository
paths, and file replacement all behave differently there.

Beyond that, verification is manual. The paths worth walking before a release:

1. Open a repository; inspect split and unified diffs; stage, unstage, and
   discard a hunk or selected lines; commit; and check the History panel.
2. Selectively stash part of a tracked file, inspect the stash, and restore it
   with its staged/unstaged split.
3. Switch SSH profiles, unlock a protected key, confirm the native-agent status,
   and verify fetch, pull, and push use the right identity.
4. Open the pull-request creator on a disposable branch and verify its target,
   commit range, template, push state, and optional fields before creating one.
5. Create a repository through **New Repo** with a license and a `.gitignore`,
   including the **Custom** option, which must open your default editor.
6. Clone a repository over SSH.
7. Run an interactive rebase, trigger a conflict, resolve it, and inspect the
   recovery point created before the rewrite.
8. Create a worktree, open it in another window, and fetch a repository group.
9. Exercise each Repository hub tab; verify missing `gh` or Git LFS tools are
   reported as unavailable rather than as empty data.
10. Restore a tracked change from **Safety Net** and create a recovery branch
    from a reflog entry.

## Releasing a new version

`npm run release` bumps the version, builds, and writes SHA-256 checksums,
asking about both:

```bash
npm run release
```

It works locally only. Nothing is uploaded, no GitHub token is needed, and the
version bump is left uncommitted for you to review. If compilation, packaging,
or checksum generation fails, the bump is rolled back so a failed release does
not leave the project renamed.

```text
Current version: 1.0.5
  1) patch  -> 1.0.6
  2) minor  -> 1.1.0
  3) major  -> 2.0.0
  4) custom version
  5) keep the current version
Version [1]:

What should be built?
  1) Installer only (NSIS .exe setup)
  2) Portable only (single .exe)
  3) Installer and portable
Target [3]:
```

The version is written to both `package.json` and `package-lock.json`. After a
successful build, `dist/SHA256SUMS.txt` is replaced atomically with checksums
for exactly the target or targets built by that invocation. Stale executables
in `dist/` are never included. The bump is **not** committed or tagged — review
the artifacts first, then commit and tag yourself:

```bash
git commit -am "chore: release v1.0.6"
```

```bash
git tag Release_v1.0.6
```

### Skipping the prompts

Every prompt has a flag, so the same script works in CI or a one-liner:

```bash
node scripts/release.js --bump patch --target both --yes
```

To rebuild the already-versioned release without accidentally incrementing it,
pass `none` explicitly. A non-interactive invocation with no flags defaults to
a patch bump:

```bash
node scripts/release.js --bump none --target both
```

| Flag | Values | Default when omitted |
| --- | --- | --- |
| `--bump` | `patch`, `minor`, `major`, `x.y.z`, `none` | prompt, or `patch` with `--yes` |
| `--target` | `installer`, `portable`, `both` | prompt, or `both` with `--yes` |
| `--yes`, `-y` | — | prompts are shown |
| `--dry-run` | — | writes files and builds |
| `--help`, `-h` | — | — |

Shortcuts for a single artifact, which still prompt for the version:

```bash
npm run release:installer
```

```bash
npm run release:portable
```

To see what a release would do without touching anything:

```bash
node scripts/release.js --bump minor --target both --dry-run
```

To rebuild without changing the version:

```bash
node scripts/release.js --bump none --target both
```

### The whole release in one command

```bash
npm run release:ship
```

Runs the six steps below in order, stopping before each one to ask
`[Y]es / [s]kip / [q]uit`:

1. build the artifacts and checksums (`scripts/release.js`)
2. commit and push the version bump
3. create the GitHub release as a draft
4. upload the assets, verify them, and close the changelog
5. commit and push the changelog
6. publish the draft — only with `--publish`

Nothing here replaces the individual commands; each step spawns the documented
one and passes its output straight through, so running them by hand still works
exactly as described below.

A step that is already done is detected and skipped — a version already
committed, a release that already exists, a changelog with nothing to move — so
this is safe to re-run after a step fails partway through.

| Flag | Effect |
| --- | --- |
| `--bump <spec>` | `patch`, `minor`, `major`, `x.y.z`, or `none`. Omitted, the build asks. |
| `--tag <tag>` | Release tag. Defaults to `Release_v<version>`. |
| `--repo`, `-R` | GitHub repository in `OWNER/REPO` form. |
| `--publish` | Publish the draft at the end. Off by default: publishing is the irreversible step. |
| `--yes`, `-y` | Do not ask; run every step. |
| `--dry-run` | Print what each step would run and change nothing. |

To see the whole thing without touching anything:

```bash
npm run release:ship -- --dry-run --yes
```

### Uploading the assets and applying GitHub labels

Create the GitHub release as a draft first, then upload the already-built
artifacts with:

```bash
npm run release:upload
```

The default tag is `Release_v<package version>`. To select it explicitly:

```bash
npm run release:upload -- --tag Release_v3.0.0
```

This command regenerates `SHA256SUMS.txt` from the exact files it is about to
upload, then runs `gh release upload` with these display labels:

- `Windows installer (recommended)`
- `Portable Windows executable`
- `SHA-256 checksums`

The upload command requires both executables, an existing release, and an
authenticated GitHub CLI. It always uploads the installer, portable build, and
their shared checksum file together, so the manifest always describes the full
binary set and split uploads cannot collide on it. It does not use `--clobber`,
so it will not delete an existing asset to replace it. Upload to a draft before
publishing when immutable releases are enabled; names and labels cannot be
changed after publication in that mode.

Use `--dry-run` to print the exact `gh` command without writing or uploading:

```bash
npm run release:upload -- --tag Release_v3.0.0 --dry-run
```

### Checking what reached the release

After uploading, the command reads the release back and prints each asset with
the size GitHub reports, next to the size of the file on disk.

This exists because GitHub's own release editor is misleading here: assets
uploaded through the API or the CLI are shown on the **Edit release** page as
*"Upload failed. Delete and try uploading this file again"*, no matter how
completely they uploaded. Following that advice deletes a working download. The
API's view of the release is the truth, and that is what this prints.

If an asset is missing or short, the command says which one and leaves
`CHANGELOG.md` alone — a changelog saying a version shipped is wrong if its
assets did not arrive. If the release cannot be read back at all, that is
reported and nothing fails: the upload has already succeeded by then.

### Closing the Unreleased section

After a successful upload, the command rewrites `CHANGELOG.md`:

- everything under `## [Unreleased]` moves under a new `## [<version>] - <date>`
  heading, so entries end up beneath the release that shipped them;
- `[<version>]` gains a compare link from the previous release's tag to this
  one, because a version with no link definition renders as literal brackets;
- `[Unreleased]` is re-based onto the new tag, so it compares against the
  release that just shipped rather than an older one.

The guidance comment stays under `## [Unreleased]`, ready for the next release.
The repository URL is read from the link definitions already in the file, so a
fork gets its own links without editing anything here.

The edit is left in the working tree; nothing is committed for you. Review it
and commit it with the release.

This runs after `gh release upload` succeeds, never before — a changelog saying
a version shipped is wrong if its assets never reached the release. It is also
safe to re-run: a version that already has a section, or an Unreleased section
with nothing in it, is reported and left alone rather than duplicated. A failure
here is a warning, not a failed release, since the release is already public by
then.

`--dry-run` reports what it would do. Pass `--no-changelog` to skip the step:

```bash
npm run release:upload -- --no-changelog
```

## Build targets in detail

`npm run release` is a wrapper. These call Electron Builder directly and never
touch the version.

### Installer (NSIS)

```bash
npx electron-builder --win nsis
```

Produces `dist/Multi-Git-Client-Setup-<version>.exe`. Configured in
`package.json` under `build.nsis`:

- `artifactName` gives the local file and GitHub asset one stable name;
- `oneClick: false` — a real wizard rather than a silent install;
- `allowToChangeInstallationDirectory: true` — the user picks the location.

### Portable

```bash
npx electron-builder --win portable
```

Produces `dist/Multi-Git-Client-Portable-<version>.exe`: a single executable
that unpacks to a temporary folder at launch and needs no installation. User
data still lives in the home directory, so a portable copy shares configuration
and the vault with an installed one.

### Both at once

```bash
npm run build-win
```

### Portable into a separate folder

```bash
npm run build-standalone
```

Same portable target, written to `dist-standalone/` instead of `dist/` so it
does not collide with an installer build.

### After-pack step

`scripts/after-pack.js` runs automatically after packaging. It stamps the
Windows executable icon and metadata with `rcedit`, because
`win.signAndEditExecutable` is `false` in the Electron Builder config. If you
change the icon, product name, description, or version, check the resulting
`.exe` properties.

## Build output

Both artifacts land in `dist/` (or `dist-standalone/` for that one script).
The release driver also writes `dist/SHA256SUMS.txt`; direct
`electron-builder`, `npm run build-win`, and `npm run build-standalone` calls do
not. The checksum file is ordinary UTF-8 text without a BOM. Each line contains
a lowercase SHA-256 digest, two spaces, and the exact artifact basename.
`dist/`, `dist-standalone/`, `out/`, `release/`, and `*.blockmap` are all in
`.gitignore` — build output is never committed.

There is no special checksum container: `SHA256SUMS.txt` is a plain-text file
that is uploaded beside the binaries. A Windows user can calculate a download's
value with PowerShell and compare it with the matching line:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\Multi-Git-Client-Setup-3.0.0.exe
```

Expect a few hundred megabytes per build. Delete the folder between releases
if disk space is tight:

```bash
rm -rf dist dist-standalone
```

## Troubleshooting builds

### `electron-builder is not installed`

`npm run release` says this when dev dependencies are missing, usually after an
`npm install --omit=dev` or `npm ci --omit=dev`. Reinstall with dev
dependencies:

```bash
npm install
```

### The Electron download fails or stalls

Electron Builder caches downloads in `%LOCALAPPDATA%\electron-builder\Cache`.
A partial download there survives and keeps failing. Delete the cache folder
and rerun the build.

### The build fails on a locked file

An installed or running copy of Multi-Git, an open Explorer window on `dist/`,
or a virus scanner can hold the output files. Close the app and any Explorer
window on the output folder, then rerun.

### A new source file is missing from the packaged app

The packaged app only contains what `build.files` in `package.json` lists.
Compiled TypeScript is covered by the `out/**/*` entry, so a new module under
`src/` needs no change. Add new top-level modules and asset folders there.
`npm test` fails when a known-required entry is missing, but it cannot guess
at files you add later.

Run `npm run compile` before packaging by hand; every `build*` and `release`
script already does it.

### `Application entry file "out\node\main\main.js" ... was not found in this archive`

Nothing was compiled before packaging, so electron-builder produced an asar
with no entry point. `out/` is gitignored, so a fresh clone or a checkout in a
different working tree has none of it, and the failure looks like a corrupt
archive rather than a missing build step.

Every packaging path compiles first, so this should not happen. If it does,
run `npm run compile` and check that `out/node/main/main.js` exists before
packaging again.

### Version numbers disagree

If `package.json` and `package-lock.json` drift apart, set both from one place:

```bash
node scripts/release.js --bump 1.0.6 --target both --dry-run
```

That prints the intended version without writing. Drop `--dry-run` to apply it
to both files and build.
