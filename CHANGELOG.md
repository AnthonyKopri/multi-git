# Changelog

All notable changes to Multi-Git Client are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!--
Add changes here under the headings Added, Changed, Deprecated, Removed, Fixed,
or Security. Remove empty headings when preparing a release.

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security
-->
## [3.1.1] - 2026-08-11

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

[Unreleased]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.1.0...HEAD
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
