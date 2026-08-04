---
title: "Phase 0: Toolchain and implementation foundations"
phase: 0
status: complete
completed: 2026-08-05
branch: claude/phase-0-implementation-f94f8a
depends_on: []
suggested_branch: codex/phase-0-toolchain-foundations
parallelizable: false
---

# Phase 0: Toolchain and Implementation Foundations

## Outcome

Move the project to the latest compatible Electron, Vitest, TypeScript, Vite, and Node baseline, then establish the process, operation, configuration, and provider seams required by every later phase. This phase must preserve all current behavior and land before feature work.

## Current baseline

- Installed: Electron 42.8.0, Vitest 3.2.7, TypeScript 5.9.3.
- Latest stable verified on 2026-08-03: Electron 43.2.0, Vitest 4.1.10, TypeScript 7.0.2.
- Electron 43 requires Node 22.12 or newer for its npm ecosystem and embeds Node 24; use `@types/node` 24.x unless Electron changes its embedded major.
- The suite passed under Vitest 4.1.10 and Vite 8.2. TypeScript 7 compiled the current sources after replacing legacy `moduleResolution: node` with modern ES module/bundler settings.
- Current CI/build documentation still targets Node 18. Dependabot only performs security updates.

## Scope

1. Toolchain and configuration migration.
2. Typed, injectable, cancellable child-process execution with progress events.
3. Versioned persisted configuration and migrations.
4. Shared operation and provider foundations without implementing Phase 1 features.
5. CI, dependency automation, and developer documentation.

Out of scope: PR UI, SSH-agent mutation, worktrees, history features, and provider-specific collaboration logic.

## Workstream A — upgrade the toolchain

1. Update `package.json` and the lockfile to Electron 43.2.0, Vitest 4.1.10, TypeScript 7.0.2, compatible Vite 8.x, and `@types/node` 24.x. Upgrade adjacent build packages only where required.
2. Set `engines.node` to `>=22.12.0`, update CI/release matrices and BUILDING/CONTRIBUTING documentation, and change server/build targets from Node 18 to Node 22.
3. Replace removed or deprecated TypeScript settings. Prefer `module: ESNext`, `moduleResolution: bundler`, explicit `verbatimModuleSyntax`, and separate node/web/test configs. Do not suppress new diagnostics globally.
4. Rename the Vitest config to `vitest.config.mts` if required for unambiguous ESM loading. Apply the Vitest 4 migration guide to fake timers, mocks, coverage, pools, and browser-environment behavior actually used by this repository.
5. Audit Electron breaking changes affecting window creation, preload context isolation, IPC serialization, navigation, permissions, and packaging. Keep `contextIsolation` enabled and renderer Node access disabled.
6. Run `npm audit`, packaging smoke tests, and a packaged-app launch. Security findings outside direct control must be documented rather than hidden with risky overrides.
7. Re-enable grouped non-security Dependabot updates for the Electron/TypeScript/test toolchain on a controlled cadence. Keep major upgrades as separate reviewable PRs.

If a latest stable package is incompatible after reasonable migration work, pin the newest compatible version and record: attempted version, failing dependency/API, minimal reproduction or upstream issue, and revisit trigger in `FEATURE_PARITY.md`.

## Workstream B — process and operation services

Create one execution boundary used by Git, `gh`, `ssh-add`, PowerShell, WSL, and later provider CLIs. Preserve executable and arguments as separate values; shell execution is off by default.

```ts
export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  allowNonZero?: readonly number[];
  redact?: readonly string[];
}

export interface CommandResult {
  executable: string;
  args: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  cancelled: boolean;
}
```

- Inject an `ExecutableRunner` into services so tests can assert argv, stdin, environment, cancellation, and redaction without running host tools.
- Cancellation must terminate the process tree on Windows and return a typed cancellation result, not a generic failure toast.
- Never include passphrases, tokens, private-key contents, AskPass responses, or redacted arguments in logs.
- Add an operation registry with stable IDs and renderer-visible state:

```ts
export type OperationState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface OperationProgress {
  id: string;
  kind: string;
  repoPath?: string;
  state: OperationState;
  message?: string;
  completed?: number;
  total?: number;
  cancellable: boolean;
}
```

Expose subscribe/list/cancel primitives through the existing server/Electron boundary. SSE is preferred for server-to-renderer progress; IPC may forward the same typed events in desktop mode.

## Workstream C — schemas and migrations

- Add a top-level `configVersion` and a sequential migration registry. Migrations must be idempotent, covered by fixtures from every previous version, and write atomically through a temporary file plus replace.
- Validate untrusted request/config payloads at the boundary. Do not allow arbitrary executable paths, repository paths, or environment keys to bypass existing validation.
- Add empty forward-compatible sections for repository settings, hosting providers, external tools, and operation preferences only when consumed. Avoid speculative fields.
- Define a repository-scoped settings record keyed by canonical repository identity rather than display name. Preserve existing SSH profile references.
- Define a minimal `HostingProvider` capability contract for Phase 1 without shipping provider behavior.

## Workstream D — CI and quality gates

- Required jobs: formatting/lint if present, `npm test`, `npm run compile`, packaging/build smoke, and link validation for roadmap docs.
- Add Windows coverage for process cancellation, Unicode/space-containing paths, and configuration replacement. Retain the repository's other supported runners.
- Test execution with no GitHub CLI, no SSH agent, and no network. Unit tests must not rely on developer credentials.
- Measure startup and test duration before/after; investigate material regressions.

## Verification

Automated:

- All existing tests plus new runner, cancellation, redaction, operation-registry, config-validation, and migration suites pass.
- All TypeScript project configs compile without ignored errors.
- A clean install succeeds on Node 22.12+ and the packaged Electron app starts.
- `git diff --check` and the documentation link checker pass.

Manual:

- Open a repository, inspect history/diff, stage/unstage, commit, stash, fetch, pull, push, and switch SSH profiles.
- Cancel a deliberately long injectable test operation and confirm the process tree exits and UI leaves busy state.
- Upgrade an existing user-data fixture and verify repositories, settings, SSH profiles, and Safety Net records remain intact.

## Definition of done

- The latest stable toolchain is running, or every justified pin is documented with evidence.
- CI and developer docs use the same supported Node version.
- All subprocess callers can migrate to the shared typed runner without shell strings.
- Operation progress/cancellation and configuration migrations are production-ready.
- No Phase 1 user-facing behavior is prematurely coupled into the foundation.

## Handoff notes

List the final dependency versions and every compatibility adjustment. Call out shared files likely to conflict with later phases and include exact commands used for clean-install, test, compile, and packaging verification.
