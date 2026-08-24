# macOS Port Handoff

This is the practical handoff for the person with access to a Mac. The code,
packaging, updater, documentation, and native CI paths are implemented on the
`codex/macos-parity-handoff` branch. What remains is real-machine validation,
fixing anything that only Apple hardware exposes, and opening the pull request.

Do not commit anything from `dist/`, Apple certificates, passwords, API keys,
provisioning data, or `.p8`/`.p12` files. Build output is intentionally ignored
by Git, and release secrets belong in GitHub Actions secrets.

## What has already been implemented

- Finder-safe PATH bootstrapping for Homebrew, MacPorts, and common per-user
  tool locations.
- Native macOS app menus, Dock lifecycle, Command-key labels, and Finder folder
  opening through `public.folder` registration.
- Terminal.app launch support even when Terminal is already running. The
  Terminal-panel repository shell explicitly carries PATH, the SSH-agent socket,
  and `GIT_SSH_COMMAND`; worktree terminals and coding agents carry PATH/socket
  and use the repository's persisted `core.sshCommand` routing.
- Native folder selection and ordinary Launch Services file opening.
- Per-architecture DMG updates verified against `SHA256SUMS-macOS.txt`.
- Apple Silicon (`arm64`) and Intel (`x64`) DMG and portable ZIP packaging.
- Hardened runtime, signing/notarization configuration, native CI packaging,
  release upload automation, and publication guards.
- Cross-platform fixes for Unicode Git paths, case-sensitive paths and remotes,
  shell quoting, process-tree cancellation, recent-repository aliases, and
  Safety Net compatibility.

The Windows handoff validation completed with 1,674 tests passing and 18
platform-specific skips, strict TypeScript checks, production compilation, link
checking, and an unpacked Windows Electron package. The Mac CI jobs execute the
POSIX/macOS-specific coverage and package both CPU architectures.

## 1. Get the handoff branch

If you have write access to the main repository:

```bash
git clone git@github.com:AnthonyKopri/multi-git.git
cd multi-git
git fetch origin
git switch --track origin/codex/macos-parity-handoff
```

In an existing clone:

```bash
git fetch origin
git switch codex/macos-parity-handoff || \
  git switch --track origin/codex/macos-parity-handoff
git pull --ff-only
```

If you do not have write access, fork the repository, add the original as
`upstream`, and branch from the handoff commit:

```bash
gh repo fork AnthonyKopri/multi-git --clone
cd multi-git
git remote add upstream git@github.com:AnthonyKopri/multi-git.git 2>/dev/null || true
git fetch upstream
git switch -c macos-parity-handoff upstream/codex/macos-parity-handoff
git push -u origin macos-parity-handoff
```

Confirm that the checkout is correct and clean before testing:

```bash
git branch --show-current
git status --short
git log -1 --oneline
```

## 2. Record the Mac being used

Include this output in the pull request. It makes architecture-specific failures
diagnosable later:

```bash
uname -m
sw_vers
sysctl -n machdep.cpu.brand_string 2>/dev/null || true
```

Expected `uname -m` values:

- `arm64`: Apple Silicon (M1 or newer).
- `x86_64`: Intel Mac.

Use the physical Mac for its native architecture. GitHub Actions builds and
checks the other architecture on a native hosted runner, but that does not
replace Finder, Terminal, Gatekeeper, SSH, or GUI testing on the other CPU. In
the PR, explicitly record the other architecture as physically untested. An
Apple Silicon run under Rosetta is useful extra coverage, but is not a real
Intel-Mac test.

## 3. Install prerequisites

Install Apple's command-line tools if they are missing:

```bash
xcode-select -p || xcode-select --install
```

The project requires Node.js 22.12 or newer, npm, Git, OpenSSH, and GitHub CLI
for the handoff/PR/Actions commands:

```bash
node --version
npm --version
git --version
ssh -V
gh --version
gh auth status
```

Node 22 LTS or Node 24 is recommended. It may come from the official Node
installer, Homebrew, Volta, or another normal version manager. The application
must also be tested once when launched from Finder, because Finder does not
inherit the same PATH as an interactive shell.

Install the exact locked dependencies and run the baseline checks:

```bash
npm ci
npm test
npm run compile
npm run lint:links
```

Do not continue from a failing baseline. Save the complete failing command and
output in an issue or commit message, then fix the cause and add a regression
test where practical.

## 4. Validate everything that works from source

```bash
npm run desktop
```

The source run is for application behavior, Git operations, Terminal/agent
launches, and native menus. Finder registration, Gatekeeper, installed-app PATH
recovery, DMG/ZIP behavior, and the real updater target require a packaged app;
test those in section 5 instead. A source run correctly reports updates as
unsupported because it has no DMG or ZIP installation target.

Use a disposable repository containing at least:

- a filename with spaces;
- a Unicode filename such as `café.txt` or `资料.txt`;
- staged, unstaged, untracked, renamed, and conflicted files;
- one HTTPS remote and, if available, one SSH remote;
- a worktree.

Walk through this checklist and record pass/fail notes in the pull request:

### Application lifecycle and native UI

- The app starts without a blank window or backend error.
- The application, Edit, View, and Window menus are present in the macOS menu
  bar. Copy/paste, undo/redo, Services, Hide, Minimize, and Command+Q work.
- Closing the last window keeps the app available in the Dock. Clicking its Dock
  icon opens a repository window again. Command+Q quits it fully.
- Shortcut hints use macOS symbols. In particular, Command+Option shortcuts work
  even when Option changes the typed character, and Command+R refreshes.
- Window restoration works after quit/relaunch, including after disconnecting a
  second display if one is available.

### Picker and files

- The native repository folder picker opens and accepts a Git repository.
- Setup does not show Git Bash as a missing Mac prerequisite. If Git is missing,
  its install action opens the macOS Git page rather than the Windows page.
- Opening an image or PDF from the repository uses its normal macOS application,
  not a forced text editor.
- Unicode filenames render exactly and can be staged, diffed, discarded,
  restored from Safety Net, renamed, and opened.

### Terminal, agents, Git, and SSH

- Assign an SSH profile to the test repository and confirm
  `git config --local --get core.sshCommand` names it. Start Terminal.app, then
  click the **Terminal** button in Multi-Git's Terminal panel. It opens a new
  window in the selected repository even though Terminal is already running.
  Check `pwd`, `printenv SSH_AUTH_SOCK`, `printenv GIT_SSH_COMMAND`, and
  `git ls-remote` there.
- Open a worktree-row terminal too. It should have the correct `pwd` and
  `SSH_AUTH_SOCK`; Git routing comes from that worktree's `core.sshCommand`, so
  `GIT_SSH_COMMAND` does not have to be present in this second window.
- A configured interactive agent opens visibly in Terminal.app and receives its
  prompt. Test a path containing a space and, if possible, an apostrophe.
- Repository SSH identity selection persists. Fetch/push uses the selected key,
  and a new Terminal.app window receives `SSH_AUTH_SOCK` and the repository's
  `GIT_SSH_COMMAND` routing.
- If available, sign and verify a commit and tag with Homebrew GPG and its normal
  pinentry. Also exercise an authenticated HTTPS remote using
  `credential-osxkeychain`; neither flow should hang behind the app.
- Cancelling a long Git command ends its child process tree and does not leave an
  `ssh`, credential helper, or Git process running.
- Case-distinct remote names such as `origin` and `Origin` remain distinct.
- After normal Terminal and agent launches, this should not list newly stranded
  prompt-bearing bridge directories (failed deliveries are removed after a
  bounded fallback period):

  ```bash
  find "${TMPDIR:-/tmp}" -maxdepth 1 -type d \
    -name 'multi-git-terminal-*' -print
  ```

### Regression surface

- Create/switch/delete branches and worktrees.
- Stage/unstage/discard individual files and a batch of files.
- Commit, amend, stash, apply/pop a stash, fetch, pull, and push.
- Open the history, diff, blame, conflicts, remotes, submodules, maintenance,
  settings, and command palette. The navbar update control stays hidden in a
  source build; if **Check now** is used in Settings, it clearly says an
  installed packaged build is required instead of silently doing nothing.
- Confirm existing Windows-oriented options are hidden or relabelled where they
  do not apply, without removing the corresponding Windows behavior.

## 5. Build an unsigned local DMG and portable ZIP

This is the normal handoff build. It needs no Apple developer account and only
builds the Mac's native CPU architecture:

```bash
set -euo pipefail
case "$(uname -m)" in
  arm64)
    CSC_IDENTITY_AUTO_DISCOVERY=false \
      npm run build-mac:arm64 -- --config.mac.notarize=false
    ;;
  x86_64)
    CSC_IDENTITY_AUTO_DISCOVERY=false \
      npm run build-mac:x64 -- --config.mac.notarize=false
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac
```

This produces both:

```text
dist/Multi-Git-Client-macOS-<version>-<arch>.dmg
dist/Multi-Git-Client-macOS-<version>-<arch>.zip
```

The ZIP is the portable/manual package. The DMG is the ordinary
drag-to-Applications package. Neither local artifact should be committed.

Verify their structure:

```bash
set -euo pipefail
VERSION=$(node -p "require('./package.json').version")
case "$(uname -m)" in
  arm64)
    ARCH=arm64
    MACH_ARCH=arm64
    APP='dist/mac-arm64/Multi-Git Client.app'
    ;;
  x86_64)
    ARCH=x64
    MACH_ARCH=x86_64
    APP='dist/mac/Multi-Git Client.app'
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac
DMG="dist/Multi-Git-Client-macOS-${VERSION}-${ARCH}.dmg"
ZIP="dist/Multi-Git-Client-macOS-${VERSION}-${ARCH}.zip"

test -s "$DMG"
test -s "$ZIP"
test -d "$APP"
hdiutil verify "$DMG"
unzip -t "$ZIP"
lipo -archs "$APP/Contents/MacOS/Multi-Git Client" | \
  grep -Eq "(^| )${MACH_ARCH}( |$)"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c \
  'Print :CFBundleDocumentTypes:0:LSItemContentTypes:0' \
  "$APP/Contents/Info.plist"
npx --no-install asar list "$APP/Contents/Resources/app.asar" | \
  grep 'out/node/main/main.js'
```

Expected metadata:

- Mach-O architecture is `arm64` on Apple Silicon or `x86_64` on Intel. The
  package filename deliberately uses Electron Builder's `arm64`/`x64` tokens;
- bundle identifier is `com.multigit.client`;
- folder content type is `public.folder`;
- the asar contains `out/node/main/main.js`.

Launch the unpacked app, then separately open the DMG and copy the app into
Applications. Actually extract and run the portable ZIP too:

```bash
open "$APP"
open "$DMG"

# Quit every running Multi-Git Client instance before testing this separate copy.
PORTABLE_DIR=$(mktemp -d)
ditto -x -k "$ZIP" "$PORTABLE_DIR"
test -d "$PORTABLE_DIR/Multi-Git Client.app"
open -W "$PORTABLE_DIR/Multi-Git Client.app"
rm -rf -- "$PORTABLE_DIR"
```

Now validate the installed/package-only behavior that was intentionally skipped
in section 4:

- Copy the DMG app into `/Applications`, launch it from Finder rather than a
  terminal, and confirm Homebrew/MacPorts Git plus configured tools are found.
- Confirm `gh` and configured editors/agents are detected after that Finder
  launch. If a tool was installed through nvm, fnm, asdf, or mise, record
  whether it is found; those version-manager PATHs vary by user and may need a
  follow-up fix.
- This opens the selected repository, including a path containing spaces,
  Unicode, and an apostrophe:

  ```bash
  open -a "Multi-Git Client" "/absolute/path/to/a/repository"
  ```

- Repeat that command once with the app cold and once while it is already
  running. It should focus/open the repository once, not duplicate it.
- Finder's **Open With → Multi-Git Client** is offered for folders. Opening a
  non-repository folder must not replace the current repository; note in the PR
  if the rejection does not give useful visible feedback.
- The packaged update control is visible, can check the public feed, and
  internally selects the matching-architecture DMG. The ZIP remains the manual
  portable fallback and is not an automatic-update target.
- The unsigned local build may trigger Gatekeeper warnings. Do not weaken or
  globally disable Gatekeeper to get around them.

An intentionally unsigned build can produce a Gatekeeper warning when moved
between machines. Do not globally disable Gatekeeper. Use unsigned output only
for this controlled test; public releases should be signed and notarized.

## 6. Commit fixes and open the pull request

After every fix, rerun at least the focused test plus the full checks:

```bash
npm test
npm run compile
npm run lint:links
git diff --check
```

If you have write access, commit and push back to the handoff branch:

```bash
git add -A
git status --short
git diff --cached --stat
git diff --cached
git diff --cached --check
git commit -m "fix: finish native macOS validation"
git push origin codex/macos-parity-handoff
```

Stop before committing if the staged diff contains a certificate, `.p8`,
`.p12`, provisioning profile, password, token, build output, or unrelated local
file. The common Apple secret formats are ignored by this branch, but the staged
diff is the final authority. Never force-add a signing file.

Then open the PR:

```bash
gh pr create \
  --base main \
  --head codex/macos-parity-handoff \
  --title "feat: add native macOS parity" \
  --web
```

From a fork, push your `macos-parity-handoff` branch and open a PR against
`AnthonyKopri/multi-git:main` in the GitHub UI or with `gh pr create --repo`.

The PR description should include:

- Mac model, macOS version, and `uname -m` output;
- full automated test result;
- local DMG/ZIP filenames and architecture checks;
- the manual checklist with pass/fail notes;
- fixes made after physical-Mac testing;
- anything not tested, especially real SSH hardware/keychain behavior;
- screenshots only where they help explain a native UI problem.

## 7. Download both Mac architectures from GitHub Actions

Windows cannot reliably create or validate a Mac `.app`, DMG, code signature,
notarization ticket, Finder association, or Gatekeeper behavior. Do not try to
turn a Windows cross-package into the release artifact.

Every push to `main` or the upstream `codex/macos-parity-handoff` branch, every
pull request, and every manual CI dispatch runs native `macos-15` Apple Silicon
and `macos-15-intel` packaging jobs. A fork normally gets its upstream run when
the pull request is opened. When the jobs pass, CI retains two unsigned
artifacts for 14 days:

- `macos-smoke-arm64`
- `macos-smoke-x64`

Download them from **GitHub → Actions → CI → the run → Artifacts**, or from any
machine with GitHub CLI:

```bash
gh run list -R AnthonyKopri/multi-git \
  --workflow CI \
  --branch <the-branch-that-triggered-the-run>
gh run watch <run-id> -R AnthonyKopri/multi-git --exit-status
gh run download <run-id> -R AnthonyKopri/multi-git \
  -n macos-smoke-arm64 -D macos-builds/arm64
gh run download <run-id> -R AnthonyKopri/multi-git \
  -n macos-smoke-x64 -D macos-builds/x64
```

These CI packages solve the “I only have Windows” build problem for testing and
manual sharing. They are deliberately unsigned and should not be presented as a
normal public release.

## 8. Produce the real signed release after merge

The release workflow is the production build machine. It creates both native
architectures, signs with hardened runtime, notarizes through Apple, validates
the tickets, builds DMG and ZIP packages, writes `SHA256SUMS-macOS.txt`, and
attaches everything to an existing draft GitHub release.

Configure the protected `macos-release` environment, its environment-scoped
secrets, and the immutable `Release_v*` tag ruleset described in `BUILDING.md`.
Do not leave copies of Apple secrets at repository scope. Never send those
secrets to another person or place them in shell history. Then:

1. Merge the tested PR into `main`.
2. On Windows, switch to a clean, fully pulled `main`, then run the documented
   Windows release flow without publishing. Its preflight fails on source
   changes or a local/remote mismatch; it builds the Windows packages, commits
   the version, non-force-pushes the exact tag, creates the draft with
   `--verify-tag`, and writes `SHA256SUMS.txt`.
3. In **GitHub → Actions → macOS release packages → Run workflow**, select
   **Use workflow from: main** and enter the exact tag
   `Release_v<package-version>`. The release owner approves the protected
   environment when GitHub asks; the Mac tester does not need the credentials.
4. Leave `allow_unsigned` off for a public release. The workflow validates that
   the exact tag points to a commit on `main`, pins all builds to that commit,
   and fails closed if signing or notarization credentials are missing. Turning
   `allow_unsigned` on creates separate `macos-unsigned-*` Actions artifacts
   for testing and completely skips the release-writing job.
5. Wait for both native jobs and the upload job. The draft should then contain:

   ```text
   Multi-Git-Client-macOS-<version>-arm64.dmg
   Multi-Git-Client-macOS-<version>-arm64.zip
   Multi-Git-Client-macOS-<version>-x64.dmg
   Multi-Git-Client-macOS-<version>-x64.zip
   SHA256SUMS-macOS.txt
   ```

6. Inspect the authenticated draft before publication. Confirm that it is still
   a draft and that both Windows artifacts, all four Mac artifacts, and both
   checksum manifests are present:

   ```bash
   gh release view Release_v<version> -R AnthonyKopri/multi-git \
     --json isDraft,assets \
     --jq '{isDraft, assets: [.assets[].name]}'
   ```

7. Authentically download the native DMG, ZIP, and checksum manifest from the
   draft. Verify the bytes, both packaged app copies, Apple signature,
   Gatekeeper assessment, and stapled ticket before publication:

   ```bash
   set -euo pipefail
   VERSION=$(node -p "require('./package.json').version")
   TAG="Release_v${VERSION}"
   case "$(uname -m)" in
     arm64) ARCH=arm64 ;;
     x86_64) ARCH=x64 ;;
     *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
   esac
   SMOKE_DIR=$(mktemp -d)
   gh release download "$TAG" -R AnthonyKopri/multi-git \
     --pattern "*-${ARCH}.dmg" \
     --pattern "*-${ARCH}.zip" \
     --pattern 'SHA256SUMS-macOS.txt' \
     --dir "$SMOKE_DIR"

   DMG="$SMOKE_DIR/Multi-Git-Client-macOS-${VERSION}-${ARCH}.dmg"
   ZIP="$SMOKE_DIR/Multi-Git-Client-macOS-${VERSION}-${ARCH}.zip"
   (
     cd "$SMOKE_DIR"
     grep -F "  $(basename "$DMG")" SHA256SUMS-macOS.txt | shasum -a 256 -c -
     grep -F "  $(basename "$ZIP")" SHA256SUMS-macOS.txt | shasum -a 256 -c -
   )

   MOUNT_DIR="$SMOKE_DIR/dmg"
   ZIP_DIR="$SMOKE_DIR/zip"
   mkdir "$MOUNT_DIR" "$ZIP_DIR"
   hdiutil attach "$DMG" -readonly -nobrowse -mountpoint "$MOUNT_DIR"
   ditto -x -k "$ZIP" "$ZIP_DIR"
   for CANDIDATE in \
     "$MOUNT_DIR/Multi-Git Client.app" \
     "$ZIP_DIR/Multi-Git Client.app"
   do
     codesign --verify --deep --strict --verbose=2 "$CANDIDATE"
     spctl --assess --type execute --verbose=2 "$CANDIDATE"
     xcrun stapler validate "$CANDIDATE"
   done
   ```

   Drag-install from the DMG, launch from Finder, repeat the section 5 Finder
   and Terminal checks, then detach with `hdiutil detach "$MOUNT_DIR"`. If a
   previous public version exists, keep a copy installed for the post-publish
   updater check; a draft is intentionally invisible to its public update API.
8. Publish only after the authenticated draft inspection and physical-Mac smoke
   test pass. Re-run the ship command, skipping the already-completed
   build/upload prompts. Its publish boundary refuses to proceed while any
   Windows or Mac package/checksum asset is missing:

   ```bash
   npm run release:ship -- --tag Release_v<version> --publish
   ```

9. Immediately after publication, verify exactly what an unauthenticated
   installed app can see:

   ```bash
   npm run release:verify -- --tag Release_v<version>
   ```

   This verifier deliberately uses the public releases API, so it only works
   after publication; draft releases are invisible to the same API used by the
   in-app updater.
10. Download the published DMG in Safari or another browser so macOS applies its
    normal quarantine metadata. Confirm Gatekeeper accepts the drag-installed
    app without a bypass. Then launch the previously installed public version,
    check for updates, download the new native package, verify its checksum is
    accepted, and confirm the DMG opens. If no prior release exists, record the
    updater end-to-end case as not applicable and retain the public-feed and
    browser-download results.

No Mac build has to be transferred through Git or rebuilt on the Windows PC.
GitHub Actions produces and attaches it; the Windows owner can download, retain,
or publish those artifacts from GitHub after the Mac owner has validated them.
