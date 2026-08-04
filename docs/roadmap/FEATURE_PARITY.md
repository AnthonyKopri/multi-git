---
title: Feature parity and request inventory
status: living-document
last_reviewed: 2026-08-04
---

# Feature Parity and Request Inventory

This matrix compares Multi-Git with major desktop Git clients and their public feature-request discussions. It tracks product capabilities rather than individual bug fixes.

Status values: **Current** means materially available today; **Planned** has an implementation phase; **Deferred** needs a later product decision; **Rejected** is intentionally outside the product direction.

| Capability | Multi-Git today | Competitive evidence / request signal | Target | Status |
| --- | --- | --- | --- | --- |
| Create pull requests | No in-app creator | [GitHub Desktop PR flow](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/creating-an-issue-or-pull-request-from-github-desktop), [GitKraken PRs](https://help.gitkraken.com/gitkraken-desktop/pull-requests/) | Phase 1 | Planned |
| PR review, checks and provider dashboards | No unified dashboard | GitKraken PRs and [SmartGit features](https://www.smartgit.dev/features/) | Phase 5 | Planned |
| Native SSH-agent lifecycle and key loading | Per-command `GIT_SSH_COMMAND`; no agent start/load | [Microsoft OpenSSH key management](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement), [`ssh-add` behavior](https://man.openbsd.org/OpenBSD-7.7/ssh-add.1) | Phase 1 | Planned |
| Line/hunk staging and discard | File-level workflow | [Sourcetree](https://www.sourcetreeapp.com/), [Sublime Merge guide](https://www.sublimemerge.com/docs/getting_started) | Phase 2 | Planned |
| Side-by-side, word and image diff | Basic text diff | [Tower features](https://www.git-tower.com/features/all-features), [TortoiseGit manual](https://tortoisegit.org/docs/tortoisegit/) | Phase 2 | Planned |
| Selective and multiple stashes | Basic stash support | [Selective stash request](https://github.com/desktop/desktop/issues/11531), [multiple stashes request](https://github.com/desktop/desktop/issues/12699) | Phase 2 | Planned |
| Commit search and branch comparison | History exists; limited discovery | [GitHub Desktop search request](https://github.com/desktop/desktop/issues/7022), Sourcetree | Phase 2 | Planned |
| Interactive rebase, autosquash and commit splitting | Not available | [GitHub Desktop request](https://github.com/desktop/desktop/issues/12354), [GitKraken requests](https://feedback.gitkraken.com/) | Phase 2 | Planned |
| SSH and GPG commit/tag signing | Not available | [GitHub Desktop signing request](https://github.com/desktop/desktop/issues/78), Tower | Phase 2 | Planned |
| Persistent reflog/Safety Net recovery | Safety Net exists, but recovery coverage is incomplete | Tower, TortoiseGit | Phase 2 | Planned |
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
| Command palette | Not available | Sublime Merge | Phase 2 | Planned |
| Branch pin, rename, prune and stale cleanup | Partial | [GitHub Desktop pin request](https://github.com/desktop/desktop/issues/15767), Tower | Phase 2 | Planned |
| Stacked branches and PRs | Not available | [Tower stacked PRs](https://www.git-tower.com/features/stacked-prs/) | Phase 5 | Planned |
| WSL repositories | No explicit execution abstraction | GitKraken request board (high demand) | Phase 5 | Planned |
| Remote SSH repositories | Not available | [GitHub Desktop request](https://github.com/desktop/desktop/issues/11667) | Phase 5 gated epic | Deferred |
| Explorer/shell integration | Not available | TortoiseGit | Phase 4, opt-in | Planned |
| Large-file image preview | No dedicated LFS preview | [GitHub Desktop request](https://github.com/desktop/desktop/issues/2981) | Phase 2/4 | Planned |
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
