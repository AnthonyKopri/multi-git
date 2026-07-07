# Multi-Git Client

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-desktop-47848f.svg)](https://www.electronjs.org/)

Multi-Git Client is a lightweight Git GUI for people who work across multiple repositories, GitHub accounts, and SSH identities. It gives you a local desktop or browser-based interface for day-to-day Git work, with first-class support for switching SSH keys per repository.

The app is intentionally simple: a local Express backend executes Git commands, and a web UI or Electron shell gives you a practical interface for staging, committing, branching, syncing, inspecting history, resolving conflicts, and managing SSH profiles.

## Highlights

- Manage multiple local Git repositories from one UI.
- Switch SSH keys per repository before pushing, pulling, fetching, or cloning.
- Create and test SSH profiles, generate new SSH keys, and copy public keys.
- Store SSH passphrases in an optional encrypted local vault.
- Auto-select an account profile from repository origin URL rules.
- Stage, unstage, discard, commit, amend, and undo the last commit.
- View diffs, modified files, file contents, file blame, and commit history.
- Fetch, pull, push, force-push with lease, and convert GitHub HTTPS remotes to SSH.
- Create, checkout, merge, rebase, and delete branches.
- Clone repositories with the selected SSH profile.
- Resolve merge and rebase conflicts from the UI.
- Stash, apply, pop, and drop stashes.
- Create, push, inspect, and delete tags.
- Cherry-pick, revert, and reset from commit history.
- Use a safety net for recent risky operations and discarded files.

## Screens

Multi-Git is organized around a few everyday Git workflows:

- **Repository header**: select recent repositories, clone a repository, inspect the current branch, and switch the active SSH key.
- **Staging area**: stage files, inspect diffs, discard changes, commit, amend, and undo the last commit.
- **Workspace explorer**: browse repository files and toggle Git blame for a selected file.
- **Branch drawer**: create, checkout, merge, rebase, and delete local branches while seeing remote branches.
- **Remote sync panel**: fetch, pull, push, force-push with lease, and convert compatible GitHub HTTPS remotes to SSH.
- **History drawer**: inspect commits, view changed files, create tags, cherry-pick, revert, reset, and inspect per-file history.
- **SSH Profile Manager**: register keys, generate keys, save optional identities, test profiles, copy public keys, and configure auto-select rules.
- **Safety Net**: undo recent checkpointed operations and restore recently discarded files.

## Requirements

- Git available on your `PATH`.
- Node.js 18 or newer.
- npm.
- OpenSSH tools available on your `PATH` for SSH key validation and generation:
  - `ssh`
  - `ssh-keygen`

For packaged desktop builds, the current `electron-builder` configuration targets Windows NSIS and portable executables.

## Quick Start

Clone the repository and install dependencies:

```bash
git clone https://github.com/AnthonyKopri/multi-git.git
cd multi-git
npm install
```

Run the browser-based app:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

Run the Electron desktop app:

```bash
npm run desktop
```

The desktop app starts the local backend automatically and loads it in an Electron window. In desktop mode, the backend asks the operating system for an available port, so a busy port `3000` should not prevent startup.

## Common Workflows

### Open an Existing Repository

1. Start Multi-Git with `npm start` or `npm run desktop`.
2. Select a local Git repository folder from the welcome screen.
3. Multi-Git stores the repository path in your recent repositories list.
4. Use the staging, sync, branch, history, and explorer panels as needed.

### Add an SSH Profile

1. Open **SSH Profile Manager**.
2. Enter a profile label, private key path, and optional Git author identity.
3. Optionally enter a passphrase and choose whether to keep it in the encrypted vault.
4. Click **Test** to validate the key with `ssh-keygen`.
5. Save the profile.

An SSH profile contains:

- a human-friendly label,
- a private key path,
- optional `user.name` and `user.email` values for repository commits,
- optional saved passphrase metadata.

### Generate a New SSH Key

1. Open **SSH Profile Manager**.
2. Fill out **Generate New SSH Key**.
3. Choose a key type, such as `ed25519` or `rsa`.
4. Add an optional passphrase.
5. Create the key and profile.
6. Copy the generated public key and add it to your Git host.

Generated keys are written to your user `.ssh` directory using a unique file name derived from the profile label.

### Use Different GitHub Accounts

A typical setup might look like this:

| Profile | Key | Identity | Example repository |
| --- | --- | --- | --- |
| Personal | `~/.ssh/id_ed25519_personal` | `Jane Doe <jane@personal.example>` | `github.com/janedoe/*` |
| Work | `~/.ssh/id_ed25519_work` | `Jane Doe <jane@company.example>` | `github.com/company/*` |

Then add auto-select rules:

| Match text | Profile |
| --- | --- |
| `github.com/janedoe` | Personal |
| `github.com/company` | Work |

When a repository opens, Multi-Git can match the origin remote URL and select the right SSH profile.

### Convert a GitHub HTTPS Remote to SSH

SSH profiles only affect SSH remotes. If a repository uses a GitHub HTTPS origin like:

```text
https://github.com/owner/repo.git
```

Multi-Git can convert it to:

```text
git@github.com:owner/repo.git
```

Use **Convert Origin to SSH** in the Remote Sync panel. Non-GitHub or non-standard HTTPS remotes need to be changed manually.

### Clone with an SSH Profile

1. Click **Clone**.
2. Enter an SSH repository URL:

```text
git@github.com:owner/repo.git
```

3. Select the destination folder.
4. Pick an SSH profile or use your system SSH configuration.
5. Start the clone.

If you select an SSH profile, Multi-Git runs `git clone` with a custom `GIT_SSH_COMMAND` that points Git at that profile's private key.

### Commit with the Right Identity

SSH keys authenticate network operations, but commit authorship comes from Git config. Multi-Git lets you set the local repository identity:

```bash
git config user.name "Jane Doe"
git config user.email "jane@example.com"
```

You can edit that identity from the UI. If a selected SSH profile has an expected name and email, Multi-Git can warn when the repository identity does not match.

### Resolve Conflicts

When merge, rebase, cherry-pick, or revert operations hit conflicts:

1. Multi-Git shows a conflict banner.
2. Open each conflicting file.
3. Choose current/incoming sections or edit the file manually.
4. Save and stage the resolved file.
5. Continue the operation, or abort it.

## Safety Features

Multi-Git includes a few guardrails for common mistakes:

- Risky history operations capture in-memory checkpoints before merge, rebase, cherry-pick, revert, and reset.
- Checkpoints can be undone from **Safety Net** until the app restarts.
- Discarded file contents are copied to a local temporary trash area before deletion.
- Trash entries expire after 24 hours and keep the most recent 30 saved files per repository.
- Force-push uses `--force-with-lease`, not plain `--force`.
- The backend binds to `127.0.0.1` and rejects non-localhost Host/Origin values.

These features are helpful, but they are not a substitute for normal Git backups, remote branches, or careful review before destructive operations.

## Local Data and Security

Multi-Git stores application state in your home directory:

```text
~/.multi-git-client-config.json
~/.multi-git-client-secrets.json
```

The config file contains recent repositories, SSH profile metadata, and account rules. The secrets file is used only if you save SSH passphrases.

Saved passphrases are encrypted locally with:

- AES-256-GCM for encryption,
- `crypto.scryptSync` for deriving a key from your master key,
- a random salt and IV.

The vault is unlocked in memory while the app is running. Lock it from the UI when you no longer need saved passphrases.

The backend executes Git and filesystem operations for local repositories. For that reason, it is designed as a local-only service and should not be exposed to a network.

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

## npm Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the Express app on `http://localhost:3000`. |
| `npm run dev` | Alias for `npm start`. |
| `npm run desktop` | Start the Electron desktop app. |
| `npm run build` | Build with Electron Builder using the package config. |
| `npm run build-win` | Build Windows NSIS and portable targets. |
| `npm run build-standalone` | Build a Windows portable target into `dist-standalone`. |

## Local API Examples

The UI talks to a local JSON API. These examples are useful for debugging while the server is running.

Get app config:

```bash
curl http://localhost:3000/api/config
```

Check repository status:

```bash
curl -H "x-repo-path: /path/to/repo" \
  http://localhost:3000/api/git/status
```

Stage files:

```bash
curl -X POST http://localhost:3000/api/git/stage \
  -H "Content-Type: application/json" \
  -H "x-repo-path: /path/to/repo" \
  -d '{"files":["README.md"]}'
```

Commit staged changes:

```bash
curl -X POST http://localhost:3000/api/git/commit \
  -H "Content-Type: application/json" \
  -H "x-repo-path: /path/to/repo" \
  -d '{"message":"Update documentation"}'
```

Fetch with an SSH profile:

```bash
curl -X POST http://localhost:3000/api/git/fetch \
  -H "Content-Type: application/json" \
  -H "x-repo-path: /path/to/repo" \
  -d '{"profileId":"PROFILE_ID"}'
```

On Windows PowerShell, quote JSON accordingly:

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/git/stage `
  -Headers @{ "x-repo-path" = "C:\path\to\repo" } `
  -ContentType "application/json" `
  -Body '{"files":["README.md"]}'
```

## Development Notes

- The project currently uses plain JavaScript, Express, and Electron.
- There is no build step for the web UI.
- Static assets are served directly from `public/`.
- Git commands are executed with `spawn`, with repository paths passed through request headers.
- SSH profile operations use `GIT_SSH_COMMAND` so Git uses the selected private key for a single operation.
- The Electron preload exposes only a folder picker bridge as `window.desktopApi.selectFolder()`.

## Troubleshooting

### `git` is not recognized

Install Git and make sure it is available on your terminal `PATH`.

### SSH profile does not affect push or pull

Check that the repository origin is an SSH URL:

```bash
git remote -v
```

SSH profiles do not apply to HTTPS remotes. Convert a GitHub HTTPS origin from the UI or run:

```bash
git remote set-url origin git@github.com:owner/repo.git
```

### Vault is locked

Unlock the vault from the SSH Profile Manager before using profiles with saved passphrases.

### Port 3000 is already in use

Browser mode uses `PORT` or `3000` by default:

```bash
PORT=3001 npm start
```

In PowerShell:

```powershell
$env:PORT = "3001"
npm start
```

Desktop mode automatically asks the operating system for a free port.

### Electron build output is large

That is normal for Electron. Generated folders such as `dist/` and `dist-standalone/` are ignored by Git.

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
