---
name: multi-git-agent
description: Operate Multi-Git through its JSON CLI to browse and clone repositories, inspect diffs, stage and commit changes, manage branches and worktrees, or push authorized changes. Use for Multi-Git workflows when a shell is available.
---

# Multi-Git agent

Use the running Multi-Git backend so repository locks, SSH profiles, operation tracking and recovery behavior remain shared with its GUI.

## Connect and discover

Use the `multi-git` command when it is on PATH: the user enabled it from the desktop app, or unpacked the terminal edition. Otherwise, in a source checkout, run `npm ci` and `npm run compile`, then `node <checkout>/scripts/multi-git.cjs`. `multi-git --version` says which version you have.

There is nothing to connect: the first command starts the shared per-user backend or joins the one the desktop app already runs, so locks, SSH accounts and operations are shared with the user's GUI. Pass `--server` (or `MULTI_GIT_URL`) only to reach a specific loopback server such as `npm start`. Run `app.info` to check.

Read `help` first: its JSON command catalogue includes input fields, HTTP method, whether a repository is required, and effect metadata, with a JSON Schema per command under `inputSchemas`. All output is one JSON envelope with `schemaVersion: 1` and `success`; execution has `data` or `error`. Exit 0 means success, 1 means transport/API failure, 2 means invalid input or refused write. With npm, use `npm run --silent agent -- ...` to keep stdout parseable.

Prefer the guided commands — `sync.fetch`, `pull`, `sync.push`, `ssh.inspect`/`ssh.select`, `remote.inspect`/`remote.toggle` — over raw `fetch` and `push`: they apply the desktop app's checks. When one answers `DECISION_REQUIRED`, nothing changed; show the user what the matching inspect command reports and repeat with `"confirmed": true` only when they agree. For an MCP client, see the `multi-git-mcp` skill.

## Work on an explicit repository

Inspect each command's `effects`: `mutates` indicates state-changing intent, `local` lists possible local changes, and `remote` is `none`, `read` or `write` for interaction with a remote repository/service (excluding the loopback CLI connection). Dry-run includes the same object at `data.effects`, alongside `request` and `note`. For example:

- `stage`: `{"mutates":true,"local":["index"],"remote":"none"}`.
- `fetch`: `{"mutates":true,"local":["object-database","local-refs","ref-prune"],"remote":"read"}`; pruning removes local tracking refs, not remote branches.
- `push`: `{"mutates":true,"local":["local-refs","repo-config"],"remote":"write"}`; it publishes remotely and can set local tracking configuration.

These are conservative possible effects across supported inputs, not a prediction of success. Creation effects include initialization of the new repository/worktree; `local-history` includes creating commits and advancing HEAD. Branch/worktree creation can write tracking configuration, and a detached worktree preview still includes effects possible in other branch modes. See the [effect definitions](../../docs/agent-cli.md#command-effects) for the full vocabulary.

Metadata is descriptive, not authorization or a sandbox guarantee. It excludes incidental logs, caches, authentication helpers, arbitrary hooks and effects introduced by custom Git configuration or external programs. Compare the effects and exact request with the user's authorized task; the CLI does not enforce granular permissions. Keep using `--allow-write` for every executed POST. Tolerate additive JSON fields, but require policy review for missing metadata or unfamiliar effect identifiers/enum values. Help and dry-run do not query repository state to refine these descriptions.

Pass `--repo <absolute-path>` for every repository command; the CLI never guesses from the active GUI tab. Paths are sent as UTF-8/base64 headers, including spaces and non-ASCII characters.

Pass command input through a UTF-8 JSON file using `--input <file>` or through stdin using `--input -`. Avoid shell-quoted JSON, especially in PowerShell. Unknown fields and options fail. GET input becomes query parameters; POST input becomes a JSON body. Use `help` as the field reference for the running CLI version.

For a commit task:

1. Read `status` and `diff` for the relevant paths (`source: "working-tree"` or `"index"`). Preserve unrelated staged changes; the commit command commits the entire current index.
2. Preview the exact `stage` request with `--dry-run` and a file such as `{"files":["README.md"]}`. The preview performs no server validation and changes nothing.
3. Execute the authorized stage request with `--allow-write`, then inspect its index diff and status.
4. Commit with a file such as `{"message":"docs: update the guide"}` and `--allow-write`; read status again.

`--allow-write` expresses intent to execute a mutation; it is not permission to expand the user's task. Fetch also changes refs and needs this flag. Push only when requested or already authorized. The CLI exposes no force-push field. The raw `push` skips the account check; `sync.push` runs it and asks for a decision when the key signs in as an unexpected account.

For cloning, use `repositories.list` with an optional GitHub user/organization owner. It returns at most 100 owned repositories, including private repositories the `gh` account can access. This is not a search of every repository shared with the account. Select `sshUrl` for an SSH profile or `url + ".git"` for HTTPS. Review `repo.clone` with the URL, existing `parentDir`, optional child `folderName` and optional `profileId`, then execute the authorized request. Listing uses GitHub CLI authentication, independent of the clone's SSH identity.

For parallel branch work, use `worktrees.list` and `worktrees.create` with an explicit target path and branch mode. Repository operations on the resulting worktree require its own `--repo` path.

## Failures and GUI handoff

On a backend failure, the error names the backend log; a `BACKEND_VERSION_MISMATCH` means another Multi-Git version is running and the user has to close it. On a timeout or uncertain write result, inspect status/history before retrying; the server may have completed the operation. Never blindly repeat a clone, commit or push. Missing `gh`, expired authentication and locked vaults need setup or user intervention; do not put tokens, passwords or private key contents into CLI arguments, output or test evidence.

Use the companion `multi-git-computer-use` skill for native folder pickers, visual review, dialogs, or functionality outside the CLI catalogue. Report which operations succeeded and what remains blocked. The CLI does not open GUI repository tabs; `repo.remember` only adds a recent entry.
