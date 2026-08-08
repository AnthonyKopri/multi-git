---
title: "Phase 2: Precision review, history editing, signing and recovery"
phase: 2
status: complete
completed: 2026-08-08
depends_on: [phase-0]
soft_dependencies: [phase-1-ssh-for-signing]
suggested_branch: claude/phase-2-review-history-recovery
parallelizable: true
lanes: [diff-staging, history-search, rebase-recovery, signing]
lanes_complete: [diff-staging, history-search, rebase-recovery, signing]
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

**Landed 2026-08-08.** Stage, unstage and discard work at hunk and line level,
end to end, and the review side is complete: side-by-side, intra-line word
highlights, a whitespace toggle, image comparison and binary metadata. Details
in [Workstream A status](#workstream-a-status).

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

**Landed 2026-08-08.** See [What shipped](#what-shipped).

- Selective stash accepts chosen files/hunks, includes/unincludes untracked files, supports messages, and restores the prior index exactly.
- Multiple-stash browser: inspect, search, rename-equivalent annotation if supported locally, apply, pop, branch-from, and drop with confirmation/Safety Net.
- Full-text commit search across hash, subject/body, author, paths, branches/tags, and date range. Add branch/tag filters and cancellable pagination.
- Compare any two refs with commits-ahead/behind, unique commits, changed files, and patch view.
- Branch management: rename local branches, pin favorites, set/change upstream, identify merged/stale branches, prune remotes, and guarded delete.
- Add a keyboard-first command palette indexing safe app actions and contextual Git actions. Destructive commands still require their normal confirmation.

## Workstream C — recovery before rewriting

**Landed 2026-08-08.** See [What shipped](#what-shipped).

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

**Landed 2026-08-08.** See [What shipped](#what-shipped).

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

**Landed 2026-08-08.** See [What shipped](#what-shipped).

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

## What shipped

All five workstreams landed on 2026-08-08, on
`claude/roadmap-version-display-e8d226`, in five commits — one per
workstream plus the window-title change that prompted the branch.

| Workstream | Where |
| --- | --- |
| A — structured diff and precision staging | `src/shared/diff-types.ts`, `src/server/git/{structured-diff,patch-build,precision-staging}.ts`, `src/server/routes/diff.routes.ts`, `src/renderer/features/diff/` |
| B — selective stash, search, compare, branch maintenance, palette | `src/server/git/selective-stash.ts`, `src/server/routes/{stash,search,branch-admin}.routes.ts`, `src/renderer/features/{palette,search,branch-admin}/` |
| C — durable recovery journal and reflog | `src/shared/recovery-types.ts`, `src/server/git/reflog.ts`, `src/server/safety-net/recovery.ts`, `src/server/routes/recovery.routes.ts`, `src/renderer/features/recovery/` |
| D — interactive rebase and commit splitting | `src/shared/rebase-types.ts`, `src/server/git/{rebase,rebase-bridge}.ts`, `src/server/routes/rebase.routes.ts`, `src/renderer/features/rebase/` |
| E — signing | `src/shared/signing-types.ts`, `src/server/git/signing.ts`, `src/server/routes/signing.routes.ts`, `src/renderer/features/signing/` |

Suite: 792 passed, 3 skipped, up from 521 at the start of the phase. The
three skips are Phase 0's; the signing tests skip themselves where
`ssh-keygen` cannot sign, rather than pretending to have run.

### Decisions a later phase should not have to rediscover

- **Patch direction inverts the rule for unselected lines.** Applying
  forward, an unselected addition is dropped and an unselected deletion
  becomes context; reversed, the other way round. The table at the top of
  `patch-build.ts` is the reference. Selective stash needs *both* patches for
  one selection, because its two applies go in opposite directions — building
  one and reusing it is how the first version silently failed to apply.
- **Staleness is structural.** A hunk id is a hash of its position and
  content, and the server re-reads the diff before applying, so a hunk that
  moved is simply not found. No token to keep in step.
- **A partial selection out of a whole-file add or delete rewrites its own
  header**, or git refuses with "new file … depends on old contents".
- **The rebase editor bridge takes its mode as an argument, not from the
  environment.** Git uses both editors during one rebase, and a bridge that
  cannot tell them apart writes the todo list over a commit message.
- **A rebase git refused looks exactly like one that finished** — no rebase in
  progress, either way — unless the exit status is kept. It is.
- **`%G?` says `N` for a signed commit that cannot be verified**, so an `N` is
  checked against the commit object before anything is called unsigned.
- **Recovery points live in the repository's git directory**, not in user
  config: a point is meaningless without the objects it names, and deleting a
  repository should take its points with it.
- **Capture is routed through `captureCheckpoint`**, so a new destructive
  operation cannot record a session undo and forget the durable point.
- **The whitespace toggle is a reading setting, never an applying one.** A
  patch built from a diff that hid whitespace changes would silently discard
  them, so an apply always re-reads with whitespace shown.
- **Blobs are read as bytes.** Decoding a blob as UTF-8 replaces every invalid
  sequence, so an image round-tripped through the text path is not the image
  any more. `binaryStdout` on the runner exists for this.
- **So are text diffs.** The same replacement happens to a Latin-1 source file,
  and there it corrupts the user's own lines rather than an image. The whole
  patch pipeline is byte-faithful; see `src/server/git/encoding.ts`.

### Still open

Every clause of the definition of done is met. One item is deliberately not
done — see [Syntax-aware rendering](#syntax-aware-rendering-deliberately-not-done)
below — and one was scoped to a later phase from the start:

- **Operation progress has no UI.** Diff reads and searches are registered as
  cancellable operations, and the runner takes an AbortSignal, but the panel
  that would let a user press cancel is Phase 4's. Phase 2 reports through the
  registry without rendering it, exactly as the phase brief asked.

Three limitations recorded here when the phase landed have since been fixed;
see [Follow-up fixes](#follow-up-fixes).

### Syntax-aware rendering: deliberately not done

The phase brief asked for "syntax-aware rendering **where safe**". Having built
the rest of the diff pane, the answer to *where safe* turned out to be narrow
enough that the feature was declined rather than deferred to a date. Decided
2026-08-08.

**It conflicts with the rule that makes the diff pane safe.** The renderer
builds every node with `textContent` and never `innerHTML`, because file
contents are repository data and a repository is not trusted input — the same
reason `script-src 'self'` carries no `'unsafe-inline'`. Most highlighters
return an HTML string. Using one means either calling `innerHTML` on untrusted
file content or adding a sanitiser to defend against the library just chosen.
A token-emitting highlighter avoids this, which narrows the field to a few
candidates before anything else is weighed.

**A diff cannot be highlighted accurately without the whole file.** Hunks are
fragments with gaps between them. A hunk that begins inside a block comment or
a template literal has no way to know it, so per-line highlighting is wrong at
exactly the boundaries a reader is looking at. Getting it right means fetching
both complete versions, highlighting each, and mapping lines back into the
hunks — which is a great deal of work and memory for a hunk of a large file.

**The pane is already using colour for two things.** Added and removed lines
carry a background, and intra-line word highlighting marks what changed within
a line. Syntax colour is a third system competing for the same pixels, and its
failure mode — a comment fragment rendered as code — misleads rather than
merely looking wrong.

**What would change the decision.** A token-emitting highlighter small enough
to bundle beside a 157 KB web bundle and one runtime dependency, plus a reason
to accept per-line approximation — most likely shipping it as a toggle in the
diff view options, defaulting off, so it never has to be right to be useful.
The structured diff model supports it: `StructuredDiffLine.content` is the
text, and `word-diff.ts` already segments a line, so syntax tokens would be a
second segmentation merged at the union of both boundaries. That merge, not
the library, is the work.

## Follow-up fixes

Landed 2026-08-08, after the phase merged. Each closes something the phase
shipped with, recorded above at the time as a limitation.

### Non-UTF-8 files were corrupted by precision staging

**What happened.** The patch pipeline decoded git's output as UTF-8. A file in
Latin-1, Windows-1252 or any other encoding contains bytes that are not valid
UTF-8, and the decoder replaced each one with U+FFFD; encoding that back
produced different bytes from the ones that went in.

Two symptoms, depending on where the byte sat. In a context line, the mangled
text no longer matched the file and the apply failed with git's
"patch does not apply" — confusing, but harmless. In a changed line with ASCII
context, git had nothing to catch it on: staging reported success and silently
rewrote `Café` as `Caf<U+FFFD>` in the index.

**The fix.** `src/server/git/encoding.ts`. A diff is bytes from git to
`git apply`, carried as a `latin1` string — the one decoding where every byte
maps to exactly one code unit and back. Everything the parser reads is ASCII,
which means the same in both, so parsing is unchanged. Decoding to UTF-8
happens once, at the route that serialises for the renderer.

Ids are hashed over the transport form and the renderer only echoes them back,
so a selection still resolves against a fresh read. Display is unchanged and
cannot be better: nothing tells the application what encoding a file is in.

### Interactive rebase failed in long repository paths on Windows

**What happened.** `git rebase -i` names one of its internal files after the
commit range — two 40-character object names and three dots. In a repository
whose own path is long, that crosses Windows' 260-character limit and the
rebase fails before it starts.

**The fix.** `rebaseGitArgs` in `src/server/git/rebase.ts` passes
`-c core.longpaths=true` on every rebase-family invocation, on Windows only.
Per invocation rather than written to the user's configuration, and scoped to
rebase rather than applied to every command — where it would also let git
create working-tree paths that other Windows tools cannot open.

### GPG signing had no test against a real keyring

`tests/signing-gpg.test.ts` generates an unprotected key in a `GNUPGHOME` of
its own and covers signing a commit, an amend and a tag, sign-by-default and
opting out of it, a tampered commit reading as `bad`, and a signature this
repository has no key for reading as `unknown` rather than `unsigned`. It
skips where gpg cannot produce a key, rather than pretending to have run.

No defect was found in the GPG paths; they were simply unverified.

## Workstream A status

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

### Presentation, added 2026-08-08

| Piece | Where |
| --- | --- |
| Token-level line diffing and removal/addition pairing | `src/renderer/features/diff/word-diff.ts` |
| Side-by-side layout and word highlighting | `src/renderer/features/diff/structured-view.ts` |
| Whitespace modes on the read | `src/server/git/precision-staging.ts` |
| Image and binary comparison | `src/server/git/blob.ts`, `GET /api/git/diff/blobs` |

Only syntax-aware rendering is left, and it is a dependency decision rather
than a gap in the model.
