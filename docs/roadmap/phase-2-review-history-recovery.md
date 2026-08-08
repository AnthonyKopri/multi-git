---
title: "Phase 2: Precision review, history editing, signing and recovery"
phase: 2
status: in-progress
depends_on: [phase-0]
soft_dependencies: [phase-1-ssh-for-signing]
suggested_branch: claude/phase-2-review-history-recovery
parallelizable: true
lanes: [diff-staging, history-search, rebase-recovery, signing]
lanes_complete: [diff-staging-core]
---

# Phase 2: Precision Review, History Editing, Signing and Recovery

## Outcome

Bring daily review and local history workflows to parity with mature clients: line/hunk actions, rich diffs, searchable history, selective stashes, interactive rebase, commit splitting, signing, and reliable undo/recovery.

## Dependency and sequencing

Phase 0 is required. Diff/staging and history-search lanes can start independently. Signing should reuse the Phase 1 SSH-agent state model. Persistent recovery primitives must land before exposing destructive rebase, reset, amend, or branch-cleanup actions.

**Both prerequisites are merged.** Phase 0 and Phase 1 are in `improvements` as of 2026-08-07. Branch from there.

## What already exists — do not rebuild it

The foundations table in [README.md](README.md#current-state) is the full list. The parts this phase will reach for most:

- **Running git, `gpg`, `ssh-keygen` or anything else**: `src/server/process/runner.ts`. Injectable, argv-only, no shell, cancellable, and it redacts secrets from stdout, stderr and the recorded argv. An interactive rebase or a signing operation must not invent its own `spawn`.
- **Long-running or cancellable work**: `src/server/operations/registry.ts`. An interactive rebase is exactly the kind of operation this exists for. The registry is server-side only; the UI panel is Phase 4, so this phase reports through it without rendering it.
- **Signing identity**: `src/server/ssh/agent-session.ts` already models agent availability, key loading, fingerprint verification and per-repository identity. SSH signing should read that state rather than re-deriving which key is active. `ensureAgentForRepo` is the call to make before an operation that needs the key.
- **Anything persisted**: `src/server/config/migrations.ts`, with a fixture for the version being upgraded from. Repository-scoped settings key off `canonicalRepoKey`, never a display path.
- **Tests that shell out**: `tests/helpers/fake-runner.ts`. **Renderer tests**: `// @vitest-environment happy-dom` against the real `public/index.html` — see `tests/pull-request-window.test.ts` for the pattern, including how it asserts on preserved user input and accessible labels.

Two conventions this phase inherits and must keep: repository data is rendered with `textContent`, never `innerHTML`, because a repository is not trusted input; and anything that could destroy work goes through Safety Net before it is offered.

## Workstream A — structured diff and precision staging

**Core landed on 2026-08-08.** Stage, unstage and discard now work at hunk and
line level, end to end. What shipped and what is still open is recorded in
[Workstream A status](#workstream-a-status) at the foot of this file; the
presentation items — side-by-side view, word highlights, whitespace toggles,
image comparison — are the remainder.

Create a parser/model independent of rendered patch text:

```ts
export interface DiffFile {
  oldPath?: string;
  newPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "binary";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  binary?: { mime?: string; oldSize?: number; newSize?: number };
}

export interface DiffHunk {
  id: string;
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface PatchSelection {
  repoPath: string;
  filePath: string;
  source: "working-tree" | "index" | "commit";
  hunkIds?: string[];
  lineIds?: string[];
}
```

- Support stage, unstage, and discard for files, hunks, and valid line selections. Generate/apply patches through stdin (`git apply --cached`, reverse modes as appropriate); never shell-interpolate patch data.
- Re-read status/diff before apply and fail with a stale-selection message when context changed. Discard requires Safety Net capture and confirmation proportional to impact.
- Add side-by-side/unified views, intra-line word highlights, whitespace toggles, syntax-aware rendering where safe, rename display, binary metadata, and before/after image comparison.
- Keep large diffs responsive through virtualized rendering, file/hunk lazy loading, cancellation, and size thresholds with an explicit “load anyway”.

## Workstream B — stash and history discovery

- Selective stash accepts chosen files/hunks, includes/unincludes untracked files, supports messages, and restores the prior index exactly.
- Multiple-stash browser: inspect, search, rename-equivalent annotation if supported locally, apply, pop, branch-from, and drop with confirmation/Safety Net.
- Full-text commit search across hash, subject/body, author, paths, branches/tags, and date range. Add branch/tag filters and cancellable pagination.
- Compare any two refs with commits-ahead/behind, unique commits, changed files, and patch view.
- Branch management: rename local branches, pin favorites, set/change upstream, identify merged/stale branches, prune remotes, and guarded delete.
- Add a keyboard-first command palette indexing safe app actions and contextual Git actions. Destructive commands still require their normal confirmation.

## Workstream C — recovery before rewriting

Extend Safety Net from operation snapshots into a durable recovery journal linked to native Git recovery points.

```ts
export interface ReflogEntry {
  ref: string;
  selector: string;
  oid: string;
  previousOid?: string;
  action: string;
  timestamp: string;
}

export interface RecoveryPoint {
  id: string;
  repoPath: string;
  operation: string;
  refs: Record<string, string>;
  stashRef?: string;
  createdAt: string;
  expiresAt?: string;
}
```

- Before every reset, rebase, amend, force branch move/delete, stash drop, or bulk discard, record affected refs and working/index preservation when needed.
- Add a recovery browser combining Multi-Git recovery points and reflog entries. Actions: inspect, create branch, restore ref, reapply snapshot, and copy command.
- Expiration is transparent and configurable; never run cleanup during an unfinished operation.

## Workstream D — interactive rebase and commit editing

```ts
export type RebaseAction = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";
export interface RebaseTodoItem { oid: string; action: RebaseAction; subject: string; }
export interface RebasePlan { repoPath: string; onto: string; items: RebaseTodoItem[]; autosquash: boolean; }
```

- Visual planner supports reorder, reword, squash/fixup, drop, autosquash preview, and validation against duplicate/missing commits.
- Use controlled sequence-editor/message-editor bridges with securely created temporary files. Do not build a shell script from subjects or paths.
- Persist an operation session so the UI can continue/skip/abort after conflicts or app restart.
- Commit splitting at an `edit` stop resets the selected commit while preserving changes, opens the precision staging UI, tracks remaining changes, and resumes only after at least one replacement commit.
- Require recovery-point creation and show push consequences before rewriting a published branch. Force pushes use `--force-with-lease`, never unqualified `--force`.

## Workstream E — signing

```ts
export interface SignatureInfo {
  kind: "ssh" | "gpg";
  status: "good" | "bad" | "unknown" | "unsigned";
  signer?: string;
  fingerprint?: string;
  trust?: string;
}
```

- Display commit/tag signature status and details without claiming trust Git cannot establish.
- Configure signing per repository with System, GPG key, or registered SSH signing key. Reuse the unlocked-key and native-agent services from Phase 1.
- Support sign commit, sign amend, sign tag, and “sign commits by default”. Failure must leave the user's changes intact and surface actionable tool/agent diagnostics.

## API surface

Add typed endpoints/services for structured diffs, patch selection actions, stash inspection/actions, commit search, ref comparison, branch maintenance, recovery points/reflog, rebase plan/start/continue/skip/abort, and signature configuration/status. Mutations require canonical repo validation and operation IDs for progress/cancellation.

## Testing

- Golden diff fixtures: CRLF/LF, Unicode, no-newline marker, rename/copy, binary, image, mode change, submodule, huge hunk, conflict, and hostile filenames.
- Patch selection property tests verify only selected lines change and stale context never applies incorrectly.
- Stash tests preserve staged/unstaged/untracked combinations exactly.
- Recovery integration fixtures run each destructive operation, simulate interruption/restart, and restore the original refs/worktree.
- Rebase tests cover every action, autosquash, conflicts, abort, restart, published-branch warning, split commit, cancellation, and temp-file cleanup.
- Signing tests mock tool/agent responses and include missing key/tool, locked key, good/bad/unknown signatures, and failed commit signing.

## Definition of done

- Users can safely act on a line or hunk and review common text/image changes without external tools.
- Search/compare and branch cleanup remain responsive on large histories.
- Every history-rewriting/destructive operation creates an inspectable recovery path first.
- Interactive rebase survives conflicts and app restarts, and published history uses lease-protected force push.
- SSH/GPG signing works without exposing passphrases or misrepresenting verification status.

## Handoff notes

Document patch-generation assumptions, diff size thresholds, recovery retention, rebase temp/editor protocol, Git-version requirements, and signing tool matrix. Include before/after recovery evidence for every destructive operation shipped.

## Workstream A status

Landed 2026-08-08 on `claude/roadmap-version-display-e8d226`.

### Shipped

| Piece | Where |
| --- | --- |
| Structured diff model | `src/shared/diff-types.ts` |
| Unified-diff parser keeping header lines and hunk identity | `src/server/git/structured-diff.ts` |
| Reduce a diff to the selected changes, forward or reversed | `src/server/git/patch-build.ts` |
| Read a diff, synthesise one for untracked files, apply a selection | `src/server/git/precision-staging.ts` |
| `GET /api/git/diff/structured`, `POST /api/git/diff/apply-selection` | `src/server/routes/diff.routes.ts` |
| Selectable line rows, per-hunk actions, selection toolbar | `src/renderer/features/diff/structured-view.ts`, `.../diff/index.ts` |

Stage, unstage and discard each work on a whole file, a hunk, or an arbitrary
set of lines. Discard captures a Safety Net snapshot before it touches the
working tree, and asks for confirmation unless the repository opted out.

### Decisions worth knowing before extending this

- **Patch direction inverts the rule for unselected lines.** Applying forward,
  an unselected addition is dropped and an unselected deletion becomes context;
  reversed, it is the other way round. The table at the top of
  `patch-build.ts` is the reference. A consequence the code relies on: the side
  being consumed always survives intact, so its `@@` range is copied from the
  original hunk and only the produced side is recounted and shifted.
- **Staleness is structural, not a token.** A hunk id is a hash of its position
  and content, so a hunk that moved or changed simply is not found in the fresh
  read the server does before applying, and the request is refused with 409.
  There is no separate version to keep in step.
- **Header lines are replayed verbatim.** Path quoting, modes and rename
  metadata come back out exactly as git wrote them, which is what makes hostile
  and non-ASCII filenames work without a quoting implementation of our own.
- **Omitting both id lists means the whole file; an empty list means nothing**
  and is refused. A UI that lost its checkboxes must not stage everything.
- **A partial selection out of a whole-file add or delete rewrites its own
  header.** Keeping half of an added file means the patch no longer creates it,
  and git rejects a `new file` patch whose old side has content
  ("new file … depends on old contents"). So the create/delete markers and the
  `index` line come off and the `/dev/null` side is pointed at the real path,
  taken from the other side's header line so its quoting is already right.
- **Untracked files get a synthesised added-file diff** so the same selection
  path works on them. Partial *discard* is refused for them: reversing a patch
  whose pre-image is `/dev/null` would delete the file.
- **Diffs over 2 MB are not read** unless the request passes `force=true`,
  which is what the pane's "Load anyway" button sends.

### Still open in this workstream

- Side-by-side view, intra-line word highlights, whitespace toggles, and
  syntax-aware rendering.
- Before/after image comparison and richer binary metadata.
- Cancellation of a diff read through the operations registry; the size
  threshold covers the responsiveness case for now, and the registry has no UI
  until Phase 4.
- A non-UTF-8 file's diff round-trips through a UTF-8 string. Text in another
  encoding would be re-encoded on the way back into `git apply`. No test
  covers it because no current code path produces one.
