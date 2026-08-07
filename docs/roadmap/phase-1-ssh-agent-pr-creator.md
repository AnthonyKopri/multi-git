---
title: "Phase 1: SSH agent reliability and pull-request creator"
phase: 1
status: complete
completed: 2026-08-07
branch: claude/phase-1-ssh-agent-pr-creator
depends_on: [phase-0]
suggested_branch: codex/phase-1-ssh-agent-pr-creator
parallelizable: true
lanes: [ssh-agent, pull-request-creator]
---

# Phase 1: SSH Agent Reliability and Pull-Request Creator

## Outcome

Selecting an unlocked SSH key makes command-line and external coding-agent pushes work through the native Windows SSH agent, while a large in-app GitHub PR window creates draft or ready pull requests without leaving Multi-Git.

The SSH and PR lanes may be assigned separately after agreeing on shared repository settings and process-runner types.

## Scope and non-goals

- Windows-native OpenSSH agent discovery, repair, key loading, verification, repository routing, and diagnostics.
- Non-Windows detection and actionable diagnostics; automated service mutation is deferred until platform-specific designs are approved.
- GitHub-first PR creation through `gh`, behind a provider interface.
- No custom SSH agent daemon, private-key copying, token storage, browser scraping, or proprietary external-agent hooks.
- Do not remove keys loaded by other applications and never use `ssh-add -D`.

## Lane A — SSH agent lifecycle

### State model

```ts
export type SshAgentAvailability = "ready" | "stopped" | "disabled" | "missing" | "unreachable";

export interface SshAgentKey {
  fingerprint: string;
  comment?: string;
  source: "multi-git-session" | "pre-existing";
}

export interface SshAgentState {
  platform: NodeJS.Platform;
  availability: SshAgentAvailability;
  serviceName?: string;
  socketPresent: boolean;
  keys: SshAgentKey[];
  selectedProfileId?: string;
  selectedFingerprint?: string;
  selectedKeyLoaded: boolean;
  repairRequiresElevation: boolean;
  diagnostic?: string;
}
```

### Required behavior

1. On startup and before an SSH network operation, call `ssh-add -l` through the shared runner and inspect the Windows `ssh-agent` service. Treat exit code 1 as “agent reachable, no identities” and connection errors as unavailable.
2. When the selected profile is `System`, remove repository-specific SSH routing and use the inherited environment. Do not start or mutate an agent solely for System mode.
3. When a registered key is selected and unlocked:
   - ensure the native `ssh-agent` service is running;
   - if disabled/stopped, offer one explicit **Repair and start SSH agent** action;
   - invoke an Electron-main IPC handler that runs a constant, audited elevated PowerShell command to set the service to Automatic and start it;
   - load only the selected private key with `ssh-add <absolute-key-path>`;
   - supply the vault passphrase through a short-lived AskPass helper and environment, not argv/stdout/logs;
   - verify the expected public-key fingerprint appears in `ssh-add -l` output.
4. Record only fingerprints loaded by this Multi-Git process. Vault lock may remove those identities individually with `ssh-add -d <public-key-path>`; app exit should leave native-agent keys available so terminals, Codex, Claude, and other tools continue to push. Provide an explicit **Unload this key** action.
5. Persist the active SSH profile in repository settings. Configure repository-local `core.sshCommand` to select the expected identity (`IdentitiesOnly=yes`) while still using the native agent. This makes external processes launched in that repository inherit the same routing without Multi-Git's child-process environment.
6. Migrate existing “managed SSH config” behavior without overwriting user-owned `~/.ssh/config`. Any generated include remains clearly delimited and atomically written.
7. If repair or loading fails, keep in-app Git usable through the existing per-command fallback and display a precise degraded-state diagnostic. Never silently switch the remote to HTTPS.
8. Re-check agent/key state after resume, profile change, vault unlock/lock, and before push/fetch/pull. Coalesce checks to avoid UI churn.

### API and IPC

- `GET /api/ssh/agent/status`
- `POST /api/ssh/agent/load` with `{ repoPath, profileId }`
- `POST /api/ssh/agent/unload` with `{ fingerprint }`, limited to session-owned identities unless explicitly confirmed
- Electron preload: `getSshAgentStatus()`, `repairSshAgent()`, and status subscription. Elevation is desktop-only and never exposed as arbitrary PowerShell.

## Lane B — GitHub pull-request creator

### Provider contract

```ts
export type HostingProviderId = "github";

export interface PullRequestPreflight {
  provider: HostingProviderId;
  authenticated: boolean;
  cliAvailable: boolean;
  headBranch: string;
  headPushed: boolean;
  defaultBaseBranch: string;
  commitsAhead: number;
  commitsBehind: number;
  existingPullRequestUrl?: string;
  warnings: string[];
}

export interface PullRequestCreateInput {
  repoPath: string;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
  draft: boolean;
  maintainerCanModify: boolean;
  reviewers?: string[];
  assignees?: string[];
  labels?: string[];
}

export interface PullRequestCreateResult {
  provider: HostingProviderId;
  number: number;
  url: string;
  state: "draft" | "open";
}
```

Implement a `HostingProvider` interface with `detect`, `preflightPullRequest`, and `createPullRequest`; register only `GitHubGhProvider` in this phase. All `gh` calls go through the injectable runner. Pass multiline body content via stdin or a securely managed temporary file, never shell quoting.

### Window and flow

1. Add **Create Pull Request…** to the repository toolbar/menu and command surface. Open a large responsive modal/window, not a narrow popover.
2. Preflight repository host, `gh` availability/authentication, current/head branch, default base, ahead/behind counts, unpushed commits, dirty state, duplicate PR, and fork ownership.
3. Show base/head selectors, title, Markdown body, draft toggle, maintainer-edit toggle, optional reviewers/assignees/labels, commit summary, changed-file count, warnings, and a final URL action.
4. Seed title/body from commits and an available repository PR template. Never overwrite user edits when asynchronous metadata arrives.
5. If the head is unpushed, require an explicit **Push and create** choice. The push must use the selected SSH profile and pass the SSH-agent preflight before invoking `gh pr create`.
6. Support same-repository branches and GitHub forks. Explain when upstream push permission is absent and select the authenticated user's fork when possible.
7. Handle missing `gh`, expired auth, detached HEAD, no commits ahead, protected branch rejection, duplicate PR, network failure, cancellation, and partial success. If push succeeds but creation fails, retain form state and say so.
8. On success, show PR number/URL with **Open in browser** and **Copy link**. Refresh repository status without clearing unrelated working changes.

### Server endpoints

- `GET /api/pull-requests/preflight?repoPath=...&headBranch=...`
- `POST /api/pull-requests`

Both validate canonical repository paths and return typed error codes such as `CLI_MISSING`, `AUTH_REQUIRED`, `NO_COMMITS_AHEAD`, `HEAD_NOT_PUSHED`, `PR_EXISTS`, `CANCELLED`, and `PROVIDER_ERROR`.

## Testing

Automated SSH cases:

- service ready/stopped/disabled/missing; `ssh-add` exit codes 0/1/error; key already present; wrong fingerprint; locked vault; cancelled elevation; AskPass timeout; path with spaces/Unicode; resume; unload ownership; System-profile behavior.
- Assert no passphrase or private material appears in runner calls, logs, API errors, or snapshots.
- Repository-local config changes are idempotent and never modify another repository.

Automated PR cases:

- Mock `git` and `gh` argv/stdin for success, draft, fork, duplicate, missing CLI, auth failure, dirty tree, detached HEAD, unpushed head, push success/create failure, validation, cancellation, and hostile title/body text.
- Renderer tests cover keyboard focus, validation, preserving edits, loading/partial-success states, and accessible labels.

Manual acceptance:

1. On Windows with `ssh-agent` Disabled/Stopped and no `SSH_AUTH_SOCK`, unlock/select a registered key, approve repair, and verify `ssh-add -l` contains it.
2. Open PowerShell, Codex, or Claude in the repository and push via the SSH remote without changing to HTTPS or re-entering the passphrase.
3. Restart Multi-Git and confirm profile routing and key-state reporting remain correct.
4. Create ready and draft GitHub PRs, including one with an unpushed branch and one fork workflow.

## Definition of done

- Selecting an unlocked key results in a verified native-agent identity or a precise recoverable diagnostic.
- External processes in the repository use the selected SSH identity and are never silently redirected to HTTP.
- Native-agent keys remain after app exit; only explicit/session-owned unload actions remove identities.
- The complete GitHub PR flow works in the large in-app creator with robust preflight and retained failure state.
- Tests are credential-free, compilation passes, and security-sensitive behavior has a manual review record.

## Handoff notes

Report any elevation behavior, files/config written outside the repository, cleanup strategy for the AskPass helper, exact `gh` command forms, and which manual scenarios were executed. Include screenshots of ready, repair-required, PR validation, and PR success states when practical.
