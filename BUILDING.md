# Building And Releasing Multi-Git

How to run the project from source, check it, and release it: the **NSIS
installer** and the **portable executable** for Windows, and the **macOS disk
image**, all built and published by GitHub Actions.

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
| Windows | 10 or 11 | required to build the Windows artifacts locally |

Building the Windows targets on macOS or Linux is not supported by this
project's configuration, and the macOS disk image can only be built on a Mac.
Develop anywhere: releases are built on GitHub Actions, one runner per
platform — see [Releasing a new version](#releasing-a-new-version).

The GitHub CLI (`gh`) is optional. It is used at runtime by the new-repository
dialog and the pull-request creator, and to start a release from the command
line. Local builds and checksum generation do not need it.

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

Releases are built and published by GitHub Actions, in
[`.github/workflows/release.yml`](.github/workflows/release.yml). Nothing is
built on your machine and nothing is uploaded from it, so a release does not
depend on which computer it was cut from, and the macOS build — which can only
be made on a Mac — comes out of the same run as the Windows ones.

A release is two steps.

**1. Prepare the version**, on a branch:

```bash
npm run release:prepare -- --bump minor
```

That bumps `package.json` and `package-lock.json`, and moves the Unreleased
entries in `CHANGELOG.md` under a heading for the new version. Commit both and
merge them to `main` through a pull request. `--bump` takes `patch`, `minor`,
`major`, or an explicit `x.y.z`; `--dry-run` says what would change.

**2. Run the Release workflow** on `main`, from **Actions → Release → Run
workflow**, or:

```bash
gh workflow run release.yml
```

It releases whatever version `package.json` on `main` carries:

1. **plan** reads the version, and stops if that version is already released
   or its tag already points somewhere else;
2. **wait for CI** waits for CI on the same commit to pass — so running this
   straight after the merge is fine — and stops if it fails;
3. **build (Windows)** and **build (macOS)** run meanwhile, each on its own
   runner, and each checks what it built (below);
4. **publish** creates the release as a draft, titled `Multi-Git v<version>`
   on a `Release_v<version>` tag, attaches every build and `SHA256SUMS.txt`,
   reads the release back to confirm each asset arrived at full size, publishes
   it, and checks that an installed copy would be offered it.

The draft stage is not something to act on: it is how every file is in place
before the release is public, and before its tag exists. A version whose number
has a prerelease suffix (`5.0.0-beta.1`) is released as a GitHub prerelease,
which the updater never offers.

| Input | Effect |
| --- | --- |
| **draft** | Stop at the draft, with every build attached, so the notes can be edited before you publish it yourself. Works from any branch. |
| **dry run** | Build and assemble everything, attaching the builds, the checksums and the notes to the run as artifacts, and create no release. Works from any branch, and does not wait for CI. |

The workflow also runs as a dry run on every pull request that changes the
packaging or the release scripts, so a build that no longer works shows up
there instead of on release day.

If a run fails, fix the cause and re-run its failed jobs. A draft left behind by
an earlier run is reused: pointed at the new commit, its assets replaced, its
notes kept.

### What each build checks

The Windows build confirms the installer and the portable executable both
exist under the names the upload and the updater look for, and that the
executable they wrap carries the product name, description and version.

The macOS disk image is universal: one download for Apple silicon and Intel
Macs. The build mounts it and checks the bundle's version, both architectures,
that `app.asar` holds the app's entry point, and the code signature, then
launches the app and fails if it exits or cannot boot.

### What goes into the release notes

The notes are written from the changelog rather than linking to it: the entries
under this version become the `What's new`, `What's fixed` and similar
sections, followed by the downloads, named from the same table the upload uses,
and a footer linking the full changelog and the comparison against the previous
release. Wrapped changelog prose is unwrapped, since GitHub renders every line
break in a release body.

They are a starting point. Edit them on the release afterwards, or tick
**draft** to edit them before it is published. To see them first:

```bash
npm run release:notes
```

`--intro <file>` and `--verification <file>` add an opening paragraph and a
Verification section, for a release whose notes are written by hand.

### Signing and notarization

The Windows builds are not code-signed, and Windows may show a SmartScreen
warning for them.

Without an Apple Developer ID, the macOS app is ad-hoc signed. That is enough
for it to run, but not for Gatekeeper: a Mac that downloads it says Apple could
not verify it, and will not open it until the user chooses **Open Anyway** under
**System Settings → Privacy & Security**. Say so in the release notes while
that is the case.

With an Apple Developer Program membership, the macOS build signs and
notarizes instead, once these repository secrets exist:

| Secret | What it is |
| --- | --- |
| `MACOS_CERTIFICATE` | The *Developer ID Application* certificate and key, exported as `.p12` and base64-encoded |
| `MACOS_CERTIFICATE_PASSWORD` | The password the `.p12` was exported with |
| `APPLE_ID` | The Apple ID of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | The ten-character team ID |

The certificate alone signs without notarizing, and the build warns about it:
Gatekeeper still blocks a build that is signed but not notarized.

### Verifying the release is discoverable

The workflow's last step runs this, and it can be run by hand at any time:

```bash
npm run release:verify
```

It queries the same GitHub API the in-app updater does and applies the same
filters, then reports each check individually. The things that hide a release
from the updater — a mistyped or miscased tag, a tag whose version disagrees
with `package.json`, a release left as a draft or ticked as a pre-release, a
missing artifact or checksum file — all fail *silently*: nothing errors, the
release is simply invisible, and nobody updates. This is what catches that.

It exits non-zero when the release would not be offered. A missing build for a
platform the updater does not serve, such as macOS, is reported as a warning
instead: every installed copy still finds the release. To check a specific one:

```bash
npm run release:verify -- --tag Release_v3.0.0
```

When `dist/SHA256SUMS.txt` is present, it also compares the published checksums
against it, which catches artifacts rebuilt between generating the manifest and
uploading it. With `GH_TOKEN` set it asks with that token, which avoids the
anonymous rate limit of 60 requests an hour.

### Checking what reached the release

The upload step reads the release back and prints each asset with the size
GitHub reports, next to the size of the file it uploaded, and fails when one is
missing or short.

This exists because GitHub's own release editor is misleading here: assets
uploaded through the API or the CLI are shown on the **Edit release** page as
*"Upload failed. Delete and try uploading this file again"*, no matter how
completely they uploaded. Following that advice deletes a working download. The
API's view of the release is the truth, and that is what this prints.

### Building locally

`npm run release` builds the Windows artifacts on this machine, to try them
before releasing. It bumps the version, builds, and writes SHA-256 checksums,
asking about both:

```bash
npm run release
```

It works locally only. Nothing is uploaded, no GitHub token is needed, and the
version bump is left uncommitted. If compilation, packaging, or checksum
generation fails, the bump is rolled back. To build without changing the
version, which is what trying a change usually wants:

```bash
node scripts/release.js --bump none --target both
```

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
in `dist/` are never included.

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

A macOS build cannot be made this way. For one to try, run the Release workflow
with **dry run** ticked and download `build-macos` from the run.

### Uploading by hand

The workflow uploads with this command, and it is the fallback for attaching
builds to an existing release yourself:

```bash
npm run release:upload -- --tag Release_v3.0.0
```

It needs every build of the release in `dist/` — both Windows executables and
the macOS disk image, which a dry run's artifacts provide — and stops before
writing anything if one is missing. It regenerates `SHA256SUMS.txt` from exactly
the files it is about to upload, so the manifest always describes the full set,
then runs `gh release upload` with these display labels:

- `Windows installer (recommended)`
- `Portable Windows executable`
- `macOS disk image (Apple silicon and Intel)`
- `SHA-256 checksums`

It will not replace an asset that is already on the release unless given
`--clobber`, and refuses `--clobber` on anything but a draft: a published
download may already have been checked against its checksum. `--dry-run` prints
the exact `gh` command and names any build that is missing.

After a verified upload it also closes the Unreleased section of
`CHANGELOG.md`, for a release that was not prepared with
`npm run release:prepare`; `--no-changelog` leaves the file alone. A version
that already has a section is left alone either way.

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

### macOS disk image

On a Mac only:

```bash
npx electron-builder --mac
```

Produces `dist/Multi-Git-Client-macOS-<version>.dmg`, a universal build for
Apple silicon and Intel. Configured in `package.json` under `build.mac` and
`build.dmg`. Its icon is `docs/images/multi-git_icon.svg`, rasterized by
Electron Builder; the Windows `.ico` is 256px, below the 512px an `.icns`
needs. Without a signing certificate in the keychain, add `-c.mac.identity=-`
for the ad-hoc signature the Release workflow uses.

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

On a Mac, in Terminal:

```bash
shasum -a 256 Multi-Git-Client-macOS-3.0.0.dmg
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
