Session branch: promo/video-2

# Multi-Git promo: build notes

## Progress log

- [x] M0 orient — 2026-09-25T02:43Z — `promo: start notes`
- [x] M1 environment — 2026-09-25T02:48Z — `promo: scaffold the Remotion project`
- [x] M2 demo world and captures — 2026-09-25T03:18Z — `promo: capture the demo world and real UI/CLI output`
- [x] M3 timing and audio — 2026-09-25T03:33Z — `promo: synthesize the score and sound effects`
- [x] M4 scaffold and primitives — 2026-09-25T03:46Z — `promo: add the motion primitives` (sheet: `review/m4-primitives.jpg`)
- [x] M5 rough cut — 2026-09-25T04:05Z — `promo: rough cut of the master`
- [x] M6 review round 1 and hero polish — 2026-09-25T04:19Z — `promo: review round 1` (sheets: `review/round-1/`; smoke clip 420-570 at 0.25 had H.264 + AAC 48 kHz stereo)
- [x] M7 review round 2 — 2026-09-25T04:28Z — `promo: review round 2` (sheets: `review/round-2/`, incl. `montage-cards.jpg`)
- [x] M8 review round 3 (optional) — 2026-09-25T04:35Z — `promo: review round 3` (sheets: `review/round-3/`)
- [ ] M9 cutdowns
- [ ] M10 docs, checks and the final push

Earlier sessions: none. This session started from `67963aa` on `promo/video-2`.

## Morning checklist

_(filled in at M10)_

## The storyboard as built

Master `Promo`, 30 fps, 2700 frames. Bars and frames match the spec exactly;
every cue is in `timing.json` (section-local `[bar, beat, offset]`).

| Section | Bars | Frames | Scene | Built as |
| --- | --- | --- | --- | --- |
| coldOpen | 1-4 | 0-239 | `ColdOpen` | Terminal card: `git push` half typed at frame 0, errors on 1.3 with shake, reset on bar 2, dim + "…wait." on 2.4, Vim flood + CONFLICT on bar 3, shatter into two trails on bar 4 with both lines |
| lanes | 5-8 | 240-479 | `Lanes` | Cyan/indigo trails with pulses, chips, pain cards (cyan beat 1, indigo beat 2), switcher jab on bar 8 |
| reveal | 9-11 | 480-659 | `Reveal` | Lanes dive into the trunk (bloom <= 40%, shake), `LogoMerge`, wordmark slam, tagline, app assembles per beat with graph lanes drawing, caption |
| sceneA | 12-15 | 660-899 | `SceneA` | Spell A -> SSH Key segment; Personal -> Work dropdown flip; Auto-select rules; acme-web on Work; Ctrl+Alt+U -> real Account mismatch (Work/Personal highlighted) -> Cancel -> stamp |
| sceneB | 16-18 | 900-1079 | `SceneB` | Spell B -> File Diff; 3 line clicks, selection bar count, Stage selection; console.logs -> Discard selection + caption; Ctrl+Enter; commit lands in History; diff; image diff |
| sceneC | 19-22 | 1080-1319 | `SceneC` | `git reset --hard HEAD~3` types; three History rows turn red and fall; shaky spell C -> recovery point -> real Restore confirm; rewind; emerald landing; new recovery point; 24 h card |
| sceneD | 23-25 | 1320-1499 | `SceneD` | Spell D -> real planner; Move earlier/later; squash/fixup/drop; Autosquash; edit stop "Split this commit" pulse (+9); real Split confirm; one node -> three; lease note |
| sceneE | 26-29 | 1500-1739 | `SceneE` | Spell E -> Worktrees section; rows fan out; windows; real Launch window cards light up and fly; three terminals (`claude`, `codex`, `gemini`); small text |
| sceneF | 30-32 | 1740-1919 | `SceneF` | Counter cracks, glyphs pour into the real Terminal panel, the film's real write commands appear; hover + Copy with cwd/exit/duration; lines; cyan glint; Ctrl+K -> real palette |
| montage | 33-37 | 1920-2219 | `Montage` | 20 cards, one per beat, real controls, struck commands; lane switch at 2070 |
| twoLanes | 38-39 | 2220-2339 | `TwoLanes` | Real merge preview (cyan); real TUI states + keycaps and a real MCP `tools/call` (indigo) |
| stinger | 40-41 | 2340-2459 | `Stinger` | True black, split-flap reshuffle lands on 45; hit at 2400: "You typed zero." with the 0 dropping in |
| checklist | 42-43 | 2460-2579 | `Checklist` | Questions struck and answered one per beat; three more checks |
| endCard | 44-45 | 2580-2699 | `EndCard` | Lanes sweep and fuse (fast `LogoMerge`), wordmark, tagline, Download free + URL, platforms; click at 2670 ticks the counter to 46 |

Lane sweeps carry every cut except into the stinger (hard cut to black).

## Decision log

- **Browser.** `npx remotion browser ensure` now downloads from
  `remotion.media`, which the Trusted allowlist blocks (403). Fallback from §2:
  Puppeteer's own Chrome Headless Shell (Chrome for Testing 154, fetched from
  `storage.googleapis.com` into `promo/.cache/puppeteer`) is passed to Remotion
  via `REMOTION_BROWSER`. `remotion.config.ts` reads it, so the owner's PC keeps
  Remotion's own browser.
- **Fonts.** Inter comes from `@fontsource-variable/inter` (latin + latin-ext
  files). JetBrains Mono comes from the official v2.304 GitHub release instead
  of `@fontsource/jetbrains-mono`, because the fontsource files are subset and
  lack the box-drawing and arrow glyphs the TUI and spells need. Both OFL.
- **zod.** `@remotion/zod-types` 4.0.528 declares no zod peer, but
  `@remotion/studio` 4.0.528 depends on `zod@4.5.4`, so zod is pinned to 4.5.4.
- **Audio tag.** `Html5Audio` from `remotion` (the old `Audio`); no extra
  `@remotion/media` package.
- **Puppeteer** is a dev dependency with its cache in `promo/.cache`, and
  `.puppeteerrc.cjs` skips its browser download on Windows (re-capture is a
  Linux job) unless `MG_CAPTURE=1`.
- **Remotion skills** installed with `npx remotion skills add` (kept out of git).
- **Demo world.** Dates are anchored to the start of the current UTC day, so
  same-day re-runs reproduce the same hashes. The Acme logo PNG is drawn by a
  tiny built-in PNG encoder (blue, recoloured orange in the working tree).
  `feature/login` forks at `main~2` (3 ahead, 2 behind, 5 files); the rebase
  range `main~5..main` is linear with a `fixup!` whose target is in range.
  Fake `refs/remotes/origin/*` refs give ahead/behind counts with no network,
  plus a remote-only `origin/feature/export` for the montage.
- **`ssh-keygen`** wasn't installed; `openssh-client` came from the Ubuntu
  archive. The keys live only in the fake home.
- **Safety Net's Recently Discarded** is stored under `os.tmpdir()`, so the
  isolated env sets `TMPDIR` inside the fake home (no `/tmp` paths, and
  rebuilds start empty).
- **Captures** are WebP plates plus the live DOM of each region
  (`assets/captures/dom/*.html`) and JSON from the API/CLI/MCP
  (`assets/captures/data/`). The rebuild renders the real DOM under the real
  (scoped) stylesheet and animates it, rather than hand-drawing the app.
- **Privacy scan** allow-lists addresses that ship in the app's own
  `public/index.html` (placeholder copy such as `jane@work.com`).
- **TUI keys:** Space, Escape, j, k, v were sent. `s` would stage a file, so it
  appears only as a keycap in the film.
- **Timing is data.** `timing.json` holds the grid, each composition's
  arrangement, and for every section its named cues (`[bar, beat, offset]`),
  its SFX rows and its counter events. The synth, the Remotion scenes, the SFX
  placement and `npm run check` all read it, so re-timing a scene moves its
  sounds and counter ticks with it.
- **Audio mastering.** The synth masters in JS (BS.1770-4 integrated loudness,
  4x-oversampled true-peak estimate, lookahead limiter), so `npm run audio`
  works on a Windows PC with no ffmpeg. When ffmpeg is on the PATH it also runs
  `loudnorm` pass 1 and applies pass 2 (linear) only if the file drifted more
  than 0.3 LU; today pass 1 reads -14.6 LUFS, so pass 2 is skipped.
- **Music is mastered to -14.5 LUFS / -2 dBTP, not -14 / -1**, so the finished
  mix (music plus the SFX Remotion adds) lands on the delivery target:
  `review/mix-preview.mp3` measures -14.1 LUFS integrated, -1.0 dBTP. The music
  dips 10 dB under the lead SFX (collapse thunks, drop impact, oops boom,
  stinger hit), which lead; other SFX sit 6-12 dB under. Energy above 8 kHz is
  -30 dB relative to the full band.
- **The mix preview is mixed in JS** from the same SFX event list Remotion uses
  (identical frames and volumes), then encoded with ffmpeg, instead of a
  100-input `adelay` + `amix` graph.
- **UI rebuild.** `scripts/build-app-css.mjs` scopes the app's real
  `public/style.css` under `.mg-app`; `scripts/build-snapshots.mjs` turns the
  captured DOM into `src/ui/snapshots.generated.ts`. `AppSnapshot` renders a
  snapshot under that CSS and an `apply(root, frame)` callback sets per-frame
  state on the real nodes (classes, text, transforms), deterministically.
- **Counter** values come from `src/counter.ts` (timeline ticks derived from
  `timing.json` counter rows and the spell copy); `npm run check` recomputes
  the same totals in plain JS.
- **Viewport units.** The app's CSS sizes dialogs in `vw`/`vh`, which in
  Remotion resolve against the 1920x1080 frame. `build-app-css.mjs` converts
  them to px for the 1600x1000 app window (a separate postcss pass, so no rule
  is prefixed twice), and the app window has a transform so `position: fixed`
  dialogs centre on the app, exactly as in the captures.
- **SSH agent rows hidden.** The capture container had no SSH agent, so the
  SSH Key dropdown showed "Agent: unreachable" in red. The film hides those
  rows (`hideAgentRows`) so the shot stays on the account rows.
- **Counter** steps aside during the two-lanes beat (the merge preview needs
  the top-right) and during the stinger, which shows it huge.
- **Collapse choreography:** the stack lands on the control first, then the
  camera pushes in 6 frames later, so the pulse sits on the real control.
- **Word-level diff.** The storyboard's quick flex needs a modified line, so
  the demo world also changes one line of `src/handlers/health.ts` (a fourth
  working-tree change; the spec's listed state is unchanged). Its split diff
  (`worddiff`) shows the app's real `diff-word-changed` highlights; the image
  diff shows the app's own checkerboard.
- **Hashes are read from the capture.** The restore hash and the reset target
  come from the captured Restore confirm, so re-capturing on another day keeps
  the film consistent.
- **Whip pans.** Every cut except into and out of the stinger is a 6-frame
  whip (3 out, 3 in, right to left with the lanes) under `CameraMotionBlur`
  (5 samples, only on those frames), with the lane sweep on top.
- The session's own branch is `promo/video-2` itself (`git branch --show-current`
  at the start), so the morning fast-forward is a no-op.

## Spec issues and deviations

1. **Brief §3.4, `POST /api/config/ssh/repo-setup`** does not select an
   account: it is a read-only preflight (`wouldOverwrite`). The header dropdown
   really calls `POST /api/config/ssh/apply-ssh-config` then
   `POST /api/git/identity`; the backend's own record (what the TUI reads) is
   `POST /api/workflows/ssh`. `selectAccount()` in `make-demo-world.mjs` does
   all three.
2. **Fact sheet, SSH Key dropdown:** "the rows Should use and Using (each with a
   Check button)". The app's markup has **Change** on *Should use* and
   **Check** on *Using*. The film follows the app (rule 2: real labels).
3. **Codex label.** The agent catalogue calls it "Codex CLI"; the spec names
   the card "Codex". The seeded `externalAgents` entry is labelled `Codex` (a
   user-editable label), so the real window says "Codex".
4. **Restore confirm title** is "Restore ref" in the app; the spec gives only
   the body. Real values: *Reset main back to 48b2e3ad? … anything committed
   since "Reset (hard) to 021fd393" goes with it.*
5. **Merge preview** in a dirty tree adds "Note: 3 uncommitted changes in
   tracked files…". The film omits that line (a clean tree doesn't show it).
6. **The rebase planner** rejects `HEAD~5` as a base ("a character Git does
   not allow in a ref"), so captures pass the resolved hash. The spell text
   still shows `git rebase -i HEAD~5`, which is what a user would type.
8. **Spell timing.** The spec asks for the first line to type at ~45 chars/s,
   the whole spell within 45 frames, a 1-beat hold, and the collapse on the
   next downbeat, with the spell on "beats 2-4". That leaves a 30-frame flood,
   and spell A's first line (62 chars) alone needs 41 frames at 45 chars/s.
   `SpellStack` types at 45 chars/s for up to 40% of the budget, then the rest
   of line 1 lands with the flood (gaps shrinking 6 -> 1, scaled to fit). The
   collapse starts on the downbeat and lands 8 frames later (thunk at +8,
   counter flips from +11).
9. **Spell text contrast.** Text dim `#6b7280` is 4.1:1 on `#0a0c10`, under the
   4.5:1 floor. Spell comments/prompts use `#8b94a3` (6.4:1) and command lines
   `#b8bfcc`; the dim token stays for non-text.
10. **The vertical hook** ("Splitting one Git commit takes nine commands.") is
    7 words, over the 6-word headline rule. It's the spec's verbatim copy, so
    it stays, set as a two-line hook.
11. **ReadmeGif runs at 30 fps** so the beat grid holds (a beat would be 7.5
    frames at 15 fps); `npm run render:gif` samples it at 15 fps.
12. **Montage card 18** says "Submodules → Update"; the app's button reads
    **Update all** (`src/renderer/features/submodules`). The card uses the real
    label.
13. **UI text vs. the 24 px floor.** The spec shows UI at 1.0-1.4x of a
    1600x1000 window (13 px app text becomes 13-18 px) but also says nothing
    is under 24 px. Film typography is >= 24 px; UI shots push in to 1.6-2.2x
    on the control that matters, and the UI is the picture, not copy.
7. **Browser mode can't open *Launch a coding agent*** (it needs
   `desktopApi.launchAgent`). The capture stubs only that function for the one
   step, so the real dialog renders; nothing is launched.

## Captured vs. rebuilt

Captured (real app, `npm run capture`): 25 WebP plates, 29 DOM snapshots and
19 data files; see `assets/captures/manifest.json`. Terminal records for scene
F come from `GET /api/logs/stream` after the scene-like actions (account switch,
stage selection, discard selection, commit, hard reset, restore, worktree add).
The TUI is real `multi-git tui` output in tmux, and the MCP exchange is a real
stdio transcript.

_(Which film shots use plates vs. the live rebuild: filled in at M5.)_

## Known issues and TODOs

_(none yet)_

## Licenses

_(filled in at M10)_
