# Agent CLI

The CLI connects to a running Multi-Git app and uses the same backend as its GUI. Node 22.12+ is required. From a source checkout:

```powershell
npm ci
npm run compile
node scripts/multi-git.cjs help
```

Optionally run `npm link` to install the `multi-git` command on PATH. No global installation is needed when invoking the script directly. This is a source-checkout CLI; the Windows installer does not install Node or add the command to PATH.

Start `npm start` or the desktop app. In **Settings → Git and GitHub**, copy **Agent CLI connection**. Pass it with `--server` (or set `MULTI_GIT_URL`). The default is `http://127.0.0.1:3000`; desktop mode chooses a new port on launch.

```powershell
node scripts/multi-git.cjs app.info --server http://127.0.0.1:3000
node scripts/multi-git.cjs status --repo "D:\work\my repo" --server http://127.0.0.1:3000
```

`help` returns the machine-readable command catalogue, inputs and scope. Available commands cover repository browsing/cloning, remembering local repos, status/diff, branches, staging, commits, fetch/push, worktrees, recovery listings and agent listings. `repo.remember` adds a recent entry; it does not switch an open GUI window. Existing browser/server startup commands remain unchanged.

Save request data as UTF-8 JSON instead of escaping it into a shell command:

```json
{"files":["README.md"]}
```

```powershell
node scripts/multi-git.cjs stage --repo "D:\work\my repo" --input stage.json --dry-run
node scripts/multi-git.cjs stage --repo "D:\work\my repo" --input stage.json --allow-write
```

`--input -` reads JSON from stdin. GET command input becomes query parameters. Unknown command names, options and fields are rejected. `--dry-run` prints the request without contacting the server; it does not check filesystem state or run server validation. All POST commands, including fetch and remember, require `--allow-write`. Force push and arbitrary API dispatch are not exposed. The CLI uses backend SSH routing but does not run the renderer's account-verification prompt; verify origin and profile before pushing.

Output is always one JSON line (`--json` is accepted for compatibility). With npm use `npm run --silent agent -- ...` to suppress npm's own banner. The envelope has `schemaVersion: 1`, `success`, `command`, and `data` or `error: {code,message}`. API response data is the existing, unversioned application payload. Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Successful request or preview |
| 1 | API, connection or response failure |
| 2 | Invalid arguments/input, missing build or write intent |

Only loopback HTTP origins are allowed; redirects are rejected. Requests time out after 15 minutes. A timed-out write may still finish on the server: check the operation/status before retrying. Authentication and vault unlocking remain in the existing user workflows. Never supply secrets through command input.

## Agent skills

The repository ships [multi-git-agent](../skills/multi-git-agent/SKILL.md) for the CLI and [multi-git-computer-use](../skills/multi-git-computer-use/SKILL.md) for native GUI operation. Copy the desired complete skill directory into your agent's skill directory (for Codex, `~/.codex/skills/`) or a project skill directory supported by your agent. The skills do not install the application or computer-use runtime. Install only in a scope you intend to use.

GUI regression procedures and fixture setup are in [Computer Use smoke tests](testing/computer-use-smoke.md).
