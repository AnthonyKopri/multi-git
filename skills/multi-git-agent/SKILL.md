---
name: multi-git-agent
description: Operate Multi-Git through its JSON CLI to browse and clone repositories, inspect diffs, stage and commit changes, manage branches and worktrees, or push authorized changes. Use for Multi-Git workflows when a shell is available.
---

# Multi-Git agent

Use the running Multi-Git backend so repository locks, SSH profiles, operation tracking and recovery behavior remain shared with its GUI.

## Connect and discover

Locate the Multi-Git source checkout. After `npm ci` and `npm run compile`, invoke `node <checkout>/scripts/multi-git.cjs`. An optional `npm link` makes `multi-git` available on PATH; installation is not required. Do not assume a globally installed executable is this checkout.

Read `help` first: its JSON command catalogue includes input fields, HTTP method and whether a repository is required. All output is one JSON envelope with `schemaVersion: 1`, `success`, and either `data` or `error`. Exit 0 means success, 1 means transport/API failure, 2 means invalid input or refused write. With npm, use `npm run --silent agent -- ...` to keep stdout parseable.

Start the desktop app or `npm start`. Copy **Settings → Git and GitHub → Agent CLI connection** and pass it with `--server`. Desktop ports change at restart. Browser mode defaults to `http://127.0.0.1:3000`; `MULTI_GIT_URL` can override it. Run `app.info` to verify the connection. Only loopback HTTP origins are accepted, and redirects are refused.

## Work on an explicit repository

Pass `--repo <absolute-path>` for every repository command; the CLI never guesses from the active GUI tab. Paths are sent as UTF-8/base64 headers, including spaces and non-ASCII characters.

Pass command input through a UTF-8 JSON file using `--input <file>` or through stdin using `--input -`. Avoid shell-quoted JSON, especially in PowerShell. Unknown fields and options fail. GET input becomes query parameters; POST input becomes a JSON body. Use `help` as the field reference for the running CLI version.

For a commit task:

1. Read `status` and `diff` for the relevant paths (`source: "working-tree"` or `"index"`). Preserve unrelated staged changes; the commit command commits the entire current index.
2. Preview the exact `stage` request with `--dry-run` and a file such as `{"files":["README.md"]}`. The preview performs no server validation and changes nothing.
3. Execute the authorized stage request with `--allow-write`, then inspect its index diff and status.
4. Commit with a file such as `{"message":"docs: update the guide"}` and `--allow-write`; read status again.

`--allow-write` expresses intent to execute a mutation; it is not permission to expand the user's task. Fetch also changes refs and needs this flag. Push only when requested or already authorized. The CLI exposes no force-push field. A push through the CLI does not run the GUI's account-verification prompt: verify the intended origin and SSH profile first, using the GUI when account identity is uncertain.

For cloning, use `repositories.list` with an optional GitHub user/organization owner. It returns at most 100 owned repositories, including private repositories the `gh` account can access. This is not a search of every repository shared with the account. Select `sshUrl` for an SSH profile or `url + ".git"` for HTTPS. Review `repo.clone` with the URL, existing `parentDir`, optional child `folderName` and optional `profileId`, then execute the authorized request. Listing uses GitHub CLI authentication, independent of the clone's SSH identity.

For parallel branch work, use `worktrees.list` and `worktrees.create` with an explicit target path and branch mode. Repository operations on the resulting worktree require its own `--repo` path.

## Failures and GUI handoff

On a connection failure, confirm that the app is running and recopy its port. On a timeout or uncertain write result, inspect status/history before retrying; the server may have completed the operation. Never blindly repeat a clone, commit or push. Missing `gh`, expired authentication and locked vaults need setup or user intervention; do not put tokens, passwords or private key contents into CLI arguments, output or test evidence.

Use the companion `multi-git-computer-use` skill for native folder pickers, visual review, dialogs, or functionality outside the CLI catalogue. Report which operations succeeded and what remains blocked. The CLI does not open GUI repository tabs; `repo.remember` only adds a recent entry.
