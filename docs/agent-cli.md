# Agent CLI

The CLI connects to a running Multi-Git app and uses the same backend as its GUI. Node 22.12+ is required. From a source checkout:

```bash
npm ci
npm run compile
node scripts/multi-git.cjs help
```

Optionally run `npm link` to install the `multi-git` command on PATH. No global installation is needed when invoking the script directly. This is a source-checkout CLI; the packaged desktop app does not install Node or add the command to PATH.

Start `npm start` or the desktop app. In **Settings → Git and GitHub**, copy **Agent CLI connection**. Pass it with `--server` (or set `MULTI_GIT_URL`). The default is `http://127.0.0.1:3000`; desktop mode chooses a new port on launch.

The commands are the same in PowerShell, on macOS and on Linux; only the repository path is written the way the operating system writes it (`"D:\work\my repo"` on Windows, `"/Users/you/work/my repo"` on macOS, `"/home/you/work/my repo"` on Linux).

```bash
node scripts/multi-git.cjs app.info --server http://127.0.0.1:3000
node scripts/multi-git.cjs status --repo "/home/you/work/my repo" --server http://127.0.0.1:3000
```

`help` returns the machine-readable command catalogue, inputs, repository requirements and effect metadata. Available commands cover repository browsing/cloning, remembering local repos, status/diff, branches, staging, commits, fetch/push, worktrees, recovery listings and agent listings. `repo.remember` adds a recent entry; it does not switch an open GUI window. Existing browser/server startup commands remain unchanged.

Save request data as UTF-8 JSON instead of escaping it into a shell command:

```json
{"files":["README.md"]}
```

```bash
node scripts/multi-git.cjs stage --repo "/home/you/work/my repo" --input stage.json --dry-run
node scripts/multi-git.cjs stage --repo "/home/you/work/my repo" --input stage.json --allow-write
```

`--input -` reads JSON from stdin. GET command input becomes query parameters. Unknown command names, options and fields are rejected. `--dry-run` prints the request without contacting the server; it does not check filesystem state or run server validation. All POST commands, including fetch and remember, require `--allow-write`. Force push and arbitrary API dispatch are not exposed. The CLI uses backend SSH routing but does not run the renderer's account-verification prompt; verify origin and profile before pushing.

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

Output is always one JSON line (`--json` is accepted for compatibility). With npm use `npm run --silent agent -- ...` to suppress npm's own banner. The envelope has `schemaVersion: 1`, `success`, `command`, and `data` or `error: {code,message}`. Help instead has top-level `usage`, `input` and `commands`. API response data is the existing, unversioned application payload. Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Successful request or preview |
| 1 | API, connection or response failure |
| 2 | Invalid arguments/input, missing build or write intent |

Only loopback HTTP origins are allowed; redirects are rejected. Requests time out after 15 minutes. A timed-out write may still finish on the server: check the operation/status before retrying. Authentication and vault unlocking remain in the existing user workflows. Never supply secrets through command input.

## Agent skills

The repository ships [multi-git-agent](../skills/multi-git-agent/SKILL.md) for the CLI and [multi-git-computer-use](../skills/multi-git-computer-use/SKILL.md) for native GUI operation. Copy the desired complete skill directory into your agent's skill directory (for Codex, `~/.codex/skills/`) or a project skill directory supported by your agent. The skills do not install the application or computer-use runtime. Install only in a scope you intend to use.

GUI regression procedures and fixture setup are in [Computer Use smoke tests](testing/computer-use-smoke.md).
