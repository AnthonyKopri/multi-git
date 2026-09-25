# Promo Specifications

This is the production bible for Multi-Git's second promo: a 90-second 2D
motion-graphics film plus three cutdowns. It defines what the video says, how
it looks and sounds, and what it's allowed to claim.
[promo/CLOUD_PROMPT.md](promo/CLOUD_PROMPT.md) defines how it gets built.

- **Version:** 2, 2026-09-25. Product facts were checked against the code at
  5.2.1, and rival facts on the web in September 2026.
- **Two rules that override everything else:**
  1. Every claim on screen appears in the [Fact sheet](#fact-sheet).
  2. Every UI label on screen is the app's real label, spelled the way the app
     spells it.

**Contents:** [Product](#product) · [Audience](#audience) ·
[The big idea](#the-big-idea) · [Key messages](#key-messages-in-order) ·
[Video](#video) · [Visual system](#visual-system) · [Storyboard](#storyboard) ·
[Cutdowns](#cutdowns) · [Must show](#must-show) · [Avoid](#avoid) ·
[Fact sheet](#fact-sheet) · [Competitive notes](#competitive-notes-internal) ·
[Music and sound](#music-and-sound) ·
[Assets and demo data](#assets-and-demo-data) · [Deliverables](#deliverables)

## Product

- **Name:** Multi-Git. The full name is Multi-Git Client, but on screen it is
  always "Multi-Git".
- **One-liner:** A free, open-source, local-first Git client for Windows, macOS
  and Linux, with multiple repositories, accounts and SSH identities.
- **Tagline for this film:** **All of Git. None of the wizardry.**
- **Repository:** https://github.com/AnthonyKopri/multi-git
- **Download:** https://github.com/AnthonyKopri/multi-git/releases/latest
- **On-screen URL:** `github.com/AnthonyKopri/multi-git`
- **Price and license:** Free and MIT-licensed. No account, no sign-up, no
  subscription.
- **Editions:**
  - The desktop app: Windows installer or portable, a universal macOS DMG, and
    Linux AppImage, `.deb` or `.rpm`.
  - The terminal edition: `multi-git tui`, a JSON CLI, and an MCP server for AI
    agents. It shares one backend with the desktop app.

### What it is

Multi-Git does the hard parts of Git for you, then shows you exactly how it
did them.

- **Accounts:** every repository gets its own SSH key and commit identity, and
  Auto-select rules pick the right one. If a push is about to go out as the
  wrong account, it stops and asks.
- **Precision:** you can stage or discard single lines, plan an interactive
  rebase row by row (reorder, squash, split), and check out several branches
  at once as worktrees, each with a coding agent of your choice.
- **Safety:** risky operations record a recovery point first, so they can be
  undone.
- **Transparency:** every Git command it runs is listed exactly as it ran,
  ready to copy.

It runs on your machine, needs no account, costs nothing, and underneath it
all it's plain Git: your repos, your keys, your config.

## Audience

The film speaks to two groups at once. Visually they are the **two lanes**,
and at the reveal they become the logo's two arrows (see
[The big idea](#the-big-idea)).

### Lane 1 (cyan): newcomers and hobbyists

Students, indie developers, designers, game developers (the `.gitignore`
templates include Unity, Unreal and Godot), and anyone who learned `add`,
`commit` and `push` and stopped there.

- **What hurts:**
  - Git feels like memorising spells.
  - "Rebase", `reset --hard` and "detached HEAD" are frightening.
  - One wrong command can cost a day's work.
  - SSH keys are confusing, and merge conflicts look like a wall of
    `<<<<<<<`.
  - They google the same five questions every week.
- **What they need to hear:** Every risky move explains itself first and can
  be undone. Everyday questions become one click. And you learn real Git by
  watching the commands it runs.

### Lane 2 (indigo): experienced developers and power users

Freelancers and consultants juggling client accounts, open-source
maintainers, anyone with separate work and personal GitHub accounts, terminal
natives, and developers running AI coding agents across branches.

- **What hurts:**
  - Pushing to a work repo as their personal account, again.
  - A `~/.ssh/config` full of host aliases.
  - The nine-command routine it takes to split one commit.
  - GUIs that hide what they actually run.
  - Paying for a Git GUI, and having no Linux build.
- **What they need to hear:**
  - The Git is visible, and every command it ran can be copied.
  - It covers the full range: rebase planning, worktrees, bisect, LFS,
    submodules, signing, patches and notes.
  - It has Vim keys in a terminal UI, a JSON CLI and an MCP server.
  - It's free and MIT-licensed.

### Switchers

These are users of GitHub Desktop, Sourcetree, Tower and GitKraken. No rival
is named or shown on screen. Instead, the film asks four questions, each true
of at least one rival, and the closing checklist answers them one-for-one:

| The question (bar 8) | Hits users of | The answer (bar 42) |
| --- | --- | --- |
| "Paying for a Git GUI?" | Tower; GitKraken for private repos | ✓ Free. MIT open source. |
| "One GitHub account at a time?" | GitHub Desktop | ✓ Every repo on its own account. |
| "No Linux build?" | Tower, Sourcetree, GitHub Desktop | ✓ Windows · macOS · Linux. |
| "Can't see what it runs?" | Most GUIs (not all; see [Competitive notes](#competitive-notes-internal)) | ✓ Every command visible. |

## The big idea

### The Spell Collapse

Git makes you type spells. Multi-Git turns each one into a single click.
Every feature scene uses the same two-beat move:

1. **The spell.** A stack of real Git commands floods the screen in dim
   monospace. It's cramped, glowing faintly red, and plainly hard work.
2. **The collapse.** On the next downbeat, the whole stack gets sucked into
   **one** real UI control (a button, a dropdown or a keycap). The control
   pulses indigo and the app does the job in one clean motion.

This is how one scene speaks to both lanes. Newcomers read the headline and
see a single click. Veterans recognise every line of the spell and feel how
much time the click saves them.

### The counter

A small counter sits in the top-right corner from the first collapse on:

> `commands you didn't type: 0`

Each collapse adds its spell to the counter with a split-flap tick.

**Counting rule:** only commands Multi-Git replaces count. That means:

- the command lines of a spell that collapses, one per line (for example
  `git …`, `ssh-add …`, `gh …`, or `cd … && claude`), where a line suffixed
  `# ×3` counts three
- the struck-through command on each montage card, one per card

Commands the viewer is shown typing for themselves (the cold open, and the
`reset --hard` oops in scene C) don't count. Neither do prompts, prompt
answers, comments, file contents or output.

The master's scenes add +6, +3, +2, +9, +5 and then +20 in the montage, for
a total of **45**. The payoff:

> **You just watched 45 commands.**
> **You typed zero.**

The counter must be honest. If a spell changes, the total changes with it,
and each cutdown computes its own total from the spells it shows (see
[Cutdowns](#cutdowns)).

### The glass-box twist

In scene F the motif turns inside out. The counter cracks open and its
contents pour into Multi-Git's real **Terminal** panel as the *real* commands
Multi-Git ran for those scenes. These are captured from the app, not written
by hand. The line: **"We didn't hide Git. We typed it for you."** This is the
beat that wins over veterans who distrust GUIs.

### Two lanes, one trunk

The logo ([docs/images/multi-git_icon.svg](docs/images/multi-git_icon.svg)) is
a single trunk that forks into two upward arrows, on a deep-indigo disc.

1. The film opens with two light trails, **cyan** for newcomers and **indigo**
   for veterans. They run side by side through the problem section.
2. At the drop they dive to bottom centre and fuse into the trunk. The trunk
   shoots up and forks into the logo's two arrows: one tool, both audiences,
   both heading up.
3. The lanes split again for the "two lanes, one tool" beat, then fuse one
   last time into the end card.

Lane trails also carry every transition between scenes.

### Emotional arc

| Phase | Where | The viewer feels |
| --- | --- | --- |
| Frustration | cold open | "I've been there." |
| Recognition | the two lanes and the switcher questions | "That's me, and that's my Git client." |
| Relief | the drop and reveal | "Oh, this is the fix." |
| Delight | the feature collapses and the montage | "One click? Seriously?" |
| Trust | the glass-box twist | "And it shows me the Git." |
| Confidence | the stinger | "45 to zero." |
| Action | the checklist and end card | "Downloading it." |

## Key messages (in order)

1. **The problem:** Git is powerful, but it's a spellbook, and your current
   client either hides the spells or charges you for them.
2. **What Multi-Git does:** all of Git, none of the wizardry. Every
   incantation becomes one click, and every risky move explains itself and can
   be undone.
3. **Standout features:**
   - multiple accounts that can't cross wires
   - line-level staging
   - Safety Net undo
   - visual rebase with split
   - worktrees with any coding agent
   - the glass-box Terminal
   - then a montage of everyday answers and power moves
4. **Call to action:** Free. Open source. Windows, macOS, Linux. Download at
   `github.com/AnthonyKopri/multi-git`.

## Video

- **Length:** 90 s for the master.
- **Format:** 1920×1080 at 30 fps, SDR, BT.709.
- **Tempo grid:** 120 BPM, which gives 1 beat = 0.5 s = 15 frames and
  1 bar = 2 s = 60 frames, so 45 bars = 2,700 frames. Bar *n* starts at frame
  `(n − 1) × 60`, and beat *b* of bar *n* at `(n − 1) × 60 + (b − 1) × 15`.
  Every cut, headline entrance and collapse lands on a beat boundary.
- **Voiceover:** none. Kinetic type carries the story, so the film works on
  mute in social feeds and autoplay, and needs no subtitles.
- **Tone:**
  - Swift, punchy and confident, a little cheeky, never snide.
  - Launch-trailer energy, not an explainer.
  - It should feel the way a keyboard-driven tool feels: dark UI, cuts on the
    beat, glowing indigo, and monospace grit against clean headlines.
- **Reference feel (inspiration only):** the product films of Linear, Raycast
  and Vercel. Dark, crisp, fast kinetic type, with the UI as the hero. Copy no
  layout, asset or phrase from them.
- **Pacing rules:**
  - Frame 0 already has motion and text, with no black lead-in. On some
    platforms it's also the thumbnail.
  - Nothing is static for more than 2 bars (4 s), except the end card.
  - Aim for 3–4 visual events per bar. The average shot is 2 s or shorter.
  - Use hard cuts or lane wipes only: no crossfades, no dissolves.
  - Headlines are 6 words or fewer and hold for at least 1 bar.
  - Spell timing is set under Motion language.

## Visual system

### Color

Tokens come from the app (`public/style.css`) and the logo.

| Token | Hex | Use, and only this use |
| --- | --- | --- |
| Background | `#0a0c10` | The base canvas, everywhere except the stinger |
| True black | `#000000` | The stinger's hard cut only |
| Panel / card | `#11141a` / `#171b26` | UI surfaces |
| Border | `#262e3d` | UI hairlines |
| Primary indigo | `#6366f1` (hover `#4f46e5`) | The veteran lane, collapse flashes, primary buttons |
| Logo indigo / disc | `#6A69EB` / `#3B3E8D` | The logo and the end card |
| Cyan | `#06b6d4` | The newcomer lane and its captions |
| Emerald | `#10b981` | Success, restored commits, checkmarks, additions |
| Red | `#ef4444` | Errors, the spell glow (about 25% opacity), destructive buttons, deletions |
| Amber | `#f59e0b` | Warnings (the account mismatch) |
| Text main / muted / dim | `#f3f4f6` / `#9ca3af` / `#6b7280` | Headlines / sublines / spell text |

Roughly 70% of the frame is near-black, 20% UI greys and 10% accent. Use one
accent per moment. Cyan never appears outside the newcomer lane, and red
never appears outside errors and spells.

### Typography

Sizes are at 1920×1080.

| Role | Font | Size | Notes |
| --- | --- | --- | --- |
| Hero headline | Inter 700 | 112–128 px | Tracking −2%, line-height 1.0, at most 2 lines, 6 words or fewer |
| Subline | Inter 500 | 44–52 px | Text muted |
| Chip / lane label | Inter 600 | 24–28 px | Uppercase, tracking +8%, like the app's section headers |
| Spell | JetBrains Mono 400 | 26–30 px | Line-height 1.35 |
| Keycap | JetBrains Mono 500 | 36–44 px | On a `#171b26` cap with a 2 px `#262e3d` border and a 6 px bottom edge |
| Counter | JetBrains Mono 500 | 28 px in the corner, about 280 px in the stinger | Split-flap digits |
| End-card wordmark | Inter 700 | about 160 px | |
| End-card URL | JetBrains Mono 500 | 40 px | |

Nothing on screen is smaller than 24 px, so the film still reads on a phone.
Icons are Material Symbols Outlined, as in the app.

### Layout and safe areas

- **Title-safe margin:** 5%, which is 96 px left and right and 54 px top and
  bottom. All text sits inside it.
- **Feature scenes:** the headline sits top-left. The UI stage fills the
  lower-right two-thirds under a 2D camera. The spell floods centered over the
  stage, then collapses into its target control.
- **The counter** sits top-right inside the safe margin, and stays out of the
  way of headlines.
- **UI is always legible.** The UI is shown at 1.0–1.4× the scale of a
  1600×1000 app window, and the camera pushes in on the area that matters.
  Never hold a full app view with unreadable text for more than 1 beat.

### Motion language

- **Entrances:** expo-out, 8–12 frames. **Exits:** expo-in, 6–8 frames.
- **UI pops:** a spring with damping of about 14–18, stiffness about 180–220
  and mass about 0.8, with a slight overshoot.
- **Stagger:** 2 frames between letters, words or rows.
- **Spell reveal:** the first line types at about 45 characters per second.
  The rest flood in line by line, with the gap between lines shrinking from 6
  frames to 1. The whole spell takes 45 frames or fewer and holds for 1 beat.
- **Collapse:** 8 frames with expo-in into the target. The target then scales
  1 → 1.08 → 1 over 6 frames with an indigo glow pulse. A short streak trail
  is allowed.
- **Counter:** a split-flap flip of 4 frames per digit, with increments
  staggered 2 frames apart.
- **Easing:** typing is the only linear motion.

### Camera

- **Drift:** always a gentle drift of 1–2% scale per scene.
- **Punch-ins:** land on beats, over 6–8 frames.
- **Whip pans:** between scenes, 6 frames long, following the lane direction,
  with motion blur.
- **Parallax:** UI layers can separate slightly in depth (background panel,
  UI, overlays). Keep it 2D; no 3D rotation.

### Texture and effects

- An animated grain of 2–3% sits over everything. It prevents H.264 banding
  on the dark gradients.
- A subtle vignette is fine.
- For glows, use pre-rendered radial-gradient sprites. Avoid `filter: blur()`
  and `backdrop-filter` on large layers: they render slowly and add nothing
  visible.

### Accessibility

- **Flashes:** no more than 3 full-screen luminance flashes in any second
  (WCAG 2.3.1). The drop is a color bloom at 40% opacity or less, never a
  white frame.
- **Screen shake:** 6 px or less, lasting 4 frames or fewer.
- **Contrast:** text contrast is at least 4.5:1 against what is behind it.

## Storyboard

Frames refer to the 30 fps master. **Bold lines are on-screen copy,
verbatim.** "Counter" is the running total after the scene.

### 0:00–0:08 · Cold open: "The spellbook" (bars 1–4, frames 0–239)

The screen shows a terminal card floating on the dark canvas. Errors glow red,
and the camera shakes slightly on each error hit.

- **Bar 1 (frame 0).** `git push` is already half typed at frame 0. Beat 3:
  ```text
  ERROR: Permission to acme/api.git denied to jane-personal.
  fatal: Could not read from remote repository.
  ```
- **Bar 2 (frame 60).** `git reset --hard HEAD~3` → Beat 2:
  `HEAD is now at 1a2b3c4 feat(auth): add login form`. Beat 3: the music
  drops out. Beat 4: **"…wait."**
- **Bar 3 (frame 120).** `git rebase -i HEAD~5`. A Vim buffer of `pick` lines
  floods the card, then:
  ```text
  error: could not apply 3f2e1d0... fix(auth): refresh the token
  CONFLICT (content): Merge conflict in src/auth.ts
  ```
- **Bar 4 (frame 180).** The terminal shatters, and the shards streak off to
  become two light trails. Beat 1: **"Git is powerful."** Beat 3:
  **"It's also a spellbook."**

### 0:08–0:16 · The two lanes (bars 5–8, frames 240–479)

- **Bars 5–7.** The cyan lane runs on top, labelled **NEW TO GIT**, and the
  indigo lane below, labelled **BEEN DOING THIS FOR YEARS**. Each bar, one
  pain card rides in on each lane: cyan on beat 1, indigo on beat 2. Both hold
  until the bar ends.

  | Bar | Cyan | Indigo |
  | --- | --- | --- |
  | 5 | **Scared to press *rebase*.** | **Pushed as the wrong account. Again.** |
  | 6 | **One command from losing a day.** | **Nine commands to split one commit.** |
  | 7 | **What even is a detached HEAD?** | **A `~/.ssh/config` full of host aliases.** |

- **Bar 8 (frame 420), the switcher jab.** The lanes pull apart. Four
  questions stack at centre, one per beat, and each earlier one dims to 40%:
  1. **Paying for a Git GUI?**
  2. **One GitHub account at a time?**
  3. **No Linux build?**
  4. **Can't see what it runs?**

  A riser climbs through the bar.

### 0:16–0:22 · The drop: reveal (bars 9–11, frames 480–659)

- **Bar 9 beat 1 (frame 480): the drop.** The two lanes dive to bottom centre
  and fuse into one bright trunk. The trunk shoots up the middle and forks.
  - Beat 2 (frame 495): the two arrowheads pop on a spring.
  - Beat 3: the deep-indigo disc scales in behind them.

  The result is the Multi-Git logo, drawn from the lanes themselves.
- **Bar 10.** Beat 1: the wordmark **Multi-Git** slams in. Beat 2:
  **All of Git.** Beat 3: **None of the wizardry.**
- **Bar 11.** The logo lifts away and the app assembles one region per beat:
  the header (Repository, Branch, SSH Key), the sidebar, the Staging Area,
  then History with its graph lanes drawing in. A caption sits under it:
  **Free · Open source · Windows · macOS · Linux**.

### 0:22–0:30 · A. Every repo, its own account (bars 12–15, frames 660–899)

**Headline: The right account. Every push.**

- **Bar 12.** Beat 1: the headline. Beats 2–4: the spell (+6):
  ```text
  ssh-keygen -t ed25519 -f ~/.ssh/id_work -C "jane@acme.example"
  # ~/.ssh/config
  Host github-work
    HostName github.com
    IdentityFile ~/.ssh/id_work
    IdentitiesOnly yes
  git remote set-url origin git@github-work:acme/api.git
  git config user.name  "Jane Doe"
  git config user.email "jane@acme.example"
  ssh-add ~/.ssh/id_work
  ssh -T git@github-work
  ```
- **Bar 13 (frame 720): the collapse** into the **SSH Key** dropdown in the
  header ("SSH key for this repository"), which lists **Personal** and
  **Work**.
  1. Beat 2: the cursor picks **Work**.
  2. Beats 3–4: the key, the account rows (**Should use** `jane-acme` ·
     **Using** `jane-acme`) and the identity row
     (`Jane Doe <jane@acme.example>`) all flip together.

  **Counter: 6.**
- **Bar 14.** Beat 1: an **Auto-select rules** row snaps in:
  `github.com/acme/` → **Work**. Beat 3: a second acme repo opens, already on
  Work.
- **Bar 15: the save.** Personal is selected on an acme repo.
  1. Beat 1: the push shortcut `Ctrl` + `Alt` + `U` appears as keycaps.
  2. Beat 2: the real **Account mismatch** dialog slams in, reading
     *Your auto-select rules map this remote to account "Work", but you're
     pushing with "Personal". Push anyway?*, with **Cancel** and a red
     **Push Anyway**. "Work" and "Personal" highlight.
  3. Beat 3: the cursor hits **Cancel**.
  4. Beat 4: a stamp: **Caught before it happened.**

### 0:30–0:36 · B. Precision staging (bars 16–18, frames 900–1079)

**Headline: Commit exactly what you meant.**

- **Bar 16.** The headline, then the spell (+3):
  ```text
  git add -p src/auth.ts
  (1/3) Stage this hunk [y,n,q,a,d,j,J,g,/,s,e,?]? s
  (1/4) Stage this hunk [y,n,q,a,d,j,J,g,/,e,?]? e
  # …hand-edit the hunk in your editor…
  git restore -p src/auth.ts
  git commit -m "fix(auth): refresh the token before expiry"
  ```
- **Bar 17 (frame 960): the collapse into File Diff.**
  1. Beats 1–2: three clicks on three added lines, each flashing indigo, while
     the selection bar counts **3 lines selected**.
  2. Beat 3: **Stage selection**.
  3. Beat 4: two leftover `console.log` debug lines get selected →
     **Discard selection**, with a caption (not app UI):
     **Snapshotted to Safety Net first.**

  **Counter: 9.**
- **Bar 18.** Beat 1: keycaps `Ctrl` + `Enter`. Beat 2: the commit lands on the
  History graph. Beats 3–4, a quick flex: the split diff with word-level
  highlights, then the before/after image diff on a checkerboard.

### 0:36–0:44 · C. Safety Net (bars 19–22, frames 1080–1319)

**Headline (after the rescue): Undo the scary stuff.** Sub:
**Even the undo.**

- **Bar 19.** `git reset --hard HEAD~3` types. Beats 2–4: three commit nodes on
  the History graph turn red and fall off their lane.
- **Bar 20.** Beats 1–2: a panicked, shaky spell (+2):
  ```text
  git reflog                  # squint at 40 lines of HEAD@{n}
  git reset --hard HEAD@{1}
  ```
  Beat 3: it collapses into **Safety Net** → a recovery-point row →
  **Restore**, and the real confirm dialog flashes. Beats 3–4: the music
  tape-stops and reverses as the three nodes fly back up. **Counter: 11.**
- **Bar 21 (frame 1200).** The groove slams back and the nodes land in
  emerald. The headline appears.
- **Bar 22.** Beat 1: a new recovery point appears for the restore itself,
  and the sub lands: **Even the undo.** Beat 3: a card reads
  **Discarded files? Kept for 24 hours.**

### 0:44–0:50 · D. Visual interactive rebase (bars 23–25, frames 1320–1499)

**Headline: Rewrite history. Visually.**

- **Bar 23.** The headline, then the spell (+9):
  ```text
  git rebase -i HEAD~5
  # pick → edit, squash, fixup, reorder… in Vim
  git reset HEAD^
  git add -p        # ×3
  git commit        # ×3
  git rebase --continue
  ```
- **Bar 24 (frame 1380): the collapse into the rebase planner.**
  - Beats 1–2: rows move with the **Move earlier** and **Move later** arrow
    buttons. It is not drag and drop.
  - Beats 2–4: row action dropdowns flick to `squash`, `fixup` and `drop`, and
    the dropped row dims.
  - The Autosquash preview line appears.
- **Bar 25.** At the `edit` stop:
  1. Beat 1: **Split this commit** pulses.
  2. Beat 2: the real **Split commit** confirm → **Split**.
  3. Beats 3–4: one commit node becomes three.

  **Counter: 20**, jumping +9 like a slot machine. Small text:
  **Already pushed? It pushes with `--force-with-lease`.**

### 0:50–0:58 · E. Worktrees + coding agents (bars 26–29, frames 1500–1739)

**Headline: Three branches. Three agents. Zero stashing.**

- **Bar 26.** The headline, then the spell (+5):
  ```text
  git worktree add ../acme-api.worktrees/login  -b feature/login
  git worktree add ../acme-api.worktrees/search -b feature/search
  cd ../acme-api.worktrees/login  && claude
  cd ../acme-api.worktrees/search && codex
  cd ../acme-api && gemini
  ```
- **Bar 27 (frame 1560): the collapse into the Worktrees section.** Beats 1–3:
  three rows (`main`, `feature/login`, `feature/search`) fan out like
  branches, each marked clean or showing ahead/behind counts. Beat 4: each
  opens its own window. **Counter: 25.**
- **Bar 28.** The **Launch a coding agent** window. Beats 1–3: the **Claude
  Code**, **Codex** and **Gemini CLI** cards light up one per beat. Beat 4:
  each flies into a different worktree window.
- **Bar 29.** Three windows side by side, each a terminal showing just the
  command that started it (`claude`, `codex`, `gemini`) and a cursor. Don't
  mock up any third-party interface. Small text:
  **Claude Code · Codex · Gemini CLI · Copilot CLI · Aider · Cursor CLI and
  more. Your agents. Multi-Git stores no API keys.**

### 0:58–1:04 · F. Glass box: the twist (bars 30–32, frames 1740–1919)

- **Bar 30 (frame 1740).** The counter cracks open, and its glyphs pour into
  the **Terminal** panel at the bottom of the app. As they land, they become
  the real recorded commands for this film's actions: working directory,
  argument vector, exit code and duration. Only commands that changed
  something are shown, never read-only queries.

  Beat 3: **No black box.**
- **Bar 31.** Beat 1: the cursor hovers a line and it copies. Beat 2:
  **Every command it runs, exactly as it ran.** Beat 3:
  **We didn't hide Git. We typed it for you.**
- **Bar 32.** Beat 1: the cyan lane glints under the panel:
  **Learn Git by watching it.** Beat 4 (frame 1905): the `Ctrl` + `K` keycap
  thocks and the command palette opens. The montage pours out of it.

### 1:04–1:14 · Montage: one per beat (bars 33–37, frames 1920–2219)

Twenty cards, one per beat, so card *k* starts at frame `1920 + (k − 1) × 15`.
Each card shows three things:

- a question or label of 5 words or fewer
- the one real control that answers it
- the command it replaces, struck through in small mono underneath

Each card adds +1 to the counter, taking it from 25 to 45. The screen shakes
slightly on each downbeat.

- **Cards 1–10** ride the cyan lane under the chip **EVERYONE'S FIRST
  QUESTIONS**.
- **Cards 11–20** ride the indigo lane under the chip **POWER MOVES**. The
  lane switches at frame 2070.

| # | Card | The control | Struck through |
| --- | --- | --- | --- |
| 1 | **Undo my last commit?** | History → **Undo** | `git reset --soft HEAD~1` |
| 2 | **Unstage a file?** | Click its staged row | `git restore --staged app.ts` |
| 3 | **Throw away changes?** | Trash icon (a copy is kept) | `git restore app.ts` |
| 4 | **Fix my last message?** | **Amend** | `git commit --amend -m "…"` |
| 5 | **Grab a remote branch?** | Click `origin/feature` | `git switch -c feature --track origin/feature` |
| 6 | **Rename a branch?** | Branch maintenance → rename | `git branch -m old new` |
| 7 | **Delete a branch safely?** | Delete icon (force only after asking) | `git branch -d feature` |
| 8 | **Ignore this file?** | Ignore icon | `echo "debug.log" >> .gitignore` |
| 9 | **Fix a merge conflict?** | **Use HEAD (Ours)** / **Use Incoming (Theirs)** | `git checkout --theirs src/auth.ts` |
| 10 | **Undo a pushed commit?** | **Revert** | `git revert 3f2e1d0` |
| 11 | **Pull requests, pre-flighted** | Create pull request | `gh pr create --base main --draft …` |
| 12 | **Signed. Verified.** | Sign + the Verified badge | `git config gpg.format ssh` |
| 13 | **Bisect that runs itself** | Bisect with a saved test | `git bisect run npm test` |
| 14 | **Fetch a whole group** | Groups → **Fetch all** | `for d in */; do git -C "$d" fetch; done` |
| 15 | **Clean up merged branches** | Maintenance → Delete merged | `git branch --merged main \| grep -v main \| xargs git branch -d` |
| 16 | **Find any commit** (`Ctrl+Shift+F`) | Search commits | `git log --since=1.week -- src/auth.ts` |
| 17 | **Compare any two refs** | Compare two refs | `git rev-list --left-right --count main...feature` |
| 18 | **Submodules, untangled** | Submodules → Update | `git submodule update --init` |
| 19 | **LFS, visible** | The LFS tab | `git lfs ls-files` |
| 20 | **Force-push? Only with a lease.** | **Force Push (with lease)** | `git push --force-with-lease` |

### 1:14–1:18 · Two lanes, one tool (bars 38–39, frames 2220–2339)

The screen splits along the two lanes.

- **Cyan (top): NEW TO GIT?** The real merge preview. The title is
  *Merge feature/login?*, and the body reads *3 commits from feature/login,
  touching 5 files.*, then the commit subjects, then *Your 2 commits and
  theirs both stay, joined by a merge commit.* and
  *A recovery point is recorded first, so this can be undone from Safety
  Net.* It ends on the **Merge** button. Caption:
  **Every risky move explains itself first.**
- **Indigo (bottom): LIVING IN THE TERMINAL?** The real `multi-git tui` in
  NORMAL mode: `Space` opens the shortcut menu, then `j`, `k`, `v` and `s`
  appear as keycaps. Beside it, a stylized MCP exchange shows a real
  `tools/call` and its real result, taken from a transcript. Caption:
  **Vim keys. JSON CLI. An MCP server for your agents.**

### 1:18–1:22 · The stinger (bars 40–41, frames 2340–2459)

- **Bar 40 (frame 2340).** Hard cut to true black and silence. The counter
  alone, huge at centre, reshuffles its digits and lands on 45:
  **You just watched 45 commands.**
- **Bar 41 beat 1 (frame 2400).** The massive hit: **You typed zero.** The
  "0" drops in at full height.

### 1:22–1:30 · Checklist → end card (bars 42–45, frames 2460–2699)

- **Bar 42.** The four bar-8 questions return, dimmed. One per beat, each is
  struck through and answered:
  1. **✓ Free. MIT open source.**
  2. **✓ Every repo on its own account.**
  3. **✓ Windows · macOS · Linux.**
  4. **✓ Every command visible.**
- **Bar 43.** Three more checks tick in on beats 1, 2 and 3:
  - **✓ No sign-up. Local-first.**
  - **✓ Undo for the scary stuff.**
  - **✓ Your repos, your keys. Plain Git underneath.**
- **Bars 44–45 (frame 2580).** The two lanes sweep in and fuse into the logo,
  a fast replay of the reveal. The end card holds for both bars:

  > **Multi-Git**
  > All of Git. None of the wizardry.
  > **[ Download free → ]** `github.com/AnthonyKopri/multi-git`
  > Windows · macOS · Linux

  Bar 45 beat 3 (frame 2670): the cursor clicks **Download free** and the
  corner counter ticks to **46**. That's the viewer's turn. The final chord
  rings out to frame 2699.

## Cutdowns

Each cutdown reuses the master's scene components, has its own music
arrangement on the same grid, and **computes its own counter from the spells
it shows**.

### `Promo30`: 30 s, 1920×1080 (15 bars, 900 frames)

| Bars | Content | Counter |
| --- | --- | --- |
| 1–2 | Cold open, condensed: the push error, then the reset and "…wait." | — |
| 3 | The switcher jab: four questions, one per beat | — |
| 4–5 | The drop, the logo, the tagline | — |
| 6–8 | A, condensed: spell → collapse → Account mismatch caught | 6 |
| 9–10 | D, condensed: spell → planner → Split this commit | 15 |
| 11–12 | C, condensed: the oops → Restore → the rewind | 17 |
| 13 | Stinger: **You just watched 17 commands.** then **You typed zero.** | 17 |
| 14–15 | End card with the call to action | — |

### `Vertical`: 20 s, 1080×1920 (10 bars, 600 frames)

Keep every text element inside the centre 1080×1300 area, about 250 px clear
at the top and 370 px at the bottom, so platform UI never covers it.

| Bars | Content | Counter |
| --- | --- | --- |
| 1 | The hook, top: **Splitting one Git commit takes nine commands.** Then D's spell floods. | — |
| 2 | Collapse into **Split this commit** | 9 |
| 3 | The logo reveal, fast | — |
| 4 | **All of Git. None of the wizardry.** | — |
| 5–6 | A, condensed: the dropdown switch, then Account mismatch caught | 15 |
| 7 | Stinger: **15 commands. You typed zero.** | 15 |
| 8–10 | The vertical end card: logo, tagline, **Download free**, URL, platforms | — |

### `ReadmeGif`: about 20 s, 720×405, 15 fps, no audio, no counter

Order: the logo, then A, B, C and E condensed (about 4 s each), then the end
card. The last frame must cut seamlessly back to the first, so the GIF opens
and closes on the logo. Push in close enough that UI text reads at 720 px
wide. Target 10 MB or less, replacing `docs/images/multi-git-promo.gif` when
approved.

## Must show

- The **two-lane → logo** fusion at the reveal and at the end card.
- **Per-repo accounts**, including the real **Account mismatch** dialog
  catching a wrong-account push. This is the feature the product is named
  for.
- **Line-level staging and discard** (the selection bar).
- **A Safety Net restore** of a hard reset, with the rewind.
- **The visual rebase planner** with **Split this commit**.
- **Worktrees** with **coding agents** launched into them, with Claude Code,
  Codex and Gemini CLI named.
- **The Terminal panel** showing real, copyable commands: the glass-box
  twist.
- **Keyboard shortcuts as keycaps:**
  - `Ctrl+Alt+U` (push), `Ctrl+Enter` (commit), `Ctrl+K` (palette) and
    `Ctrl+Shift+F` (search).
  - Others available if a moment needs them: `Ctrl+Alt+F` fetch,
    `Ctrl+Alt+P` pull, `Ctrl+Alt+S` stage all, `Ctrl+1/2/3` tabs, `Ctrl+B`,
    `Ctrl+Shift+B`, `F5`.
  - Show them as `Ctrl` (on a Mac the app shows `Cmd`).
- **The terminal edition** (`multi-git tui`) and the **MCP server**.
- **The counter** and its **45 → zero** payoff.
- **Free · MIT · Windows · macOS · Linux** and the URL.

## Avoid

- **The old promo's look.** No slow fades, no left-aligned paragraph blocks,
  no idle hairlines drifting across empty screens, no small floating
  screenshots. None of its text either ("Supercharged Git", "Let the code vibe
  with you").
- **Rivals on screen.** No names, logos, UI, screenshots or lookalike UI. The
  comparison stays implied.
- **Uniqueness claims.**
  - Not "the only…", "the first…" or "unlike other clients…".
  - Rivals have undo (Tower, GitKraken), worktrees (GitHub Desktop 3.6, Tower,
    GitKraken) and MCP (GitKraken). Only the claims in the switcher table are
    comparative, and they're true as of September 2026.
- **UI that doesn't exist:**
  - A "stash selection" button. Stashing selected lines exists in the API and
    the README, but the GUI has no control for it.
  - Drag and drop in the rebase planner. Rows move with arrow buttons.
  - Labels that differ from the app's. For example, the conflict buttons read
    **Use HEAD (Ours)** and **Use Incoming (Theirs)**, not "Keep ours".
- **Overclaiming Safety Net.** Say "undo" or "recover", never "never lose
  work" or "backup". A hard reset stays destructive.
- **"AI-powered Git."** Multi-Git launches *your* agents and serves them over
  MCP. It has no AI of its own.
- **Tokens and keys.** Never imply Multi-Git stores GitHub tokens or model API
  keys. It stores neither.
- **Blind force-pushes.** Only `--force-with-lease` appears, and only as
  protection.
- **Auto-pull merging or rebasing.** It only ever fast-forwards.
- **Security-warning screens.** No SmartScreen or macOS "unidentified
  developer" dialogs, and never say "signed", "notarized" or "verified
  publisher" about the app itself. The **Verified** badge on commits is fine.
- **Real personal data.** No real names, emails, key material, passphrases,
  hostnames or local paths (no `D:\Important\…`, `/root`, `/tmp/…`). Use the
  fictional cast in [Assets and demo data](#assets-and-demo-data).
- **Performance claims** such as "fastest" or "lightweight". Nothing measured
  backs them.
- **Features that don't exist:** cloud sync, team workspaces, mobile, built-in
  code editing, and PR creation for GitLab or Bitbucket (PRs go through
  GitHub's `gh`).
- **A prominent version number.** It dates the film. A small "v5" on the end
  card at most.
- **Stock footage, 3D renders, people or hands.** Keep it 2D, vector and UI.
- **Flashing that breaks the accessibility rules** in
  [Visual system](#visual-system).

## Fact sheet

### Claims the film may make

| Claim | Source |
| --- | --- |
| Free, MIT, open source | `LICENSE`, README |
| Windows (installer and portable), a universal macOS DMG, and Linux AppImage/.deb/.rpm | README "Download and Install" |
| No required account; application state stays local | README "Local Data, Privacy, And Security" |
| Each repository has its own SSH profile and commit identity, switched together | README "SSH profiles, accounts, and identities" |
| Auto-select rules pick a profile from the origin URL | README "Auto-select profiles"; the SSH window's "Auto-select rules" |
| A push that contradicts a rule asks first (**Account mismatch**) | `src/renderer/features/sync/index.ts` |
| A push from a key verified as another account asks first (**Wrong account**) | Same file. It needs the host, so it can't be captured offline. |
| Encrypted passphrase vault (AES-256-GCM, scrypt) | README "Passphrase vault" |
| Stage, unstage or discard selected lines or hunks, with discards snapshotted | README "Staging part of a file"; the selection bar in `public/index.html` |
| Split or unified diffs, word-level highlights, before/after images | README "Reading the diff" |
| Rebase planner: pick/reword/edit/squash/fixup/drop, move earlier/later, Autosquash preview, Split this commit | README "Interactive rebase"; `src/renderer/features/rebase/index.ts` |
| Recovery points survive restarts; restoring records its own point; discarded copies are kept for 24 h | README "Safety Net" |
| History → Undo soft-resets the last commit; Amend; Revert; Cherry-pick; Reset | README "Staging, diffs, and commits", "Visual history" |
| Clicking a remote branch creates or reuses a tracking branch | README "Branches, merges, and rebases" |
| Branch maintenance: rename, pin, bulk delete; delete merged branches | README "Branch maintenance", "Maintenance" |
| One-click ignore of an untracked file | README "Staging, diffs, and commits" |
| Conflict workflow: Use HEAD (Ours), Use Incoming (Theirs), Save & Resolve | `public/index.html` |
| Worktrees: create, lock, move, repair, prune preview, a window each | README "Worktrees" |
| Launches Claude Code, Codex, Gemini CLI, Copilot CLI, Aider, Cursor CLI, Qwen, Amp, Goose and others; stores no API keys | README "Coding agents" |
| The Terminal panel records each command's real argument vector, cwd, exit code and duration | README "Terminal"; `src/shared/log-types.ts` |
| Merge, rebase and pull explain what will happen first | `docs/release-notes-4.0.0.md`; `src/renderer/features/branches/index.ts` |
| A rejected push offers `--force-with-lease`, never a silent force | README "Keep in sync" |
| Auto-pull only fast-forwards | README "Keep in sync" |
| PR creation with a preflight, drafts, reviewers and forks, via `gh` | README "Creating GitHub pull requests" |
| SSH/GPG signing with Verified / Unverified / Bad signature badges | README "Commit signing" |
| Commit search (`Ctrl+Shift+F`) and comparing refs | README "Searching and comparing" |
| Remotes, submodules, LFS, patches, bisect (with a saved test command), notes | README "The Repository hub" |
| Repository groups: Fetch all, with results per repo | README "Multiple windows and repository groups" |
| New-repo wizard: license, `.gitignore`, create on GitHub, first push | README "Creating a new repository" |
| `multi-git tui` with Vim keys, a `Space` menu and a `:` palette | `docs/terminal.md` |
| MCP server: read-only unless `--allow-write`, never force-pushes | `docs/mcp.md` |
| Plain Git underneath: settings are written to the repo's own Git config | README "Commit signing"; `core.sshCommand` in README "Terminal" |
| Keyboard shortcuts | The command table in `src/renderer/main.ts` |

### Real UI copy (use verbatim)

| Where | Text |
| --- | --- |
| Account mismatch dialog | Title **Account mismatch**. *Your auto-select rules map this remote to account "Work", but you're pushing with "Personal". Push anyway?* Buttons: Cancel, **Push Anyway** |
| SSH Key dropdown | Title *SSH key for this repository*, the profile list, the rows **Should use** and **Using** (each with a **Check** button), *Identity: …*, and a **Manage** button |
| Repo account note (in that dropdown) | *This key authenticates as jane-personal, but this repository belongs to jane-acme. Pushing would come from the wrong account.* |
| Merge preview | Title *Merge feature/login?*. Body: *N commits from feature/login, touching N files.*, the subjects, *Your N commits and theirs both stay, joined by a merge commit.*, *A recovery point is recorded first, so this can be undone from Safety Net.* Button: **Merge** |
| Restore confirm | *Reset main back to 9f8e7d6? This is a hard reset: anything committed since "…" goes with it. A new recovery point is recorded first.* Button: **Restore** |
| Split confirm | Title **Split commit**. *Undo this commit, keeping its changes in the working tree? Stage and commit each part in turn, then continue the rebase.* Button: **Split** |
| Selection bar | *N lines selected*, **Stage selection**, **Unstage selection**, **Discard selection**, **Clear** |
| Force push | **Force Push (with lease)** |
| Palette titles | *Interactive rebase (plan commit by commit)*, *Recovery points and reflog*, *Manage SSH profiles*, *Manage worktrees*, *Launch a coding agent here*, *Search commits*, *Compare two refs*, *Branch maintenance*, *Create a pull request* |

Hashes, counts and dates in this copy come from the demo world at capture
time. The film shows the real values, and the demo world is built so the
storyboard's numbers come out true (see
[Assets and demo data](#assets-and-demo-data)).

## Competitive notes (internal)

These notes are for decisions, not for the screen. They were checked on the
web in September 2026; re-check before any public comparison.

| Rival | Price and license | Platforms | Accounts | Strengths to respect | Our angle |
| --- | --- | --- | --- | --- | --- |
| **GitHub Desktop** | Free, open source | Windows and macOS only (Linux via a community fork) | One GitHub.com account at a time; a multi-account PR was closed in January 2026 | Worktrees and deeper Copilot integration since 3.6 (June 2026) | Per-repo accounts with Auto-select, Linux, and depth: rebase planner with split, bisect, LFS, submodules |
| **Sourcetree** | Free, closed source | Windows and macOS only; Linux has been requested since 2015 | Not checked | Mature, familiar | Linux, open source, a modern UI, per-repo accounts |
| **Tower** | Subscription: $69/yr Basic, $129/yr Pro (free for education) | macOS and Windows only | Not checked | The most complete undo (`Cmd`/`Ctrl+Z`); worktrees | Free, open source, Linux. Don't pitch undo as unique against Tower. |
| **GitKraken** | Free only for local and public repos; private repos need Pro (about $59/yr); multiple profiles are paid | Windows, macOS, Linux | Requires a GitKraken account to open a repo | MCP server and CLI, AI features, worktrees, undo | Free for private repos, no account, open source, per-repo accounts at no cost |

**Where Multi-Git clearly stands out:** the *combination* of free, MIT,
Linux, no account, per-repo identities that switch key and author together,
wrong-account push checks, commands you can see and copy, any coding agent
you like, and a terminal edition on the same backend.

Sources:
[GitHub Desktop 3.6](https://github.blog/changelog/2026-06-26-github-desktop-3-6-worktrees-and-deeper-copilot-integration/) ·
[multi-account PR](https://github.com/desktop/desktop/pull/21467) ·
[Linux fork](https://github.com/shiftkey/desktop) ·
[Sourcetree on Linux](https://community.atlassian.com/forums/Sourcetree-questions/Sourcetree-application-for-Ubuntu-Linux/qaq-p/3229670) ·
[Tower pricing](https://www.git-tower.com/pricing) ·
[Tower undo](https://www.git-tower.com/blog/best-git-client) ·
[GitKraken pricing](https://gitkraken.com/pricing) ·
[GitKraken account FAQ](https://support.gitkraken.com/account/faq/) ·
[GitKraken MCP](https://gitkraken.com/blog/introducing-gitkraken-mcp)

## Music and sound

### Track: synthesized, original

- **Tempo and key:** 120 BPM in F minor, resolving to F major (a Picardy
  third) on the end card.
- **Style:** driving electronic, between a synthwave arp and a modern
  future-bass drop. Bright supersaws, a sidechained sub, tight claps.
  Energetic, not festival-loud.
- **Structure (master):**

  | Bars | Section | Feel |
  | --- | --- | --- |
  | 1–4 | Cold open | Sparse: a detuned low drone and a keyboard-clack rhythm, with a glitch hit per failed spell. **Dropout on bar 2, beats 3–4** ("…wait."). A shatter sweep on bar 4. |
  | 5–7 | Two lanes | A filtered arp rising, a plucky cyan motif and a warm indigo pad. |
  | 8 | Switcher jab | Four snare hits on the beats, and a riser into bar 9. |
  | 9–11 | **The drop** | The full drop on the fusion (frame 480): a supersaw stab, the sub, four-on-the-floor. |
  | 12–32 | Feature scenes | The main groove, with a one-beat fill before each scene change. Bar 20 beats 3–4: a **tape-stop and reverse** for the rewind; the groove slams back on bar 21. |
  | 33–37 | Montage | Double-time hats and a counter-melody arp: the energy peak. A swell at the lane switch (frame 2070). |
  | 38–39 | Two lanes | Kick only, with the cyan pluck and the indigo pad trading phrases. |
  | 40 | Stinger, part 1 | **Hard stop. Silence.** |
  | 41 | Stinger, part 2 | **One massive hit** on frame 2400, then a building pulse. |
  | 42–45 | Checklist → end | A final lift, resolving to a sustained F-major chord on the end card that rings out. |

### Sync points (master)

| Frame | Time | Bar.beat | Event | Sound |
| --- | --- | --- | --- | --- |
| 0 | 0:00.0 | 1.1 | `git push` typing | Key clatter |
| 30 | 0:01.0 | 1.3 | Permission denied | Glitch hit |
| 90 | 0:03.0 | 2.3 | Music drops out | Silence |
| 105 | 0:03.5 | 2.4 | "…wait." | — |
| 120 | 0:04.0 | 3.1 | Rebase and the Vim flood | Clatter + glitch |
| 180 | 0:06.0 | 4.1 | The terminal shatters | Shatter sweep |
| 420 | 0:14.0 | 8.1 | The switcher questions | Snare ×4, riser |
| 480 | 0:16.0 | 9.1 | **Drop:** lanes fuse into the trunk | Impact + drop |
| 495 | 0:16.5 | 9.2 | Arrowheads pop | Stab |
| 720 | 0:24.0 | 13.1 | Collapse A | Whoosh + thunk, flips ×6 |
| 855 | 0:28.5 | 15.2 | Account mismatch | Amber alarm blip |
| 870 | 0:29.0 | 15.3 | Cancel | "Caught" chime |
| 960 | 0:32.0 | 17.1 | Collapse B | Whoosh + thunk, flips ×3 |
| 1080 | 0:36.0 | 19.1 | The oops | Low boom |
| 1170 | 0:39.0 | 20.3 | Restore → rewind | Tape-stop + reverse cymbal |
| 1200 | 0:40.0 | 21.1 | Nodes land | Impact + emerald chimes |
| 1380 | 0:46.0 | 24.1 | Collapse D | Whoosh + thunk |
| 1440 | 0:48.0 | 25.1 | Split: counter +9 | Flips ×9, slot-machine style |
| 1560 | 0:52.0 | 27.1 | Collapse E | Whoosh + thunk, flips ×5 |
| 1740 | 0:58.0 | 30.1 | The counter cracks and lines pour | Glass crack + cascade |
| 1905 | 1:03.5 | 32.4 | `Ctrl+K` | Key thock |
| 1920 | 1:04.0 | 33.1 | Montage | Ticks, one per card |
| 2070 | 1:09.0 | 35.3 | Lane switch | Swell |
| 2340 | 1:18.0 | 40.1 | Stinger | Silence |
| 2400 | 1:20.0 | 41.1 | "You typed zero." | Massive hit |
| 2580 | 1:26.0 | 44.1 | The logo and end card | Resolve to F major |
| 2670 | 1:29.0 | 45.3 | Download click, counter 46 | Click + flip |

### Sound design (layered over the music)

- **Spell typing:** fast mechanical-keyboard clatter, panned slightly.
- **Collapse:** a short whoosh-in, then a deep, satisfying thunk as the stack
  lands in the control. This is the signature sound.
- **Counter:** a crisp split-flap flip. Stack the flips for multi-digit jumps.
- **Errors:** a low digital buzz with a bit-crushed tail.
- **Account mismatch:** an amber alarm blip, then a clean "caught" chime.
- **Rewind:** a tape-stop plus a reverse cymbal. Restored nodes land with soft
  emerald chimes.
- **Montage:** a pitched tick per card, rising a semitone every four cards.

### Mix and delivery

- **Loudness:** about −14 LUFS integrated and −1 dBTP true peak, for web
  platforms.
- **Balance:** SFX sit about 6 dB under the music bus, except the collapse
  thunk and the stinger hit, which lead.
- **Format:** 48 kHz stereo. The audio is AAC at 320 kbps in the MP4, and PCM
  in the ProRes master.

## Assets and demo data

### Fictional cast (use nothing real)

| Who | Commit identity | Host account | Key file |
| --- | --- | --- | --- |
| Jane, personal | `Jane Doe <jane@example.com>` | `jane-personal` | `~/.ssh/id_ed25519_personal` |
| Jane, work | `Jane Doe <jane@acme.example>` | `jane-acme` | `~/.ssh/id_ed25519_work` |
| Teammates | `Sam Rivera <sam@acme.example>`, `Priya Nair <priya@acme.example>` | — | — |

- `example.com` and the `.example` TLD are reserved for documentation, so they
  are safe.
- The repo `acme/api` belongs to the organisation `acme`, so its intended
  account is set to `jane-acme` (the app lets you override the owner for
  organisation repos).

### Demo repositories

- **`~/code/acme-api`**, origin `git@github.com:acme/api.git`:
  - About 30 conventional commits over three weeks, for example
    `feat(auth): add login form`, `fix(auth): refresh the token before
    expiry`, `feat(search): index titles`, `refactor(api): split handlers`,
    `test(auth): cover token refresh`, `perf(search): cache results`,
    `docs: add API usage`, `chore(deps): bump express`.
  - Branches `main`, `feature/login`, `feature/search` and
    `fix/token-refresh`, with real merges so the graph has colored lanes.
  - Tags `v1.0.0` and `v1.1.0`.
  - Worktrees at `~/code/acme-api.worktrees/login` and
    `~/code/acme-api.worktrees/search`.
- **`~/code/acme-web`**, origin `git@github.com:acme/web.git`: a small second
  work repo. It opens already on Work in scene A, and it joins `acme-api` in
  a repository group **Acme** for the montage's "Fetch a whole group" card.
- **`~/code/dotfiles`**, origin `git@github.com:jane/dotfiles.git`, which the
  Personal account uses.

### State the storyboard depends on

- **The merge preview (two-lanes beat):** `feature/login` is exactly
  3 commits ahead of `main`, touching 5 files, and `main` has exactly
  2 commits `feature/login` lacks. The preview then reads *3 commits … 5
  files* and *Your 2 commits …*.
- **The working tree for scene B:**
  - `src/auth.ts` has three meaningful hunks (token refresh) plus two
    `console.log` debug lines.
  - One other file is already staged, and one untracked file exists.
  - The logo PNG is recolored for the image diff.
- **History for scenes C and D:** at least 5 commits above the rebase base,
  including one `fixup!` commit so the Autosquash preview has something to
  show. Also one stash and one git note.
- **Safety Net:** at least one recovery point and one Recently Discarded
  entry exist before capture.

### Files in this repository

- The logo: [docs/images/multi-git_icon.svg](docs/images/multi-git_icon.svg)
  (vector) and [docs/images/multi-git-logo.png](docs/images/multi-git-logo.png).
- A UI reference: [docs/images/multi-git-overview.png](docs/images/multi-git-overview.png).
  It's an older version; captures from the current build take precedence.
- The old promo, for reference only:
  [docs/images/multi-git-promo.gif](docs/images/multi-git-promo.gif).

## Deliverables

| Deliverable | Spec |
| --- | --- |
| Master | 90 s, 1920×1080, 30 fps, H.264 (CRF about 18, `yuv420p`, BT.709) with AAC 320 kbps |
| Mezzanine | ProRes 422 HQ with PCM audio |
| `Promo30` | 30 s, 1920×1080, H.264 |
| `Vertical` | 20 s, 1080×1920, H.264 |
| `ReadmeGif` | About 20 s, 720×405, 15 fps, 10 MB or less, loopable |
| Thumbnail | 1280×720, from the stinger frame **You typed zero.** |
