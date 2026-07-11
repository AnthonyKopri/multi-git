# Multi-Git Client

[![Latest release](https://img.shields.io/github/v/release/AnthonyKopri/multi-git?display_name=tag&sort=semver)](https://github.com/AnthonyKopri/multi-git/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078d4.svg)](https://github.com/AnthonyKopri/multi-git/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-desktop-47848f.svg)](https://www.electronjs.org/)

**A free, open-source Git desktop client built for multiple repositories, accounts, and SSH identities.**

Multi-Git brings the everyday comfort of clients such as Tower and GitHub Desktop to a transparent, local-first application. Open or clone a repository, review a visual history, stage only what you want, commit, sync, resolve conflicts, and recover from risky operations without translating every intention into a Git command.

Its defining feature is account-aware SSH: each repository can use its own key and commit identity, with optional origin-based rules that automatically select the right profile. There is no subscription, account requirement, or hosted service. Multi-Git is MIT-licensed and performs its work through the Git installation on your computer.

## What You Can Do

- **Work across repositories quickly:** open, create, clone, remember, switch, and remove repositories from the recent list.
- **Stage and commit with confidence:** click files to stage or unstage, inspect line-by-line diffs, discard safely, amend commits, and use Conventional Commit shortcuts.
- **See the shape of the project:** browse an all-branches commit graph, inspect commits and changed files, follow file history, and view Git blame.
- **Sync without the command line:** fetch, pull, push, see ahead/behind counts, switch a compatible origin between HTTPS and SSH, and retry rejected pushes with `--force-with-lease`.
- **Keep work and personal accounts separate:** assign an SSH key and Git identity to each profile, auto-select profiles from origin URLs, and catch account or identity mismatches before commit or push.
- **Handle advanced Git workflows:** create and switch branches, track remote branches, merge, rebase, cherry-pick, revert, reset, stash, and manage tags.
- **Resolve conflicts visually:** choose the current or incoming version, edit the result, stage it, and continue or abort the operation.
- **Recover from mistakes:** restore recently discarded files and undo checkpointed merge, rebase, cherry-pick, revert, and reset operations.
- **See what the app did:** open the live Terminal Log for the Git commands, output, warnings, and errors behind each action.

## Install And Start

### Windows: installer or portable app

Packaged releases are currently provided for Windows.

1. Install [Git for Windows](https://git-scm.com/download/win) if `git` is not already available on your system.
2. Open the [latest Multi-Git release](https://github.com/AnthonyKopri/multi-git/releases/latest).
3. Download one of the two `.exe` files:
   - **`Multi-Git.Client.Setup.<version>.exe`** installs Multi-Git and lets you choose the installation directory.
   - **`Multi-Git.Client.<version>.exe`** is portable and can be run without installation.
4. Launch **Multi-Git Client**.

The Windows packages are not currently code-signed, so Windows may show a SmartScreen warning. Only continue if the file came from this repository's official Releases page.

### Run from source

Running from source requires [Node.js 18 or newer](https://nodejs.org/), npm, Git, and OpenSSH (`ssh` and `ssh-keygen`).

```bash
git clone https://github.com/AnthonyKopri/multi-git.git
cd multi-git
npm install
npm run desktop
```

For browser-based development, run:

```bash
npm start
```

Then open `http://localhost:3000`. Desktop mode chooses a free local port automatically; browser mode uses `PORT` or port `3000`.

> Packaged macOS and Linux builds are not published yet. The Electron source is designed to be portable, but those platforms still need packaging and workflow testing.

## Five-Minute Guide

### 1. Open your first repository

The welcome screen offers three starting points:

- **Select Folder** opens an existing local Git repository.
- **Create** selects a folder and runs `git init` there.
- **Clone** accepts a remote URL, destination, optional folder name, and optional SSH profile.
- **Recent Repositories** reopens a repository you previously used.

After opening a repository, use the **Repository** section in the header to switch projects. Multi-Git remembers recent paths, but it does not move, upload, or copy those repositories.

### 2. Choose an account when needed

If your normal system SSH agent or `~/.ssh/config` already handles authentication, leave the header set to **System SSH**.

For separate work and personal keys, open **SSH Key** in the header, select **Manage SSH Profiles**, and either add an existing private key or generate a new one. Pick the profile you want for the current repository. The choice is remembered per repository.

Example setup:

| Profile | SSH key | Commit identity | Typical remote |
| --- | --- | --- | --- |
| Personal | `~/.ssh/id_ed25519_personal` | `Jane Doe <jane@example.com>` | `github.com/jane/*` |
| Work | `~/.ssh/id_ed25519_work` | `Jane Doe <jane@company.example>` | `github.com/company/*` |

Add Auto-Select Rules such as `github.com/company` → **Work** to make this automatic.

### 3. Make and commit a change

1. Open **Staging Area**.
2. Click a row under **Unstaged Changes** to stage it. Click a staged row to unstage it.
3. Use the file's **diff icon** to review its changes before committing.
4. Enter a commit message. Optionally select `feat`, `fix`, `docs`, or another template and add a scope.
5. Click **Commit**, or press `Ctrl+Enter` in the message box.
6. Click the **Push** icon in the top toolbar when you are ready to publish.

The row and its action icons intentionally do different things: clicking the row toggles staging; clicking the diff icon opens **File Diff**; clicking the trash icon starts a confirmed discard.

### 4. Keep in sync

The top toolbar contains the normal remote workflow:

| Control | What it does | Git equivalent |
| --- | --- | --- |
| **Fetch** | Downloads origin refs and prunes deleted remote refs without changing your files. | `git fetch --prune origin` |
| **Pull** | Pulls the current branch from origin. | `git pull origin <branch>` |
| **Push** | Pushes the current branch and establishes upstream tracking. | `git push -u origin <branch>` |
| **SSH / HTTPS** chip | Converts a compatible origin URL between GitHub-style SSH and HTTPS forms. | `git remote set-url origin …` |
| **Terminal Log** | Opens a separate live window with commands and their output. | Read-only transparency view |
| **Refresh** | Reloads status, branches, history, origin, stashes, tags, and Safety Net. | Multiple read-only Git queries |

Ahead and behind badges appear in the branch header and on the push/pull controls. If a normal push is rejected as non-fast-forward, Multi-Git explains the risk and can retry using `--force-with-lease`; it does not silently force-push.

## Feature Guide

### Repositories and the main workspace

The application is organized around one active repository:

- The **Repository**, **Branch**, and **SSH Key** header sections show the active context and open quick-switch menus.
- The left column contains **Branches**, **Merge / Rebase**, **Stashes**, **Tags**, and **Safety Net**.
- The center contains **Staging Area**, **File Diff**, and **Workspace Explorer**.
- The right-side **History** panel shows an expandable commit graph.
- The top toolbar contains origin protocol, sync, log, and refresh controls.

Use the repository dropdown to reopen recent projects, open another folder, create a repository, clone, or remove an entry from recents. Removing an entry only forgets it in Multi-Git; it does not delete the repository.

### Staging, diffs, and commits

**Staging Area** is optimized for the daily edit-review-commit loop.

| Action | Result |
| --- | --- |
| Click an unstaged file row | Stages that file. |
| Click a staged file row | Unstages that file. |
| Click the ignore icon on an untracked file | Adds that exact path to the repository's `.gitignore`. |
| Click the diff icon | Opens a line-numbered diff with additions, deletions, and hunks. |
| Click the trash icon | Confirms before deleting/discarding; the warning can be disabled for that repository from the dialog. |
| **Stage All** / **Unstage All** | Moves the whole visible set in one action. |
| Trash icon / **Discard All** | Confirms, snapshots affected file contents, then removes working-tree changes. |
| **Wrap file names** | Wraps long paths in both staging lists. |
| **Amend last commit** | Prefills the previous message and runs `git commit --amend`; warns if the commit appears pushed. |
| **History → Undo** | Soft-resets the last commit so its content remains staged. |

The dedicated **File Diff** tab lists every modified, untracked, staged, and conflicted file. From the diff header you can stage, unstage, or discard the selected working-tree file. Diffs opened from commit history are read-only.

The commit box supports free-form messages and optional Conventional Commit helpers:

```text
feat(auth): add SSH account auto-selection
fix(history): keep graph lanes aligned
docs: update portable installation steps
```

Enter an optional scope, then click one of `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, or `perf`. The helper inserts or replaces the prefix; it never blocks a non-conventional message.

### Visual history and commit actions

**History** loads commits from all refs and draws colored branch and merge lanes. Branch and tag refs appear beside their commits, and more history loads as you scroll.

Click a commit to open its detail drawer. You can:

- read the full SHA, author, date, message, and changed-file list;
- click a changed file to inspect that commit's diff;
- open up to 50 commits of per-file history with rename following;
- copy the full SHA;
- **Cherry-pick** the commit onto the current branch;
- **Revert** it by creating a new inverse commit;
- create a tag at that commit;
- **Reset to here** in `soft`, `mixed`, or `hard` mode.

Reset modes matter:

| Mode | Commits after the target | File changes after the target |
| --- | --- | --- |
| `soft` | Removed from the branch | Kept staged |
| `mixed` | Removed from the branch | Kept unstaged |
| `hard` | Removed from the branch | Discarded |

Multi-Git creates a Safety Net checkpoint before reset, but `hard` remains destructive: undoing the checkpoint also hard-resets the repository and can discard work created afterward.

### Branches, merges, and rebases

The **Branches** panel lists local and remote refs.

- Enter a name and click the add button to create and check out a local branch.
- Click a local branch to check it out.
- Click a remote branch such as `origin/feature` to create or reuse a local tracking branch and check it out.
- Use the delete icon to run a safe `git branch -d`. If Git reports that the branch is not fully merged, Multi-Git offers a separate force-delete confirmation.
- The branch header shows the checked-out branch plus ahead/behind counts when an upstream exists.

To integrate work, select a branch under **Merge / Rebase**:

- **Merge** runs `git merge <selected-branch>` into the current branch.
- **Rebase** runs `git rebase <selected-branch>`, replaying the current branch onto it.

Both actions save a checkpoint first. If Git reports conflicts, the app switches to its conflict workflow instead of leaving you without context.

### Conflict resolution

Merge, rebase, cherry-pick, and revert can all enter the conflict workflow.

1. Open a conflicted file from **Unstaged Changes** or click **Resolve**.
2. Review the parsed conflict blocks in the editor.
3. Choose **Keep Ours**, **Keep Theirs**, or edit the combined result manually.
4. Click **Save & Resolve** to write and stage the file.
5. Repeat until no conflicts remain.
6. Click **Continue** in the conflict banner, or **Abort** to abandon a merge/rebase.

In Git terminology, “ours” and “theirs” depend on the operation, especially during rebase, so review the resulting content rather than relying only on the labels.

### Safety Net

Safety Net adds a recovery layer around actions that are easy to regret.

**Undoable Operations** keeps up to 10 in-memory checkpoints per repository for merge, rebase, cherry-pick, revert, and reset. Clicking undo hard-resets the branch to the saved pre-operation `HEAD`. Checkpoints disappear when the backend/app restarts.

**Recently Discarded** stores a copy of file contents before per-file or bulk discard. Copies:

- live in the operating system's temporary directory;
- expire after 24 hours;
- are capped at the 30 most recent entries per repository;
- can be restored to their original repository path from the UI.

Safety Net is a convenience layer, not a backup system. Commit or back up irreplaceable work before destructive operations.

### SSH profiles, accounts, and identities

Authentication and authorship are related in the UI but distinct in Git:

- The **SSH key** authenticates fetch, pull, push, tag push, and SSH clone operations.
- `user.name` and `user.email` determine the author recorded in new commits.

An SSH profile can carry both. When you switch to a profile whose identity differs from the repository, Multi-Git offers to update the repository-local Git identity. It also warns before committing with a mismatched identity or pushing with an account that conflicts with an Auto-Select Rule.

#### Add an existing key

Open **SSH Key → Manage SSH Profiles → Add Existing Key**, then enter:

- **Profile Name / Label**, such as `Personal` or `Work`;
- **Path to Private Key**;
- optional **Commit Name** and **Commit Email**;
- optional SSH passphrase and encrypted-vault storage.

Use **Test Key** to validate the private/public key pair, then **Save Profile**. Registered profiles also provide actions to retest the key, copy its public key or path, open its folder, edit it, or delete it.

#### Generate a new key

Open **Generate New Key**, choose `ed25519` or RSA, and provide a label, optional filename, commit identity, and passphrase. **Create Key + Profile** writes a uniquely named key pair under your user `.ssh` directory and registers it immediately.

The result panel can open the key folder, copy either path, or copy the public key itself. Add that public key to GitHub, GitLab, or your other Git host before testing network access. Never upload or share the private key.

#### Clone with a profile

Choose an SSH URL and the matching profile in the Clone dialog:

```text
git@github.com:owner/repository.git
```

Profiles only apply to SSH URLs. An HTTPS clone such as `https://github.com/owner/repository.git` must use the system credential flow or be changed to SSH first.

#### Auto-select profiles

Auto-Select Rules match text anywhere in a repository's origin URL. Rules are evaluated in list order, and the first match selects its profile.

| Match text | Profile |
| --- | --- |
| `github.com/jane/` | Personal |
| `github.com/acme/` | Work |
| `gitlab.company.example` | Work |

#### Keep `~/.ssh/config` in sync

By default, Multi-Git maintains a clearly marked block in `~/.ssh/config` for the active repository host. This makes external tools such as Git Bash and IDEs use the same active key. Selecting **System SSH** removes Multi-Git's entry for that host.

If you manage SSH aliases or advanced host rules yourself, turn off **Keep `~/.ssh/config` in sync with the active key** in SSH Profile Manager. You can optionally remove the managed block at the same time. In-app operations still use the selected key through `GIT_SSH_COMMAND` even when config synchronization is disabled.

### Passphrase vault

The optional vault lets Multi-Git use passphrase-protected keys without asking on every operation.

1. Click **Set Up Vault** and choose a master key.
2. Add or edit an SSH profile, enter its SSH passphrase, and enable **Save passphrase in the encrypted vault**.
3. Unlock the vault once per app session when that profile is needed.
4. Click **Lock** to remove the derived decryption key from app memory.

The master key is not stored and cannot be recovered. Saved passphrases are encrypted on disk with AES-256-GCM using a 256-bit key derived with `scrypt`, plus a random salt and IV. They are made available only while the vault is unlocked.

### Workspace Explorer and blame

**Workspace Explorer** provides a collapsible tree of tracked and untracked repository files. Select a file to read its contents, then click **Show Blame** for line-by-line commit, author, and date attribution. Click a blame entry to open that commit in History.

The explorer is deliberately read-only; edit files in your normal editor and return to Staging Area to review the result.

### Stashes and tags

**Stashes** supports the complete short-term shelf workflow:

- **Stash** runs `git stash push -u`, including untracked files.
- **Apply** restores a stash and keeps it in the list.
- **Pop** restores and removes it.
- **Drop** permanently deletes it after confirmation.

**Tags** lists local tags and their target commits. Use the actions beside a tag to inspect its commit, push that specific tag to origin with the active SSH profile, or delete the local tag. Create a new tag from a commit's History drawer. Deleting locally does not delete an already-pushed remote tag.

### Terminal Log

Click the terminal icon in the top toolbar to open the live log in a separate window (or a named browser tab in browser mode). It shows the Git-shaped command, selected SSH context, command output, and errors for the current app session. The window is for visibility and troubleshooting; it is not an interactive shell.

## Local Data, Privacy, And Security

Multi-Git has no required cloud account. Application state stays on your machine. Network traffic occurs when Git contacts the remotes you configured, and the current UI loads its fonts and Material Symbols from Google Fonts when an internet connection is available.

```text
~/.multi-git-client-config.json   recent repositories, profiles, rules, settings
~/.multi-git-client-secrets.json  encrypted passphrases, if the vault is used
<temporary directory>/multi-git-trash/  short-lived discarded-file snapshots
```

Private key files remain at the paths you choose and are not copied into the configuration file. The app stores profile metadata and key paths, while the optional secrets file stores only encrypted passphrases.

The Express backend binds to `127.0.0.1` and rejects non-localhost Host and Origin values. This matters because the API can run Git commands and access files inside the selected repository. Do not reverse-proxy or expose the backend to a network.

## Releases

See [GitHub Releases](https://github.com/AnthonyKopri/multi-git/releases) for installers, portable builds, and release notes.

- **v1.0.4:** streamlined SSH key and vault setup, UI fixes, and executable icon fixes.
- **v1.0.3:** redesigned UI/UX, pop-out Terminal Log, SSH/HTTPS origin switch, SSH config synchronization, commit history graph, and assorted UI fixes.
- **v1.0.2:** simplified Remote Sync controls.
- **v1.0.1:** made staging rows directly toggle staged state.
- **v1.0.0:** initial release.

## Project Structure

```text
multi-git/
|-- main.js             # Electron lifecycle, windows, and local backend startup
|-- preload.js          # Minimal folder-picker and log-window bridge
|-- server.js           # Local API, Git runner, config, vault, and Safety Net
|-- ssh-config.js       # Managed ~/.ssh/config block
|-- public/
|   |-- index.html      # Application shell and dialogs
|   |-- app.js          # Client-side state, rendering, and workflows
|   |-- style.css       # Application styles
|   `-- logs.html       # Live Terminal Log window
|-- scripts/
|   `-- after-pack.js   # Windows executable icon post-processing
|-- package.json        # Scripts, dependencies, and Electron Builder config
`-- LICENSE             # MIT license
```

The UI talks to a localhost JSON API. Repository-scoped requests carry the selected path in the `x-repo-path` header. Git commands are executed as argument arrays with Node's `spawn`; a selected profile is applied per operation with `GIT_SSH_COMMAND`, and saved passphrases use a short-lived askpass bridge.

## Developer Commands

| Command | Description |
| --- | --- |
| `npm start` | Start browser mode on `http://localhost:3000` (or `PORT`). |
| `npm run dev` | Alias for `npm start`. |
| `npm run desktop` | Start the Electron desktop app with a dynamic local port. |
| `npm run build` | Build targets configured in `package.json`. |
| `npm run build-win` | Build Windows NSIS installer and portable executable. |
| `npm run build-standalone` | Build only the portable Windows target into `dist-standalone`. |

There is no frontend compilation step: Express serves the JavaScript, HTML, and CSS directly from `public/`. There is also no dedicated automated test script yet, so test Git changes against disposable repositories.

## Local API Examples

Most users never need the API, but these examples are useful when debugging browser mode.

```bash
# Read status
curl -H "x-repo-path: /path/to/repository" \
  http://localhost:3000/api/git/status

# Stage one file
curl -X POST http://localhost:3000/api/git/stage \
  -H "Content-Type: application/json" \
  -H "x-repo-path: /path/to/repository" \
  -d '{"files":["README.md"]}'

# Commit the staged files
curl -X POST http://localhost:3000/api/git/commit \
  -H "Content-Type: application/json" \
  -H "x-repo-path: /path/to/repository" \
  -d '{"message":"docs: improve README"}'
```

The API is an internal application interface rather than a versioned public contract and may change between releases.

## Troubleshooting

### Multi-Git cannot find Git

Install Git and make sure `git` is available to desktop applications through the system `PATH`, then restart Multi-Git. From PowerShell, verify with:

```powershell
git --version
```

### Key generation or testing fails

Make sure OpenSSH supplies both `ssh` and `ssh-keygen` on `PATH`. Also confirm that the profile points to the private key, not the `.pub` file. Multi-Git's key test distinguishes missing, invalid, passphrase-protected, and valid keys.

### An SSH profile does not affect pull or push

Profiles apply only to SSH remotes. Check the **SSH / HTTPS** chip in the toolbar. For compatible GitHub-style remotes, click it to switch the origin to a form such as:

```text
git@github.com:owner/repository.git
```

For custom hosts or unusual remote formats, change the origin manually.

### The vault is locked

Open the **SSH Key** dropdown and unlock the vault. A profile with a stored passphrase cannot use that passphrase until the correct master key has unlocked the vault for the current session.

### The wrong account or commit author is selected

Check all three pieces separately:

1. the active **SSH Key** profile in the header;
2. the repository-local **Identity** shown in that dropdown;
3. the origin URL and any **Auto-Select Rules** in SSH Profile Manager.

Authentication decides which remote account Git uses; identity decides what name and email are written into the commit.

### Port 3000 is already in use

Desktop mode automatically chooses an available port. For browser mode, set another one:

```powershell
$env:PORT = "3001"
npm start
```

### A risky action needs to be undone

First check **Safety Net**. Checkpoint undo is available only during the current app/backend session, while discarded file copies last up to 24 hours. If neither entry exists, use Git reflog or your backup before making more changes.

### Build output is large

That is normal for Electron applications. Generated `dist/` and `dist-standalone/` directories are ignored by Git.

## Contributing

Contributions are welcome, especially for Git edge cases, accessibility, automated tests, macOS/Linux packaging, cross-platform validation, and UI polish.

Please read the [contributing guidelines](CONTRIBUTING.md) before opening a pull request. Use the repository's issue forms for bugs and feature requests, read [SUPPORT.md](SUPPORT.md) for troubleshooting help, and report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md). All project participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

Before opening a pull request:

1. Run the application locally.
2. Exercise the changed workflow against a disposable repository, including error and conflict paths.
3. Do not commit generated builds, local configuration, keys, passphrases, or test repositories.
4. Keep the change focused and explain its user-visible behavior.
5. Update this README when buttons, requirements, storage, or workflows change.

## License

Multi-Git Client is free and open-source software released under the [MIT License](LICENSE).
