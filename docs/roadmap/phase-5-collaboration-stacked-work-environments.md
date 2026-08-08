---
title: "Phase 5: Collaboration, stacked work and environments"
phase: 5
status: planned
depends_on: [phase-1, phase-2, phase-3, phase-4]
blocked_on: [phase-3, phase-4]
suggested_branch: claude/phase-5-collaboration-stacked-work-environments
parallelizable: true
lanes: [providers, pr-dashboard, stacked-work, wsl, remote-ssh-discovery]
---

# Phase 5: Collaboration, Stacked Work and Environments

> **Blocked on Phases 3 and 4.** Phase 2 completed on 2026-08-08, so of the
> four prerequisites only worktrees (Phase 3) and the power tools (Phase 4)
> are outstanding.
>
> Phase 1 delivered the `HostingProvider` contract
> (`src/shared/provider-types.ts`) with GitHub as the only implementation,
> which is the seam the additional providers plug into — see
> `src/server/providers/github.ts` for the shape an implementation takes.
>
> Stacked work depends on Phase 2 rather than waiting for it: restacking is a
> history rewrite, so it should drive `src/server/git/rebase.ts` and record a
> recovery point through `captureCheckpoint` rather than shelling out to
> `git rebase` on its own. The editor bridge that answers git's prompts
> (`src/server/git/rebase-bridge.ts`) already exists and should be reused.

## Outcome

Extend the GitHub-first foundation into a provider-neutral collaboration workspace, add stacked branch/PR workflows, and execute repositories correctly inside WSL. Complete discovery and threat modeling for a separately gated remote-SSH epic.

## Principles

- Git remains usable without a hosting provider, provider CLI, or network.
- Prefer official CLIs and OS credential stores; do not create a parallel plaintext token vault.
- Provider-specific features are capability-gated rather than forced into a misleading lowest-common-denominator UI.
- Stack metadata is transparent, local-first, and recoverable; ordinary branches continue to work outside Multi-Git.
- WSL Git operates on WSL paths through WSL Git. Never run Windows Git directly against `\\wsl$` working trees.

## Workstream A — hosting providers

Expand the Phase 1 contract:

```ts
export type HostingProviderId = "github" | "gitlab" | "gitea" | "azure-devops" | "bitbucket";

export interface ProviderCapabilities {
  createPullRequest: boolean;
  drafts: boolean;
  reviewers: boolean;
  assignees: boolean;
  labels: boolean;
  checks: boolean;
  merge: boolean;
  forks: boolean;
}

export interface PullRequestSummary {
  provider: HostingProviderId;
  id: string;
  number: number;
  title: string;
  url: string;
  state: "draft" | "open" | "merged" | "closed";
  headBranch: string;
  baseBranch: string;
  reviewState?: string;
  checksState?: string;
  updatedAt: string;
}
```

- Implement adapters in this order unless demand changes: GitLab (`glab`), Gitea/Forgejo (`tea` or documented REST fallback), Azure DevOps (`az repos`/official APIs), Bitbucket (official API/credential flow).
- Detect providers from remotes but allow explicit selection for self-hosted domains. Store host mapping, never credentials, in Multi-Git config.
- Each adapter exposes capabilities, auth diagnostics, rate-limit information where available, typed errors, and test fixtures. Unsupported fields are hidden or clearly disabled.
- Keep all body/description data out of argv where provider tools support stdin/files.

## Workstream B — PR dashboard and actions

- Repository/worktree list shows linked PR pills, draft/review/check status, merge conflicts, update time, and provider.
- Dashboard filters authored/review-requested/open/draft/blocked and refreshes incrementally with caching/rate-limit awareness.
- PR detail shows commits, changed files, checks, reviewers, and links. Add checkout/open-worktree, mark ready, add metadata, merge, and close only when supported.
- Merge choices include merge commit, squash, and rebase per provider capability and repository policy. Always show the exact base/head and resulting local cleanup plan.
- Notifications remain in-app and opt-in; no background polling before provider authentication/consent.

## Workstream C — stacked branches and pull requests

```ts
export interface StackBranch {
  branch: string;
  parent: string;
  position: number;
  pullRequest?: PullRequestSummary;
}

export interface BranchStack {
  id: string;
  repoPath: string;
  trunk: string;
  branches: StackBranch[];
  updatedAt: string;
}
```

- Create/adopt a stack from an existing linear branch chain; validate ancestry and show ambiguous/merge-commit cases instead of guessing.
- Visualize trunk → branch dependencies, commits and linked PRs. Actions: add branch, reorder when safe, restack onto updated parent/trunk, submit/update PRs, navigate worktrees, and merge down/up.
- Before restack, create a recovery point through `captureCheckpoint`. Publish rewritten branches with `--force-with-lease` after an explicit impact preview — Phase 2's rebase planner already shows how many of the commits being rewritten are on the upstream, and stacked work needs the same warning per branch.
- PR bases follow stack parents; after a lower PR merges, offer to retarget/rebase remaining branches and preserve provider metadata.
- Store minimal stack metadata in the repository's Git config or a documented local metadata file that is safe to ignore/share. Provide inspect/export/remove and never make branches unusable without the metadata.

## Workstream D — WSL execution environment

```ts
export interface ExecutionEnvironment {
  kind: "windows" | "wsl";
  distro?: string;
  repoPath: string;
  displayPath: string;
  gitVersion?: string;
}
```

- Detect `wsl.exe`, distributions, and repositories opened through `\\wsl$` or `wsl.localhost`; normalize to a distro plus Linux path.
- Execute with `wsl.exe --distribution <name> --exec <executable> ...args`, retaining argv boundaries. Translate only explicitly typed file paths, not arbitrary output text.
- Discover Git, provider CLIs, SSH agent/socket, editors, and terminals inside the selected distro. WSL SSH diagnostics must not attempt to mutate the Windows service.
- Watch files using an environment-appropriate strategy and document performance guidance for Windows-mounted vs Linux-native repositories.
- Open terminal/editor/agent inside the same distro and repository path. Settings distinguish Windows and per-distro executable definitions.

## Workstream E — remote SSH discovery gate

Do not implement general remote execution in this phase unless a separate security/design review approves it. Produce an epic design covering:

- trusted-host onboarding and host-key verification;
- remote path authorization and containment;
- remote Git/tool discovery;
- streaming/cancellation/reconnect semantics;
- credential and agent-forwarding threats;
- file watching and diff transfer limits;
- desktop-only exposure and denial of arbitrary remote command execution;
- offline/error behavior and audit logging.

Prototype only against disposable fixtures, behind a disabled development flag. Promotion requires threat-model approval and its own implementation plan.

## Testing

- Contract tests run every provider adapter through the same create/list/detail/action/error/cancellation cases, plus provider-specific capability fixtures.
- Test self-hosted domain mapping, missing/expired auth, rate limits, forks, protected branches, unavailable fields, and hostile metadata without public credentials.
- Stack graph/property tests cover linear validation, reordered parents, merged bases, recovery, conflicts, lease failure, partial PR creation, and restart.
- WSL CI/integration covers multiple distros where available, Unicode/spaces, Linux-native and mounted paths, missing tools, distro stopped, socket loss, cancellation, and correct argv/path translation.
- Security tests prove HTTP clients cannot launch provider tools, WSL commands, agents, or remote SSH arbitrarily.

## Manual acceptance

1. Create a PR on each enabled provider against a disposable repository and exercise supported metadata/actions.
2. Build a three-branch stack, create its PRs, update trunk, recover from a conflicting restack, merge the base PR, and retarget the remainder.
3. Open a Linux-native WSL repository, stage/commit/fetch/push with distro-local Git/SSH, launch an agent in that distro, and verify Windows Git is never used.
4. Review the remote-SSH threat model and explicitly accept/defer every risk before scheduling implementation.

## Definition of done

- Provider adapters present accurate capability-specific UI and never store plaintext access tokens.
- PR status/actions work across supported hosts without compromising offline Git workflows.
- Stacked branches/PRs are inspectable, recoverable, and remain ordinary Git branches outside Multi-Git.
- WSL repositories use distro-native tools, paths, SSH, and launch contexts reliably.
- Remote SSH remains gated until the security design is approved; a prototype is not treated as a shipped feature.

## Handoff notes

Record provider CLI/API versions, authentication and self-hosted assumptions, rate-limit/cache behavior, stack metadata format, WSL path/argv mapping, tested distributions, and the remote-SSH security decision with approvers and follow-up epic link.
