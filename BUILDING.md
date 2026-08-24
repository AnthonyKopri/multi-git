# Building And Releasing Multi-Git

How to run the project from source, check it, and produce native packages for
Windows and macOS: an **NSIS installer**, **portable executable**, and
architecture-specific macOS **DMG** and **portable ZIP**.

For contribution rules and coding conventions see [CONTRIBUTING.md](CONTRIBUTING.md).
For what the app does see [README.md](README.md).
For the owner of a Mac validating this port see [docs/MACOS_HANDOFF.md](docs/MACOS_HANDOFF.md).

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
| macOS | 15 on Apple Silicon or Intel | required to build, sign, and notarize macOS artifacts |

Build each target on its native operating system. The macOS CI matrix uses
`macos-15` for arm64 and `macos-15-intel` for x64; cross-packaging does not
replace a native test. Windows builds still run on Windows. Develop anywhere,
but assemble releases from the two native workflows.

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
its own cache, so `npm run build-win`, `npm run build-mac`, and `npm run release` work on a checkout
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
[.github/workflows/ci.yml](.github/workflows/ci.yml). The matrix covers Windows,
Linux, Apple Silicon macOS, and Intel macOS on Node 22.12 and Node 24. Separate
packaging jobs inspect the Windows executable and both native Mac app bundles,
including their CPU architecture, bundle identifier, asar entry point, DMG,
and ZIP.

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

`npm run release` bumps the version, builds native artifacts, and writes the
platform's SHA-256 manifest. On Windows it asks which Windows artifacts to
build; on macOS its default is the current runner architecture:

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

What should be built? (Windows example)
  1) Windows installer only (NSIS .exe setup)
  2) Portable Windows executable only
  3) Windows installer and portable executable
Target [3]:
```

The version is written to both `package.json` and `package-lock.json`. After a
successful Windows build, `dist/SHA256SUMS.txt` is replaced atomically. A Mac
build writes `dist/SHA256SUMS-macOS.txt`. Each contains exactly the artifacts
built by that invocation; stale packages in `dist/` are never included. The bump
is **not** committed or tagged — review
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
| `--target` | `installer`, `portable`, `both`, `mac-arm64`, `mac-x64` | prompt, or the current platform's native set with `--yes` |
| `--yes`, `-y` | — | accepts defaults without prompting |
| `--dry-run` | — | prints the plan without writing or building |
| `--help`, `-h` | — | — |

Shortcuts for a single artifact, which still prompt for the version:

```bash
npm run release:installer
```

```bash
npm run release:portable
```

Native Mac shortcuts build both the DMG and ZIP for the named CPU. The release
driver refuses to build them on the other architecture, so a cross-package is
not mistaken for a native verification:

```bash
npm run release:mac:arm64
npm run release:mac:x64
```

To see what a release would do without touching anything:

```bash
node scripts/release.js --bump minor --target both --dry-run
```

To rebuild without changing the version:

```bash
node scripts/release.js --bump none --target both
```

### The Windows half of a release in one command

```bash
npm run release:ship
```

Runs the six Windows steps below in order, stopping before each one to ask
`[Y]es / [s]kip / [q]uit`:

1. build the artifacts and checksums (`scripts/release.js`)
2. commit and push the version bump
3. create and non-force-push the exact `Release_v<version>` tag, then create the
   GitHub release as a draft with `--verify-tag` and notes linking this version's
   changelog entry
4. upload the assets, verify them, and close the changelog
5. commit and push the changelog
6. publish the draft — only with `--publish`

For a cross-platform release, leave the release as a draft after step 5, run
the **macOS release packages** workflow for that tag, and only publish after it
has attached both architectures. The workflow is the release path for Mac
because signing and notarization require native Apple runners and credentials.

Nothing here replaces the individual commands; each step spawns the documented
one and passes its output straight through, so running them by hand still works
exactly as described below.

The check before step 1 fails unless the checkout is the default branch at the
exact commit currently on `origin`, with no source changes. It permits only the
package/changelog residue produced by an interrupted release. Step 3 verifies
that existing local and remote tags agree, that the tagged package version is
correct, and that the tag is in the current branch's ancestry. GitHub is never
allowed to invent the tag from a newer default-branch tip, so the Windows and
Mac packages are built from the same immutable commit.

A step that is already done is detected and skipped — a version already
committed, a release that already exists, a changelog with nothing to move — so
this is safe to re-run after a step fails partway through. In particular, an
uncommitted package bump, the exact package-only commit made by step 2, or an
unpublished current tag/draft forces the rebuild to use `--bump none`, even
when the original command used `--bump patch --yes`. Existing tags may be
followed only by the generated `CHANGELOG.md` commit; any other source change
stops the release because Windows and Mac would otherwise build different code.

| Flag | Effect |
| --- | --- |
| `--bump <spec>` | `patch`, `minor`, `major`, `x.y.z`, or `none`. Omitted, the build asks. |
| `--tag <tag>` | Explicit release tag; it must equal `Release_v<version>`. |
| `--repo`, `-R` | GitHub repository in `OWNER/REPO` form. |
| `--publish` | Publish the draft at the end. Off by default: publishing is the irreversible step. |
| `--no-changelog` | Upload without closing the Unreleased section. Passed through to the upload step. |
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

The default target is the Windows upload path. The native workflow calls the
same guarded command with `--target macos`. Windows and Mac use separate
checksum files, so neither native build rewrites a manifest created on the
other operating system.

### Building, signing, and uploading macOS packages

Create the draft release with the Windows flow, then run the
**macOS release packages** workflow (`.github/workflows/release-macos.yml`) with
its exact `Release_v<version>` tag. It proves that the tag matches the package
version and points to a commit on `main`, pins later jobs to that commit, and
builds on both native standard runners:

- `macos-15` produces `arm64` DMG and ZIP packages;
- `macos-15-intel` produces `x64` DMG and ZIP packages.

The upload job downloads both runner outputs, creates
`SHA256SUMS-macOS.txt` over the four exact packages, and attaches the set to the
existing draft. It refuses to modify a published release and never uses
`--clobber`.

Before the first signed release, create a protected GitHub Environment named
`macos-release`:

1. Allow deployments only from `main` and require approval from the repository
   owner (or another release owner).
2. Put the secrets below in that environment, not in repository-wide Actions
   secrets. Delete any repository-wide copies with the same values. Otherwise a
   manually dispatched workflow from another in-repository branch could read
   signing material before this workflow's own validation runs.
3. Keep the repository's default Actions token permission read-only. The
   workflow grants `contents: write` only to its approved final upload job.
4. Add an active tag ruleset for `Release_v*` that prevents tag updates and
   deletions after creation. This keeps the commit validated/built by Actions
   attached to the same tag at publication time.

The `macos-release` environment needs these secrets:

| Secret | Purpose |
| --- | --- |
| `MACOS_CSC_LINK` | Base64 PKCS#12 Developer ID Application certificate |
| `MACOS_CSC_KEY_PASSWORD` | Certificate password |
| `MACOS_APPLE_API_KEY_BASE64` | Base64 App Store Connect `.p8` key |
| `MACOS_APPLE_API_KEY_ID` | App Store Connect key ID |
| `MACOS_APPLE_API_ISSUER` | App Store Connect issuer UUID |

As an alternative to the three API-key secrets, configure
`MACOS_APPLE_ID`, `MACOS_APPLE_APP_SPECIFIC_PASSWORD`, and
`MACOS_APPLE_TEAM_ID`. Electron Builder signs with hardened runtime and the
minimum Electron JIT entitlements, submits the app for notarization, and
staples the app bundle before it is placed in the DMG and ZIP. The workflow
verifies `codesign`, Gatekeeper (`spctl`), and that ticket before upload.

The workflow fails closed when credentials are absent. For a test-only build,
dispatch it with **allow_unsigned** explicitly enabled. That choice creates
separate `macos-unsigned-arm64` and `macos-unsigned-x64` Actions artifacts and
skips the release upload job completely. Gatekeeper will warn users; those files
must never be attached to the public release.

To build locally on a Mac without touching the version, use the runner's native
architecture:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false \
  npm run build-mac:arm64 -- --config.mac.notarize=false
# or, on an Intel Mac
CSC_IDENTITY_AUTO_DISCOVERY=false \
  npm run build-mac:x64 -- --config.mac.notarize=false
```

`npm run build-mac:portable -- --config.mac.notarize=false` with
`CSC_IDENTITY_AUTO_DISCOVERY=false` produces only the native unsigned ZIP. It
is useful when a signing account is unavailable, and is the supported portable
fallback rather than a Windows-built pseudo-Mac package.

### Verifying the release is discoverable

After publishing, check that an installed copy will actually find it:

```bash
npm run release:verify
```

This queries the same GitHub API the in-app updater does and applies the same
filters, then reports each check individually. Run it every time. The things
that hide a release from the updater — a mistyped or miscased tag, a tag whose
version disagrees with `package.json`, a release left as a draft or ticked as a
pre-release, a missing artifact or checksum file — all fail *silently*: nothing
errors, the release is simply invisible, and nobody updates. This is the only
step that catches that.

It exits non-zero when the release would not be offered, so it can gate a
release script. To check a specific release:

```bash
npm run release:verify -- --tag Release_v3.0.0
```

The verifier requires both native platforms. When either local checksum
manifest is still present, it also compares published digests against it,
which catches artifacts rebuilt between generation and upload.

The Windows upload command requires both executables, an existing release, and
an authenticated, current GitHub CLI. It always verifies the installer,
portable build, and their shared checksum file as one set. A retry reads the
existing asset inventory, skips only assets whose name, byte size, and
GitHub-reported SHA-256 all match, and uploads only missing files. It never uses
`--clobber`; a different or unavailable digest fails closed and requires a
deliberate human inspection. Upload to a draft before publishing when immutable
releases are enabled; names and labels cannot be changed after publication.

Use `--dry-run` to print the exact `gh` command without writing or uploading:

```bash
npm run release:upload -- --tag Release_v3.0.0 --dry-run
```

### Checking what reached the release

After uploading, the command reads the release back and verifies each asset's
GitHub-reported byte size and SHA-256 against the local file.

This exists because GitHub's own release editor is misleading here: assets
uploaded through the API or the CLI are shown on the **Edit release** page as
*"Upload failed. Delete and try uploading this file again"*, no matter how
completely they uploaded. Following that advice deletes a working download. The
API's view of the release is the truth, and that is what this prints.

If an asset is missing, short, different, or cannot be read back, the command
fails and leaves `CHANGELOG.md` alone. A retry is safe: exact existing content
is skipped, missing content is uploaded, and ambiguous content is never
overwritten automatically.

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

### Windows portable executable

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

### macOS DMG and portable ZIP

```bash
npm run build-mac
```

On Apple Silicon this produces:

- `dist/Multi-Git-Client-macOS-<version>-arm64.dmg` — the normal
  drag-to-Applications distribution;
- `dist/Multi-Git-Client-macOS-<version>-arm64.zip` — the portable/manual
  fallback.

An Intel host produces the same names with `x64`. The `${arch}` segment is
load-bearing: the updater chooses the DMG matching `process.arch` and never
guesses. The ZIP is published for manual use but the in-app update opens the
verified DMG.

Electron Builder reads `docs/images/multi-git-logo.png` for the app icon and
`packaging/entitlements.mac*.plist` for hardened helper processes. The PNG is a
1024×1024 transparent conversion of the existing Windows logo; the two platform
icons therefore remain the same mark in their native formats.

`mac.extendInfo.CFBundleDocumentTypes` registers `public.folder` with the
`Viewer` role and `Alternate` rank. That is the Info.plist half of Finder's
**Open With** support; the main process queues Electron's `open-file` event and
validates that the selected folder is actually a Git repository. To test the
same path from Terminal:

```bash
open -a "Multi-Git Client" /path/to/repository
```

### After-pack step

`scripts/after-pack.js` runs automatically after packaging. On Windows it stamps
the executable icon and metadata with `rcedit`, because
`win.signAndEditExecutable` is `false` in the Electron Builder config. If you
change the icon, product name, description, or version, check the resulting
`.exe` properties. The hook is a deliberate no-op on macOS; Electron Builder
owns the signed bundle metadata there.

## Build output

Native artifacts land in `dist/` (or `dist-standalone/` for the one Windows
script). The release driver writes `dist/SHA256SUMS.txt` for Windows or
`dist/SHA256SUMS-macOS.txt` for Mac; direct `electron-builder` and `build-*`
calls do not. Each checksum file is ordinary UTF-8 text without a BOM. Each line
contains a lowercase SHA-256 digest, two spaces, and the exact artifact basename.
`dist/`, `dist-standalone/`, `out/`, `release/`, and `*.blockmap` are all in
`.gitignore` — build output is never committed.

There is no special checksum container: both manifests are plain text uploaded
beside the packages. A Windows user can calculate a download's
value with PowerShell and compare it with the matching line:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\Multi-Git-Client-Setup-3.0.0.exe
```

The macOS equivalent is:

```bash
shasum -a 256 Multi-Git-Client-macOS-3.0.0-arm64.dmg
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

Electron Builder caches downloads in `%LOCALAPPDATA%\electron-builder\Cache`
on Windows and `~/Library/Caches/electron-builder` on macOS. A partial download
there survives and keeps failing. Delete only the affected cache entry and
rerun the build.

### The build fails on a locked file

An installed or running copy of Multi-Git, an open Explorer window on `dist/`,
or a virus scanner can hold the output files. Close the app and any Explorer
window on the output folder, then rerun.

### A macOS release is unsigned or not notarized

Pull-request packaging is unsigned by design. The public release path is not:
it fails unless the certificate plus one complete notarization credential set
is present. An **allow_unsigned** dispatch remains an Actions artifact and
cannot reach the draft-release upload job. Check a signed result on macOS with:

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Multi-Git Client.app"
spctl --assess --type execute --verbose=2 "dist/mac-arm64/Multi-Git Client.app"
xcrun stapler validate "dist/mac-arm64/Multi-Git Client.app"
```

Real Gatekeeper, drag-to-Applications, Keychain, SSH-agent, and Finder behavior
still need a physical or virtual Mac for final manual QA; a Windows host cannot
meaningfully simulate them. The two native CI runners cover compilation,
packaging, architecture, metadata, signing, and notarization.

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
