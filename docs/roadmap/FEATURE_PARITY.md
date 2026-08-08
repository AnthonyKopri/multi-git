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
| Worktrees and per-worktree WIP | Not available | [GitHub Desktop request](https://github.com/desktop/desktop/issues/19307), [GitKraken discussion](https://feedback.gitkraken.com/suggestions/187158/comment/279649), [Fork releases](https://fork.dev/releasenoteswin) | Phase 3 | Planned |
| Multi-window and repository groups | One active repository | [GitHub Desktop request](https://github.com/desktop/desktop/issues/3606), GitKraken current releases | Phase 3 | Planned |
| Launch external coding agents | Not available | [GitKraken current releases](https://help.gitkraken.com/gitkraken-desktop/current/) | Phase 3 | Planned |
| Multiple remotes and remote management | Limited | Tower, SmartGit | Phase 4 | Planned |
| Submodules | No full management UI | Sourcetree, SmartGit, TortoiseGit | Phase 4 | Planned |
| Git LFS and locking | No full management UI | Sourcetree, SmartGit, TortoiseGit | Phase 4 | Planned |
| Patch create/apply and clipboard patches | Not available | Fork, TortoiseGit | Phase 4 | Planned |
| Bisect workflow | Not available | Fork, [SmartGit what's new](https://www.smartgit.dev/whats-new/), TortoiseGit | Phase 4 | Planned |
| Git Notes | Not available | SmartGit what's new | Phase 4 | Planned |
| External diff/merge/editor tools | Limited editor launch | [GitHub Desktop request](https://github.com/desktop/desktop/issues/9609), GitKraken requests | Phase 4 | Planned |
| Operation progress and cancellation | Server-side registry, SSE stream and cancel endpoint landed in Phase 0; no UI yet | [GitKraken requests](https://feedback.gitkraken.com/), [GitHub Desktop clone cancellation request](https://github.com/desktop/desktop/issues/2082) | Phases 0/4 | Phase 0 done; UI planned |
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

Everything known to be outstanding after Phases 0, 1 and 2, in one place. None
of it blocks Phase 3 or Phase 4. Each row links to the section holding the
evidence.

| Item | Kind | Owner | Detail |
| --- | --- | --- | --- |
| Express 4 → 5 | Dependency | Standalone PR | The only dependency not at latest. Nothing blocks it — the server declares no parametric or wildcard routes, and every handler already reads `req.body ?? {}`. Left out of Phase 0 as a runtime-framework major touching `app.ts` and every route file. See [Justified pins and deferrals](#justified-pins-and-deferrals). |
| Repository paths outside Latin-1 cannot be opened | Pre-existing defect | Standalone PR | `x-repo-path` carries the path as an HTTP header; header values are byte strings and `fetch` truncates each UTF-16 code unit to its low byte. `café` survives, `中文` and emoji do not. Reproduced on the pre-upgrade baseline too. See [Pre-existing defect found during Phase 0 verification](#pre-existing-defect-found-during-phase-0-verification-not-fixed-here). |
| Operation progress has no UI | Deliberate scope split | Phase 4 | Registry, SSE stream and cancel endpoint landed in Phase 0. The panel is Phase 4's. |
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

### Pre-existing defect found during Phase 0 verification, not fixed here

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

Left out of Phase 0 deliberately: the fix is to percent-encode the header in
`src/renderer/api/client.ts` and decode it in
`src/server/middleware/repo-path.ts`, both of which are shared hotspots the
execution contract asks to be claimed, and it is unrelated to the toolchain and
foundation work this phase delivers. Worth a small standalone PR.

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
