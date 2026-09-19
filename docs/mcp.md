# MCP server

`multi-git mcp` runs a Model Context Protocol server over stdio for AI agents. It uses the same shared backend and the same typed commands as the [JSON CLI](agent-cli.md), so an agent works with the same repository locks, SSH accounts and safety checks as you do in the desktop app.

## Adding it to an agent

Nothing is added to any agent for you. Settings → Terminal and agents → **MCP server for AI agents** → **Copy** gives an entry to paste into the agent's MCP configuration. It points at the stable `multi-git` launcher, so it keeps working after updates:

```json
{
  "mcpServers": {
    "multi-git": { "command": "/home/you/.local/bin/multi-git", "args": ["mcp"] }
  }
}
```

On Windows the command is `cmd.exe` with `["/d", "/c", "<install folder>\\multi-git.cmd", "mcp"]`, because MCP clients start servers without a shell and a `.cmd` file needs one.

## Read-only unless allowed

By default only reading tools are offered: status, diffs, history, branches, worktrees, recovery points, SSH profiles and setup, remote protocol, auto-pull, operations, prerequisites and agents. Add `--allow-write` to the arguments to also offer the core changing tools: stage, unstage, commit, create and switch branches, clone, remember a repository, create a worktree, `sync_fetch`, `pull`, `sync_push`, `ssh_select`, `ssh_verify`, `remote_toggle`, `auto-pull_set` and `operations_cancel`.

Never offered: force-pushing, reading secrets or passphrases, unlocking the vault, launching programs, and dispatching arbitrary API calls.

## How the tools behave

- Tool names are the CLI command names with `.` replaced by `_`. Each tool's description includes its effect metadata.
- Repository tools need `repo`: an absolute path. Nothing is guessed from an open window.
- Inputs are checked against a schema; unknown fields are refused.
- Every tool takes `dryRun: true`, which returns the exact request and its effects without running anything.
- Results are the CLI's JSON envelope, as text and as structured content.
- A workflow that needs the user's decision — a pull that would merge or rebase, switching an account over an existing setup, pushing as an unexpected account, switching SSH and HTTPS — fails with `DECISION_REQUIRED` and the reason. Nothing has changed. Show the user what the matching inspect tool reports, and call again with `confirmed: true` only if they agree.
- Nothing but protocol messages goes to stdout; diagnostics go to stderr.

The [multi-git-mcp skill](../skills/multi-git-mcp/SKILL.md) tells an agent how to use these well.
