---
title: "Phase 3: Worktrees, windows and external coding agents"
phase: 3
status: planned
depends_on: [phase-1]
recommended_dependencies: [phase-2-recovery]
suggested_branch: codex/phase-3-worktrees-windows-agents
parallelizable: true
lanes: [worktrees, multi-window, agent-launch]
---

# Phase 3: Worktrees, Windows and External Coding Agents

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
- A forced removal requires Phase 2 recovery capture, explicit typed confirmation, and exact resolved target validation. Never recursively remove a computed path outside the allowed worktree root.
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

## Handoff notes

Record supported Git/Windows Terminal versions, canonicalization rules, worktree parent defaults, removal protections, watcher strategy, external-agent adapters tested, and every desktop-only authorization boundary.
