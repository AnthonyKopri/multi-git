# Multi-Git v4.0.0

**This release is about trust.** Multi-Git's whole pitch is that you can see what
it does to your repositories — and it turned out the part doing the telling was
making things up. That is fixed, and a lot follows from fixing it.

---

## In plain terms

**The Terminal Log was showing you commands that never ran.**

Every line that looked like a Git command was written by the part of the app that
*decided* to do something, not the part that actually did it. So it showed you a
tidy approximation: the right idea, the wrong details. Your SSH key path was
replaced with three literal dots. Extra settings the app quietly adds on Windows
never appeared. You could not copy a line and run it, because it was never a real
command in the first place.

Now every command is recorded by the part of the app that runs it, exactly as it
ran. Copy any line, paste it in a terminal, and you get the same result.

**The terminal moved to where you actually work.** It used to be a separate
window you had to go and open from a menu. It is now a panel along the bottom of
the main window — collapsed until you want it, and readable even while a dialog
is asking you about the thing that just failed.

**Two buttons open a real shell in the repository you are looking at.** Git Bash,
or your normal terminal for `gh` commands. The point is not the shell — you could
always open one yourself. The point is that it opens *with the right SSH key
already working*. If you have ever opened Git Bash in a repository and been asked
for a passphrase you know you already unlocked, that is a real problem with a
real cause, and these buttons fix it.

**Merge, rebase and pull now tell you what they are about to do.**

This was the strangest thing we found. Deleting a single file asked you to
confirm. Rewriting your entire branch did not — you picked a branch from a
dropdown, pressed a button, and found out afterwards. Meanwhile, opening a pull
request, which changes nothing on your computer at all, had the most careful
preview in the app.

Now all of them explain themselves first: which commits are coming, how many
files they touch, whether anything of yours gets rewritten, and that a recovery
point is saved before it starts.

**Pull, in particular, was a coin flip.** Pressing Pull could fast-forward your
branch, create a merge commit, or rewrite your local commits — three genuinely
different outcomes — and which one you got depended on Git settings the app never
read and never showed you. It reads them now and tells you which one is about to
happen.

**Windows stopped taking over the screen.**

Seven of them — Repository tools, worktrees, rebase, recovery, branch
maintenance, search and agents — used to dim and freeze the whole app when you
opened them. Which meant you could not watch a rebase and read the conflict's
diff at the same time, or manage remotes while looking at the history that made
you want to. They now dock down the side and everything else stays live. You can
drag them wider and Multi-Git remembers.

Real questions — "are you sure?", "what is the passphrase?" — still stop you,
because a question you can click past is a worse question.

**One place for each thing.**

Remotes, submodules and Git LFS each existed twice: an expandable section in the
sidebar *and* a tab in the Repository window, joined by a "Manage" button. So the
answer to "where do I manage remotes?" was "both, but only one of them really
does it." The sidebar is now a list of ways in, and the Repository window does
the work. Patches, bisect, notes and maintenance got a way in too — they never
had one.

**Shortcuts, and somewhere to learn them.**

There were six for forty-one commands, and nothing in the app taught any of them.
There are now thirteen — the workspace tabs on `Ctrl+1`, `Ctrl+2`, `Ctrl+3`,
fetch, pull and push on `Ctrl+Alt+F`, `Ctrl+Alt+P` and `Ctrl+Alt+U` — and every
one is printed next to its command in `Ctrl+K`, which is where anyone would look.

**`Ctrl+K` finds branches now.**

It only ever searched commands, so getting to a branch meant opening a dropdown
and reading down it. Type any part of the name instead: `rel40` finds
`release-4.0`.

**And Safety Net now admits when it fails.** Multi-Git takes a snapshot before
destructive actions so you can undo them. When taking that snapshot failed, it
said nothing at all — you were told your work was protected when it was not.
Those failures are now reported.

---

## What changed, in detail

### The Terminal

- **Commands are recorded where they run.** Both places, in fact: Git commands
  and the other tools — `gh`, `git lfs`, `ssh-add`, `ssh-keygen` — which take a
  different path through the app and would otherwise have left the log looking
  complete while omitting exactly the commands people ask about when
  authentication misbehaves. Each entry carries the real argument vector, the
  working directory, the environment Multi-Git added on your behalf, the exit
  code and the duration.
- **Only the environment the app added is shown.** The rest is yours, and is not
  ours to display back at you.
- **Reads are folded away.** A single refresh runs more than forty Git commands
  and nearly all of them are questions — `rev-parse`, `status`, `for-each-ref`.
  Each command is classified, and the view shows actions by default with a
  **Reads** toggle for the rest. Nothing is left out of the record, only off the
  first screen. The classification deliberately errs towards showing: a log that
  occasionally includes a harmless query is fine, one that silently omits
  something that changed your repository is not.
- **Every line says which repository it came from.** Windows share one log, so in
  an app built around having several repositories open at once there was no way
  to tell whose line was whose. Filter to this window, or show everything.
- **Delivery is ordered and durable.** Logging was one HTTP request per line, so
  a refresh firing fourteen parallel requests could land them in any order, and a
  request that failed dropped its line into a developer console nobody has open.
  Lines are queued, batched in the order they were written, and retried.
- **Copy** on any command copies the argument vector — which is now the argument
  vector that ran.
- **Filter** by text, by repository, and by read/write.

### Opening a real shell

Two buttons in the Terminal panel: **Git Bash** and **Terminal**. Both open in
the repository you have open, and both carry its SSH identity.

That second half is the reason they exist. Multi-Git writes `core.sshCommand`
into each repository so Git finds the right key — but that setting names a bare
`ssh`, and inside Git Bash a bare `ssh` is the MSYS build shipped with Git for
Windows. That build speaks a different protocol to the agent Multi-Git loads your
keys into, and cannot see it at all. So the key is unlocked, sitting in the
agent, and Git Bash asks for its passphrase anyway.

Opened from here, the shell is handed a `GIT_SSH_COMMAND` naming the
agent-capable build with the same key. It takes precedence over
`core.sshCommand`, so it corrects the binary without contradicting anything the
repository says. `git push` in that shell works with the right account and no
prompt.

Git Bash is offered only where it is installed.

### Merge, rebase and pull

- **A preflight before each**, modelled on the pull-request one that was already
  the best thing in the app. It reports the commits that would arrive with their
  subjects, how many files they touch, whether the branch can simply move
  forward, and how many of your own commits would be replayed. Every command
  behind it is a read, so opening the dialog costs a few queries and changes
  nothing.
- **Pull resolves its strategy before running.** `pull.rebase` and `pull.ff` are
  read and the outcome is stated. A fast-forward proceeds without interruption —
  it is the safest thing Git does, and asking every time would train you to click
  through the dialog that matters. A merge or a rebase says which it is. A
  `pull.ff=only` refusal is predicted rather than reported afterwards as a
  failure.
- **The recovery point is mentioned.** Merge and rebase have captured one since
  they existed and never said so. A safety net nobody knows about buys no
  confidence.
- **Outcomes come back to where you pressed the button.** You used to get "Push
  completed" while Git's own summary — `Fast-forward`, the ref update, the file
  count — went to a window you had to know to open.
- **Two different features stopped sharing the word "Rebase".** The sidebar's is
  now **Rebase onto**, which says which direction it works in. The command
  palette's is **Interactive rebase (plan commit by commit)**. Merge is **Merge
  in** for the same reason.

### The window itself

- **Seven overlays became a dock.** Repository tools, worktrees, rebase,
  recovery, branch maintenance, search and agents now open as a resizable column
  down the right-hand side rather than a sheet over everything. The main body
  gives up the width rather than being covered by it — a panel that hides the
  history pane has only moved the problem. On a narrow window it covers instead,
  because there is no width to give away.
- **The remaining sixteen stay modal.** Confirm, prompt, the passphrase and vault
  dialogs, the wizards, settings and the palette are all "answer this, then
  continue".
- **Escape closes a modal before a panel**, whatever order they were opened in. A
  panel sits beside the work, so a modal raised over one is unambiguously on top.
- **Tab leaves a panel**, which is the whole point of docking one, and is still
  trapped inside a true modal.
- **Sidebar sections became launchers.** Remotes, submodules and LFS each had an
  accordion here *and* a tab in the Repository panel. The lists are gone; the
  counts and warnings are not, because those were the only things the sidebar
  said that the panel did not.

### Keyboard

- `Ctrl+1` / `Ctrl+2` / `Ctrl+3` — Staging Area, File Diff, Workspace Explorer
- `Ctrl+Shift+F` — search commits
- `Ctrl+Alt+F` / `Ctrl+Alt+P` / `Ctrl+Alt+U` — fetch, pull, push
- `Ctrl+Alt+S` — stage everything

Each is declared on the command it belongs to, so the hint shown in `Ctrl+K`,
the row in the toolbar menu and the key that fires are one string. There is no
second table to keep in step — which is exactly how F5 came to be advertised in a
tooltip, cited in a test comment, and bound to nothing.

`Ctrl+K` also indexes every local branch and every recent repository, matched as
a subsequence: `rel40` finds `release-4.0`.

### Safety Net

- Failures to write a recovery point, to keep a copy of a file before discarding
  it, or to list the files a bulk discard was about to touch went only to the
  Electron process's standard output. An app that promises a safety net owes you
  the news when it does not deliver one.

---

## Upgrading

Multi-Git checks for updates on its own and will offer this one. Nothing is
downloaded until you choose to, and every download is checked against the
release's published SHA-256 before it is allowed to run.

To upgrade by hand, download the installer or portable build below.
`SHA256SUMS.txt` lists the expected fingerprint of each executable — verify with:

```powershell
Get-FileHash -Algorithm SHA256 <downloaded-file>
```

There is nothing to migrate. Your configuration, SSH profiles and vault are
untouched.

---

## For the curious

Details that matter if you are reading the diff.

### Why this is 4.0.0 and not 3.6.0

Because behaviour people relied on changed, not because anything broke.

Merge and rebase now interrupt with a confirmation where they used to act
immediately, so anyone with muscle memory for a one-click rebase will notice.
Seven windows open somewhere new. Three sidebar sections are gone, replaced by
rows that open the panel that already did the work. And a pull that would create
a merge commit or rewrite your commits now stops to say so first.

Nothing on disk changes, and nothing needs migrating: your configuration, SSH
profiles and vault are untouched. The break is in habits, not in data — but that
is still a break, and pretending otherwise by calling it a minor release would be
the kind of thing this release exists to stop doing.

### The classification rule

Git subcommands are sorted into reads and writes from the set this codebase
actually runs, not from Git's full surface. Subcommands with both forms —
`branch`, `config`, `stash`, `remote`, `tag`, `worktree`, `notes` — name the
flags that make them a read, and everything else in that subcommand counts as an
action. An unrecognised subcommand is treated as an action.

The subcommand is read past any leading `-c key=value`, because a Windows rebase
really runs as `-c core.longpaths=true rebase -i <base>` and anything keying off
the first argument sees `-c`.

### Redaction

Passphrases reach `ssh` through a short-lived askpass script and never appear in
an argument vector, so the recorded argv cannot contain one. The process runner
redacts its arguments before they are recorded regardless.

### The pull-strategy resolver

Pure, and lives in shared code so both sides use the same rules. Every
combination of `pull.rebase` and `pull.ff` is covered by unit tests that need no
repository on disk, and the three outcomes were then checked against a real
diverged repository with the configuration set three ways. `pull.rebase=merges`
counts as a rebase, and `pull.rebase` wins over `pull.ff`, as Git does.

### Where launching lives

Opening a shell goes through the Electron IPC bridge, not the local HTTP port.
That is the same line the external-tools code already drew: reading and detecting
configuration is safe to answer on a loopback port; starting a program is not.

### How the dock was done

The seven panels keep their markup, their open and close functions, and every
listener they had. What changed is what the overlay *is*: a class in the
stylesheet turns a full-viewport sheet into a column, drops the backdrop, and
moves pointer events onto the card so the window either side stays live. Nothing
was moved between files, which is why a change this visible touches so little.

A `MutationObserver` watches those overlays for the class that hides them, rather
than asking a dozen features to report in when they open something. Opening is
`setHidden(modal, false)` in many places, and threading a callback through all of
them to announce what the DOM already knows would be a second source of truth.

### Why the palette caps at sixty rows

It now includes every branch and every recent repository, so an unfiltered list
in a repository with eighty branches would draw a hundred and twenty rows nobody
scrolls. The cap is on drawing, not matching — typing narrows the whole set.

Sixty is comfortably above the number of fixed commands on purpose. A cap at or
below it would put the ceiling exactly where the generated entries begin, so an
unfiltered palette would never show a branch at all and the category would look
missing rather than merely further down. The first attempt used forty and had
precisely that bug.

### Shortcut matching

A chord is written the way a person reads it and parsed on use. Modifiers must
match exactly rather than as a superset, so `Ctrl+Alt+P` does not also fire on
`Ctrl+Alt+Shift+P` and two commands cannot answer one press. Keys are compared
case-insensitively, because Shift and Caps Lock change what the browser reports —
which is what stopped `Ctrl+K` working with Caps Lock on before this.

A chord carrying Ctrl or Alt still fires inside a text box, because nobody types
one into a commit message; a bare key does not, which is what stops a future
single-letter shortcut eating a character mid-word.

### Smaller fixes

- `sc.exe query` was classified as an action because the lookup table kept an
  extension the name resolver strips, putting four lines of service probing at
  the top of an otherwise empty log.
- The pop-out log window gained the same **Reads** toggle, so the two views agree.
- Uncommitted changes in tracked files are reported as a warning before an
  integration; untracked files are not, because they cannot be in the way.
- An integration is blocked outright while a conflict is unresolved, rather than
  offered and then failing.
- The commit list in a preflight is capped at fifty subjects, with the full count
  reported separately, so a branch a thousand commits behind does not try to draw
  a thousand rows.
- A panel docked to the right needed `right: 0` as well as `left: auto`; without
  both, an unanchored fixed box falls back to its static position and the dock
  opened over the left of the window instead of the right.
- The Terminal panel and the operations bar make room for the dock too, rather
  than running underneath it.
