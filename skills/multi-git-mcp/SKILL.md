---
name: multi-git-mcp
description: Work with Git repositories through the Multi-Git MCP server (tools such as status, diff, history, stage, commit, sync_fetch, pull, sync_push, ssh_select). Use when the multi-git MCP tools are available, to inspect repositories and make authorized changes with Multi-Git's account and safety checks.
---

# Multi-Git over MCP

The `multi-git` MCP server exposes Multi-Git's typed commands as tools. It shares a backend with the user's desktop app and terminal, so repository locks, SSH accounts and running operations are the same as theirs.

## What is available

Tools are the CLI commands with `.` replaced by `_`. Each description ends with its effects: `mutates`, the possible `local` changes and `remote` interaction (`none`, `read` or `write`). Read them before calling a tool; they are descriptions, not permission.

The server is read-only unless the user started it with `--allow-write`. Without it you can inspect — `status`, `diff`, `history`, `branches_list`, `worktrees_list`, `recovery_list`, `ssh_profiles`, `ssh_inspect`, `remote_inspect`, `auto-pull_get`, `operations_list`, `doctor` — but not change anything. If a change is needed and the tool is missing, tell the user it needs `--allow-write`; do not look for another way.

There is no force push, no secret or passphrase access, no vault unlocking and no way to launch programs. Those stay with the user.

## Calling tools

- Pass `repo` as an absolute path to every repository tool. Never guess it from an open window.
- Use `dryRun: true` to see the exact request and its effects before an unfamiliar change.
- Results are `{ schemaVersion: 1, success, command, data }` in structured content.

## Decisions belong to the user

Some workflows answer `DECISION_REQUIRED` instead of acting. Nothing has changed when they do.

| Tool | Asks when | Show the user |
| --- | --- | --- |
| `pull` | The pull would merge or rebase rather than fast-forward | The incoming and outgoing commits (`history`, or the message) |
| `sync_push` | The key signs in as an account other than the one the remote expects | The account from `ssh_verify` |
| `ssh_select` | The repository already has an account or author set up | `ssh_inspect` for that profile |
| `remote_toggle` | Always | `remote_inspect`: the current and proposed URL |

Repeat the call with `confirmed: true` only after the user agrees. Keep a deliberate commit author with `keepIdentity: true` on `ssh_select`.

## A commit

1. `status`, then `diff` for the files in question (`source`: `working-tree` or `index`).
2. `stage` exactly the files the task is about. `commit` commits the whole index, so leave anything already staged by the user alone, or ask.
3. `commit` with a message, then `status` again.
4. Push only when asked: `sync_push`. It publishes a branch that has no upstream yet.

## Syncing

`sync_fetch` fetches and, when the user has auto-pull on, fast-forwards a branch that is purely behind. Its `autoPull` result says `off`, `current`, `blocked` with the reason, or `pulled`. Report a blocked reason rather than working around it. Use `pull` when the user asks to bring changes in.

## When something goes wrong

A timeout or unclear failure after a change: check `status` and `operations_list` before retrying — the operation may have finished. Never repeat a clone, commit or push blindly. A locked vault, a key that needs a passphrase, or a missing GitHub CLI needs the user; say what is needed. See [docs/mcp.md](../../docs/mcp.md) and [docs/agent-cli.md](../../docs/agent-cli.md).
