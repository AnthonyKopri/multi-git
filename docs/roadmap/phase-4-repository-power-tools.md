---
title: "Phase 4: Repository power tools"
phase: 4
status: planned
depends_on: [phase-2]
dependencies_met: true
suggested_branch: claude/phase-4-repository-power-tools
parallelizable: true
lanes: [remotes-submodules, lfs, patch-bisect-notes, external-tools-progress]
---

# Phase 4: Repository Power Tools

> **Ready to start.** The dependency was Phase 2's recovery primitives, and
> Phase 2 completed on 2026-08-08. This phase can run in parallel with
> Phase 3.
>
> What Phase 2 leaves for this phase to build on:
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
