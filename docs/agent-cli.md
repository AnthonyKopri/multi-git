# Agent CLI

`multi-git` is one command with four faces: JSON commands for scripts and agents (this page), a guided terminal UI ([terminal.md](terminal.md)), an MCP server for AI agents ([mcp.md](mcp.md)), and `multi-git update`.

## Getting it

- **From the desktop app:** Settings → Terminal and agents → **Enable**, or **Enable multi-git in your terminal** on the welcome screen. This installs the terminal edition for your user account and puts `multi-git` on PATH.
- **Without the desktop app:** download `Multi-Git-Terminal-<version>-<os>-<arch>` for your system from the release page, unpack it, and run `multi-git` (Windows: `multi-git.cmd`) from that folder. It carries its own Node runtime; only Git is required.
- **From a source checkout:** `npm ci`, `npm run compile`, then `node scripts/multi-git.cjs`. `npm link` puts that checkout on PATH.

## Connecting

There is nothing to configure. The first `multi-git` command starts the shared per-user backend, or joins the one the desktop app or another terminal already started, so every client shares one set of repository locks, one operations list and one unlocked vault. The backend exits a minute after its last client. `--server <loopback origin>` or `MULTI_GIT_URL` still override this and talk to that server instead, which is what `npm start` users want. `help`, `--version` and `--dry-run` never start or contact a backend.

The commands are the same in PowerShell, on macOS and on Linux; only the repository path is written the way the operating system writes it (`"D:\work\my repo"` on Windows, `"/Users/you/work/my repo"` on macOS, `"/home/you/work/my repo"` on Linux).

```bash
multi-git app.info
multi-git status --repo "/home/you/work/my repo"
```

`help` returns the machine-readable command catalogue: inputs, repository requirements and effect metadata under `commands`, a JSON Schema for each command's input under `inputSchemas`, and the non-API modes under `modes`. Commands cover repository browsing and cloning, remembering local repositories, status and diffs, history, branches, staging, commits, fetch and push, the guided sync workflows, SSH accounts, remote protocol, worktrees, recovery listings, operations and agent listings. `repo.remember` adds a recent entry; it does not switch an open GUI window.

### Guided workflows

`fetch`, `push` and the other raw commands behave exactly as before. The guided commands add the desktop app's checks:

| Command | What it adds |
| --- | --- |
| `sync.fetch` | After fetching, fast-forwards the branch when auto-pull is on and it is purely behind with no local edits. Reports `autoPull` as `off`, `current`, `blocked` with the reason, or `pulled`. The decision is made once, in the backend, under the repository lock. |
| `pull` | A fast-forward goes ahead; a pull that `pull.ff=only` would refuse is refused; a merge or rebase answers `DECISION_REQUIRED` until repeated with `"confirmed": true`. |
| `sync.push` | Pushes, or publishes a branch with no upstream. When the profile's key signs in as a different account than the remote expects, answers `DECISION_REQUIRED` until confirmed. Never forces. |
| `ssh.inspect` / `ssh.select` | Shows what switching accounts would change, then switches SSH routing and the commit author together, keeping custom `core.sshCommand` settings. Overwriting an existing setup needs `"confirmed": true`; `"keepIdentity": true` keeps the author. |
| `ssh.verify` | Asks the SSH host which account the key signs in as. |
| `remote.inspect` / `remote.toggle` | Shows origin and the SSH or HTTPS URL it would switch to, then switches after confirmation. |
| `auto-pull.get` / `auto-pull.set` | The global auto-pull switch. Off by default. |
| `operations.list` / `operations.cancel` | Running and recent backend operations, and cancelling one. |
| `doctor` | Git and optional tools. |

A `DECISION_REQUIRED` answer is a 409 with the reason; nothing has changed. Show the user what the inspect command reports, and repeat with `"confirmed": true` only when they agree.

Save request data as UTF-8 JSON instead of escaping it into a shell command:

```json
{"files":["README.md"]}
```

```bash
node scripts/multi-git.cjs stage --repo "/home/you/work/my repo" --input stage.json --dry-run
node scripts/multi-git.cjs stage --repo "/home/you/work/my repo" --input stage.json --allow-write
```

`--input -` reads JSON from stdin. GET command input becomes query parameters. Unknown command names, options and fields are rejected, and input is checked against the command's schema before anything is contacted. `--dry-run` prints the request without contacting the server; it does not check filesystem state or run server validation. All POST commands, including fetch and remember, require `--allow-write`. Force push and arbitrary API dispatch are not exposed. The raw `push` uses backend SSH routing without the account check; `sync.push` runs it.

## Command effects

Every command in `help.commands` includes an `effects` object. A dry-run returns the same metadata at `data.effects`, alongside the existing `data.request` and `data.note`. Normal execution output and HTTP requests are unchanged.

```json
{"mutates":true,"local":["index"],"remote":"none"}
```

`mutates` describes state-changing intent: it is `true` for POST commands and `false` for GET commands. `local` lists possible application-level changes. `remote` is `none`, `read`, or `write`, describing interaction with a remote repository or service, excluding the CLI's loopback connection to Multi-Git. `repositories.list`, for example, reads GitHub without mutating repository state.

| Local identifier | Meaning |
| --- | --- |
| `app-config` | Update Multi-Git's application configuration, such as recent repositories. |
| `repository-create` | Create and initialize a repository, including its files, objects, refs, index and configuration. |
| `index` | Change the staged contents or index state. |
| `local-history` | Create commits and advance HEAD, including the corresponding local refs and objects. |
| `local-refs` | Create or update local branch or remote-tracking refs. |
| `head` | Change the checked-out branch or HEAD position. |
| `working-tree` | Update files in the working tree. |
| `repo-config` | Write repository configuration, including branch tracking settings. |
| `object-database` | Write fetched Git objects to the local repository. |
| `ref-prune` | Remove stale local remote-tracking refs during fetch. |
| `worktree-create` | Create a linked worktree, including its files, index, HEAD and registration metadata. |
| `ssh-agent` | Load or unload keys in the machine's SSH agent. |
| `operation-control` | Cancel a running backend operation. |

Examples from the catalogue:

| Command | `mutates` | `local` | `remote` |
| --- | --- | --- | --- |
| `stage` | `true` | `["index"]` | `none` |
| `fetch` | `true` | `["object-database", "local-refs", "ref-prune"]` | `read` |
| `push` | `true` | `["local-refs", "repo-config"]` | `write` |

The metadata is a conservative description of possible effects across supported inputs, not a forecast of what will succeed or a record of what happened. For example, worktree creation includes `local-refs` even in a detached preview, and branch/worktree creation includes `repo-config` because Git's automatic tracking configuration can write it. Fetch can prune local tracking refs without deleting branches on the remote. Push can publish commits and update local tracking configuration.

The CLI reads these static descriptions from its catalogue without additional filesystem, Git or server queries. Help works offline, and dry-run still performs no server validation. Effect descriptions exclude incidental writes such as logs, caches, authentication helpers and arbitrary Git hooks; they are not a sandbox guarantee or an exhaustive account of effects introduced by custom Git configuration or external programs.

Effects describe operations; they do not authorize them. All POST commands still require `--allow-write` for execution, and the gate remains based on HTTP method. There are no granular permission flags or risk scores. A caller can use the metadata to decide whether a command fits the user's authorization, but must apply that policy itself.

These fields are additive within `schemaVersion: 1`. Consumers should tolerate unknown JSON fields and require policy review for missing effect metadata, unfamiliar effect identifiers or unrecognized enum values, rather than assuming they are harmless. The `local` array is a set of possible effects; its order has no policy meaning. New catalogue commands must supply typed effect metadata and receive a contract-test review.

## Output and failures

Output is always one JSON line (`--json` is accepted for compatibility). With npm use `npm run --silent agent -- ...` to suppress npm's own banner. The envelope has `schemaVersion: 1`, `success`, `command`, and `data` or `error: {code,message}`. Help instead has top-level `usage`, `input`, `commands`, `modes` and `inputSchemas`. API response data is the existing, unversioned application payload. Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Successful request or preview |
| 1 | API, connection, backend or response failure |
| 2 | Invalid arguments/input, missing build or write intent |

Only loopback HTTP origins are allowed; redirects are rejected. Requests time out after 15 minutes. A timed-out write may still finish on the server: check the operation/status before retrying. Authentication and vault unlocking remain in the existing user workflows. Never supply secrets through command input.

## Agent skills

The repository ships [multi-git-agent](../skills/multi-git-agent/SKILL.md) for the CLI, [multi-git-mcp](../skills/multi-git-mcp/SKILL.md) for the MCP server, and [multi-git-computer-use](../skills/multi-git-computer-use/SKILL.md) for native GUI operation. The terminal edition carries them too; Settings → Terminal and agents → Agent skills shows where. Copy the desired complete skill directory into your agent's skill directory (for Codex, `~/.codex/skills/`) or a project skill directory supported by your agent. The skills do not install the application or computer-use runtime. Install only in a scope you intend to use.

GUI regression procedures and fixture setup are in [Computer Use smoke tests](testing/computer-use-smoke.md).
