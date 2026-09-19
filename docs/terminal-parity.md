# Terminal parity

What the terminal UI (`multi-git tui`) covers, workflow by workflow, against the desktop app. Every workflow listed is reachable from the `:` palette and the workflow list; the everyday ones also have a `Space` shortcut. Anything that changes a repository shows a preview and waits for **Confirm**.

`tests/terminal-ui.test.ts` checks that every action belongs to a listed group, and a script-level audit keeps each action's fields in step with the API route it calls.

**Status:** ✅ available · ◐ available with the difference noted · — desktop only, by design.

| Area | Workflow | Status | Notes |
| --- | --- | --- | --- |
| Repositories | Open, switch, remember | ✅ | `Space r` |
| | Clone | ✅ | With an SSH profile |
| | Create a repository, templates, publish to GitHub | ✅ | |
| | Browse GitHub repositories | ✅ | Needs the GitHub CLI |
| | Repository groups, fetch a group | ✅ | |
| Changes | Status, file diffs | ✅ | `Enter` on a file |
| | Stage and unstage files, hunks and lines | ✅ | `s` / `u`, `v` to select |
| | Discard, ignore | ✅ | |
| | Commit, amend, undo last commit | ✅ | The preview lists the whole index and the author |
| History | Log, commit details, search, compare, blame, file history | ✅ | |
| | Cherry-pick, revert, reset | ✅ | Reset records a recovery point |
| Branches | Switch, create, rename, upstream, pin, delete, maintenance | ✅ | `Space b` |
| Sync | Fetch with auto-pull | ✅ | `Space f`; the backend decides once, under the lock |
| | Pull with preflight | ✅ | `Space p`; a merge or rebase needs Confirm |
| | Push or publish, account check | ✅ | `Space P`; never forces |
| | Auto-pull on or off | ✅ | `Space A`; the header shows Off, Ready or Blocked and why |
| | Force push after a rejected push | — | Deliberately left to the desktop app's dialog |
| Remotes | List, add, edit, prune, fetch all | ✅ | |
| | SSH ↔ HTTPS for origin | ✅ | |
| Tags | List, create (signed), publish, delete | ✅ | |
| Stash | List, save, apply, pop, to a new branch, drop | ✅ | |
| Worktrees | List, status, create, open, lock, unlock, move, repair, remove | ✅ | `Space w` |
| | Stale worktree survey and purge | ✅ | |
| Integrate | Merge, rebase, preflight | ✅ | |
| | Interactive rebase plan | ◐ | `Enter` cycles an entry's action, `J`/`K` reorder, `:start-rebase` applies |
| | Rebase continue, skip, abort, split | ✅ | |
| | Conflicts | ◐ | Both sides are shown; the resolution is written in the editor (`Ctrl+e`), not a three-pane merge view |
| Recovery | Safety Net, reflog, recover to a branch, restore a ref, discarded files | ✅ | `Space u` |
| Signing | Status, configure SSH or GPG signing | ✅ | |
| Submodules | List, init, update, sync, deinit | ✅ | |
| LFS | Status, install, track, untrack, fetch/pull/prune, lock, unlock | ✅ | |
| Patches | Create, apply, patch series continue/skip/abort | ✅ | Saving a patch to a file is the desktop's; the terminal shows it |
| Pull requests | Preflight, open | ✅ | Needs the GitHub CLI |
| Notes | Read, write, sync | ✅ | |
| Bisect | Start, mark, reset, run a saved test | ✅ | |
| Accounts | Switch SSH account and author | ✅ | `Space a`; shows what changes first, keeps a deliberate author |
| | Verify an account, add or edit a profile, account rules | ✅ | |
| | Load a key, unlock or lock the vault | ✅ | Secrets are typed, masked, and never shown again |
| | Generate a new key | ✅ | Optional masked passphrase; public key shown for registration on the Git host |
| Settings | Auto-pull, keys, appearance, shortcuts, prerequisites | ✅ | `Space s` |
| | Shared Git/account settings | ✅ | SSH configuration, recovery retention and default worktree location |
| Operations | Progress and cancelling | ✅ | `Space o` |
| Tools | Configured tools and agents: list, detect, launch | ✅ | |
| | Open in editor | ✅ | |
| Desktop only | Windows, Explorer integration, installer and desktop updates | — | Outside terminal parity by design |
