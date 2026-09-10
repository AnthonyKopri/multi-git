# Changelog

All notable changes to Multi-Git Client are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!--
Add changes here under the headings Added, Changed, Deprecated, Removed, Fixed,
or Security. Remove empty headings when preparing a release.
-->

### Added

- **A repository now says which account it should use, and which one it really
  uses.** The SSH Key dropdown gains a block naming the account derived from the
  remote's owner — overridable, because the owner of an organisation repository
  or a fork is not an account anybody authenticates as — beside the account the
  host actually greets when that key connects. A push whose account disagrees is
  blocked with an override, force pushes included: a force push as the wrong
  account is the worst version of this mistake, not one to wave through.
- **A default account, chosen deliberately.** A star to the left of a profile
  name sets the account that every unpinned repository falls back to. Nothing
  recorded that choice before, so it was whichever repository you opened last.

### Changed

- **Authentication and authorship are written together, or not at all.** The
  repository pin was written unconditionally while the commit identity was
  written only behind a dialog, and only if the profile carried an email — so a
  repository could authenticate as one account and commit as another, with
  nothing to reconcile them and no warning at any point. Profiles with no commit
  email now say so on the row, rather than letting it surface later in a commit.
- **Changing a repository's account shows what is already configured and asks
  before overwriting it**, including when a hand-written `core.sshCommand` will
  be left alone. Previously that last case was a silent no-op.
- **Profile rows lost five buttons.** Eight icon buttons wrapping onto two lines
  became Edit, Verify, Copy key, Delete and an overflow menu.

### Fixed

- **The account pinned to a repository now reaches the SSH agent.** The pin
  written into `core.sshCommand` named a bare `ssh`, and git prepends its own
  `usr/bin` — so it resolved to the MSYS build, which looks for an agent on a
  Unix socket, while the keys had been loaded into the Windows agent service's
  named pipe. Keys present, agent healthy, and every push outside this app
  asking for a passphrase that was already cached — or failing outright wherever
  there is no terminal to ask at, such as git-lfs, hooks and coding agents.
- **A pinned repository authenticates as the account you picked.**
  `IdentitiesOnly=yes` does not mean "only the key given with `-i`". It means
  only the identities named in the configuration *and* on the command line, so
  the managed block's own entry for the same host was offered alongside the pin
  and the agent's ordering decided the account. GitHub answered `ERROR:
  Repository not found.`, which names the wrong problem entirely and sends
  people looking for a repository they think they deleted; that message now
  carries the explanation. Pins written by earlier versions are recognised and
  migrated in place on the next profile apply.
- **The machine-wide default account no longer follows whichever repository is
  open.** Selecting a profile for one repository rewrote the catch-all entry in
  `~/.ssh/config` with that repository's key, so a push from any unpinned folder
  went out as whichever account you had looked at last.
- **Repository settings stopped discarding one another.** The config validator
  rebuilds each section from a list of fields it knows, so a setting saved here
  worked for the rest of the session and reverted on the next read.

## [4.0.0] - 2026-08-23

### Added

- **A setup step on first run.** Multi-Git runs Git for everything it does, so on
  a machine without it the app was a window with nothing behind it — and you
  found that out at the first click, as a raw error from a failed process. The
  welcome screen now checks once and says what is missing. **Install** runs the
  official package through winget in a terminal window, so you can see progress
  and answer the elevation prompt; where winget is not available it opens the
  download page instead. Nothing appears on a machine that is already set up.
- **Git is treated as required, and the GitHub CLI as optional.** Without Git,
  Open, New and Clone are disabled with a reason rather than left to fail at the
  first command. Without the GitHub CLI, everything else works and only the
  features that genuinely need it — creating a pull request, publishing a new
  repository to GitHub — are greyed out, with a tooltip saying why.
- **Settings → Git and GitHub** shows what is installed, what is signed in, and
  a **Check again** button. The welcome screen is only seen when no repository is
  open, and someone who decides to start creating pull requests six months later
  has no reason to go back there.
- **Release notes are rendered as an announcement.** They arrive from GitHub, so
  they went into the update window as plain text — which for anything longer than
  a sentence meant raw Markdown in a small monospace box, cut off at two thousand
  characters. They are now formatted, in a window with room, up to forty thousand.
  Nothing is treated as markup: every element is constructed and every string
  goes in as text, so the safety of the old approach is unchanged. Links show
  their label rather than becoming clickable, because a link from remote text is
  not a navigation this window should offer.
- **Merge and rebase now show you what they would do, and ask.** Opening a pull
  request changes nothing on your machine and got a twenty-field preflight;
  merging and rebasing rewrite your history and got a dropdown and a button. No
  preview, no confirmation, no indication of what was coming — while discarding
  a single file asked you to confirm. The risk model was the wrong way round.
  Both now show the commits that would arrive with their subjects, how many
  files they touch, whether the branch can simply move forward, and what it
  costs your own commits.
- **Pull says which kind of pull it is.** The server runs a bare
  `git pull origin <branch>`, so whether you get a fast-forward, a merge commit,
  or your commits replayed is decided by `pull.rebase` and `pull.ff` — git
  configuration this app never read and never showed. Those are read now and
  resolved before anything runs. A fast-forward proceeds without interruption,
  because it is the safest thing git does and asking every time would train
  people to click through the dialog that matters; a merge or a rebase says so
  first; and a `pull.ff=only` refusal is predicted rather than reported
  afterwards as a failure.


- **A Terminal panel in the main window.** The log lived in a pop-out you had to
  summon from a menu, which is the wrong place for the thing that tells you what
  just happened to your repository. It now sits along the bottom, collapsed to
  its header until you want it, resizable, and outside the blurred area so it
  stays readable while a dialog is asking about the failure it just recorded. The
  separate window still works and shows the same stream.
- **Open Git Bash, or a terminal, in this repository — with its SSH identity.**
  Two buttons in the Terminal panel. The point is not the shell, it is the
  identity: `core.sshCommand` is written into the repository so git finds the
  right key, but it names a bare `ssh`, and in Git Bash that is the MSYS build
  shipped inside Git for Windows, which cannot see the named-pipe agent this app
  loads keys into. The key is unlocked, sitting in the agent, and Git Bash asks
  for its passphrase anyway. The shell is now handed a `GIT_SSH_COMMAND` naming
  the agent-capable build with the same key, so `git push` there works with the
  right account and no prompt. Git Bash is offered only where it is installed.
- **Filtering in the log** — by repository, by whether a command read or changed
  anything, and by free text. Every command is recorded; a single refresh runs
  more than forty and nearly all are questions, so the queries are folded away
  behind a **Reads** toggle rather than burying the one command you came to see.
- **Copy, on any recorded command.** It copies the argument vector, which is now
  the argument vector that ran.

- **Seven windows became panels instead of covering the app.** Repository tools,
  worktrees, rebase, recovery, branch maintenance, search and agents are things
  you want open *beside* the work — but as full-screen overlays they dimmed and
  froze everything, so you could not watch a rebase and read the conflict's diff
  at the same time, or manage remotes while looking at the history that sent you
  there. They now dock down the right-hand side, resizable and remembered, with
  the rest of the window still live. The genuine questions — confirm, passphrase
  prompts, the wizards — stay modal, because a question you can ignore while
  clicking elsewhere is a worse question.
- **Seven more keyboard shortcuts, and every one of them is taught.** `Ctrl+1`,
  `Ctrl+2` and `Ctrl+3` for the three workspace tabs, `Ctrl+Shift+F` to search
  commits, and `Ctrl+Alt+F` / `Ctrl+Alt+P` / `Ctrl+Alt+U` for fetch, pull and
  push, plus `Ctrl+Alt+S` to stage everything. They are declared on the command
  itself, so the hint in the palette, the row in the menu and the key that
  actually fires are one string — which is how F5 came to be printed in a
  tooltip and bound to nothing.
- **`Ctrl+K` finds branches and repositories, not just commands.** It indexed
  forty-one verbs and nothing else, so reaching a branch meant opening a dropdown
  and reading. Type any part of the name instead — `rel40` finds `release-4.0`.

### Changed

- **Remotes, submodules and LFS have one home instead of two.** Each used to be
  an accordion in the sidebar *and* a tab in the Repository panel, with a Manage
  button bridging them — a count-and-preview in one place and the real thing in
  the other, so "where do I manage remotes?" answered "both, but only one of
  them works". The sidebar is a launcher now, and the panel owns them. Nothing
  the sidebar was the only place to say is lost: counts stay, and so do the
  warnings — LFS hooks left installed but unused run on every pull, and a
  submodule that is uninitialised or out of step is a broken build waiting to
  happen. Patches, bisect, notes and maintenance gained launchers too, having
  previously had no way in from the sidebar at all.

- **Merge and rebase say that a recovery point is taken.** They always have
  taken one, and never mentioned it. A safety net nobody knows about buys no
  confidence.
- **Fetch, pull and push report what git said.** The outcome was a toast reading
  "Push completed" while git's own summary — "Fast-forward", "3 files changed",
  the ref update — went to a log window you had to know to open. That summary is
  the informative half, and it now appears where the button was pressed.
- **The two different features called "Rebase" no longer share a name.** The
  sidebar button is **Rebase onto**, which says the direction it works in; the
  palette's is **Interactive rebase (plan commit by commit)**. They do different
  things and had the same label.
- **Merge is labelled "Merge in"**, and the section says "Bring another branch
  into this one" — the old wording left the direction to be guessed.


- **The Terminal Log shows what actually ran.** Every line describing a command
  used to be composed in the renderer from what it *meant* to do, so the log read
  like git without being it: `git add a b c` for an invocation of a different
  shape, a key path elided to a literal `...`, and no sign of the
  `-c core.longpaths=true` a Windows rebase really carries. None of it could be
  copied and run. Commands are now recorded by the server at the point they
  execute, with the real argument vector, the working directory, the environment
  this app added, the exit code and the duration.
- **Every line says which repository it came from.** Windows share one log, so
  in an app built around having several repositories open at once there was no
  way to tell whose line was whose. The panel shows this window's repository
  unless you ask for all of them.
- **Lines are sent in order, and kept if they fail.** Logging was one HTTP
  request per line, so a refresh firing fourteen parallel requests could land
  them in any order, and a request that failed dropped its line into the
  developer console where nobody would see it. They are queued, batched in the
  order they were written, and retried.

### Fixed

- **Safety Net now says when it could not protect you.** Failures to write a
  recovery point, to keep a copy of a file before discarding it, or to list the
  files a bulk discard was about to touch went only to the Electron process's
  stdout. An application that promises a safety net owes you the news when it
  does not deliver one, so these appear in the Terminal Log.

## [3.5.0] - 2026-08-23

### Fixed

- **Pushing with a locked key asks for it, every time.** An unlock check runs on
  its own when a repository opens, and pressing Push while that was still
  running joined it instead of asking a question of its own. Because the
  background check never prompts, the push was cancelled by a toast for a
  question the user was never asked. An explicit fetch, pull or push now always
  gets its own prompt.
- **"Remember this passphrase" now remembers it.** It was asked after the key had
  already been loaded, and the request to store it was answered by the branch
  that returns early because there is nothing left to load — so nothing was ever
  written to the vault while the app reported that it had been. The choice is now
  a checkbox on the passphrase prompt itself, and travels with the one request
  that can prove the passphrase before storing it. Nothing is stored unless the
  key actually opened.
- **A saved passphrase that stopped working can be corrected.** Changing a key's
  passphrase outside Multi-Git left the saved copy being retried on every launch,
  reported as a failure that typing could not fix. It is now treated as what it
  is — a rejected passphrase — so the app asks for the new one and replaces the
  stale entry.
- **Sign tags by default now signs tags.** Git honours `tag.gpgsign` only for
  annotated tags, and the tag drawer created lightweight ones, so the setting
  could never take effect through the interface that offered it.
- **A repository opened mid-rebase says so.** A rebase stopped at an `edit` step
  raises no conflict, so nothing in the window mentioned it. The rebase progress
  panel now opens by itself.
- **The Repository tools window keeps up with the repository.** Its panels are
  drawn by the features that own them and were never redrawn by a refresh, so an
  open tab kept showing whatever it held when it was opened.
- **F5 refreshes.** The Refresh row has named the key since the toolbar became a
  menu, and nothing was listening for it.
- **Escape closes the Create Pull Request window.** It listened for the key
  itself, but nothing moved focus into it, so the listener never heard one.
- **`Ctrl+K` works with Caps Lock on.**
- **Auto-pull stops in every window when it is turned off.** The setting belongs
  to the application, but each window decided from a copy read when it opened, so
  a second window carried on fast-forwarding until it was reopened.
- **A retention longer than the field allows is clamped, not ignored.** The
  Settings field offers up to 3650 days and redraws from what the server stored,
  so a larger number silently reverted to the previous value.

### Changed

- **The discard warnings describe what actually happens.** Discarding a file said
  "permanently", and discarding everything said it could not be undone. Both are
  copied into Safety Net first, and discarding everything also records a recovery
  point — it is the most recoverable destructive action in the application, and it
  was the one warning people their work was gone for good. Both now say what is
  kept, and for how long.
- **Neither the menu nor `Ctrl+K` offers what it cannot do.** With no repository
  open they listed rebase, maintenance and worktrees, which opened an empty window
  and logged a failure. Both now show only what works, from the same one list.
- **A bulk discard writes its Safety Net index once** rather than once per file,
  and no longer deletes snapshots it took moments earlier while the quota filled.

### Added

- **Check now**, in Settings, beside the update toggle. The update icon only
  appears once there is something to install, so an up-to-date app offered no way
  to ask. Shown only where a check can actually happen.
- **Every window takes focus when it opens, and Tab stays inside it.** Twelve of
  them left focus on the page behind, which is blurred and cannot be clicked, so
  reaching a control meant using the mouse first.
- **Keyboard shortcuts are shown** beside the rows that have them, in both the
  menu and `Ctrl+K`. Nothing taught them before.
- **Messages offer the fix they describe.** A push cancelled by a locked key
  carries an Unlock button that returns to the push; being told to open a
  repository first carries the folder picker.
- Windows announce themselves to screen readers, and so do the notifications the
  app reports almost every outcome through.

### Removed

- The **Keep the text of agent prompts in launch history** setting. Nothing read
  it, and nothing could: launch history is built from the command without the
  prompt, and the function that records it takes no prompt to record. The setting
  promised something the design deliberately refuses to do. Prompt text is still
  never written anywhere, which Settings now states plainly instead of offering a
  switch for it.

## [3.4.0] - 2026-08-22

### Added

- A **Settings** window, reached from the toolbar menu or `Ctrl+K`. It holds
  what is true of Multi-Git whatever repository is open: auto-pull, the
  `~/.ssh/config` sync toggle, the stale-branch rules, how long Safety Net
  recovery points are kept, the folder new worktrees are suggested in, whether
  agent prompt text is kept, window restoration, and the update check. Seven of
  those had no interface at all before and could only be changed by closing the
  app and editing `~/.multi-git-client-config.json`. Every control writes as you
  change it, and what is shown is always what was stored — a value the server
  repaired comes back corrected rather than staying as typed.
- A **menu** at the end of the toolbar, holding everything that used to be a
  sixth, seventh or eighth icon. Its rows are drawn from the same command list
  `Ctrl+K` searches, so the two cannot offer different things.

### Changed

- The toolbar is five controls instead of eight: fetch, pull, push, the
  pull-request button and the auto-pull chip, plus the update icon when there is
  news. Repository tools, the terminal log, refresh and the protocol chip moved
  into the menu — the same elements, with the same shortcuts, so `F5` still
  refreshes.
- Sidebar sections other than **Branches** and **Merge / Rebase** now start
  collapsed. Ten sections opening at once made the column a scroll before it was
  a layout. A section you have opened or closed yourself keeps that state: the
  default applies only where nothing has been remembered, and each section
  declares its own in the markup.
- `POST /api/config/settings` accepts every app setting, and validates them
  through the same code the configuration file goes through rather than a second
  copy of those rules.

## [3.3.0] - 2026-08-22

### Added

- A **Maintenance** tab in the Repository hub: purge the worktrees nobody came
  back to, with their branches, and delete every branch already merged into the
  default branch. Nothing is purged from a rule directly — the rules produce a
  list, every row carries the reasons it is on it, and only ticked rows are
  removed. A recovery point recording each branch tip is written first, one
  worktree Git refuses does not stop the rest, and every outcome is reported
  separately.
- Stale is now a definition you choose rather than a constant. Tick any of three
  signals — no pull request was ever opened for the branch, no remote has a copy
  of it, nothing has landed on it for a number of days you set — and say whether
  all of them must hold or any one is enough. It is stored as
  `settings.staleRules`, and the Branch Maintenance window reads the same
  definition, so the two can no longer disagree about which branches are stale.
  A signal that cannot be answered — the pull-request one on a repository with
  no GitHub origin, or with no `gh` signed in — counts as unknown rather than as
  true, so nothing is ever offered for deletion on the strength of a lookup that
  never happened, and the tab says which rule to untick.
- Purging a worktree that holds uncommitted changes is a separate opt-in, and
  snapshots tracked work into the Safety Net before the folder goes. Deleting a
  branch Git refuses to delete for not being merged is another, asked for in the
  confirmation itself. The main worktree, the folder the window is open on,
  anything locked, and anything on a pinned branch are never offered, and the
  panel names them rather than leaving their absence unexplained.

### Fixed

- The **Auto-pull** toggle no longer forgets itself when the app restarts. The
  setting was stored and validated correctly, but the sanitised configuration
  sent to the window left `autoPull` out, so the chip read it back as absent and
  rendered off — and nothing pulled automatically — however the configuration
  file read.

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

[Unreleased]: https://github.com/AnthonyKopri/multi-git/compare/Release_v4.0.0...HEAD
[4.0.0]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.5.0...Release_v4.0.0
[3.5.0]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.4.0...Release_v3.5.0
[3.4.0]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.3.0...Release_v3.4.0
[3.3.0]: https://github.com/AnthonyKopri/multi-git/compare/Release_v3.2.0...Release_v3.3.0
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
