# Cloud brief: build the Multi-Git promo video

> **For the human only.** Agent, skip straight to [Mission](#mission).
>
> 1. **Environment:**
>    - Network access: **Trusted**.
>    - Setup script: yours. Optionally add
>      `apt-get install -y fonts-jetbrains-mono || true` before the
>      `ffmpeg -version` line. Keep `|| true` on anything optional, because a
>      setup script that exits non-zero stops the session from starting.
> 2. **Start the session:**
>    - Repository `AnthonyKopri/multi-git`, branch **`promo/video-2`**.
>    - Permission mode **Auto** (or **Accept edits** if Auto isn't offered).
> 3. **Paste this:** *Read promo/CLOUD_PROMPT.md and PromoSpecifications.md
>    in full, then carry out promo/CLOUD_PROMPT.md from "Mission" onward.
>    Work autonomously until done and never ask me anything.*
> 4. **In the morning:**
>    1. The session pushes to its *own* branch, because cloud push protection
>       allows only that one. Its name is on the first line of
>       `promo/NOTES.md`.
>    2. Fast-forward: `git fetch origin`, `git switch promo/video-2`,
>       `git merge --ff-only origin/<session-branch>`, `git push`.
>    3. Render: `cd promo`, `npm ci`, `npm run render`. Details are in
>       `promo/README.md`.
> 5. **If it stopped early:** start a new session from the session branch and
>    paste the same line. It resumes from `promo/NOTES.md`.

## Mission

Build the promotional film specified in
[PromoSpecifications.md](../PromoSpecifications.md) as a Remotion project in
`promo/`. Along the way:

- capture the real product with fictional data
- synthesize the music and sound effects
- check your work with cheap low-resolution stills
- document everything
- commit and push after every milestone

You don't render the final film. The owner renders it on their own PC from
your project. The job is done when the project renders the whole 90 s master
exactly as the spec's storyboard describes, and the owner can render, preview
and tweak it with the commands in `promo/README.md`.

**Quality bar:** this should look like a launch film from a top product team.
Every beat has motion, cuts land on the music, type is kinetic, and the UI is
the hero. Nothing is a static slide. The previous promo was calm and slow;
this one is swift and energetic.

### Definition of done

- [ ] `promo/` is a standalone npm package: Remotion project, scripts,
  lockfile.
- [ ] The compositions `Promo` (master), `Promo30`, `Vertical` and `ReadmeGif`
  are registered. `Promo` is complete; the cutdowns are complete if the budget
  allowed (see §1).
- [ ] Real captures and their `manifest.json` are in `promo/assets/captures/`.
- [ ] The synthesized music and SFX are reproducible with `npm run audio`, and
  a mix preview is at `promo/review/mix-preview.mp3`.
- [ ] Review contact sheets are in `promo/review/round-N/`.
- [ ] `npm run check` passes: types, counter math, banned phrases, privacy
  scan.
- [ ] `promo/README.md` (render and tweak) and `promo/NOTES.md` (status,
  decisions, deviations) are written.
- [ ] Everything is committed and pushed to the session branch.

## 0. Operating rules

- **Work autonomously.** Never stop to ask a question. An idle session can
  expire overnight. When something is ambiguous, decide, log the decision in
  `promo/NOTES.md`, and keep going.
- **Sources of truth:**
  - The spec wins on *content*: story, copy, timing, look, sound, claims,
    "Avoid".
  - This file wins on *process*.
  - If you find a mistake in the spec, don't edit the spec. Log it under
    "Spec issues" in `NOTES.md` and do the closest faithful thing.
- **Stay inside `promo/`.** You may read anything and run the app, but never
  modify repository files outside `promo/`. The exceptions are build output
  that is already gitignored (`node_modules/`, `out/`) and scratch space
  outside the repository, such as the fake home `/home/jane`. Never change
  the spec.
- **Git:**
  - Cloud push protection only lets you push this session's own working
    branch. At the start, run `git branch --show-current` and write that name
    on the first line of `promo/NOTES.md`.
  - After every milestone, commit and run `git push -u origin HEAD`.
  - Never push elsewhere, force-push, open PRs, create tags or releases,
    trigger workflows, or touch `main`.
- **Resume, don't restart.** If `promo/NOTES.md` already has a progress log, an
  earlier session ran out of budget. Continue from the first unchecked
  milestone and don't redo finished work. This session has a new branch, so
  replace line 1 with its name and note the old branch in the progress log.
  Rebuild anything that isn't in git (`node_modules`, the fake home, generated
  audio) before continuing.
- **Refusals.** If the permission system refuses a command, don't retry the
  same command. Find another route, or log it and move on.
- **Privacy:**
  - Use only the spec's fictional cast and data.
  - Never commit private keys, even fake ones.
  - Nothing in the video may show the container's paths, username or
    hostname.

## 1. Budget: read this twice

The owner has a fixed amount of credit, and **model tokens are the only cost**
(the cloud VM has no compute charge). Everything you read stays in context
and is paid for again on every later turn, so work lean.

- **One agent, working linearly.** No subagents, no Agent or Workflow tools, no
  parallel fan-out.
- **Read narrowly.** Read the spec and this file once, in full. For
  everything else, use grep and read only the lines you need. The codebase
  facts in §3 are already verified, so don't re-derive them.
- **Keep output short.** Pipe through `| tail -n 25`, and use
  `npm i --no-audit --no-fund --loglevel=error`. Never print lockfiles,
  bundles, minified CSS, full logs or large JSON.
- **Write whole files in one pass** rather than many small edits.
- **Image views: 30 for the whole session.** Always look at tiled contact
  sheets, never individual frames or full-resolution screenshots, and keep
  every sheet 1600 px wide or less.
- **No full-length or 1080p video renders.** Allowed: stills, contact sheets,
  and one smoke clip of 5 s or less at scale 0.25.
- **Don't poll or sleep.** Run long commands in the foreground with a generous
  timeout (up to 10 minutes), and split anything longer into batches.
- **Three strikes.** If a problem survives 3 attempts, use the fallback from
  §2, log it, and move on.
- **Soft budgets in tool calls.** Past about 450 calls, stop polishing: finish
  the current milestone and go straight to M10.

  | M0 | M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | M9 | M10 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 10 | 20 | 70 | 30 | 45 | 90 | 55 | 45 | 25 | 35 | 20 |

- **If you run low, go breadth-first,** in this priority order:
  1. The full master timeline plays with the correct copy, timing and audio.
  2. The hero moments are polished.
  3. The montage and checklist are polished.
  4. The cutdowns exist.
  5. Extras.

## 2. Environment (verified 2026-09-25)

### The VM

- Ubuntu 24.04 on x86_64. You run as root.
- **Preinstalled:** Node 20/21/22, npm, Python 3, git, gh, jq, ripgrep, tmux.
- **Added by the owner's setup script:** `ffmpeg`, `xvfb`, `imagemagick`
  (`montage`, `convert`), `x11-utils`, `fonts-inter`, `fonts-roboto`, and the
  Chromium/Electron runtime libraries. Possibly `fonts-jetbrains-mono`.
- **Node version:** the app needs Node 22.12 or newer. Check `node -v`. If
  it's older, run `nvm install 22` if nvm exists, or install the latest 22.x
  tarball from `nodejs.org`, which is on the allowlist.

### The network (Trusted allowlist)

| Reachable | Not reachable |
| --- | --- |
| The npm registry | `cdn.playwright.dev` and Playwright's other download hosts |
| GitHub, including release assets and `raw.githubusercontent.com` | `unpkg` |
| Everything under `*.googleapis.com`, including `storage.googleapis.com` (Chrome for Testing and Chrome Headless Shell) and `fonts.googleapis.com` | `jsdelivr` |
| `fonts.gstatic.com` | |
| `nodejs.org`, PyPI, the Ubuntu archives | |

What follows from that:

- **Rendering:** `npx remotion browser ensure` downloads Chrome Headless Shell
  from `storage.googleapis.com`.
- **Captures:** use **Puppeteer**, which downloads Chrome for Testing from the
  same host. Don't use Playwright's browser installer, because it's blocked.
  (`playwright-core`'s `_electron` API needs no browser download, so it's
  still usable for Electron.)
- **One browser for both:** if only one Chromium can be obtained, point both
  tools at it. Use Puppeteer's `executablePath`, and for Remotion,
  `Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? null)` in
  `remotion.config.ts`, so the owner's PC uses Remotion's own browser.

### If X fails, do Y

| Problem | Fallback |
| --- | --- |
| `remotion browser ensure` fails | `npx @puppeteer/browsers install chrome-headless-shell@stable`, then set `REMOTION_BROWSER` |
| The Puppeteer download fails | Launch Puppeteer with Remotion's headless shell as `executablePath` |
| App fonts or icons render as words (`folder_open`) in captures | Intercept `fonts.googleapis.com` and `fonts.gstatic.com` with Puppeteer request interception and serve the local npm font files |
| A window won't open in browser mode | Rebuild it from `public/index.html` markup (§5.4), or try Electron (§3.8) |
| The TUI capture is garbled | `TERM=xterm-256color LANG=C.UTF-8 tmux -2 …`. Failing that, build the TUI frame from `docs/terminal.md` and log it. |
| The MCP handshake fails | Show real tool names from `docs/mcp.md` and log it |
| Remotion's skills won't install | Skip them (§5.3). They're optional. |
| A push is refused | Make sure the commit exists locally, retry `git push -u origin HEAD` once, then log it. Never force. |

## 3. Codebase facts (verified at 5.2.1; don't re-derive)

### 3.1 Build and run

- **Build:** `npm ci && npm run compile` at the repo root produces `out/`. It
  doesn't download Electron.
- **Browser mode:**
  `PORT=4173 HOME=/home/jane … node out/node/server/cli.js` serves the UI and
  API on `127.0.0.1`, and rejects any Host or Origin that isn't localhost.
- **Open a repository directly** at
  `http://127.0.0.1:4173/?repo=<encodeURIComponent(path)>`. Without `?repo`,
  the first entry in `recentRepos` opens automatically.
- **CLI, TUI and MCP:** `node scripts/multi-git.cjs <command>`, which needs
  the compile step. Set `MULTI_GIT_URL=http://127.0.0.1:4173` so they share
  the browser-mode backend: one set of repository locks, and CLI actions show
  up in the GUI's Terminal panel. `node scripts/multi-git.cjs help` prints the
  command catalogue.

### 3.2 Isolation

Every app, CLI, `git` and `ssh-keygen` process gets the environment
`scripts/gui-smoke.mjs` uses, with `HOME` set to the fake home:

```text
HOME=/home/jane  USERPROFILE=/home/jane  GH_CONFIG_DIR=/home/jane/gh
GH_TOKEN=  GITHUB_TOKEN=  GH_ENTERPRISE_TOKEN=  GITHUB_ENTERPRISE_TOKEN=
GIT_CONFIG_NOSYSTEM=1  GIT_CONFIG_GLOBAL=/home/jane/.gitconfig
SSH_AUTH_SOCK=  GIT_TERMINAL_PROMPT=0
```

Create `/home/jane` so that UI paths read `/home/jane/code/acme-api`. In the
demo repos, set `commit.gpgsign false`.

### 3.3 The configuration file

The file is `$HOME/.multi-git-client-config.json`, and its shape is in
`src/shared/config-types.ts`. Seed it **before** starting the server:

```jsonc
{
  "recentRepos": ["/home/jane/code/acme-api", "/home/jane/code/acme-web", "/home/jane/code/dotfiles"],
  "sshProfiles": [
    { "id": "personal", "label": "Personal", "privateKeyPath": "/home/jane/.ssh/id_ed25519_personal",
      "userName": "Jane Doe", "userEmail": "jane@example.com", "verifiedAccount": "jane-personal" },
    { "id": "work", "label": "Work", "privateKeyPath": "/home/jane/.ssh/id_ed25519_work",
      "userName": "Jane Doe", "userEmail": "jane@acme.example", "verifiedAccount": "jane-acme" }
  ],
  "accountRules": [
    { "id": "r1", "match": "github.com/acme/", "profileId": "work" },
    { "id": "r2", "match": "github.com/jane/", "profileId": "personal" }
  ],
  "repoSettings": {},
  "settings": { "manageSshConfig": false, "checkForUpdates": false,
                "restoreWindowsOnStartup": false, "autoPull": false },
  "repoGroups": [ { "id": "g1", "label": "Acme", "order": 0, "repos": [] } ],
  "externalAgents": [ /* Claude Code, Codex and Gemini CLI: shape below */ ]
}
```

- **`verifiedAccount`** is normally learned from a network verification.
  Seeding it is what makes the account states capturable offline.
- **`repoSettings` and `repoGroups[].repos`** are keyed by canonical identity
  (the realpath). Fill them through the API (§3.4), not by hand.
- **`externalAgents` entries** have this shape:
  `{ id, label, executable, args, terminal: "system-terminal", enabled: true, promptMode, catalogueId }`.
  The catalogue IDs are `claude`, `codex`, `gemini`, `copilot`,
  `cursor-agent`, `aider` and `qwen` (see `src/shared/agent-catalogue.ts`).
  Seed Claude Code, Codex and Gemini CLI.

### 3.4 The API

Requests and responses are JSON. Repository-scoped routes take the header
`x-repo-path: <path>`. Before calling a route, read its file in
`src/server/routes/` for the exact body.

| Call | Does |
| --- | --- |
| `POST /api/config/repo` `{repoPath}` | Adds the repo to the recent list |
| `POST /api/config/ssh/repo-setup` `{repoPath, profileId}` | Selects the repo's account, as the header dropdown does |
| `POST /api/config/repo-settings` `{repoPath, intendedAccount}` | Sets the account an organisation repo belongs to (`jane-acme` for acme-api) |
| `POST /api/config/account-rules` `{match, profileId}` | Adds an Auto-select rule |
| `POST /api/repo-groups` | Creates or edits a repository group (`groups.routes.ts`) |
| `GET /api/git/diff/structured?path=…&source=working-tree` then `POST /api/git/diff/apply-selection` `{action, filePath, lineIds}` | Stages or discards selected lines |
| `POST /api/git/commit`, `POST /api/git/reset`, `POST /api/git/delete-branch`, `POST /api/git/discard` | Commit, reset, branch deletion, discard. These create Safety Net checkpoints, recovery points and Recently Discarded copies. |
| `GET /api/git/recovery`, `POST /api/git/recovery/restore` | Recovery points and reflog; restore |
| `GET /api/git/rebase/plan?onto=…&autosquash=true`, `POST /api/git/rebase/start`, `/step`, `/split` | The rebase planner |
| `POST /api/worktrees` | Creates a worktree |
| `GET /api/logs/stream` | See §3.5 |

### 3.5 Terminal-panel records (for scene F)

`GET /api/logs/stream` is a server-sent event stream. Its first event,
`backlog`, is a JSON array of up to 2,000 `LogEntry` records:
`{seq, ts, type, text, repoPath?, command?}`.

Each `command` is `{argv, cwd, env?, kind: "read" | "write", durationMs?, exitCode?}`
(see `src/shared/log-types.ts`). Scene F shows **only `kind: "write"`**
commands, which are what the panel shows when its **Reads** toggle is off.

To collect them: run the scene-like actions through the API against
`~/code/acme-api`, then read the backlog and save it. Afterwards, restore the
clean state: **stop the server first** (it caches the config), re-run
`make-demo-world.mjs`, then restart the server. At minimum, run these actions:

- the account switch
- stage selection
- discard selection
- a commit
- a reset
- a restore
- a worktree add

### 3.6 Opening any window in the GUI

Press `Ctrl+K` (or `Ctrl+Shift+P`), type the title, and press Enter. The real
titles:

| Title | Shortcut |
| --- | --- |
| Search commits | `Ctrl+Shift+F` |
| Compare two refs | |
| Commit signing settings | |
| Interactive rebase (plan commit by commit) | |
| Branch maintenance | |
| Recovery points and reflog | |
| Stage everything | `Ctrl+Alt+S` |
| Fetch / Pull / Push | `Ctrl+Alt+F` / `Ctrl+Alt+P` / `Ctrl+Alt+U` |
| Create a pull request | |
| Go to the Staging Area / File Diff tab / Explorer | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` |
| Manage SSH profiles | |
| Manage worktrees | |
| Launch a coding agent here | |
| Coding agent settings | |
| Manage remotes / Manage submodules / Git LFS / Bisect / Git notes | |
| Create or apply a patch | |
| Repository maintenance | |
| Open the Terminal Log | |
| Settings | |
| Show or hide the branches panel / the commit history | `Ctrl+B` / `Ctrl+Shift+B` |
| Refresh everything | `F5` |

### 3.7 Where the README is out of date (the code wins)

- **No "stash selection" in the GUI.** Partial stash exists only in the API
  (`POST /api/git/stash` with `selections`).
- **The rebase planner:** each row has an action `<select>` (pick, reword,
  edit, squash, fixup, drop) and **Move earlier** / **Move later** arrow
  buttons. There's no drag and drop. Dropped rows get the `rebase-dropped`
  class.
- **Conflict buttons** read **Use HEAD (Ours)** and **Use Incoming (Theirs)**.
- **The SSH window** has a section titled **Auto-select rules** with an
  **Add Rule** button, and key forms titled **Add an Existing Key** and
  **Generate a New SSH Key**.
- **The selection bar** reads *N lines selected*, then **Stage selection**,
  **Unstage selection**, **Discard selection** and **Clear**.
- **Real dialog copy** for Account mismatch, Merge, Restore and Split is in
  the spec's Fact sheet. Use it verbatim.

### 3.8 Desktop-only features, and an optional Electron path

Launching a coding agent (desktop IPC), running bisect commands, and Explorer
integration exist only in the desktop app. If the **Launch a coding agent**
window can't be captured in browser mode, rebuild it from its markup.

**Optional, at most 8 tool calls:** capture it from real Electron instead.

1. Run `node scripts/ensure-electron.mjs`. The Electron download comes from
   GitHub release assets, which the allowlist permits.
2. Launch it the way `scripts/gui-smoke.mjs --launch` does: executable
   `node_modules/electron/dist/electron`, arguments
   `[repoRoot, --user-data-dir=/home/jane/.electron, --force-device-scale-factor=2]`,
   under `xvfb-run -a -s "-screen 0 1920x1200x24"`.
3. Drive it with `playwright-core`'s `_electron.launch({ executablePath, args, env })`.

### 3.9 Account states, offline

With the seeded config from §3.3:

1. Select **Personal** on acme-api (`POST /api/config/ssh/repo-setup`).
2. Press **Push** (`Ctrl+Alt+U`).

The real **Account mismatch** dialog appears with no network involved.
Capture it, then click **Cancel**. Never confirm it.

The **Wrong account** dialog needs to reach the host, so don't try to capture
it. The repo's account note (*This key authenticates as jane-personal, but
this repository belongs to jane-acme…*) appears in the SSH Key dropdown.

### 3.10 The logo

`docs/images/multi-git_icon.svg` has a 2048 viewBox and three shapes:

- a circle with r 819, fill `#3B3E8D`
- two **filled** paths, fill `#6A69EB`:
  - the right path is the right arrow plus the trunk, which runs down to
    y 1518
  - the left path is the left arrow and a branch that tucks under the trunk

The shapes are filled, not stroked. See §5.5 for how to draw them on.

## 4. Milestones

Tick each one in `NOTES.md` as it lands, then commit and push.

**M0: orient.**
- Read the spec and this file in full.
- Check `NOTES.md` for a progress log, and resume if one exists.
- Record the branch name.
- Create `promo/NOTES.md` with the skeleton from §8.
- Commit: `promo: start notes`.

**M1: environment.**
- Check the Node version.
- At the root: `npm ci && npm run compile`.
- Create the `promo/` package (§5.1–5.2) and install its dependencies.
- Run `npx remotion browser ensure` and the Puppeteer download.
- Install Remotion's skills if that's cheap (§5.3).
- *Exit when* `npx remotion compositions` lists a placeholder composition.
- Commit: `promo: scaffold the Remotion project`.

**M2: the demo world and captures.** Write these scripts in
`promo/capture/`:

- `make-demo-world.mjs`: builds the spec's "Assets and demo data", including
  every item under **State the storyboard depends on**, since the copy's
  numbers must come out true. It also writes the §3.3 config.
  - Idempotent and deterministic: fixed dates relative to now, and a seeded
    order.
  - No network.
  - Generate the ed25519 keys inside the fake home.
  - Seed the recovery point and the Recently Discarded entry through the API
    once the server is running.
- `start-app.mjs`: starts browser mode with the isolated environment on port
  4173.
- `capture-gui.mjs`: Puppeteer, viewport 1600×1000, `deviceScaleFactor: 2`,
  waiting for fonts. **First confirm one shot shows real icons**, then
  capture the list below.
- `capture-cli.mjs`: runs the JSON CLI (`status`, `history`, `ssh.inspect`,
  and a guided command with `--dry-run`).
- The TUI: in tmux at 120×34, run `tui --repo …`, send `Space`, `j`, `k` and
  `v`, save each state with `capture-pane -p -e`, and convert the ANSI to
  `{text, fg, bg, bold}` spans.
- The MCP transcript: spawn `mcp` and send `initialize`,
  `notifications/initialized`, `tools/list`, then one `tools/call`
  (`status`). Save it.
- The Terminal-panel write commands (§3.5).

GUI captures, at minimum:

- the workspace mid-work (Staging Area plus History lanes)
- File Diff in split view with selected lines and the selection bar
- the image diff
- the SSH Key dropdown (Personal/Work, including the account note)
- the SSH window's Auto-select rules
- the Account mismatch dialog
- Safety Net and Recovery points, plus the Restore confirm
- the rebase planner with rows, plus the Split confirm
- the Worktrees section and the Manage worktrees window
- the Terminal panel (Reads off)
- the command palette
- the merge preview dialog
- Remotes, LFS and Bisect in the Repository hub
- the coding-agent launch window (or its rebuild)

Save everything to `promo/assets/captures/` as WebP or JPEG, with a
`manifest.json` recording each file, what it shows and how it was made. Keep
the total at 25 MB or less.

- *Exit when* the manifest is complete and the privacy scan is clean.
- Commit: `promo: capture the demo world and real UI/CLI output`.

**M3: timing and audio.**
- `promo/src/timing.ts` plus `promo/timing.json`: the grid, and each
  composition's arrangement as a list of `{section, fromBar, toBar}`.
- `promo/audio/synth.mjs` (§5.8): renders one music WAV per composition plus
  the SFX WAVs.
- Check the loudness numbers, and look at one waveform-plus-spectrogram image
  with bar gridlines.
- Commit: `promo: synthesize the score and sound effects`.

**M4: the scaffold and primitives.**
- Register the compositions and the zod props schema.
- Theme tokens from the spec, fonts, and the scoped app CSS (§5.4).
- The primitives (§5.5).
- The `npm run check` script (§5.6).
- *Exit when* `tsc` is clean, the 4 compositions are listed, and **one** sheet
  shows every primitive.
- Commit: `promo: add the motion primitives`.

**M5: the rough cut.**
- Build every master scene in storyboard order, using the spec's exact copy,
  bars and SFX placement.
- *Exit when* the review overview renders with no errors and no blank
  stretches.
- Commit: `promo: rough cut of the master`.

**M6: review round 1 and hero polish** (§6). Polish the hero moments:

- the cold open
- the drop and logo fusion
- A's Account-mismatch catch
- B's line selection
- C's rewind
- D's split
- F's twist
- the stinger
- the end card

Commit: `promo: review round 1`.

**M7: review round 2**, plus polish for the montage, the two-lanes beat and
the checklist. Commit: `promo: review round 2`.

**M8 (optional): review round 3.** Commit: `promo: review round 3`.

**M9: the cutdowns.**
- Build `Promo30`, `Vertical` and `ReadmeGif` exactly as the spec's Cutdowns
  section lays them out, each with its own arrangement and counter.
- Make one overview sheet per cut.
- Commit: `promo: cutdowns`.

**M10: docs, checks and the final push.** Covered by §7 and §8. Commit:
`promo: docs and final checks`.

## 5. Build guidance

### 5.1 Layout

```text
promo/
  package.json  package-lock.json  remotion.config.ts  tsconfig.json  .gitignore
  README.md  NOTES.md  CLOUD_PROMPT.md  timing.json
  capture/                 make-demo-world, start-app, capture-gui, capture-cli, ansi-to-spans
  audio/                   synth.mjs (+ a small dsp.mjs)
  scripts/                 review.mjs, check.mjs, render-gif.mjs, build-app-css.mjs
  public/                  fonts/, audio/ (generated, gitignored), captures used by the video
  src/
    index.ts  Root.tsx  timing.ts  schema.ts  theme.ts
    ui/                    app.scoped.css (generated) + faithful UI pieces
    primitives/            SpellStack, Counter, LaneTrails, LogoMerge, KeyCap, Card, Terminal, Camera, Grain
    scenes/                ColdOpen, Lanes, Reveal, A..F, Montage, TwoLanes, Stinger, EndCard
    compositions/          Promo, Promo30, Vertical, ReadmeGif
  assets/captures/         real captures + manifest.json
  review/round-N/          contact sheets (committed)
```

`.gitignore` covers `node_modules`, `out`, `review/tmp`, `public/audio/*.wav`,
`.claude/`, `.agents/` and `.cache/`.

### 5.2 Packages

- **Remotion:** the latest 4.0.x of `remotion`, `@remotion/cli`,
  `@remotion/bundler`, `@remotion/renderer`, `@remotion/zod-types`,
  `@remotion/paths`, `@remotion/shapes`, `@remotion/layout-utils`,
  `@remotion/motion-blur`, `@remotion/noise` and `@remotion/fonts`, all pinned
  to the same version.
- **React:** `react` and `react-dom`, at the versions Remotion supports.
- **zod:** install the major version `@remotion/zod-types` names as its peer.
  Don't guess it.
- **Fonts:** `@fontsource-variable/inter`, `@fontsource/jetbrains-mono`, and
  `material-symbols`.
  - Copy the Inter and JetBrains Mono files into `public/fonts/` and load
    them with `@remotion/fonts`.
  - Import `material-symbols/outlined.css` once. It defines the
    `.material-symbols-outlined` class that the app's markup uses.
  - Nothing depends on the network, and every render waits for
    `document.fonts.ready`.
- **Dev:** `puppeteer`, `playwright-core` (only if you use Electron), `postcss`,
  `postcss-prefix-selector`, `typescript`.
- **npm scripts:** `studio`, `render`, `render:prores`, `render:30`,
  `render:vertical`, `render:gif`, `render:review`, `audio`, `check`,
  `capture`. They must work unchanged on Windows: plain Node, `path.join`,
  and no bash.

### 5.3 Remotion's agent skills (optional, at most 3 calls)

From inside `promo/`, run `npx remotion skills add`. If that fails, try
`npx skills add remotion-dev/skills`. Read the `remotion-best-practices` skill
file, then **only** the rule files for what you're building: animations and
springs, sequencing, audio, fonts, transitions, measuring text,
`calculateMetadata`, and parameters/zod. Keep the installed files out of git.
If both installs fail, skip this step.

### 5.4 A faithful UI, cheaply

Don't hand-draw the app. Reuse its real stylesheet and markup:

- **The stylesheet:** `scripts/build-app-css.mjs` runs `../public/style.css`
  through `postcss-prefix-selector`, prefixing every rule with `.mg-app` and
  mapping `:root`, `html` and `body` to `.mg-app` itself. The output is
  `src/ui/app.scoped.css`, which is imported once, so the real CSS applies
  only inside `<div className="mg-app">`.
- **The markup:** port the fragments you need from `../public/index.html` into
  TSX: the header, the sidebar sections, the Staging Area, the diff pane and
  selection bar, the History list, the dialogs, and the Terminal panel. Keep
  their ids and classes, and drive their state from props and frame.
- **Icons:** the markup uses `material-symbols-outlined` ligatures, which the
  local Material Symbols font renders.
- **Checking fidelity:** round 1 of the review includes one sheet placing a
  capture beside your rebuild of the header and Staging Area.
- **Screenshots:** captures may be used as plates for wide shots. Anything
  that animates must be the live rebuild.

### 5.5 Primitives

- **`SpellStack`:** takes lines, a start frame and a target rect.
  - Types the first line at about 45 characters per second, then floods the
    rest with the gap shrinking from 6 frames to 1, all within 45 frames.
  - Collapses on its cue: 8 frames of expo-in into the target rect, with a
    streak trail, then triggers the target's pulse (scale 1 → 1.08 → 1 over
    6 frames, plus an indigo glow).
  - Measure mono text with `@remotion/layout-utils` so lines never overflow.
- **`Counter`:** split-flap digits (a 4-frame flip per digit, 2-frame stagger)
  showing `commands you didn't type: N`. It gets its value from the timeline.
  It has a *crack-open* state for scene F and a *hero* state for the stinger.
- **`LaneTrails`:** two glowing paths, `#06b6d4` and `#6366f1`. The head
  leads, the tail fades, and the glow comes from pre-rendered gradient
  sprites. Lanes carry the transitions (wipes along the lane) and the labels.
- **`LogoMerge`:**
  - The logo paths are filled, so draw them on by animating **thick centreline
    strokes** (`evolvePath` from `@remotion/paths`) that act as an **SVG mask**
    over the real filled paths from the SVG.
  - Order: the trunk grows up from the bottom, then forks, then the arrowheads
    pop on a spring, then the disc scales in behind.
  - The lanes' colors blend into `#6A69EB` as they arrive.
  - Offer a fast variant for the end card.
- **`KeyCap`:** the spec's keycap style, with a press animation of 3 frames
  down and 4 frames up.
- **`Card`:** the montage card: label, control snapshot, struck command.
- **`Terminal`:** renders ANSI spans, and captured records such as `argv`,
  `cwd`, exit code and duration, as crisp text.
- **`Camera`:** a 2D transform wrapper with drift, beat punch-ins, and
  whip-pans that use `@remotion/motion-blur`'s `CameraMotionBlur` sparingly.
- **`Grain`:** deterministic 2–3% noise (`@remotion/noise`) with a subtle
  vignette.

### 5.6 Props and `npm run check`

- **The zod schema** exposes:
  - every on-screen string (headlines, spells, montage cards, checklist, URL)
  - colors (`zColor`)
  - scene lengths in bars
  - music and SFX volume
  - `showCounter`

  The defaults are the spec's values, and Studio can edit them.
- **Compositions** derive their duration from their arrangement
  (`calculateMetadata`).
- **`scripts/check.mjs`** runs `tsc --noEmit`, then checks:
  1. **Counter math:** each composition's final counter equals the sum of its
     spells under the spec's counting rule, and equals the number in its
     stinger copy (45, 17 and 15).
  2. **Banned phrases** across the default props: "the only", "first ever",
     "unlike other", "backup", "never lose", "AI-powered", "Supercharged",
     "Keep ours", "Stash selection", and any rival name.
  3. **Privacy** across `promo/src`, `promo/public`, `promo/assets` and
     `promo/review` (the Markdown docs are exempt, since they describe these
     rules): no private-key headers, no container paths (`/root/`, `/tmp/`,
     `/workspace/`) and no Windows drive paths in captures or props, and no
     email address outside the spec's cast.

  It exits non-zero on any failure.

### 5.7 Determinism and render speed

- **Determinism:** use `random(seed)` from `remotion`, never `Math.random()`.
  No wall-clock time, no network in components, and fonts and assets come via
  `staticFile()`.
- **Loading:** block rendering with `delayRender` until fonts and captures
  have loaded.
- **Speed:**
  - Avoid `filter: blur()` and `backdrop-filter` on large layers; use sprite
    glows.
  - Keep the DOM light, and limit simultaneous SVG masks to what's on screen.
  - Downscale capture plates to about 2× their on-screen size.
- **Color:** render H.264 with `--color-space=bt709` if the installed version
  supports it.

### 5.8 The audio synth (`audio/synth.mjs`)

Plain Node, no native modules: Float32 buffers written as 48 kHz stereo WAV,
driven by a seeded PRNG. It reads `timing.json` and renders one music file per
composition from its arrangement, following the spec's structure table and
sync points.

- **Instruments:**
  - kick: a sine sweep from about 150 Hz to 45 Hz with an exponential decay
  - clap: three noise bursts through a band-pass
  - hats: high-passed noise
  - sub: a sine an octave below the root, with **sidechain ducking** keyed to
    the kick
  - chord stabs: a supersaw (7 detuned saws through a low-pass)
  - arp: 16ths with a filter sweep
  - riser: rising noise plus pitch
- **Structure:**
  - The cold-open dropout at bar 2, beats 3–4.
  - **Tape-stop and reverse** at bar 20, beats 3–4: resample the mix buffer
    with a playback rate that falls to 0, then add a reversed cymbal.
  - **Hard silence** on bar 40, then **one massive hit** at frame 2400.
  - F minor throughout, resolving to **F major** on the end card.
- **SFX:** separate WAVs (the list is in the spec), placed in Remotion with
  `<Sequence>` at their events, so re-timing a scene moves its sounds with it.
- **Finishing:**
  - Soft-clip, then a gentle limiter.
  - Normalize with two-pass ffmpeg `loudnorm` to I −14, TP −1, LRA 11.
  - Check with `ebur128=peak=true`.
  - Render one PNG for the whole mix (`showwavespic` above `showspectrumpic`,
    with 45 bar gridlines), and confirm the drop, the tape-stop and the
    stinger silence sit at the right bars.
  - Keep content above 8 kHz gentle.
- **The mix preview:** `review/mix-preview.mp3` at 128 kbps, with music and
  SFX. Use an audio-only Remotion render if it's quick; otherwise mix with
  ffmpeg `adelay` + `amix` from the SFX event list.

## 6. The review loop: cheap, visual, at most 3 rounds

`scripts/review.mjs` bundles once with `@remotion/bundler`, opens one browser
(`openBrowser`), calls `selectComposition` once, then renders a frame list
with `renderStill` (`puppeteerInstance` reused, JPEG). It names each file by
its zero-padded frame number (`f0420.jpg`) so the tiles sort in order, then
tiles them with ImageMagick:

```text
montage review/tmp/*.jpg -tile 10x -geometry +4+4 -background '#0a0c10' -fill '#9ca3af' -label '%t' review/round-N/sheet-1.jpg
```

Each round produces 6 images or fewer:

1. **Overview:** every 15th frame (2 per second) at scale 0.2, tiled into
   3 sheets. It covers the whole film: pacing, blank frames, overflow,
   off-screen text.
2. **Key frames:** about 16 frames at scale 0.5 (each hero moment at its
   peak, every headline mid-hold, the stinger, the end card), in 1–2 sheets.
   Check typography, contrast, overlap, spelling, and copy against the spec.
3. **Filmstrips:** one sheet of 3 rows of 12 consecutive frames at scale 0.3:
   a spell collapse, the logo fusion, and the Safety Net rewind. Check the
   easing, the overshoot and the timing.

Round 1 also includes the fidelity sheet (§5.4).

Commit the sheets as JPEGs of 1 MB or less in `promo/review/round-N/`. They
are how the owner previews your work.

**Checklist for every round:**

- Copy matches the spec verbatim.
- The counter math holds.
- Every cut and entrance lands on a beat.
- Nothing on the spec's "Avoid" list appears.
- No personal data or container paths.
- All text is inside the 5% title-safe margin (or the vertical safe zone).
- Contrast is at least 4.5:1.
- No flashing beyond the spec's accessibility rules.

After round 1 only, render one **smoke clip** with audio: frames 420–570 (the
drop) at scale 0.25 to `out/smoke.mp4`. Confirm with `ffprobe` that it has a
video stream and an audio stream. Don't commit it.

## 7. Checks before the final push

- In `promo/`: `npm run check` passes, and `npx remotion compositions` lists
  all four compositions.
- At the repo root: `npm run lint:links` passes. Relative Markdown links must
  resolve, and paths belong in code spans.
- Nothing outside `promo/` has changed. Run `git fetch origin promo/video-2`,
  then check that `git diff --stat origin/promo/video-2 HEAD -- . ':!promo'`
  and `git status --short -- . ':!promo'` both print nothing.
- Committed files under `promo/` total about 40 MB or less.
- Every milestone reached is ticked in `NOTES.md`, and each deviation is
  logged.

## 8. Deliverables

### `promo/README.md`: rendering and tweaking on the owner's Windows PC

- **Setup:** `cd promo`, `npm ci`, then `npm run studio` to preview and edit
  props live.
- **`npm run render`:** runs `audio` first, then renders
  `out/promo-1080p.mp4` with
  `--codec=h264 --crf=18 --pixel-format=yuv420p --audio-codec=aac --audio-bitrate=320k`,
  plus `--color-space=bt709` when available.
- **The other renders:**
  - `render:prores` uses `--codec=prores --prores-profile=hq`.
  - `render:30` and `render:vertical`.
  - `render:gif` renders a 720-wide MP4, then converts it with a two-pass
    ffmpeg palette (`palettegen` / `paletteuse`) at 15 fps, aiming for 10 MB
    or less.
  - `render:review` rebuilds the contact sheets.
- **Speed:** `--concurrency=50%` to tune; `--gl=angle` on Windows if canvas or
  WebGL effects are slow.
- **Where to change things:** copy, colors, bar lengths, music parameters,
  and the SFX volume.
- **The capture scripts** are for re-capturing on Linux. On Windows,
  re-capture is optional.

### `promo/NOTES.md`, in this order

1. **Line 1:** `Session branch: <name>`.
2. **Progress log:** M0–M10 checkboxes, each with a timestamp and its commit.
3. **Morning checklist:** 5 lines for the owner, covering what to watch first
   and what needs their judgment (music, pacing).
4. **The storyboard as built:** each scene's bar range and frames, plus any
   drift from the spec.
5. **The decision log.**
6. **Spec issues and deviations**, with reasons.
7. **Captured vs. rebuilt:** which UI came from where, and why.
8. **Known issues and TODOs**, ranked.
9. **Licenses:**
   - Remotion is free for individuals and companies of up to 3 people; check
     it applies.
   - Inter and JetBrains Mono are OFL, and Material Symbols is Apache-2.0.
   - The music and SFX are original, synthesized here.

### The final message of the session

Keep it short:

- What's done and what isn't.
- The session branch.
- The exact commands to fast-forward `promo/video-2` and to render.
- The top 3 things for the owner to look at first.
