# Computer Use smoke tests

These are agent-executable GUI cases for the native desktop app. Unit/API/DOM tests do not substitute for observing native dialogs, focus, layout or window routing. Use the [GUI skill](../../skills/multi-git-computer-use/SKILL.md) with an available native computer-use runtime and follow that runtime's observation/action rules. Do not automate terminal commands or authentication through UI controls.

## Setup and evidence

Run `npm ci`, `npm run compile`, `node scripts/ensure-electron.mjs`, then `node scripts/gui-smoke.mjs --launch` from a shell. The helper creates a fresh temp root, isolated Multi-Git home, local source repository, dirty Unicode-path working copy, empty clone destination and a separate Electron user-data directory. It prints a manifest and saves it at `<fixtureRoot>/manifest.json`; desktop startup output is in `<fixtureRoot>/desktop.log`. Keep these paths for the cases below. Each run gets new fixtures. GitHub credentials and Multi-Git profiles are isolated, updates and automatic pulls are off, and the seed uses a fictitious local commit identity. Use only the local fixture URLs: clearing SSH_AUTH_SOCK does not isolate Windows' native SSH agent, so agent operations are outside these cases.

Select the development Electron window returned by the computer-use runtime; do not select an already running installed Multi-Git window. Confirm the blank welcome screen. Native dialogs may be separate returned windows. Re-observe after each action, verify focus before text input, and derive indexes/coordinates from the latest state. Stop if the selected path or window does not match the fixture.

Record commit/build, OS, window size, case ID, pass/fail/blocked, observed result and screenshot reference where useful. Record failures with the exact visible text. Save screenshots only of fixture data, excluding unrelated windows and account names. A blocked or skipped case is not a pass. The scripted setup is not GUI evidence.

## Cases

### CU-01 — Clone dialog and focus

- From the welcome screen click **Clone**. Expect **Clone Repository**, an editable URL, destination Browse, optional folder name and System SSH.
- Expand **Browse GitHub repositories**. Tab through owner, Load, filter, protocol and repository URL; each control should be reachable and visibly focused.
- At the minimum supported desktop size (900 × 600), scroll the modal. Expect the Clone and Cancel controls to remain reachable without scrolling the page behind it.
- Press Escape. Expect the clone dialog to close; reopen it and verify it remains usable.

### CU-02 — Browse failure and manual fallback (offline baseline)

- Without gh installed, expect the information box to explain optional browsing and offer **Install GitHub CLI**, with editable URL/destination and enabled Clone. Do not install software during the baseline test. In a separately authorized installation case, click Install, verify the existing installer/download flow starts, then use Check again; the button should disappear once gh is detected. An installed but signed-out CLI should show sign-in guidance instead of an install button.
- In the isolated app click **Load repositories**. Expect a loading message, disabled Load while pending, then an actionable missing-cli/authentication error and manual URL fallback. No authentication dialog should open automatically.
- Enter `--help` as owner and Load. Expect an owner validation error, with no gh invocation.
- Clear the owner, paste the manifest's `seed` path into Repository URL, and continue with CU-04. The error must not disable manual cloning.

### CU-03 — Hosted repository selection (optional authenticated environment)

Requires a separately authorized test account with gh installed and signed in before testing; the baseline helper deliberately has no credentials. Do not sign in or copy tokens as part of automation.

- Load a known public test owner. Expect owner/name, visibility and archived markers. Filter by part of a name; then a missing string should produce zero matches.
- Clear the filter, choose SSH and select a known result. Expect exactly its SSH URL and no clone started.
- Choose HTTPS and select the same result again. Expect its HTTPS clone URL. Review profile compatibility.
- Change owner during loading. Expect stale results not to appear for the new owner.
- For an owner with at least 100 repos, expect a limit notice; missing repos can still be cloned by pasted URL. Record fixture availability if this limit subcase cannot be exercised.

### CU-04 — Native destination picker, cancel, and successful local clone

- Open **Browse…** next to Clone into folder. Find the native folder dialog, choose the manifest's `destination`, confirm and verify the exact path in the clone form.
- Open Browse again, cancel the native dialog and verify the previously chosen path is unchanged.
- Set URL to manifest `seed`, folder name to `gui clone`, and System SSH. Click Clone.
- Expect the modal to close and the workspace header to show `<destination>/gui clone`, branch `main`, clean staging and the seed history entry. Confirm `.git` and README exist with a read-only shell check if needed.
- Reopen Clone with the same destination/name. Expect a nonempty-destination error and the existing clone to remain usable.

### CU-05 — Open a Unicode path and recent repository switching

- Use **Repository → Open** (or Select Folder on welcome) and the native picker to select manifest `working` (`工作 tree`). Expect the exact path, `main`, modified README and untracked `new file.txt`.
- Switch to `gui clone` through Recent Repositories; expect clean status. Switch back; expect the dirty files again, without stale rows from the other repository.

### CU-06 — Diff icon versus row; stage and unstage

- On the dirty working copy click README's diff icon. Expect File Diff with the added text; README must stay unstaged.
- Click its unstaged row. Expect README to move to Staged Changes. Inspect its index diff.
- Click its staged row. Expect it to move back to Unstaged Changes. The untracked file remains separate throughout.
- Do not click the adjacent trash icon. If a discard prompt appears accidentally, cancel and verify no changes were discarded.

### CU-07 — Commit message focus and keyboard submission

- Stage only README in the working copy. Leave `new file.txt` untracked.
- Focus the commit message box and type `test: GUI smoke commit`. Verify the text before pressing Ctrl+Enter.
- Expect the new history entry, no staged README, and `new file.txt` still untracked. Read status/history if a toast or timeout is ambiguous before attempting another commit.

### CU-08 — Palette, modal dismissal and CLI connection

- Open Ctrl+K, search Settings, and activate it. Expect Settings and a selectable **Agent CLI server URL** under Git and GitHub.
- Copy/read that URL and run `node scripts/multi-git.cjs app.info --server <url>` from the shell. Expect JSON success from this app instance.
- Escape Settings. Reopen Clone through the palette. Expect keyboard navigation to work after changing modal types.

### CU-09 — Worktree window routing

- On the fixture's working repository expand Worktrees and create a new branch/worktree inside `fixtureRoot`, using a unique branch name such as `gui-worktree`.
- Open that worktree in another window. Re-enumerate windows and inspect each header. Expect the new window's path/branch to match the worktree and the original window to retain its original repository.
- Close the new fixture window and verify the original still responds to Refresh. Do not close an unrelated installed app window.

### CU-10 — Save dialog cancellation for patch export

- On a disposable repo with a tracked modification, use Repository hub → Patches to export a patch.
- Inspect the native Save dialog and cancel. Expect no success claim and no new patch file.
- Repeat and save a `.patch` inside `fixtureRoot`. Expect that exact path and a nonempty patch file. Read its contents with a shell check to confirm it contains only fixture changes.

### CU-11 — Risky-action cancellation

- On the untracked fixture file click discard/trash, inspect the confirmation and choose Cancel.
- Expect the file to remain visible and unchanged. This case tests cancellation only. Never accept delete/reset/force-push prompts on non-fixture data.

## Finish

Close only the test windows. Keep the fixture root while diagnosing a failure; after review, remove only the exact printed temp root using the shell's normal filesystem tools. The helper performs no recursive cleanup. Do not commit fixtures, logs, screenshots with private data, or configuration. In a PR, list cases actually run and explicitly separate blocked/skipped optional cases from passes.
