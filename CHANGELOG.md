# Changelog

All notable changes to Multi-Git Client are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!--
Add changes here under the headings Added, Changed, Deprecated, Removed, Fixed,
or Security. Remove empty headings when preparing a release.
-->

## [3.2.0] - 2026-08-21

### Added

- Check GitHub Releases for a newer version on packaged Windows builds, and
  offer to install it. The download is verified against the release's
  `SHA256SUMS.txt` before anything is put in place, and a file that does not
  match is discarded without ever being run. An installer build runs the new
  installer silently and quits; a portable build is placed beside the running
  executable. A release can be skipped, which suppresses it until a higher one
  appears. This is the only request the app makes that you did not ask for, so
  it can be turned off.
- An **Auto-pull** toggle in the toolbar. When it is on, a fetch that leaves the
  current branch purely behind fast-forwards it automatically. It is off by
  default and never merges or rebases: local commits, a dirty tree, a detached
  HEAD, or an operation in progress all hold it back, and the chip says which.
- `npm run release:ship` runs the whole release — build, commit the bump, create
  the draft, upload and verify, close the changelog, optionally publish —
  stopping before each step to ask. A step that is already done is skipped, so
  it is safe to re-run after one fails.
- `npm run release:upload` now reads the release back after uploading and
  reports each asset's size against the local file. GitHub's release editor
  shows CLI-uploaded assets as "Upload failed" however completely they
  uploaded, and deleting them on that advice breaks a working download.
- `npm run release:upload` now closes the Unreleased section: its entries move
  under a heading for the version just released, that version gains a compare
  link, and `[Unreleased]` is re-based onto the new tag. The edit is left in the
  working tree to review, `--dry-run` reports what it would do, and
  `--no-changelog` skips it.

### Fixed

- Find command-line tools on Windows the way Windows does. `gh` is not a file
  there — it is `gh.exe`, or a `gh.cmd` shim if it came from scoop or npm — and
  spawning it by bare name failed on the shim, outright since the fix for
  CVE-2024-27980. The release scripts now resolve through `PATH` and `PATHEXT`
  and run a batch shim through `cmd.exe` with each argument escaped, rather than
  turning on a shell and letting cmd re-parse every path and label.
- Use the OpenSSH build that can actually reach the agent. Windows ships two
  installs that do not share one: the System32 build talks to the OpenSSH
  Authentication Agent service over a named pipe, while the MSYS build inside
  Git for Windows looks for a Unix socket and sees no agent at all. Which one a
  bare `ssh` found was decided by PATH order, so a key loaded into the agent
  could still be asked for its passphrase on every push. Both `ssh` and
  `ssh-add` are now named explicitly.

## [3.1.3] - 2026-08-20

### Changed

- The New Repository wizard makes its initial commit only when "Create it on
  GitHub" is ticked. The commit exists so the first push has something to send,
  so a repository staying local no longer gets one and its files are left for
  the Staging Area to review.

### Removed

- The unused `POST /api/git/init` endpoint. Nothing called it, and it still
  created repositories the old way — on `master`, with no commit — so it was a
  second copy of a bug that has been fixed everywhere else.

### Fixed

- Refresh origin after a remote is added, renamed, removed, or pruned from the
  Remotes tab. Adding an origin by hand left the Publish button and the
  SSH/HTTPS chip showing the state from before until the next full refresh.

## [3.1.2] - 2026-08-20

### Added

- Show the Push button as **Publish** for a branch that has no upstream yet, so
  the push that creates a branch on the remote is visibly a different action
  from the ones after it.

### Fixed

- Make a repository created by the New Repository wizard pushable straight
  away. It now starts on `main`, commits the folder's contents, and pushes to
  the new GitHub remote, instead of leaving an unborn branch that `git push`
  rejects with "src refspec main does not match any".
- Stop new repositories being created on `master`: the Git for Windows
  installer sets `init.defaultBranch` in its system configuration, which is not
  a choice the user made, so only a global setting is honoured now.

## [3.1.1] - 2026-08-11

### Added

- Check GitHub for a newer stable release on packaged Windows builds, announce
  it once, and leave a toolbar icon that reopens the notice. Betas and
  prereleases are excluded by the release tag format itself.
- Download and install an update from inside the app. The installer build
  reinstalls silently and relaunches; the portable build saves the new
  executable beside the running one and opens it, leaving the old file in
  place. Every download is verified against the release's published SHA-256
  checksum before anything is run, and a mismatch is discarded.
- Add the `settings.checkForUpdates` configuration option to turn the update
  check off, and `settings.skippedUpdateVersion` to record a skipped release.
- Add `npm run release:verify`, which checks a published GitHub release against
  the same filters the updater applies and reports why it would be invisible.
  The mistakes that hide a release — a mistyped tag, a tag that disagrees with
  `package.json`, a draft or pre-release flag, a missing artifact or checksum
  file — otherwise fail silently.

### Fixed

- Avoid unnecessary Git LFS hooks when a repository does not use LFS.

## [3.1.0] - 2026-08-11

### Added

- Show repository-level Git LFS installation state and allow redundant local
  LFS configuration to be removed safely.
- Add a single action to load all configured SSH profile keys into the native
  SSH agent.
- Automate release artifact naming, SHA-256 checksum generation, and GitHub
  release uploads.
- Add a visual product overview to the README.

### Changed

- Explicit fetch, pull, and push operations prompt again for locked SSH keys
  and can fall back to per-command SSH routing when the native agent is not
  available.

### Fixed

- Detect passphrase-protected SSH keys before invoking `ssh-add`, preventing
  an inaccessible background prompt from appearing to hang the application.
- Improve Git LFS test coverage and command-argument assertions.

## [3.0.0] - 2026-08-10

### Added

- Add SSH-agent management, GitHub pull-request creation, precision staging,
  selective stashing, richer diffs, interactive rebase, and commit signing.
- Add repository search, branch maintenance, durable recovery, worktrees,
  multi-window groups, and coding-agent launchers.
- Add repository-wide tools for remotes, submodules, LFS, patches, bisect, and
  notes, along with external-tool definitions and Explorer integration.

### Changed

- Add cancellable operations, responsive panes, Unicode repository-path
  support, configuration migrations, and cross-platform continuous
  integration.

## [2.2.1] - 2026-08-04

### Changed

- Migrate the application to TypeScript with modular server and renderer code.
- Harden process execution and path handling, update dependencies, and improve
  SSH and vault user interfaces.

### Fixed

- Correct build and packaging issues.

## [1.0.6] - 2026-07-31

### Added

- Add the new-repository wizard, first-run SSH setup, and release tooling.

## [1.0.5] - 2026-07-11

### Added

- Add one-click ignore and confirmed file discard.

## [1.0.4] - 2026-07-10

### Changed

- Streamline SSH key and vault setup.

### Fixed

- Correct user-interface and executable-icon issues.

## [1.0.3] - 2026-07-10

### Added

- Add a pop-out terminal log, SSH/HTTPS origin switching, SSH configuration
  synchronization, and a commit-history graph.

### Changed

- Redesign the application user interface and experience.

### Fixed

- Correct assorted user-interface issues.

## [1.0.2] - 2026-07-08

### Changed

- Simplify remote synchronization controls.

## [1.0.1] - 2026-07-07

### Changed

- Make staging rows directly toggle staged state.

## [1.0.0] - 2026-07-07

### Added

- Initial release.

[Unreleased]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.2.0...HEAD
[3.2.0]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.1.3...Release_v3.2.0
[3.1.3]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.1.2...Release_v3.1.3
[3.1.2]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.1.1...Release_v3.1.2
[3.1.1]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.1.0...Release_v3.1.1
[3.1.0]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.0.0...Release_v3.1.0
[3.0.0]: https://github.com/AnthonyKopri/multi-git/compare/Release_v2.2.1...Release_v3.0.0
[2.2.1]: https://github.com/AnthonyKopri/multi-git/compare/Release_v1.0.6...Release_v2.2.1
[1.0.6]: https://github.com/AnthonyKopri/multi-git/compare/Release_v1.0.5...Release_v1.0.6
[1.0.5]: https://github.com/AnthonyKopri/multi-git/compare/Release_v1.0.4...Release_v1.0.5
[1.0.4]: https://github.com/AnthonyKopri/multi-git/compare/Release_v1.0.3...Release_v1.0.4
[1.0.3]: https://github.com/AnthonyKopri/multi-git/compare/Release_v1.0.2...Release_v1.0.3
[1.0.2]: https://github.com/AnthonyKopri/multi-git/compare/Release_v1.0.1...Release_v1.0.2
[1.0.1]: https://github.com/AnthonyKopri/multi-git/compare/Releases...Release_v1.0.1
[1.0.0]: https://github.com/AnthonyKopri/multi-git/releases/tag/Releases
