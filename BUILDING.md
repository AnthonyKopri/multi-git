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
| Node.js | 18 or newer | `node --version` |
| npm | ships with Node | `npm --version` |
| Git | any recent release | must be on `PATH`; the app shells out to it |
| OpenSSH | `ssh` and `ssh-keygen` on `PATH` | needed at runtime, not to build |
| Windows | 10 or 11 | required to build the Windows artifacts |

Building the Windows targets on macOS or Linux is not supported by this
project's configuration. Develop anywhere; cut releases on Windows.

The GitHub CLI (`gh`) is optional. It is only used at runtime, by the new
repository dialog, to create a remote repository. Nothing in the build needs it.

## First-time setup

```bash
npm install
```

This installs Express (the only runtime dependency) plus Electron and
Electron Builder as dev dependencies. The Electron download is large, so the
first install takes noticeably longer than later ones.

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

Beyond that, verification is manual. The paths worth walking before a release:

1. Open a repository, stage a file, commit, and check the History panel.
2. Switch SSH profiles and confirm fetch, pull, and push use the right key.
3. Create a repository through **New Repo** with a license and a `.gitignore`,
   including the **Custom** option, which must open your default editor.
4. Clone a repository over SSH.
5. Trigger a merge conflict and resolve it in the conflict editor.
6. Undo something from **Safety Net**.

## Releasing a new version

`npm run release` bumps the version and builds, asking about both:

```bash
npm run release
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

The version is written to both `package.json` and `package-lock.json`. The
bump is **not** committed or tagged — review the artifacts first, then commit
and tag yourself:

```bash
git commit -am "chore: release v1.0.6"
```

```bash
git tag v1.0.6
```

### Skipping the prompts

Every prompt has a flag, so the same script works in CI or a one-liner:

```bash
node scripts/release.js --bump patch --target both --yes
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

## Build targets in detail

`npm run release` is a wrapper. These call Electron Builder directly and never
touch the version.

### Installer (NSIS)

```bash
npx electron-builder --win nsis
```

Produces `dist/Multi-Git Client Setup <version>.exe`. Configured in
`package.json` under `build.nsis`:

- `oneClick: false` — a real wizard rather than a silent install;
- `allowToChangeInstallationDirectory: true` — the user picks the location.

### Portable

```bash
npx electron-builder --win portable
```

Produces `dist/Multi-Git Client <version>.exe`: a single executable that
unpacks to a temporary folder at launch and needs no installation. User data
still lives in the home directory, so a portable copy shares configuration and
the vault with an installed one.

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
change the icon or product name, check the resulting `.exe` properties.

## Build output

Both artifacts land in `dist/` (or `dist-standalone/` for that one script).
`dist/`, `dist-standalone/`, `out/`, `release/`, and `*.blockmap` are all in
`.gitignore` — build output is never committed.

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
