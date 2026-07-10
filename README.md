# Multi-Git Client

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-desktop-47848f.svg)](https://www.electronjs.org/)

Multi-Git Client is a desktop Git client for people who work across multiple repositories, GitHub accounts, and SSH identities. It is meant to feel closer to GitHub Desktop than a terminal cheat sheet: open a repository, choose an account, review changes, click buttons, and let the app handle the Git commands behind the scenes.

The app runs locally. An Electron window provides the desktop experience, while a local Express backend performs Git and filesystem operations for the UI.

## What You Can Do

- Open recent local repositories from a repository picker.
- Clone repositories from the desktop UI.
- Switch SSH key profiles per repository before fetch, pull, push, or clone.
- Generate, test, and manage SSH keys without leaving the app.
- Save SSH passphrases in an optional encrypted local vault.
- Auto-select the right account based on a repository's origin URL.
- Stage, unstage, discard, commit, amend, and undo the last commit.
- Review file diffs and browse changed files.
- Browse the repository tree and inspect Git blame.
- Fetch, pull, push, and force-push with lease.
- Convert compatible GitHub HTTPS remotes to SSH.
- Create, checkout, merge, rebase, and delete branches.
- Resolve merge and rebase conflicts from a visual conflict workflow.
- Manage stashes and tags.
- Cherry-pick, revert, reset, and inspect commits from the history drawer.
- Restore recently discarded files and undo recent risky operations from Safety Net.

## Install And Launch

### For Desktop Users

Download a packaged build from the project's releases when one is available, then launch **Multi-Git Client** like a normal desktop app.

Once the window opens, you should not need to type Git commands for day-to-day work. The app exposes common Git actions through repository panels, tabs, buttons, dropdowns, and dialogs.

### From Source

If you are running the app from source, install dependencies once:

```bash
git clone https://github.com/AnthonyKopri/multi-git.git
cd multi-git
npm install
```

Start the desktop app:

```bash
npm run desktop
```

You can also run the browser version during development:

```bash
npm start
```

Then open `http://localhost:3000`.

## Requirements

- Git installed and available to the app.
- OpenSSH tools available for SSH key validation and generation.
- Node.js 18 or newer when running from source.

For normal use, you interact with the app UI. Git, OpenSSH, and Node are runtime/development requirements, not the primary user interface.

## First Run

When Multi-Git opens, the welcome screen gives you three main choices:

1. **Select Folder**: open an existing local Git repository.
2. **Clone**: clone a remote repository into a local folder.
3. **Recent Repositories**: reopen a repository you already used.

After a repository is opened, the main window shows:

- a top header for the current repository, branch, and SSH key profile,
- a left workflow area for branches, stashes, tags, and Safety Net,
- central tabs for **Staging Area** and **Workspace Explorer**,
- a right-side **Remote Sync** and **Recent Commits** area,
- a bottom **Terminal Log** that shows what the app did for transparency.

## Main UI Areas

### Repository Header

Use the **Repository** segment to switch between recent repositories or open another folder.

Use the **Branch** segment to see the current branch and ahead/behind indicators.

Use the **SSH Key** segment to pick the active SSH profile for the current repository. This is the profile used by sync actions such as fetch, pull, push, and tag push.

### Staging Area

The **Staging Area** tab is the everyday commit workflow.

- **Unstaged Changes** shows modified and untracked files.
- **Stage All** moves every unstaged file into the staged list.
- Clicking an individual file lets you inspect its diff.
- **Stage** and **Unstage** move selected files between unstaged and staged.
- **Discard** removes local changes for a file.
- **Discard All** removes all unstaged changes after confirmation.
- **Staged Changes** shows what will be included in the next commit.
- The commit box lets you enter a message, optionally amend the previous commit, and create the commit.
- **Undo Last Commit** performs a soft undo so the last commit's changes stay staged.

The diff view is read-oriented: select a changed file, review additions and deletions, then use the staging buttons to decide what belongs in the next commit.

### Workspace Explorer

The **Workspace Explorer** tab lets you inspect repository files without switching tools.

- Browse the repository tree.
- Select a file to view its contents.
- Toggle **Blame** to see commit attribution per line.
- Open commit details from related history views.

### Branches

The **Branches** panel shows local and remote branches.

- Create a branch from the branch creation field.
- Click a local branch to check it out.
- Click a remote branch to create and check out a local tracking branch.
- Use the delete action on local branches.
- If a branch is not fully merged, the UI can offer a force-delete confirmation.

### Merge And Rebase

Use the **Merge / Rebase** panel to integrate another branch into the current branch.

- Pick a branch from the dropdown.
- Click **Merge** to merge it into the current branch.
- Click **Rebase** to replay the current branch onto the selected branch.
- If conflicts happen, Multi-Git opens the conflict workflow.
- Use the conflict banner to continue or abort once files are resolved.

### Remote Sync

The **Remote Sync** panel handles network operations.

- **Fetch** updates remote tracking information.
- **Pull** pulls the current branch from origin.
- **Push** pushes the current branch to origin.
- If a push is rejected because the remote has new commits, the app can prompt for a safer force-push with lease.
- **Convert Origin to SSH** converts compatible GitHub HTTPS origins to SSH so SSH profiles can be used.

The panel also shows which SSH profile is active. Click the profile line or the header's **SSH Key** segment to change it.

### Recent Commits

The **Recent Commits** list shows commit history for the current repository.

Click a commit to open the commit drawer. From there you can:

- view commit metadata,
- inspect changed files,
- open file history,
- copy the commit SHA,
- cherry-pick the commit,
- revert the commit,
- reset the current branch to that commit,
- create a tag at that commit.

Reset actions create a Safety Net checkpoint before running.

### Stashes

The **Stashes** panel manages temporary work.

- Click **Stash** to stash current changes, including untracked files.
- Use **Apply** to apply a stash while keeping it.
- Use **Pop** to apply and remove a stash.
- Use **Drop** to delete a stash after confirmation.

### Tags

The **Tags** panel lists local tags.

- Show the tagged commit.
- Push a tag to origin using the active SSH profile.
- Delete a local tag after confirmation.
- Create a tag from the commit drawer in **Recent Commits**.

### Safety Net

The **Safety Net** panel exists for "I clicked the scary thing" moments.

- **Undoable Operations** lists recent checkpointed operations such as merge, rebase, cherry-pick, revert, and reset.
- **Recently Discarded** lists files copied aside before discard actions.
- Restore discarded files from the UI.
- Undo checkpointed operations while the app is still running.

Checkpoints are in-memory and reset when the app restarts. Discarded file copies expire after 24 hours and keep the most recent 30 entries per repository.

## SSH Profiles And Accounts

Open **SSH Profile Manager** from the **SSH Key** header dropdown.

### Add An Existing Key

Select **Add Key From File**, then use the profile form to add:

- **Profile Name / Label**: a readable account name, such as `Personal` or `Work`.
- **Private Key Path**: the private key file to use.
- **Name** and **Email**: optional commit identity for repositories using this profile.
- **SSH Passphrase**: optional passphrase for encrypted keys.
- **Save passphrase in the encrypted vault**: store the passphrase locally so Multi-Git can use it after you unlock the vault.

Use **Test** to validate the key, then **Save Profile**.

### Generate A New Key

Select **Generate Key**, then:

1. Enter a profile label.
2. Pick a key type.
3. Optionally choose a key file name.
4. Optionally enter a passphrase.
5. Click **Create Key + Profile**.
6. Copy the public key from **Last Generated Key** and add it to your Git host.

The new profile appears in **Registered Profiles** immediately.

### Passphrase Vault

The passphrase vault is optional. You only need it when you want Multi-Git to save an SSH key passphrase.

- **First time:** Select **Set Up Vault**, choose a master key, and confirm it. The master key is not stored and cannot be recovered, so keep it somewhere safe.
- **Locked:** Saved passphrases remain encrypted on disk but cannot be used. Select **Unlock Vault** and enter the master key before saving or using a passphrase.
- **Unlocked:** Multi-Git can use saved passphrases and save new ones during the current app session. Select **Lock Vault** when you are finished to remove the decryption key from app memory.

### Auto-Select Rules

Use **Auto-Select Rules** to map repositories to accounts.

Example:

| Match text | Selected profile |
| --- | --- |
| `github.com/your-name` | Personal |
| `github.com/your-company` | Work |

When a repository opens, Multi-Git compares its origin URL with these rules and can select the matching SSH profile automatically.

### Commit Identity

The SSH profile controls authentication for network operations. Commit authorship is separate. Use the **Identity** row in the SSH profile dropdown to edit the repository's commit name and email.

If a profile has an expected name and email, Multi-Git can warn when the repository identity does not match the selected account.

## Conflict Resolution

When a merge, rebase, cherry-pick, or revert hits conflicts, Multi-Git shows a conflict banner in the staging area.

To resolve:

1. Click a conflicted file.
2. Review the conflict blocks.
3. Choose the current version, incoming version, or edit the resolved content manually.
4. Click **Save & Resolve** to write and stage the file.
5. Repeat for every conflicted file.
6. Click **Continue** from the conflict banner.

If you want to abandon the operation, use **Abort** from the same banner.

## Local Data And Security

Multi-Git stores local app state in your home directory:

```text
~/.multi-git-client-config.json
~/.multi-git-client-secrets.json
```

The config file contains recent repositories, SSH profile metadata, and account rules. The secrets file is used only if you save SSH passphrases.

Saved passphrases are encrypted locally with:

- AES-256-GCM for encryption,
- a key derived from your master key,
- a random salt and IV.

The vault is unlocked only in memory while the app is running. Set it up from **SSH Profile Manager** only if you want to save SSH passphrases. Use **Lock Vault** when you no longer need saved passphrases; this removes the decryption key from memory while leaving the encrypted vault file intact.

The backend is intended for local use only. It binds to `127.0.0.1` and rejects non-localhost Host/Origin values because it can execute Git and filesystem operations on local repositories.

## Project Structure

```text
multi-git/
|-- main.js          # Electron entry point
|-- preload.js       # Electron preload bridge for folder selection
|-- server.js        # Express API, Git command runner, config, secrets, safety net
|-- public/
|   |-- index.html   # App shell
|   |-- app.js       # Browser UI behavior
|   `-- style.css    # App styles
|-- package.json     # Scripts, dependencies, Electron Builder config
`-- LICENSE          # MIT license
```

## Developer Commands

These commands are for contributors and source builds, not for normal Git workflows inside the app.

| Command | Description |
| --- | --- |
| `npm start` | Start the local browser app on `http://localhost:3000`. |
| `npm run dev` | Alias for `npm start`. |
| `npm run desktop` | Start the Electron desktop app. |
| `npm run build` | Build with Electron Builder using the package config. |
| `npm run build-win` | Build Windows NSIS and portable targets. |
| `npm run build-standalone` | Build a Windows portable target into `dist-standalone`. |

## Developer API Reference

The desktop UI talks to a local JSON API. Most users should not need this section, but it is useful for debugging and contributions.

Common API areas include:

- `/api/config` for recent repositories, SSH profiles, and account rules.
- `/api/secrets/*` for vault status, unlock, and lock.
- `/api/config/ssh/*` for SSH profiles, key generation, public keys, and validation.
- `/api/git/status`, `/api/git/diff`, and `/api/git/log` for repository inspection.
- `/api/git/stage`, `/api/git/unstage`, `/api/git/discard`, and `/api/git/commit` for staging and committing.
- `/api/git/fetch`, `/api/git/pull`, `/api/git/push`, and `/api/git/clone` for sync and clone operations.
- `/api/git/merge`, `/api/git/rebase`, `/api/git/abort`, and `/api/git/conflict/*` for branch integration and conflict resolution.
- `/api/git/stash/*`, `/api/git/tags`, `/api/git/tag`, and `/api/git/tag/push` for stashes and tags.

Repository-scoped endpoints receive the selected repository path through the `x-repo-path` header.

## Troubleshooting

### The App Cannot Find Git

Install Git and make sure it is available to desktop applications on your system path. Restart Multi-Git after changing PATH settings.

### SSH Profile Does Not Affect Push Or Pull

Open the **Remote Sync** panel and check the origin remote. SSH profiles apply to SSH remotes, not HTTPS remotes.

If the repository uses a compatible GitHub HTTPS origin, click **Convert Origin to SSH**. For other hosts, update the remote URL in your Git hosting settings or another Git tool.

### Vault Is Locked

Open **SSH Profile Manager** and unlock the vault before using profiles with saved passphrases.

### Port 3000 Is Already In Use

The Electron desktop app chooses a free local port automatically. If you are running browser mode from source, set a different `PORT` before starting the server.

### Build Output Is Large

That is normal for Electron apps. Generated folders such as `dist/` and `dist-standalone/` are ignored by Git.

## Contributing

Contributions are welcome. Good first contributions include:

- bug fixes for Git edge cases,
- accessibility improvements,
- cross-platform testing,
- UI polish,
- tests around parsing Git output,
- documentation and screenshots,
- packaging improvements for macOS and Linux.

Before opening a pull request:

1. Run the app locally.
2. Test the workflow you changed against a disposable repository.
3. Avoid committing generated build output or local secrets.
4. Keep changes focused and describe the user-facing behavior.

There is not currently a dedicated automated test script. If you add tests, please include the npm script needed to run them.

## License

Multi-Git Client is released under the [MIT License](LICENSE).
