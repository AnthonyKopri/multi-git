---
title: "Phase 4: Repository power tools"
phase: 4
status: complete
completed: 2026-08-09
depends_on: [phase-2]
dependencies_met: true
suggested_branch: claude/phase-4-repository-power-tools
parallelizable: true
lanes: [remotes-submodules, lfs, patch-bisect-notes, external-tools-progress]
---

# Phase 4: Repository Power Tools

> **Complete, 2026-08-09.** Delivered on
> `claude/phase-4-planning-responsive-ui-82df62`, together with eight layout
> defects carried over from Phase 3. See
> [Phase 4 record](FEATURE_PARITY.md#phase-4-record-2026-08-09) for the
> decisions, the boundaries and what was left undone.
>
> What Phase 2 left for this phase to build on:
>
> - **Recovery capture** — `captureCheckpoint` in
>   `src/server/safety-net/checkpoints.ts` writes the session undo *and* the
>   durable recovery point. Every destructive remote, submodule, LFS or patch
>   action goes through it with an `operation`; never write to one store alone.
> - **The operation registry now has callers.** Phase 2 registers diff reads
>   and searches through `src/server/operations/registry.ts`, and the git
>   runner takes an `AbortSignal`, so the work to cancel is already tracked.
>   The "external-tools-progress" lane is the renderer panel that shows and
>   cancels it — a UI job, not a new subsystem.
> - **Patch create/apply** should reuse `src/server/git/patch-build.ts` and
>   `src/server/git/precision-staging.ts` rather than a second implementation,
>   and anything that builds a patch must go through
>   `src/server/git/encoding.ts` — a diff is bytes, and decoding it as UTF-8
>   corrupts any file that is not.

## Outcome

Cover advanced repository maintenance expected from major Git clients: remote management, submodules, LFS and locks, patches, bisect, Git Notes, external tools, shell integration, and trustworthy long-operation progress/cancellation.

Recovery points are required before destructive remote/submodule/LFS/patch actions; Phase 2 shipped them and `captureCheckpoint` is the single call that records one. This phase can run in parallel with Phase 3 after shared endpoint and operation-registry ownership is agreed.

## Workstream A — remotes and submodules

```ts
export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
  fetchRefspecs: string[];
  pushRefspecs: string[];
  prune: boolean;
}

export interface SubmoduleInfo {
  path: string;
  name: string;
  url: string;
  branch?: string;
  expectedOid?: string;
  checkedOutOid?: string;
  initialized: boolean;
  dirty: boolean;
}
```

- List/add/edit/rename/remove remotes, including separate fetch/push URLs, refspecs, default push remote, prune preference, connectivity test, and fetch-all. Validate names/URLs and preview destructive ref cleanup.
- Submodules: status, initialize, update, sync URL, deinitialize, change tracked branch, open as repository, and recursive operation choice. Explain the distinction between the superproject gitlink and submodule working tree.
- Preserve local changes, show progress per nested repository, and make partial failures inspectable/retryable.

## Workstream B — Git LFS

```ts
export interface LfsStatus {
  installed: boolean;
  version?: string;
  trackedPatterns: string[];
  objects: { oid: string; size: number; path?: string; present: boolean }[];
  locks: LfsLock[];
}
```

- Detect Git LFS without auto-installing it. Provide clear installation documentation when missing.
- Inspect/edit tracked patterns, fetch/pull/prune objects with previews, show pointer vs local-object availability, and render supported local image previews without automatic large downloads.
- List, create, verify, and release locks. Force unlock requires explicit confirmation and server capability/auth diagnostics.
- Surface LFS failures separately from ordinary Git push failures and make transfers cancellable where the underlying process permits.

## Workstream C — patches, bisect and Notes

```ts
export interface PatchRequest {
  repoPath: string;
  format: "diff" | "mailbox";
  from: string;
  to?: string;
  selectedPaths?: string[];
}

export interface BisectSession {
  repoPath: string;
  goodRef: string;
  badRef: string;
  currentOid?: string;
  stepsRemaining?: number;
  state: "active" | "complete" | "none";
}
```

- Create patch from commits, comparisons, working changes, or selections; save/copy securely and preview content/paths.
- Apply checked patches from file/clipboard as working changes or commits (`git apply`/`git am`) with dry-run, path safety, whitespace policy, abort/continue, and recovery point.
- Bisect wizard: select known good/bad, mark good/bad/skip, visualize remaining range, optionally run a user-approved test command, persist/resume session, and reset safely.
- Git Notes: display notes in history/detail, add/edit/remove notes, select note ref, and optionally fetch/push note refs with an explicit explanation that hosts may not show them.

## Workstream D — external tools and shell integration

- Configurable diff, merge, editor, terminal, and file-manager definitions use executable plus argument-template arrays with documented placeholders. Validate templates and show the final escaped preview.
- External merge integrates with the conflict workflow and refreshes Git state on process exit; never assume the tool resolved a file.
- Add opt-in Windows Explorer context-menu entries for **Open in Multi-Git** and **Open worktree in Multi-Git**. Installation/removal must be user-triggered, narrowly scoped, reversible, and documented. Do not claim system-wide defaults without consent.

## Workstream E — progress and cancellation completion

- Migrate clone, fetch, pull, push, LFS transfers, submodule operations, group fetch, and long history searches to Phase 0 operation IDs.
- Parse stable machine-readable progress where possible; otherwise show indeterminate progress plus elapsed time. Do not infer false percentages from arbitrary stderr text.
- The operation center lists active/recent operations, repository, duration, output summary, cancellation, retry, and copyable redacted diagnostics.
- Cancellation should request graceful termination first, then kill the process tree after a bounded timeout. Report whether server-side effects may already have occurred.

## API and authorization

Add typed CRUD/action endpoints for remotes, submodules, LFS, patches, bisect and notes. Every request requires canonical repository validation, structured error codes, operation IDs for long tasks, and capability checks for missing Git extensions. Arbitrary test/external-tool commands remain desktop-only and require a saved, user-approved definition.

## Testing

- Remote fixtures cover multiple URLs/refspecs, invalid names, auth failure, rename/remove, prune preview, and partial fetch-all.
- Submodule fixtures cover uninitialized, nested, dirty, moved URL, missing commit, partial recursive failure, and paths with spaces/Unicode.
- LFS uses local test servers/mocks for pointers, missing objects, lock ownership, cancellation, and force-unlock authorization; no tests depend on public credentials.
- Patch corpus includes traversal attempts, binary patches, CRLF, rejected hunks, mailbox series, conflicts, and abort/recovery.
- Bisect tests cover good/bad/skip, scripted result codes, interruption/restart, completion, and reset.
- External-tool tests assert argv/template expansion and reject unknown placeholders/shell metacharacter injection.
- Operation tests cover overlapping repositories, cancellation races, partial remote effects, retry, and redacted diagnostic retention.

## Definition of done

- Advanced features fail safely when their extension/tool/provider is absent and preserve recoverability around destructive actions.
- Long tasks expose honest progress, cancellation, per-target results, and redacted diagnostics.
- External tools and Explorer integration are explicit, reversible, and do not create an arbitrary-command HTTP surface.
- Common remote, submodule, LFS, patch, bisect, and Notes workflows are documented and covered by isolated tests.

## Handoff notes

Record minimum Git/Git LFS versions, platform limitations, registry entries used for Explorer integration, external-tool template grammar, operation parsers, cancellation caveats, and local fixtures needed to reproduce integration tests.


## Phase 4 record

### What was built, and where it lives

| Workstream | Server | Renderer |
| --- | --- | --- |
| A — remotes | `src/server/git/remotes.ts`, `routes/remotes.routes.ts` | `features/remotes/index.ts`, hub tab + sidebar summary |
| A — submodules | `src/server/git/submodules.ts`, `routes/submodules.routes.ts` | `features/submodules/index.ts` |
| B — LFS | `src/server/git/lfs.ts`, `routes/lfs.routes.ts` | `features/lfs/index.ts` |
| C — patches | `src/server/git/patches.ts`, `routes/patches.routes.ts` | `features/patches/index.ts` |
| C — bisect | `src/server/git/bisect.ts`, `routes/bisect.routes.ts`, IPC `bisect:run` | `features/bisect/index.ts` |
| C — notes | `src/server/git/notes.ts`, `routes/notes.routes.ts` | `features/notes/index.ts`, list marker + drawer editor |
| D — tools | `src/server/tools/{definitions,launch}.ts`, `routes/tools.routes.ts` | `features/tools/index.ts` |
| D — Explorer | `src/main/shell-integration.ts`, IPC `shell:*` | Tools tab |
| E — operations | migrated call sites in `routes/sync.routes.ts` and elsewhere | `features/operations/index.ts` |

All six toolsets are behind one **Repository hub**
(`src/renderer/features/repo-hub/index.ts`) rather than six more sidebar
sections. The sidebar keeps three compact summaries — remotes, submodules and
LFS — that deep-link into the right tab.

### Decisions worth not relitigating

- **The operations bar is a sibling of `<main>`, not a child.** The main body
  is blurred and `pointer-events: none` while an operation blocks the app, so a
  bar inside it would render a Cancel button nobody could click. A test asserts
  the structure, because no amount of testing the button would catch it.

- **Blocking behaviour did not change.** The bar adds honest progress,
  cancellation and diagnostics. Making the app non-blocking was considered and
  deliberately not done.

- **Nothing that starts a program is on the HTTP API.** Bisect runs and external
  tool launches follow Phase 3's agent-launch precedent and live behind the
  Electron IPC bridge. A "desktop-only" header check was rejected: anything that
  can reach the loopback port can set a header.

- **Saving a patch is authorised by the Save dialog itself.** The main process
  writes only to a path that came back from `showSaveDialog`, and each path is
  spent on first use, so one dialog authorises exactly one write. A channel that
  wrote to any path the renderer named would be a file-write primitive.

- **Two duplicate paths were collapsed rather than added to.** The old
  `/api/git/remote/prune` had no recovery point and validated a remote name as a
  ref; the SSH/HTTPS pill ran its own `remote set-url`. Both now go through
  `src/server/git/remotes.ts`.

### Left undone, and why

- A patch whose bytes are not valid UTF-8 cannot round-trip through the apply
  field: it arrives as a JSON string, so the decode has already happened. The
  preview flags a binary patch. A binary upload path was out of scope.
- LFS locking has not been run against a real lock server, and the Explorer
  entries have not been installed on a clean machine. Both are covered against
  scripted commands; see the open follow-ups in
  [README.md](README.md#open-follow-ups-carried-forward).
- Notes are shown as a marker plus a drawer editor, not inline in the history
  list. Inline text would need variable-height rows, and the graph gutter is
  drawn against a fixed row height so its lanes tile between rows.
