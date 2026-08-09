---
title: "Phase 3: Worktrees, windows and external coding agents"
phase: 3
status: complete
completed: 2026-08-09
depends_on: [phase-1]
recommended_dependencies: [phase-2-recovery]
dependencies_met: true
suggested_branch: claude/phase-3-worktrees-windows-agents
parallelizable: true
lanes: [worktrees, multi-window, agent-launch]
---

# Phase 3: Worktrees, Windows and External Coding Agents

> **Complete, 2026-08-09.** Every workstream landed, plus the SSH unlock
> prompt described under Workstream D and the `x-repo-path` transport fix that
> had been carried as an open follow-up since Phase 0.
>
> Two assumptions in the original plan turned out to be wrong when checked
> against git and against this codebase. Both are corrected below and in the
> implementation; they are recorded rather than quietly edited out, because
> either one would have been rediscovered as a bug.
>
> **1. Worktrees do not each need the `core.sshCommand` pin.** The plan said
> "a worktree is a separate folder, so each one needs that pin applied when it
> is created". They do not: linked worktrees share one `.git/config`, because
> `git config --local` writes to `$GIT_COMMON_DIR/config`. The pin Phase 1
> writes is therefore *already inherited* by every worktree of the family, and
> writing a second one would be writing the same value to the same file.
> A repository and its worktrees consequently have **one** SSH identity, not
> one each — per-worktree identities would need `extensions.worktreeConfig`,
> which was considered and rejected as a repository-level git extension that
> other tools reading the repository would also see. `profileForRepo` and
> `rememberProfileForRepo` now resolve to the family's main worktree, so the
> settings agree with what git will actually do.
>
> **2. Agent launch cannot go through `ExecutableRunner.run`.** That method
> awaits completion with a five-minute default timeout, which is the wrong
> shape for a tool someone will be talking to for an hour: it would hold a
> promise open for the whole session and then kill the process. A sibling
> `launchDetached` was added to the same module, keeping every property that
> made the runner worth having — argv-only, `shell: false`, explicit
> environment, injectable for tests — and dropping only the waiting. Process
> tree termination does not apply: Multi-Git does not manage an agent's
> lifetime, and says so.
>
> The full list of foundations is in
> [README.md](README.md#current-state).

## Outcome

Make concurrent work first-class: create and manage Git worktrees, open repositories in independent windows, group related repositories, and launch configured external coding agents in the correct worktree with the selected SSH key already usable.

## Product boundary

Multi-Git launches external agents as user-configured executables. It does not inject hooks, read proprietary session databases, scrape terminals, or claim live task status. “Running” means only that the launch process succeeded unless a future open protocol is deliberately adopted.

## Workstream A — worktree domain and safety

```ts
export interface WorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  isMain: boolean;
  status?: { staged: number; unstaged: number; untracked: number; conflicts: number };
}

export interface CreateWorktreeInput {
  repoPath: string;
  targetPath: string;
  branchMode: "existing" | "new" | "detached";
  branch?: string;
  startPoint?: string;
  lock?: boolean;
}
```

- Parse `git worktree list --porcelain -z`; do not scrape localized human output.
- List worktrees under one common Git directory and show branch, HEAD, lock/prunable state, dirty summary, ahead/behind, PR link when known, and last activity.
- Create from existing/new branch or detached ref with collision checks for paths and already-checked-out branches. Suggest a configurable parent directory but always preview the absolute path.
- Actions: open, reveal, fetch, pull, lock/unlock, move, remove, repair, and prune preview. Never remove a dirty/locked worktree by default.
- A forced removal requires recovery capture, explicit typed confirmation, and exact resolved target validation. Never recursively remove a computed path outside the allowed worktree root. Capture goes through `captureCheckpoint` in `src/server/safety-net/checkpoints.ts`, which writes both the session undo and the durable recovery point; pass an `operation` so the journal says what happened.
- Treat all worktrees as one repository family for remotes/config/history, but keep worktree/index/WIP state separate. Avoid duplicate watchers and refresh storms.

## Workstream B — multi-window and repository groups

- Refactor Electron window management into a registry keyed by canonical worktree/repository path. Each window owns renderer navigation and subscriptions while sharing safe backend services.
- Add **Open in new window** and restore opted-in windows after restart. Focus an existing matching window rather than accidentally duplicating it.
- In browser/server mode, provide equivalent named tabs/views without pretending OS-window control is available.
- Add user-defined repository groups with ordering, color/icon metadata, and quick **Fetch all**. Group operations use Phase 0 progress/cancellation and report per-repository outcomes.
- Persist window bounds/display safely and clamp restored windows to available displays.

## Workstream C — external agent/tool launch

```ts
export interface ExternalAgentDefinition {
  id: string;
  label: string;
  executable: string;
  args: string[];
  terminal: "direct" | "windows-terminal" | "powershell";
  enabled: boolean;
}

export interface AgentLaunchInput {
  repoPath: string;
  worktreePath: string;
  agentId: string;
  initialPrompt?: string;
}

export interface AgentLaunchResult {
  launched: boolean;
  processId?: number;
  commandPreview: string;
}
```

- Auto-detect known installed CLIs only to seed editable definitions (for example Codex and Claude). Users can add any executable.
- Validate the executable, preserve argv boundaries, set the worktree as `cwd`, and pass only an allowlisted environment. Initial prompts are argv/stdin according to a tool adapter, never a shell string.
- On Windows, support Windows Terminal profile launch and direct hidden-process launch as appropriate. Visible terminals are expected for interactive agents.
- Before launch, ensure the repository's selected SSH profile is ready through Phase 1 and repository-local routing is written. If degraded, explain that the agent may be unable to push and offer repair; never rewrite the remote to HTTP.
- Show launch history (agent, worktree, time, result) without storing prompt content by default. Provide **Open terminal here**, **Open editor**, and **Copy path** alongside agent actions.

## API and IPC

- `GET /api/worktrees`, `POST /api/worktrees`, and typed move/lock/unlock/remove/repair/prune-preview actions.
- Repository family/group CRUD and grouped-operation endpoints.
- Desktop-only preload methods for window creation/focus, path reveal, terminal/editor/agent launch. The HTTP server never exposes arbitrary executable launch to remote clients.
- Validate launch definitions at configuration write and execution time; use an explicit allowlist/consent boundary.

## Testing

- Worktree integration matrix: spaces/Unicode, linked worktrees, detached, locked, dirty, missing path, prunable metadata, nested target rejection, branch collision, move, repair, and safe/forced removal.
- Simulate common-directory aliases/symlinks and assert canonical grouping without collapsing distinct repositories.
- Window tests cover open/focus/close/restore, multi-monitor clamping, shared events, and independent selected repositories.
- Agent tests assert exact executable/argv/cwd/env, missing tool, invalid definition, SSH degraded/ready, Windows Terminal quoting, prompt privacy, and desktop-only authorization.
- Stress at least 20 worktrees for watcher count, refresh latency, and memory regression.

## Manual acceptance

1. Create two worktrees for different branches, open each in its own window, make independent changes, restart, and restore both.
2. Launch Codex and Claude (when installed) in separate worktrees and push via the selected SSH identity.
3. Attempt to remove clean, dirty, locked, and moved worktrees; confirm safe defaults and recovery behavior.
4. Run a repository-group fetch, cancel it, and inspect per-repository results.

## Definition of done

- Worktree lifecycle operations match Git state and cannot accidentally delete unrelated or dirty data.
- Multiple windows/worktrees retain independent UI and WIP state without duplicate backend work.
- Configured agents open in the intended worktree with robust argv/cwd and working SSH routing.
- No proprietary agent monitoring, hidden remote rewrite, or arbitrary server-side command execution is introduced.

## Workstream D — restoring an account, and asking to unlock it

Added during implementation. A window that reopens on a repository whose key is
locked looked ready and failed at the first push; the app only ever *mentioned*
the problem, in a log line and a toast telling the user to go and fix it
somewhere else.

"Locked" is two states and they need two questions. `VAULT_LOCKED` means the
passphrase is saved but the vault needs its master key, so the master key is
what to ask for. `PASSPHRASE_REQUIRED` means the key is protected and nothing is
saved for it, so the key's own passphrase is what to ask for — with an offer to
remember it, made only after the passphrase has demonstrably loaded the key. A
third code, `PASSPHRASE_REJECTED`, distinguishes "that was not it, try again"
from "ask for one".

A supplied passphrase reaches ssh through the existing AskPass bridge and
nowhere else: not into an argument vector, not into an environment variable, not
into a response body, and not into the log. `tests/ssh-unlock.test.ts` asserts
that against the fake runner's full record of everything that would have reached
a child process.

The prompt appears when a window opens on a locked key and before a
user-initiated fetch, pull or push — all three authenticate with the same key,
so prompting only for push would be arbitrary. It never appears during a
background refresh or a focus re-check. Declining is remembered for the session,
and the **Unlock key** button in the accounts dropdown is the way back.

## Phase 3 record (2026-08-09)

### Versions and compatibility

| | |
| --- | --- |
| Git | 2.55.0 in development. `git worktree list --porcelain -z` needs 2.36; older versions fall back to the newline form automatically, probed once per family and remembered |
| Windows Terminal | `wt.exe` when present; PowerShell is the fallback for **Open terminal here**, so the action never silently does nothing |
| Suite | 982 passed, 3 skipped (was 792 passed, 3 skipped) |

### Rules worth not rediscovering

- **Canonicalisation.** Worktrees are grouped by `canonicalRepoKey` of
  `git rev-parse --path-format=absolute --git-common-dir`. Two spellings of one
  repository collapse; two genuinely different repositories do not.
- **Git prints forward slashes on Windows.** `git worktree list` reports
  `C:/Users/…` while the rest of the application uses `C:\Users\…`. Normalised
  once, in `listWorktrees`, before any comparison, message or settings key.
- **Worktree parent default.** `<parent of repo>\<repo name>.worktrees\<branch
  slug>`, overridable per creation and by `settings.worktreeParentDir`. Never
  inside the repository: git refuses some nested layouts and a worktree inside
  the repository appears in its own status output forever after.
- **Removal protections.** A dirty or locked worktree is refused outright. A
  forced removal needs all three of: a path `git worktree list` itself returned,
  the folder's name typed by the user, and a recovery point written first.
  Uncommitted work is snapshotted with `git stash create`, which writes a commit
  into the *shared* object store and so outlives the folder; that object name is
  the recovery point's `stashRef`. The recovery point is written against the
  main worktree, because the doomed worktree's git directory goes with it.
  `git worktree remove --force` does the deleting — this application never
  removes a directory tree it computed.
- **No watchers were added.** The refresh model is unchanged: on demand and on
  window focus. Structure is one git call regardless of family size; the dirty
  counts are a second, cancellable pass with a concurrency cap of 4.
- **Agent adapters tested.** `direct`, `windows-terminal` and `powershell`.
  Windows Terminal re-parses after `--` and treats `;` as a command separator,
  so arguments are escaped for that one character. PowerShell is the only mode
  needing a string it will parse, so that string is a compile-time constant and
  the executable and arguments travel in the environment as JSON — the
  `rebase-bridge.ts` pattern.
- **Desktop-only boundaries.** Window creation, focus and claim; open terminal;
  open editor; launch agent. All Electron IPC, all re-validating their path
  argument in the main process with `resolveRepoPath`. `launchAgent` takes an
  agent *id*, looked up in the saved configuration, so no caller ever names a
  program to run. The HTTP server exposes agent definitions and detection and
  has no launch route at all.
- **Prompt privacy.** Prompt text is passed as one argv element and is absent
  from the command preview, the launch history and the Terminal Log.
  `settings.storeAgentPrompts` exists and defaults to false.

### Two Phase 2 defects fixed along the way

Reported from a built app while this phase was in progress. Both belong to
Phase 2 and are written up in full under
[its follow-up fixes](phase-2-review-history-recovery.md#two-ui-defects-reported-from-a-phase-2-build-fixed-2026-08-09):
the signing settings dialog threw on open because a `<select>` was narrowed
with `asInput`, and the Commit button was drawn over the commit template chips
because its column did not fit the panel.

The first left a general check behind. `tests/packaging.test.ts` now verifies
every typed element access in the renderer against the tag `index.html` uses,
which the existing id check could not do — the id existed, and the TypeScript
types are identical either way.

### Carried out of scope deliberately

- `git worktree add --orphan` and bare-repository families are listed correctly
  but cannot be created from the UI.
- Group membership is edited from the repositories Multi-Git has opened before,
  because those are the ones whose location it can still resolve.

## Handoff notes

Record supported Git/Windows Terminal versions, canonicalization rules, worktree parent defaults, removal protections, watcher strategy, external-agent adapters tested, and every desktop-only authorization boundary.
