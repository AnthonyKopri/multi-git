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
- **Set up a new repository in one dialog:** choose visibility, pick a license template and fill in its placeholders, and add a `.gitignore` from a stack template, a general one, or your own.
- **Stage and commit with confidence:** click files to stage or unstage, stage or discard a single hunk or a handful of lines, amend commits, and use Conventional Commit shortcuts.
- **Read a change properly:** unified or side-by-side, with the words that actually changed picked out, whitespace-only changes hidden on request, and before/after previews for images.
- **See the shape of the project:** browse an all-branches commit graph, inspect commits and changed files, follow file history, and view Git blame.
- **Sync without the command line:** fetch, pull, push, see ahead/behind counts, switch a compatible origin between HTTPS and SSH, and retry rejected pushes with `--force-with-lease`.
- **Keep work and personal accounts separate:** assign an SSH key and Git identity to each profile, auto-select profiles from origin URLs, and catch account or identity mismatches before commit or push.
- **Handle advanced Git workflows:** create and switch branches, track remote branches, merge, rebase, cherry-pick, revert, reset, stash, and manage tags.
- **Rewrite history deliberately:** plan an interactive rebase visually — reorder, reword, squash, fixup, drop, autosquash — and split a commit into several without leaving the app.
- **Find things:** search commits by message, author, path, ref or date range; compare any two refs; and reach every action from a Ctrl+K command palette.
- **Keep branches tidy:** see which are merged, stale or tracking a branch that no longer exists, then pin, rename, re-point or delete them in bulk.
- **Sign your work:** configure SSH or GPG signing per repository, and see what a commit's signature actually proves.
- **Resolve conflicts visually:** choose the current or incoming version, edit the result, stage it, and continue or abort the operation.
- **Work on two branches at once:** create and manage Git worktrees, open each in its own window, and remove them without ever losing uncommitted work by accident.
- **Group repositories that belong together:** fetch a whole group in one action, cancel it mid-flight, and see the result for each repository.
- **Hand a folder to a coding agent:** launch Claude, Codex, or any executable you configure in the worktree you choose, with the right account already usable.
- **Manage remotes properly:** separate fetch and push URLs, refspecs, prune preference, a connectivity test, and a fetch-all that reports each remote separately.
- **Work with submodules without guessing:** see the commit the superproject pins and the one the submodule is actually at as two different facts, then initialize, update, sync or remove one.
- **Handle large files:** inspect Git LFS patterns and objects, tell a downloaded file from a pointer, fetch or prune with a preview of what will move, and take or release file locks.
- **Move changes as patches:** build one from commits, a range or your uncommitted work, check it applies before it does, and apply it as working changes or as commits.
- **Find the commit that broke it:** bisect by hand, or let a saved test command decide each step for you.
- **Annotate commits after the fact:** attach a Git note without rewriting history, and see at a glance which commits carry one.
- **Use the tools you already have:** configure external diff, merge, editor and terminal programs, and optionally add "Open in Multi-Git" to the Windows Explorer right-click menu.
- **Watch and stop long work:** a bar along the bottom shows what is running, how long it has taken, and lets you cancel it.
- **Recover from mistakes:** restore recently discarded files, undo checkpointed operations, and browse a durable recovery journal beside Git's own reflog.
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

Running from source requires [Node.js 22.12 or newer](https://nodejs.org/), npm, Git, and OpenSSH (`ssh` and `ssh-keygen`).

```bash
git clone https://github.com/AnthonyKopri/multi-git.git
cd multi-git
npm install
npm run desktop
```

`npm install` does not download the Electron runtime on its own — Electron ships that as an explicit `install-electron` step rather than an install script. `npm run desktop` runs it for you when the binary is missing; `npm start` never needs it.

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

### Creating a new repository

**New Repo** opens a setup dialog instead of only running `git init`:

- **Repository folder.** Pick or type a path. A folder that does not exist yet is created. The hint below the field reports whether the folder is empty, already a Git repository, or already contains a `LICENSE` or `.gitignore`.
- **Visibility.** Choose **Private** or **Public**. Multi-Git holds no API token, so visibility only reaches GitHub through the GitHub CLI. When `gh` is installed and signed in, tick **Create it on GitHub with this visibility** to have `gh repo create` make the remote and set `origin`; the remote is then switched to SSH to match how this app authenticates. Without `gh`, the repository is created locally and the dialog says so.
- **License.** Pick from MIT, Apache 2.0, GPL/AGPL/LGPL 3.0, MPL 2.0, BSD 2- and 3-Clause, ISC, or the Unlicense. Templates whose text carries placeholders show **Copyright year** and **Copyright holder** fields, pre-filled from the active profile or repository identity. A `LICENSE`, `LICENCE`, or `COPYING` file that already exists is never overwritten without a confirmation.
- **.gitignore.** Choose a stack template (Node, Python, Rust, Go, Java, C/C++, .NET, Unity, Unreal, Godot), the **General** default that covers OS files, editors, and build output, or **Custom**, which writes a commented starter file and opens it in your default editor. An existing `.gitignore` also asks before being replaced.

Every file the dialog writes, and anything it decided to keep, is reported in the Terminal Log.

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

#### Reading the diff

| Control | What it does |
| --- | --- |
| **Split** / **Unified** | Side by side, or one column. Remembered as you move between files. |
| **Whitespace** | Show everything, ignore whitespace *changes*, or ignore whitespace entirely. |

Within a changed line, the words that actually differ are highlighted, so a
renamed variable stands out instead of the whole line looking new. Indentation
is treated as a change of its own, so re-indenting reads as re-indenting.

The whitespace setting only affects what you are shown. Staging, unstaging and
discarding always work from the full diff, so a hunk you stage while whitespace
is hidden still carries its whitespace changes rather than quietly dropping
them from the file.

**Images** are shown before and after, side by side, on a checkerboard so a
transparent PNG reads as transparent. Any other binary file reports its old and
new size, which is all Git knows about it.

#### Stashing part of a file

The same selection works for stashing: chosen lines or hunks go into a stash of
their own and everything else stays exactly as it was, staged files included.
A stash can be inspected without applying it, applied with `--index` so the
staged/unstaged split comes back as it went in, or checked out onto a new
branch when it no longer applies where you are.

The box above the stash list filters it. It searches the stash messages *and*
the files inside each stash, so "where did I put that change to config.ts" is
a question you can actually ask.

Only tracked files can be stashed piece by piece. An untracked file has no
previous version to leave behind, so it goes in whole or not at all.

#### Staging part of a file

A commit rarely matches a working session exactly, so the diff can be acted on
below file level.

| Action | Result |
| --- | --- |
| Click any added or removed line | Selects it. Click again to deselect; Space or Enter does the same from the keyboard. |
| **Stage selection** / **Unstage selection** / **Discard selection** | Applies to exactly the selected lines, and to nothing else in the file. |
| Hover a `@@` hunk header | Reveals buttons that stage, unstage, or discard that whole hunk. |
| **Clear** | Drops the selection without changing anything. |

Which buttons appear follows the diff you are looking at: an unstaged diff
offers stage and discard, a staged one offers unstage, and an untracked file
offers stage only — discarding part of a file Git has never seen has nothing
to fall back to.

Notes on how this behaves:

- Selecting only the added half of a changed line stages the addition and
  leaves the removal behind, which is the same result `git add --patch` gives
  for the same choice.
- Discarding selected lines snapshots the whole file to Safety Net first, and
  confirms unless the warning was turned off for that repository.
- If the file changes on disk between opening the diff and acting on it, the
  action is refused rather than applied to the wrong lines, and the diff
  reloads so the choice can be made again.
- Diffs over 2 MB are not rendered line by line until you ask for them with
  **Load anyway**.

The commit box supports free-form messages and optional Conventional Commit helpers:

```text
feat(auth): add SSH account auto-selection
fix(history): keep graph lanes aligned
docs: update portable installation steps
```

Enter an optional scope, then click one of `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, or `perf`. The helper inserts or replaces the prefix; it never blocks a non-conventional message.

### Interactive rebase

Open it from the command palette (`Ctrl+K` → "Interactive rebase"). Choose the
commit everything should sit on top of, and the commits above it are listed
oldest first — the order Git reads them.

| Action | What it does |
| --- | --- |
| **pick** | Keep the commit as it is |
| **reword** | Keep the changes, replace the message |
| **edit** | Stop there so the commit can be amended or split |
| **squash** | Fold into the commit above, keeping both messages |
| **fixup** | Fold into the commit above, discarding this message |
| **drop** | Remove the commit entirely |

Arrows reorder. **Autosquash** previews where your `fixup!` and `squash!`
commits would land before anything runs. If any of the commits are already on
the branch's upstream, the planner says how many, because rewriting those means
anyone who has pulled will have to reconcile — and the push afterwards uses
`--force-with-lease`.

When the rebase stops — for a conflict, or at an `edit` — the same window shows
which step it is on, what is conflicted, and offers Continue, Skip, Abort and
**Split this commit**. Splitting undoes the commit into your working tree with
nothing staged; stage and commit each part in turn using the line-level tools
above, then continue. The rebase survives closing the window or restarting the
app: reopening picks up exactly where it was.

A recovery point is recorded before the rebase starts, so the whole thing is
one click from being undone.

### Searching and comparing

`Ctrl+K` → "Search commits" finds commits by message or body, author, paths,
refs, and a date range. The filters are all optional and combine, so an empty
query with a path is "what touched this file" and an empty query with a date
range is "what happened last week". A search term that looks like an object
name is resolved directly, so a commit is findable by its hash even though
nothing in its message mentions it.

"Compare refs" counts both directions from the merge base, lists what is unique
to each side, and shows the changed files.

### Branch maintenance

`Ctrl+K` → "Branch maintenance" lists every local branch with what you need to
decide its fate: where it tracks and how far it has diverged, whether it is
already merged, whether anything has landed on it in the last 60 days, and
whether its upstream has been deleted. Filter to just the merged, stale or
orphaned ones, then pin, rename, re-point or select several and delete them at
once. Pinned and current branches are never selectable for deletion, a pin
follows its branch through a rename, and a bulk delete reports each branch's
outcome rather than stopping at the first one Git refuses.

**Prune remote** shows what it would remove before removing it.

### Commit signing

The **Sign** box beside the commit button signs a single commit; **Settings**
beside it configures the repository.

Choose **System** to leave it to your global Git configuration, **an SSH key**,
**a GPG key**, or **Nothing** to make sure this repository never signs whatever
the global configuration says. SSH mode offers the keys from your registered
SSH profiles. Settings are written to the repository's own Git configuration,
so a terminal in the same folder behaves identically.

Signature status appears on a commit when you open it. The wording is
deliberately careful:

| Badge | What it means |
| --- | --- |
| **Verified** | Git checked the signature against a key this repository trusts |
| **Unverified** | There is a signature and its trustworthiness cannot be established here — an untrusted or expired key, or no allowed-signers file |
| **Bad signature** | Git checked it and it does not match |
| *(no badge)* | The commit carries no signature |

That distinction matters more than it looks. Git reports a *signed* commit as
having no signature at all when it has no allowed-signers file to check it
against, which is the default state for anyone who has just turned SSH signing
on. Multi-Git checks the commit itself before saying anything is unsigned.

If signing fails, no commit is made and your changes stay staged — and the
message says so, along with what to check.

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

**Recovery Points** are the durable half. Before every reset, rebase, merge,
cherry-pick, revert, amend, undo, branch delete, stash drop and bulk discard,
Multi-Git records where every ref that could move was pointing — to a file
inside the repository's own `.git`, so it survives restarting the app. The
recovery browser shows those points beside Git's own reflog, which covers
everything that happened outside Multi-Git too.

From either list you can create a branch at a recorded position, which recovers
work without moving anything you are standing on; reset a ref back to it, which
is a hard reset and says so; or copy the equivalent Git command. Restoring
records a recovery point of its own, so undoing an undo works. Points expire
after 14 days by default, and expiry is frozen entirely while a merge or rebase
is unfinished.

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

On a machine with no repositories yet, the welcome screen carries its own **Set Up Keys** button. It reports how many key profiles exist and opens the SSH manager, going straight to the generator when there are none, so a first key can be created before the first clone.

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

You do not have to use the vault. When a window opens on a repository whose key is locked, or when you fetch, pull or push with one, Multi-Git asks for what it needs then and there — the vault master key if the passphrase is saved, or the key's own passphrase if it is not — and offers to remember it afterwards. Declining is remembered for the session; **Unlock key** in the accounts menu asks again whenever you are ready. A passphrase you type reaches `ssh` through a short-lived askpass bridge and appears in no command line, no log, and no file unless you asked it to be saved.

### Worktrees

A worktree is a second working folder for the same repository, so two branches can be checked out at once without stashing. Remotes, history, configuration and the object store are shared; the files, the index and whatever is half-finished in them are not.

The **Worktrees** section in the sidebar lists every worktree of the open repository, with its branch, whether it is clean, and how far ahead or behind it is. Each row can open the worktree in this window or a new one, open a terminal there, launch a coding agent, or copy the path.

**Manage** opens the full manager:

- **Create** from a new branch, an existing branch, or a detached commit. The suggested folder is a sibling of the repository named `<repo>.worktrees`, and the absolute path is always shown before the button does anything. A branch already checked out elsewhere is refused, naming where.
- **Lock** with an optional reason, so Git refuses to prune or remove it — for a worktree on a removable drive, for instance. The reason is shown wherever the lock gets in the way.
- **Move** a worktree, or **Repair links** after folders were moved outside Multi-Git.
- **Prune preview** lists the worktrees Git would forget because their folders are gone. Looking never removes anything.
- **Remove** refuses a worktree that is dirty or locked. Removing one with uncommitted changes anyway requires typing its folder name, and Multi-Git snapshots the work into the Safety Net first — that snapshot lives in the shared object store, so it survives the folder.

One account per repository family: a repository and its worktrees share one `.git/config`, so they share one SSH identity. Choosing an account in any worktree sets it for all of them, which is what Git will actually do.

### Multiple windows and repository groups

**Open in a new window** gives a repository or worktree its own window with its own selection, diff and commit message. Asking twice focuses the window that already exists rather than opening a second one that would fight it for the same index lock. Windows reopen at the next launch; turn that off with **Reopen windows on startup**. In browser mode the equivalent is a named tab.

The **Groups** section collects repositories that belong together. **Fetch all** fetches every one of them with a concurrency cap, can be cancelled, and reports each repository separately — one unreachable remote does not hide the five that worked.

### Coding agents

Multi-Git can start a tool you configure in the worktree you choose. **Detect installed** looks for known CLIs on your PATH and seeds an editable definition; you can add any executable by hand, with its own arguments and environment.

A launch sets the worktree as the working directory, passes arguments as separate values with no shell anywhere in the path, and gives the tool an allowlisted environment rather than a copy of Multi-Git's. An optional starting prompt is passed as one argument and is never recorded. Before launching, Multi-Git makes sure the account that worktree uses is actually loaded, so the agent can push.

What it does not do: install hooks, read the tool's session state, or claim to know what it is doing. **Launched** means the process started. Launching is available in the desktop app only — the local HTTP server has no route that starts a program.

### The Repository hub

The **Repository** button in the top toolbar opens one window holding the tools that act on the repository as a whole: **Remotes**, **Submodules**, **LFS**, **Patches**, **Bisect**, **Notes** and **Tools**. The sidebar keeps a short summary of the first three and jumps straight to the right tab.

**Remotes** shows more than a URL, because a remote is more than one. Fetch and push URLs are separate rows — a push URL that differs is the fork workflow, reading from upstream and writing to your own. Refspecs are shown rather than assumed, and prune says whether it was set on this remote or inherited from `fetch.prune`. **Test** reaches the remote with the account this repository uses and tells you whether a failure was the network or the key. Removing a remote or pruning its stale branches saves a recovery point first: a remote-tracking ref is the only local record that a branch existed once its remote is gone.

**Submodules** keeps two commits apart, because conflating them is what makes submodule tools dangerous. The superproject records which commit a submodule *should* be at; the submodule's working tree is at whatever you left it at. A row says which of the two is out of step rather than showing one "out of date" badge that could mean either. **Update** moves the working tree to the pinned commit — it does not change what is pinned. Each submodule is acted on separately, so one whose remote is down does not hide the nine that worked.

**LFS** needs Git LFS installed; Multi-Git will not install it, and says so plainly rather than showing an empty list that reads as "no large files here". A tracked file is committed as a small pointer, and the real bytes may or may not be on this machine — the list says which, and offers to fetch the ones that are not. Every transfer previews what it would move first. Locking is optional in the LFS spec, so a server without it is reported as a fact; force-releasing someone else's lock asks first and is never a silent retry.

**Patches** builds one from commits, a range, or your uncommitted work, in mailbox form (which keeps each commit's author and message) or as a plain diff. **Check only** tells you whether it applies without writing anything. Applying saves a recovery point first, and a patch that would write outside the repository is refused before anything runs.

**Bisect** checks out the middle of a range and asks whether it is good or bad. Mark each step yourself, or save a test command and let its exit code decide — 0 good, 125 skip, anything else bad. The session lives in the repository, so it survives closing the app, and **Reset** works even on one left behind by a crash. Running a command is available in the desktop app only.

**Notes** attaches text to a commit afterwards. The note lives in its own ref, so writing one does not rewrite history — and does not travel with an ordinary push, which is why fetching and pushing notes are separate actions here. Commits carrying a note are marked in the history list; open one to read or edit it.

**Tools** configures external diff, merge, editor, terminal and file-manager programs. **Detect installed** fills in a definition for each tool found on your PATH, including the arguments it expects. Those arguments are a guess, so the first time each kind is used Multi-Git shows the exact command and asks — once per kind, not once per launch. An external merge tool never marks a file resolved on your behalf: Multi-Git re-reads Git's state afterwards rather than assuming.

The same tab can add **Open in Multi-Git** to the Windows Explorer right-click menu. It writes two registry keys under your own user account — no administrator rights, no file associations — and shows you exactly which two before it writes or removes them.

### The operations bar

A thin bar along the bottom of the window shows what Multi-Git is currently running: a clone, a fetch, an LFS transfer, a submodule update, a history search. Click it for the full list, with how long each has taken, a **Cancel** button for the ones that can be stopped, and copyable diagnostics with secrets already removed.

Cancelling a network operation is not the same as undoing one. If a push has already sent its objects, cancelling stops the process but the remote may have received them — the bar says so rather than claiming a clean stop.

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
~/.multi-git-client-config.json   recent repositories, profiles, rules, settings,
                                  repository groups, agent definitions and launch
                                  history, and which windows were open
~/.multi-git-client-secrets.json  encrypted passphrases, if the vault is used
<repository>/.git/multi-git/      the durable recovery journal
<temporary directory>/multi-git-trash/  short-lived discarded-file snapshots
```

Private key files remain at the paths you choose and are not copied into the configuration file. The app stores profile metadata and key paths, while the optional secrets file stores only encrypted passphrases.

The Express backend binds to `127.0.0.1` and rejects non-localhost Host and Origin values. This matters because the API can run Git commands and access files inside the selected repository. Do not reverse-proxy or expose the backend to a network.

Several further protections apply, on the principle that a repository's contents are not trusted input — cloning someone else's repository is the app's normal workflow:

- Pages are served with a Content Security Policy whose `script-src` is `self`, so a rendering mistake cannot become script execution in a page that could otherwise drive the API.
- File reads resolve symlinks before checking containment, so a link inside a repository cannot reach a file outside it.
- Values that reach a Git or GitHub CLI argument vector are validated, and file paths are separated with `--`, so a branch, tag, or file name that looks like a command-line option is treated as data.
- Reading a public key is limited to keys registered to a profile or living under `~/.ssh`.
- Starting a program is not something the local API can do. Terminals, editors and coding agents are launched only through the desktop app's preload bridge, which validates every path and takes an agent id rather than an executable name.
- A launched tool gets an allowlisted environment, not a copy of Multi-Git's — in particular it never inherits the askpass bridge that would answer with a stored passphrase.
- Agent launch history records what was started and where, but never the prompt.

## Releases

See [GitHub Releases](https://github.com/AnthonyKopri/multi-git/releases) for installers, portable builds, and release notes.

The running version is in the window title — `Multi-Git Client v2.3.0` — and in
the browser tab in browser mode, so a bug report can name it without digging.

- **v1.0.4:** streamlined SSH key and vault setup, UI fixes, and executable icon fixes.
- **v1.0.3:** redesigned UI/UX, pop-out Terminal Log, SSH/HTTPS origin switch, SSH config synchronization, commit history graph, and assorted UI fixes.
- **v1.0.2:** simplified Remote Sync controls.
- **v1.0.1:** made staging rows directly toggle staged state.
- **v1.0.0:** initial release.

## Project Structure

```text
multi-git/
|-- src/
|   |-- shared/         # Types describing the API, imported by both sides
|   |-- main/           # Electron lifecycle, windows, and the preload bridge
|   |-- server/
|   |   |-- index.ts    # startServer
|   |   |-- app.ts      # Express assembly and middleware order
|   |   |-- app-root.ts # Locates templates/ and static assets in every layout
|   |   |-- routes/     # One router per area of the API
|   |   |-- git/        # Runner, argument guards, and output parsers
|   |   |-- ssh/        # Profiles, keys, askpass, managed ~/.ssh/config block
|   |   |-- vault/      # Encrypted passphrase storage
|   |   |-- config/     # Cached, atomically written configuration
|   |   `-- safety-net/ # Checkpoints and the discard trash
|   `-- renderer/       # UI: state, API client, DOM helpers, and features
|-- templates/
|   |-- licenses/       # License texts from choosealicense.com
|   `-- gitignore/      # Ignore templates from github/gitignore
|-- public/
|   |-- index.html      # Application shell and dialogs
|   |-- logs.js         # Terminal Log window script
|   |-- style.css       # Application styles
|   `-- logs.html       # Live Terminal Log window
|-- tests/              # Vitest: unit, integration, and pre-release checks
|-- scripts/
|   |-- build.mjs       # esbuild bundling and static asset copy
|   |-- release.js      # Version bump and build driver
|   `-- after-pack.js   # Windows executable icon post-processing
|-- out/                # Compiled output (generated, not committed)
|-- package.json        # Scripts, dependencies, and Electron Builder config
`-- LICENSE             # MIT license
```

The whole application is TypeScript, compiled into `out/`. `public/` holds only the HTML, CSS, and the Terminal Log window script, which are copied alongside the bundle at build time.

The UI talks to a localhost JSON API. Repository-scoped requests carry the selected path in the `x-repo-path` header, which one middleware validates; the app sends it base64-encoded, marked by `x-repo-path-encoding`, so a folder named in any script survives the trip. Git commands are executed as argument arrays with Node's `spawn`, never through a shell; values that could be read as options are validated and pathspecs are separated with `--`. A selected profile is applied per operation with `GIT_SSH_COMMAND`, and saved passphrases use a short-lived askpass bridge.

Starting a program that is not Git — a terminal, an editor, a coding agent — is deliberately not on that API. Those go through the Electron preload bridge instead, which validates every path it is given and looks agents up by id in your saved configuration, so nothing reachable over the local port can name a program to run.

## Developer Commands

| Command | Description |
| --- | --- |
| `npm start` | Start browser mode on `http://localhost:3000` (or `PORT`). |
| `npm run dev` | Alias for `npm start`. |
| `npm run desktop` | Start the Electron desktop app with a dynamic local port. |
| `npm test` | Type-check every source and run the Vitest suite. |
| `npm run typecheck` | Type-check without running the tests. |
| `npm run compile` | Build the TypeScript sources into `out/`. |
| `npm run release` | Bump the version and build, prompting for both. |
| `npm run release:installer` | Prompt for a version, then build only the installer. |
| `npm run release:portable` | Prompt for a version, then build only the portable executable. |
| `npm run build` | Build targets configured in `package.json`. |
| `npm run build-win` | Build Windows NSIS installer and portable executable. |
| `npm run build-standalone` | Build only the portable Windows target into `dist-standalone`. |

`npm start` and `npm run desktop` compile first, so the TypeScript sources are always current; every `build` and `release` script does the same. Express serves the compiled bundle and the static assets from `out/web`.

`npm test` type-checks every source under `strict` and runs the Vitest suite: the Git output parsers, patch generation, path containment, argument guards, vault encryption, and the commit-graph layout, plus integration tests that drive the real API against throwaway repositories. Parts of the renderer are covered too — the pull-request creator and the diff pane are mounted from the real `public/index.html` under happy-dom, so a renamed element id fails the suite. Everything else in the UI is still unverified by tests, so exercise visual changes against a disposable repository as well.

See [BUILDING.md](BUILDING.md) for the full build, check, and release procedure, including both Windows artifacts and how to bump the version.

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

# Read one file's diff as hunks and lines, each with an id
curl -H "x-repo-path: /path/to/repository" \
  "http://localhost:3000/api/git/diff/structured?path=README.md&source=working-tree"

# Stage only the lines whose ids came from that read
curl -X POST http://localhost:3000/api/git/diff/apply-selection \
  -H "Content-Type: application/json" \
  -H "x-repo-path: /path/to/repository" \
  -d '{"action":"stage","filePath":"README.md","lineIds":["<hunk id>:3"]}'

# Which version is running
curl http://localhost:3000/api/app-info

# Recovery points and the reflog side by side
curl -H "x-repo-path: /path/to/repository" \
  http://localhost:3000/api/git/recovery

# Search commits
curl -H "x-repo-path: /path/to/repository" \
  "http://localhost:3000/api/git/search/commits?query=fix&author=jane&limit=20"

# The plan an interactive rebase onto a commit would start from
curl -H "x-repo-path: /path/to/repository" \
  "http://localhost:3000/api/git/rebase/plan?onto=<commit>&autosquash=true"

# A diff with whitespace-only changes hidden
curl -H "x-repo-path: /path/to/repository" \
  "http://localhost:3000/api/git/diff/structured?path=src/app.ts&whitespace=ignore-all"

# Both versions of an image, as data URIs
curl -H "x-repo-path: /path/to/repository" \
  "http://localhost:3000/api/git/diff/blobs?path=logo.png&source=working-tree"

# Every worktree of this repository's family
curl -H "x-repo-path: /path/to/repository" \
  http://localhost:3000/api/worktrees

# The same, with dirty counts and ahead/behind (one or two Git calls each)
curl -H "x-repo-path: /path/to/repository" \
  http://localhost:3000/api/worktrees/status

# Create one on a new branch
curl -X POST http://localhost:3000/api/worktrees \
  -H "Content-Type: application/json" \
  -H "x-repo-path: /path/to/repository" \
  -d '{"targetPath":"/path/to/repository.worktrees/login","branchMode":"new","branch":"feature/login"}'

# What a prune would forget. Looking removes nothing.
curl -H "x-repo-path: /path/to/repository" \
  http://localhost:3000/api/worktrees/prune-preview

# Configured coding agents and the launch history
curl http://localhost:3000/api/agents
```

A repository path outside Latin-1 needs the encoded form the app itself uses, because an HTTP header cannot carry those bytes directly:

```bash
curl -H "x-repo-path: $(printf %s '/path/to/中文-仓库' | base64 -w0)" \
  -H "x-repo-path-encoding: base64" \
  http://localhost:3000/api/git/status
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

1. Run the application locally and run `npm test` (see [BUILDING.md](BUILDING.md)).
2. Exercise the changed workflow against a disposable repository, including error and conflict paths.
3. Do not commit generated builds, local configuration, keys, passphrases, or test repositories.
4. Keep the change focused and explain its user-visible behavior.
5. Update this README when buttons, requirements, storage, or workflows change.

## License

Multi-Git Client is free and open-source software released under the [MIT License](LICENSE).
