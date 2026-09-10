---
name: multi-git-computer-use
description: Operate the Multi-Git desktop GUI with computer-use tools, including repository browsing and cloning, native folder selection, staging and visual diff review, window switching, and GUI smoke tests. Use when GUI interaction is requested or required.
---

# Multi-Git with Computer Use

Load the available computer-use tool's runtime instructions before controlling the app. This skill describes Multi-Git workflows; it does not replace tool-specific targeting, observation, authentication or confirmation rules. If no native computer-use tool is available, report that limitation; do not claim API or DOM tests verified native interactions.

## Identify the workspace

List running apps/windows, select exactly the intended **Multi-Git Client** window and capture its current screen and accessibility tree. Multiple windows can belong to different repositories. Confirm the repository path and branch in the header before every mutation. Names alone are insufficient when worktrees share a basename. Never reconstruct window handles or reuse coordinates/indexes after a layout or modal change.

Use one observed action at a time and refresh after it. Prefer accessible control names; use screenshot coordinates only from the latest captured state. Verify focus before typing. If an action has an uncertain outcome, inspect the screen and repository state before retrying.

## Browse and clone

1. Choose **Clone** from the welcome screen or Repository dropdown. The URL-paste workflow always remains available. The information box offers **Install GitHub CLI** when missing; installation is optional, starts only on an explicit click, and uses the app's existing installer or official download page. After user setup, use **Check again**. Expand **Browse GitHub repositories** when ready.
2. Leave the owner blank for the signed-in user's owned repositories, or enter a GitHub user/organization and click **Load repositories**. The account comes from `gh`, independently of the selected SSH profile. Read any error or the 100-repository limit notice.
3. Filter the loaded results by name/description. Select SSH or HTTPS, then click the intended repository row. Selection fills the URL only; it does not clone. Changing protocol after selection requires selecting the row again.
4. Review **Repository URL**. If browsing is unavailable or the repository is outside the bounded list, paste its known URL. Choose **Browse…** beside **Clone into folder**, select the destination in the native dialog, and verify the returned path. Cancel should preserve the earlier destination.
5. Review the optional child folder name and SSH profile. HTTPS requires System SSH; SSH authentication must match the intended repository. Execute **Clone** within the authorized task, then verify the opened repository path and branch. Failure stays in the dialog with a readable reason; inspect the destination before retrying a partial clone.

## Stage, review and commit

The row under **Unstaged Changes** stages a file. The diff icon opens **File Diff** without changing staging; the trash icon begins discard. Click the precise target. In **Staged Changes**, clicking the row unstages it. Inspect the changed lines and staged list before committing; **Commit** includes the whole index, including changes staged before this task.

Enter the intended commit message, then use **Commit** or Ctrl+Enter while the message box is focused. Verify the new history entry and the remaining staged/unstaged files. Do not interpret a spinner or toast alone as proof of success.

**Publish** is the first push of a branch without an upstream; **Push** is subsequent synchronization. Review origin, branch and SSH identity before an authorized push. Cancel any unexpected force-push, wrong-account, discard, reset, or conflict-resolution prompt and inspect it. User authorization persists; seek additional input only for a choice or action outside the authorized scope or required by the active tool's rules.

## Navigate and inspect

Ctrl+K opens the command palette. Search visible actions there when toolbar labels are hidden. Escape closes the current modal/palette. **Settings → Git and GitHub → Agent CLI connection** exposes the current local server address for a CLI handoff.

Test native Open/Save dialogs as separate windows if the parent snapshot does not show them. In multi-window workflows, reselect the window and recheck its repository path after each switch. Do not type terminal commands through the app, terminal windows, File Explorer or file dialogs; a path field is for a path only.

For smoke testing, follow the checkout's `docs/testing/computer-use-smoke.md`. Prepare disposable fixtures with its helper, record actual observations per case, and mark skipped or blocked cases honestly. Authentication, private repositories, keys and user configuration are not test fixtures. Do not automate credential entry.
