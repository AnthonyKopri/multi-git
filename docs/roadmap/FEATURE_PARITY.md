---
title: Feature parity and request inventory
status: living-document
last_reviewed: 2026-08-08
---

# Feature Parity and Request Inventory

This matrix compares Multi-Git with major desktop Git clients and their public feature-request discussions. It tracks product capabilities rather than individual bug fixes.

Status values: **Current** means materially available today; **Planned** has an implementation phase; **Deferred** needs a later product decision; **Rejected** is intentionally outside the product direction.

| Capability | Multi-Git today | Competitive evidence / request signal | Target | Status |
| --- | --- | --- | --- | --- |
| Create pull requests | Large in-app creator with preflight, drafts and forks (Phase 1) | [GitHub Desktop PR flow](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/creating-an-issue-or-pull-request-from-github-desktop), [GitKraken PRs](https://help.gitkraken.com/gitkraken-desktop/pull-requests/) | Phase 1 | Done |
| PR review, checks and provider dashboards | No unified dashboard | GitKraken PRs and [SmartGit features](https://www.smartgit.dev/features/) | Phase 5 | Planned |
| Native SSH-agent lifecycle and key loading | Native agent status, repair, key load/unload and per-repository `core.sshCommand` (Phase 1) | [Microsoft OpenSSH key management](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement), [`ssh-add` behavior](https://man.openbsd.org/OpenBSD-7.7/ssh-add.1) | Phase 1 | Done |
| Line/hunk staging and discard | Stage, unstage and discard by hunk or by line, with Safety Net capture and stale-selection refusal (Phase 2A) | [Sourcetree](https://www.sourcetreeapp.com/), [Sublime Merge guide](https://www.sublimemerge.com/docs/getting_started) | Phase 2 | Done |
| Side-by-side, word and image diff | Unified and side-by-side, intra-line word highlights, whitespace toggle, before/after image comparison (Phase 2A) | [Tower features](https://www.git-tower.com/features/all-features), [TortoiseGit manual](https://tortoisegit.org/docs/tortoisegit/) | Phase 2 | Done |
| Syntax highlighting inside a diff | Not available, and declined | GitHub Desktop, Sublime Merge, [Tower features](https://www.git-tower.com/features/all-features) | — | Deferred — see below |
| Selective and multiple stashes | Stash by file, hunk or line; inspect, apply with index, branch-from, drop (Phase 2B) | [Selective stash request](https://github.com/desktop/desktop/issues/11531), [multiple stashes request](https://github.com/desktop/desktop/issues/12699) | Phase 2 | Done |
| Commit search and branch comparison | Search by message, author, path, ref and date range; compare any two refs (Phase 2B) | [GitHub Desktop search request](https://github.com/desktop/desktop/issues/7022), Sourcetree | Phase 2 | Done |
| Interactive rebase, autosquash and commit splitting | Visual planner with reorder, reword, squash, fixup, drop, autosquash preview and splitting (Phase 2D) | [GitHub Desktop request](https://github.com/desktop/desktop/issues/12354), [GitKraken requests](https://feedback.gitkraken.com/) | Phase 2 | Done |
| SSH and GPG commit/tag signing | Per-repository signing, signature status that never overclaims verification (Phase 2E) | [GitHub Desktop signing request](https://github.com/desktop/desktop/issues/78), Tower | Phase 2 | Done |
| Persistent reflog/Safety Net recovery | Durable recovery journal beside the reflog, capture on every destructive operation (Phase 2C) | Tower, TortoiseGit | Phase 2 | Done |
| Worktrees and per-worktree WIP | Full lifecycle with recovery-backed removal; each worktree keeps its own window and WIP (Phase 3) | [GitHub Desktop request](https://github.com/desktop/desktop/issues/19307), [GitKraken discussion](https://feedback.gitkraken.com/suggestions/187158/comment/279649), [Fork releases](https://fork.dev/releasenoteswin) | Phase 3 | Done |
| Multi-window and repository groups | A window per repository or worktree, restored on launch; groups with a cancellable Fetch all (Phase 3) | [GitHub Desktop request](https://github.com/desktop/desktop/issues/3606), GitKraken current releases | Phase 3 | Done |
| Launch external coding agents | Configured executables launched in a worktree with the family's SSH identity ready (Phase 3) | [GitKraken current releases](https://help.gitkraken.com/gitkraken-desktop/current/) | Phase 3 | Done |
| Multiple remotes and remote management | Limited | Tower, SmartGit | Phase 4 | Planned |
| Submodules | No full management UI | Sourcetree, SmartGit, TortoiseGit | Phase 4 | Planned |
| Git LFS and locking | No full management UI | Sourcetree, SmartGit, TortoiseGit | Phase 4 | Planned |
| Patch create/apply and clipboard patches | Not available | Fork, TortoiseGit | Phase 4 | Planned |
| Bisect workflow | Not available | Fork, [SmartGit what's new](https://www.smartgit.dev/whats-new/), TortoiseGit | Phase 4 | Planned |
| Git Notes | Not available | SmartGit what's new | Phase 4 | Planned |
| External diff/merge/editor tools | Limited editor launch | [GitHub Desktop request](https://github.com/desktop/desktop/issues/9609), GitKraken requests | Phase 4 | Planned |
| Operation progress and cancellation | Server-side registry, SSE stream and cancel endpoint landed in Phase 0; the worktree status pass and group fetch have inline controls (Phase 3); no general panel yet | [GitKraken requests](https://feedback.gitkraken.com/), [GitHub Desktop clone cancellation request](https://github.com/desktop/desktop/issues/2082) | Phases 0/4 | Phase 0 done; panel planned |
| Command palette | Ctrl+K over app and Git actions (Phase 2B) | Sublime Merge | Phase 2 | Done |
| Branch pin, rename, prune and stale cleanup | Pin, rename, set upstream, merged/stale detection, prune, bulk guarded delete (Phase 2B) | [GitHub Desktop pin request](https://github.com/desktop/desktop/issues/15767), Tower | Phase 2 | Done |
| Stacked branches and PRs | Not available | [Tower stacked PRs](https://www.git-tower.com/features/stacked-prs/) | Phase 5 | Planned |
| WSL repositories | No explicit execution abstraction | GitKraken request board (high demand) | Phase 5 | Planned |
| Remote SSH repositories | Not available | [GitHub Desktop request](https://github.com/desktop/desktop/issues/11667) | Phase 5 gated epic | Deferred |
| Explorer/shell integration | Not available | TortoiseGit | Phase 4, opt-in | Planned |
| Large-file image preview | Before/after image comparison in the diff pane (Phase 2A); no LFS-specific handling | [GitHub Desktop request](https://github.com/desktop/desktop/issues/2981) | Phase 2/4 | Partial — LFS pointers are Phase 4 |
| Gitea/Forgejo PR integration | No | GitKraken request board | Phase 5 | Planned |
| GitLab, Azure DevOps and Bitbucket PR integration | No | SmartGit, Tower, GitKraken | Phase 5 | Planned |

## Explicitly deferred or rejected

| Item | Decision | Reason |
| --- | --- | --- |
| Mercurial and Git-SVN | Rejected | Multi-Git remains focused on modern Git repositories. |
| Proprietary cloud workspaces | Rejected | Local-first operation and user-controlled hosts are core constraints. |
| Built-in cloud AI generation | Deferred | External agent launch provides a vendor-neutral path without sending repository content to a new service. |
| Proprietary live agent hooks/session telemetry | Rejected | Launch configured tools, but do not require their private protocols or monitor sessions. |
| Remote SSH execution | Deferred | Requires a hardened filesystem/execution boundary after local and WSL abstractions are proven. |
| Syntax highlighting inside a diff | Deferred | Three reasons, decided 2026-08-08 after the rest of the diff pane was built. Most highlighters return an HTML string, and the renderer builds every node with `textContent` precisely because file contents are untrusted repository data — so the field narrows to token-emitting libraries before anything else is weighed. A diff shows fragments, so a hunk starting inside a block comment cannot be highlighted correctly without fetching and highlighting both complete file versions. And the pane already uses colour for added/removed lines and for intra-line word changes; a third system competing for the same pixels misleads when it guesses wrong. Revisit with a small token-emitting highlighter behind a toggle that defaults off. See [Phase 2](phase-2-review-history-recovery.md#syntax-aware-rendering-deliberately-not-done). |

## Open follow-ups

Everything known to be outstanding after Phases 0–4, in one place. None of it
blocks Phase 5. Each row links to the section holding the evidence.

| Item | Kind | Owner | Detail |
| --- | --- | --- | --- |
| Express 4 → 5 | Dependency | Standalone PR | The only dependency not at latest. Nothing blocks it — the server declares no parametric or wildcard routes, and every handler already reads `req.body ?? {}`. Left out of Phase 0 as a runtime-framework major touching `app.ts` and every route file. See [Justified pins and deferrals](#justified-pins-and-deferrals). |
| LFS locking never run against a real lock server | Untested by hand | Whoever has one | It needs a host implementing the LFS lock API, which no local fixture provides. The argv, the ownership split from `locks --verify`, the force-unlock authorisation path and "this server does not support locking" are covered against a scripted `git lfs` in `tests/lfs.test.ts`. |
| Explorer entries never installed on a clean machine | Untested by hand | Whoever next uses it | `reg add` and `reg delete` argv, the HKCU-only constraint and the `%V` command form are asserted in `tests/external-tools.test.ts`, but the round trip through a real Explorer has not been watched. |
| A patch whose bytes are not valid UTF-8 cannot be applied from the text field | Known limitation | Needs a binary upload path | The patch arrives as a JSON string, so the decode happened in the renderer before the server saw it. `createPatch` flags a binary patch in its preview for exactly this reason. See [Phase 4 record](#phase-4-record-2026-08-09). |
| Agent launch never run against a real Claude or Codex install | Untested by hand | Whoever has one installed | Neither is on the development machine's PATH, so detection legitimately finds nothing there. Argv construction for all three terminal modes, the environment allowlist, the missing-tool path and the failure recording are covered against a scripted runner and a fake launcher in `tests/agents.test.ts`. |
| Creating a real pull request | Untested by hand | Whoever next uses it | Covered against a scripted `gh`. Running it for real would open a pull request on a real repository. |
| The fork workflow | Untested by hand | Whoever next uses it | Same reason. Ownership detection *has* been run against real `gh` on a non-fork. |
| `@types/node` held at 24.x | Intentional pin | Revisit with Electron | Electron 43 embeds Node 24; newer types would describe APIs the runtime lacks. Encoded as an `ignore` rule in `.github/dependabot.yml`. |
| Trailing whitespace in `public/index.html` and `public/style.css` | Pre-existing | Whoever reformats them | Why the CI whitespace check is scoped to the merge base rather than the whole tree. |

### Environment notes worth knowing

- **Git Bash cannot see the Windows SSH agent.** It ships its own `ssh` that
  uses a Unix socket, while the native agent uses a named pipe. Pushing over
  SSH from Git Bash fails even with a key loaded. PowerShell works, and so does
  any repository that Multi-Git has pinned with `core.sshCommand`, because that
  points at `C:\WINDOWS\System32\OpenSSH\ssh.exe`.
- **Windows Application Control can block a freshly built, unsigned `.exe`.**
  Packaging succeeds and the artifact is valid; launching it may not be
  permitted until the policy is satisfied.

## Phase 4 record (2026-08-09)

Delivered on `claude/phase-4-planning-responsive-ui-82df62`, alongside eight
layout defects carried over from Phase 3.

### Three assumptions that were wrong

**A container cannot style itself with its own container query.** The commit
panel was made a query container so its buttons could stack below the message
box when cramped — and the stacking worked, while the `min-height` that stops
the stacked layout being clipped silently did not. An element is excluded from
its own `@container` matches. The container is now the staging view, which is
the same width; the threshold carries a `+40px` offset for the panel's own side
padding, and says so.

**`.btn-icon.btn-sm` did not exist.** `.btn-sm` sets only padding and
font-size, and `.btn-icon` fixes both dimensions, so every "small" icon button
in the app was drawn at the full 38px. That is the mechanical cause of the
crowded worktree rows reported after Phase 3: five actions took 190px of a
240px sidebar. They are 28px now, which affects branch, agent and group rows
too — all of which asked for small and never got it.

**A patch is not always bytes.** `src/server/git/encoding.ts` exists because a
diff must survive the round trip from git to `git apply`, and its latin1
transport is correct for a string that came *from* git's own bytes. A patch
pasted or loaded in the renderer did not: it arrived as text, already decoded,
so encoding it back as latin1 would corrupt every character above U+00FF. It is
encoded as UTF-8 instead, and the case that genuinely cannot round-trip — a
binary patch — is flagged in the preview rather than silently mangled.

### Where the desktop-only boundary is, and why

Three Phase 4 features start a program: external tool launch, the automated
bisect run, and — from Phase 3 — agent launch. None of them is reachable over
HTTP. The loopback server answers anything on this machine that can reach the
port, and a header claiming to be the desktop app is not a boundary, because
anything that can reach the port can set one. Saving a definition is
configuration and stays on HTTP; running it goes through Electron IPC.

Saving a patch follows the same shape from the other direction: the main process
writes only to a path that came back from `showSaveDialog`, and each path is
spent on first use, so one dialog authorises exactly one write.

### Registry entries used for Explorer integration

Written only by `src/main/shell-integration.ts`, only on Windows, and only when
the user presses Install after seeing both keys:

| Key | Purpose |
| --- | --- |
| `HKCU\Software\Classes\Directory\shell\MultiGit` | Right-clicking a folder |
| `HKCU\Software\Classes\Directory\Background\shell\MultiGit` | Right-clicking inside an open folder |

Each gets a default value naming the menu item and a `command` subkey holding
`"<exe>" "%V"`. `%V` rather than `%1`, because `%1` is empty for a background
right-click. No HKLM, so no administrator rights and nothing changed for other
accounts. No file association is claimed. Remove deletes exactly these two.

### External-tool template grammar

An argument template is an array, and placeholders are substituted **within** an
element, never across one — `--diff={local}` stays a single argument whatever
the path contains, which is why nothing in the feature quotes anything.

`{local}` `{remote}` `{base}` `{merged}` `{path}` `{line}` `{cwd}`

Anything else is refused at the point a definition is saved and again
immediately before launch, because the configuration file is ordinary JSON in
the user's home directory that a sync client can change in between. Passing an
unknown placeholder through as literal text would hand a diff tool the word
`{theirs}` where a path belonged.

### Minimum versions

| Tool | Needed for |
| --- | --- |
| Git ≥ 2.22 | `git submodule set-branch` |
| Git ≥ 2.30 | `git bisect` subcommands used here; `rev-list --bisect-vars` is much older |
| Git LFS ≥ 2.0 | `ls-files --json`, `locks --json`, `locks --verify --json` |
| `reg.exe` | Present on every supported Windows version |

Local submodule fixtures need `protocol.file.allow=always`; git has refused the
`file` transport for submodules since CVE-2022-39253. That is set on the test
fixtures, never by the product — the protection is a real one, and an
application has no business turning it off on a user's behalf. It has to reach
two places: `-c` on the fixture's own commands, because `git submodule add`
spawns a `git clone` that never reads the superproject's local config, and a
global config file for the git the product runs.

### Cancellation caveats

Cancelling a network operation is not undoing it. `git push` may already have
sent its objects when the process is killed, so a cancelled operation reports
that the remote may have received part of it rather than claiming a clean stop.
An operation that cannot be interrupted safely is registered as not cancellable
and offers no button, rather than one that does nothing.

## Phase 3 record (2026-08-09)

### Two planning assumptions that were wrong

Both were caught by checking git's behaviour rather than by a failing test, and
both would otherwise have become bugs.

**Linked worktrees share one `.git/config`.** The phase plan said each new
worktree needs the Phase 1 `core.sshCommand` pin applied to it. It does not:
`git config --local` writes to `$GIT_COMMON_DIR/config`, which every worktree of
a family reads. The pin is inherited. The consequence is larger than one skipped
write — a repository and its worktrees have **one** SSH identity, and a UI
offering a per-worktree account would have been offering something git cannot
honour, silently rewriting the shared value each time. Per-worktree identities
would need `extensions.worktreeConfig`, a repository-level extension other tools
would also see; that was considered and rejected. `profileForRepo` and
`rememberProfileForRepo` now resolve through `mainWorktreePathSync`, so a
worktree with no record of its own inherits the family's account rather than
dropping to System SSH.

**A coding agent cannot be launched through `ExecutableRunner.run`.** That
method awaits completion under a five-minute default timeout — it would hold a
promise open for a whole session and then kill the tool. `launchDetached` was
added alongside it: same argv-only, no-shell, explicit-environment,
injectable-for-tests discipline, minus the waiting. It resolves when the process
exists and learns nothing else, which is exactly what the product boundary
already promised.

### Files and configuration written outside the repository

| Path | When | Notes |
| --- | --- | --- |
| `~/.multi-git-client-config.json` | Worktree, group, agent and window changes | Schema v2 adds `repoGroups`, `externalAgents`, `windowState` and `agentLaunches`, plus three settings. The migration is additive and idempotent. |
| `<worktree parent>/…` | Creating a worktree | The folder git creates, at the path previewed before the button is pressed. |
| `<main repo>/.git/multi-git/recovery.json` | Forced worktree removal | Written against the *main* worktree, because the removed worktree's own git directory goes with it. |

### What a launched tool does and does not inherit

Its environment is an allowlist — `PATH`, `PATHEXT`, `ComSpec`, `SystemRoot`,
`WINDIR`, `TEMP`, `TMP`, `TMPDIR`, `USERPROFILE`, `USERNAME`, `USER`, `HOME`,
`HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`, `PROGRAMFILES`,
`PROGRAMDATA`, `NUMBER_OF_PROCESSORS`, `PROCESSOR_ARCHITECTURE`, `OS`,
`SSH_AUTH_SOCK`, `LANG`, `LC_ALL`, `TERM`, `COLORTERM` — plus per-agent
overrides filtered through `sanitizeEnvOverrides`.

It never inherits `SSH_ASKPASS` or `SSH_ASKPASS_REQUIRE`, which would hand it a
bridge that answers with a stored passphrase; `GIT_SSH_COMMAND`, `GIT_SSH`,
`GIT_ASKPASS`; or `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_SEQUENCE_EDITOR`, `GIT_EDITOR`,
which describe what Multi-Git happens to be doing. The identity travels with the
folder through `core.sshCommand`, which is precisely why nothing needs to be
passed.

### Where a typed passphrase goes

Into `loadKeyIntoAgent`, which writes it to a mode-0600 script in a private
temporary directory, points `SSH_ASKPASS` at that script for one `ssh-add`, and
removes the directory in a `finally`. It is added to the runner's redaction
list, so it cannot survive into a logged result. It is not returned to the
caller, not written to the config, and stored in the vault only when the user
explicitly asks *and* the passphrase has already been shown to load the key —
saving a wrong value would fail silently on every future launch.
`tests/ssh-unlock.test.ts` asserts its absence from the fake runner's complete
record of argv, cwd, environment and stdin.

### Desktop-only authorization boundaries

`window:open-repo`, `window:has-repo`, `window:list-repos`,
`window:claim-repo`, `tool:open-terminal`, `tool:open-editor`, `agent:launch`.

Every path argument is re-validated in the main process with `resolveRepoPath`;
the renderer is not trusted to supply a directory. `agent:launch` takes an agent
*id* which is looked up in the saved configuration, so no message from a page
can name a program to run. `window:claim-repo` takes its window from
`event.sender`, never from the message, so a page cannot claim a repository on
behalf of a window it does not own. The HTTP server gained routes for agent
definitions and detection and no launch route at all.

### Manual scenarios executed

- Booted the compiled server and drove the new routes: `/api/worktrees` against
  this repository's own eight-worktree family, `/api/agents`,
  `/api/agents/detect` and `/api/repo-groups`.
- Loaded the renderer in a browser: the sidebar listed all eight worktrees with
  branch names and live dirty counts, the manager opened with removal disabled
  on the main worktree, the prune preview was empty, and the create form
  previewed `…\multi-git.worktrees\feature-login-page` for a branch typed as
  `feature/login page`.
- Detection correctly reported nothing on a machine with neither CLI installed.

Not exercised by hand: launching a real agent, and restoring windows across an
actual restart of the packaged desktop app.

## Phase 1 record (2026-08-07)

### Elevation

Exactly one action in this application requests administrator rights: enabling
and starting the Windows `ssh-agent` service. A Disabled service cannot be
started by any unprivileged caller, however the request is phrased, so the
start type has to change first.

The command is a compile-time constant, `AGENT_REPAIR_COMMAND` in
`src/server/ssh/agent-service.ts`:

```text
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command
  Set-Service -Name 'ssh-agent' -StartupType Automatic; Start-Service -Name 'ssh-agent'
```

Three things keep it that way. The IPC handler takes no parameters; the preload
bridge forwards none; and the handler lives in the Electron main process, so the
loopback HTTP server cannot reach it. `GET /api/ssh/agent/repair-command`
returns the same constant for display, because a user about to approve a UAC
prompt should be able to read what it will run. Declining the prompt is reported
as `cancelled`, not as a failure.

### Files and configuration written outside the repository

| Path | When | Notes |
| --- | --- | --- |
| `~/.multi-git-client-config.json` | Profile selection | Adds `repoSettings[<canonical repo>].sshProfileId`. |
| `~/.ssh/config` | Unchanged from before | Managed block only, delimited and written atomically. |
| Windows `ssh-agent` service | Repair action only | Start type set to Automatic, then started. |
| The agent's own key store | Key load | `ssh-add <key>`. Keys deliberately survive app exit. |
| `<repo>/.git/config` | Profile selection | `core.sshCommand`, that repository only. |
| `%TEMP%/multi-git-askpass-*/` | Key load with a stored passphrase | See below. |

### AskPass cleanup

Supplying a passphrase to `ssh-add` non-interactively requires a helper script
on disk, and that script necessarily contains the passphrase in plaintext. It is
created inside a `mkdtemp` directory, opened with `wx` and an explicit mode so
it is never briefly world-readable, removed in a `finally` block, and swept by a
process-exit hook if anything crashes in between. The passphrase never appears
in argv, on stdin, in a log line, or in an API error — asserted by test.

### Exact `gh` command forms

```text
gh --version
gh auth status
gh api user --jq .login
gh repo view --json nameWithOwner,isFork,parent,viewerPermission --jq <join>
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
gh pr list --head <ref> --state open --json url --jq .[0].url
gh pr create --base <base> --head <ref> --title <title> --body-file -
             [--repo <owner/repo>] [--draft] [--no-maintainer-edit]
             [--reviewer <r>]... [--assignee <a>]... [--label <l>]...
```

Every one is an argument vector through the shared runner, with no shell. The
pull-request body always arrives on stdin: Markdown carries newlines, quotes and
backticks, and there is no quoting of that into a command line worth trusting.
Branch names pass through `refArg` first, so a branch called `--upload-pack=…`
cannot be read as a flag.

### Manual scenarios executed

- Read agent state on a machine whose service had been Disabled with no
  `SSH_AUTH_SOCK`, and again after it was enabled: correctly reported
  `disabled` then `ready`, and classified an externally loaded key as
  `pre-existing` rather than session-owned.
- Pull-request preflight against this repository with a real authenticated `gh`:
  detected the GitHub remote and `AnthonyKopri/multi-git`, counted commits ahead
  and changed files, saw the branch as unpushed, and seeded the body from the
  repository's own `.github/PULL_REQUEST_TEMPLATE.md`.
- Rendered the creator window and the agent panel in a running app: correct chip
  text and colour, repair button correctly hidden on a healthy agent, no console
  errors.

Not executed by hand: creating a real pull request, and the fork workflow. Both
are covered by tests against a scripted `gh`, but neither has been run against
GitHub, because doing so would create a real pull request on a real repository.

## Toolchain baseline after Phase 0 (2026-08-05)

| Package | Before | After | Latest published | Note |
| --- | --- | --- | --- | --- |
| electron | 42.8.0 | 43.3.0 | 43.3.0 | Latest. Declares `engines.node >= 22.12.0`, which is now the project floor. |
| typescript | 5.9.3 | 7.0.2 | 7.0.2 | Latest. Required dropping `moduleResolution: node`; see below. |
| vitest | 3.2.7 | 4.1.10 | 4.1.10 | Latest. No migration work needed — the suite uses no fake timers, mocks, coverage config, custom pool, or browser environment. |
| vite | (transitive) | 8.2.0 | 8.2.0 | Comes in through Vitest 4; not a direct dependency. |
| @types/node | 18.19.x | 24.13.3 | 26.1.2 | **Pinned to 24.x.** See below. |
| @types/supertest | 6.0.3 | 7.2.1 | 7.2.1 | Latest; aligns the major with `supertest` 7. |
| express | 4.22.2 | 4.22.2 | 5.2.1 | **Deferred.** See below. |
| esbuild, electron-builder, rcedit, supertest | — | unchanged | same | Already at the latest published release. |

`npm audit` reports zero advisories at every severity after the upgrade.

### Justified pins and deferrals

**`@types/node` pinned to 24.x.** Electron 43 embeds Node 24. Types for 25 or
26 would describe APIs that are not present in the runtime the desktop build
actually executes, so the newest version is the wrong one here rather than a
compatibility failure. `.github/dependabot.yml` encodes this with an
`ignore: ">=25"` rule. Revisit when Electron changes its embedded Node major.

**Express 5 deferred, not blocked.** Express 5.2.1 is the latest stable and
nothing was found that prevents adopting it: the server declares no parametric
or wildcard routes, which is where the Express 5 routing rewrite breaks most
applications, and every handler already reads `req.body ?? {}`, which covers
the change from `{}` to `undefined` on an unparsed body. It is out of Phase 0's
enumerated scope — a runtime framework major touching `src/server/app.ts` and
every route file, which the execution contract names as a shared hotspot for
Phases 1–5 — and Express 4.22.2 has no open advisories. Recommended as a
standalone follow-up PR before Phase 1 branches widen the blast radius.

### Compatibility adjustments made

- **TypeScript 7 removed the legacy `node` (node10) module resolver.** All four
  configs now share `module: ESNext` and `moduleResolution: bundler` from
  `tsconfig.json`, which is what esbuild actually does. `verbatimModuleSyntax`
  was enabled at the same time; it required exactly one source change
  (`src/server/ssh/profiles.ts` importing a type without `import type`).
- **`vitest.config.ts` renamed to `vitest.config.mts`** for unambiguous ESM
  loading under Vite 8.
- **Electron 43 does not download its runtime during `npm install`.** The
  package exposes an `install-electron` bin instead of a postinstall script.
  `npm run desktop` now runs `scripts/ensure-electron.mjs`, which fetches it
  when missing. Packaging is unaffected: electron-builder uses its own cache.
  This is not new in 43 — Electron 42 behaved the same way — but it was
  previously undocumented.
- **esbuild target moved from `node18` to `node22.12`.**

### Pre-existing defect found during Phase 0 verification, fixed in Phase 3

**A repository path containing characters outside Latin-1 cannot be opened.**
`x-repo-path` carries the repository path as an HTTP header, and header values
are byte strings that Node's parser decodes as Latin-1. `café` survives, because
every code point is under U+0100. `中文` and emoji do not: the renderer's `fetch`
truncates each UTF-16 code unit to its low byte on the way out, and the server
resolves a path that does not exist.

Reproduced against a real repository on both this branch and the pre-upgrade
baseline, so it is not a regression from the toolchain move:

| Path | JSON body (`/api/config/repo`) | `x-repo-path` header |
| --- | --- | --- |
| `…/mg probe café …` | works | works |
| `…/mg probe 中文 …` | works | **fails** |
| `…/mg probe 🔑 …` | works | **fails** |

The JSON body path is unaffected, which is why opening a repository through the
picker appears to succeed before every subsequent request fails.

Left out of Phase 0 deliberately: the fix touches
`src/renderer/api/client.ts` and `src/server/middleware/repo-path.ts`, both of
which are shared hotspots the execution contract asks to be claimed, and it is
unrelated to the toolchain and foundation work that phase delivered.

**Fixed in Phase 3**, because worktrees are folders the user names themselves,
which turned a theoretical case into a likely one. The header now carries
base64 of the path's UTF-8 bytes, marked by `x-repo-path-encoding: base64`, and
the middleware decodes it. Base64 is not self-describing and
`Buffer.from(value, 'base64')` is lenient — it skips characters outside the
alphabet and returns whatever it collected — so the decoded bytes are
re-encoded and compared, turning a corrupted header into a 400 rather than a
plausible path pointing somewhere else. A raw, unmarked value still works, so
existing scripts and `curl` lines are unaffected.
`tests/repo-path-transport.test.ts` covers the round trip and drives real
repositories in `中文-仓库` and `🔑-keys` folders end to end.

### Defect found and fixed during Phase 0 verification

Launching the packaged app showed it listening on **two** ports. `src/server/index.ts`
ended with `if (require.main === module) startServer()`, and esbuild inlines
that module into `out/node/main/main.js`, where `main.js` *is* the process
entry — so the guard read as true and a second, unasked-for server bound port
3000 alongside the intended one on a free port. The start-up side effect now
lives in a dedicated `src/server/cli.ts`; `index.ts` is a pure library.

## Release and dependency sources

- [Electron 43.2.0 release](https://releases.electronjs.org/release/v43.2.0) and [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)
- [Vitest migration guide](https://vitest.dev/guide/migration)
- [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

## Quarterly review checklist

1. Review feature-request boards and release notes for GitHub Desktop, GitKraken, Tower, Sourcetree, Fork, SmartGit, Sublime Merge, and TortoiseGit.
2. Exclude bug reports unless they reveal a missing product capability.
3. Record demand, fit with local-first principles, security impact, and expected implementation surface.
4. Assign accepted requests to a phase or capture an explicit deferred/rejected decision.
5. Recheck Electron, Vitest, TypeScript, Node, Vite, and `@types/node` compatibility before each release train.
