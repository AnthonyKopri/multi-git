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
- [x] M9 cutdowns — 2026-09-25T04:41Z — `promo: cutdowns` (sheets: `review/cutdowns/`)
- [x] M10 docs, checks and the final push — 2026-09-25T04:43Z — `promo: docs and final checks`
- [x] R1.1 slower master timeline — 2026-09-25 — `promo: slower master timeline`
- [x] R1.2 scene C recovery emphasis and headline layout — `promo: scene C recovery emphasis and headline layout`
- [x] R1.3 natural cursor and real click targets — `promo: natural cursor and real click targets`
- [x] R1.4 opaque overlays and scene E layout — `promo: opaque overlays and scene E layout`
- [x] R1.4b end card — `promo: end card emphasis and longer hold`
- [x] R1.5 score for the new timeline — `promo: re-render the score for the new timeline`
- [x] R1.6 review, 2 rounds — `promo: revision 1 review` (sheets: `review/revision-1/`)
- [x] R1.7 docs and the final push — 2026-09-25T06:15Z — `promo: revision 1 docs`

Earlier sessions: none. This session started from `67963aa` on `promo/video-2`.

## Morning checklist

1. Pull `promo/video-2`, then run `cd promo && npm ci && npm run render`.
   You get `out/promo-1080p.mp4`, the 2:10 master (3,900 frames). This
   session saw it only as contact sheets (`review/revision-1/`) and one
   3-second smoke clip.
2. Watch it start to finish. Look hardest at:
   - **scene C (0:46-0:58):** the VHS rewind, then bar 4 on the restored
     commits;
   - **scene D (0:58-1:10):** the cursor on real controls, and the reorder;
   - **scene E (1:10-1:22):** the Worktrees section, the windows and the
     Launch modal;
   - **the end card (2:00-2:10).**
3. Judge the pacing, especially A and B (see Revision 1's deviations). Retime
   in `timing.json`, then run `npm run audio`.
4. Listen for the new tape whir under the rewind and the end chord decaying
   into the fade (`review/mix-preview.mp3` is a quick listen). The knobs are
   `PARAMS` in `audio/synth.mjs` and the SFX volumes in `timing.json`.
5. Render the cuts (`render:30`, `render:vertical`, `render:gif`). Their
   timing is unchanged, but they share the fixed scene code.

## Revision 1

The owner rendered and watched the first master and asked for eight things
(`REVISION_1.md`): slower and readable, a bigger recovery moment, the 00:43
headline overlap, scene D's cursor and highlights, scene E's layer
compositing, accidental glitches, a bigger and longer end card, and a darker
spell plate. This revision answers all eight. The music's character and the
undo sequence are kept. The cutdowns keep their timing.

**Bar and frame numbers:** the master's bar and frame numbers in
`PromoSpecifications.md` are superseded by the table below. The spec's copy
and order still apply.

### The new storyboard (master `Promo`, 65 bars, 3,900 frames, 2:10)

| Section | Bars | Frames | What changed |
| --- | --- | --- | --- |
| coldOpen | 1-5 | 0-299 | Errors hold 1-2.5 s. The silence runs from `…wait.` until the rebase (`dropoutUntil`). Shatter on bar 5, and the two lines hold to the cut |
| lanes | 6-10 | 300-599 | One pain pair per bar. The last pair clears before the questions, which land 2 beats apart over bars 9-10 under one riser |
| reveal | 11-14 | 600-839 | Both tagline lines hold for more than 1.5 s before the app assembles (bar 13, beat 4) |
| sceneA | 15-19 | 840-1139 | The Account mismatch dialog holds 2.5 s before Cancel, and the stamp holds 1.5 s. The dialogs open as modals |
| sceneB | 20-23 | 1140-1379 | Six real clicks at the natural cursor's pace. The caption holds 2.2 s. The quick flex (word diff, image diff) is cut; see the deviations |
| sceneC | 24-29 | 1380-1739 | The Restore confirm opens from a click, the cursor clicks Restore, and a VHS rewind plays. Bar 4 belongs to the restored rows, with the caption "3 commits. Back." The headline arrives on bar 5 and "Even the undo." sits below it |
| sceneD | 30-35 | 1740-2099 | Measured targets and one reorder. Squash, fixup, drop, Autosquash and Start rebase are each a real click, and so are Split this commit and the Split confirm. Then the hold |
| sceneE | 36-41 | 2100-2459 | The base shows the Worktrees section itself. The windows are opaque and framed, the Launch window is a modal, and the terminals rise over a covered stage |
| sceneF | 42-45 | 2460-2699 | A HeadlineBlock for "No black box.", then the lead and headline. The closing line gets a bottom scrim |
| montage | 46-51 | 2700-3059 | A conveyor: cards 1-10 centre on beats 2-11 and 11-20 on beats 14-23, each with a tick and a counter step. The lane switch and swell fall on beat 12 |
| twoLanes | 52-54 | 3060-3239 | The merge preview stays up all 6 s. The TUI keys start on bar 2 |
| stinger | 55-56 | 3240-3359 | Unchanged length. The number lands on beat 2 |
| checklist | 57-60 | 3360-3599 | One answer every 2 beats, then the hold |
| endCard | 61-65 | 3600-3899 | Hero fusion, then the settle with the wordmark and tagline, the CTA with a breathing glow, a click that ticks the counter to 46, and a still hold with a 2% push. Picture and sound fade over the last 20 frames |

The counter still adds up to 45 (+6 +3 +2 +9 +5 +20) and ticks to 46 on the
end card. The grid stays at 120 BPM and 60 frames per bar, and the synth's
`PARAMS` and instruments are unchanged.

### What changed, by the owner's notes

1. **Pacing.** Every master cue is re-placed by the reading rules. Holds grow;
   typing, the 8-frame collapses, pops, whips and the tape-stop keep their
   speed. The synth follows the new section lengths. The cold-open silence
   now ends at the rebase (a new `dropoutUntil` music parameter). The
   switcher jab spans two bars, with a snare per question and one riser. The
   checklist lift splits Db and Eb across its bars. The end section strikes
   the F chord again on bar 4 and lets it decay into the fade.
2. **The recovery.** Scene C follows the brief's cue plan. The rewind runs
   from the Restore click to the landing (`primitives/Vhs.tsx`). It shows a
   ◀◀ REW display, three tracking bands (`@remotion/noise`) and scanlines,
   with 2-4 px jitter, red and cyan fringe copies of the stage, and 45%
   desaturation. There are no flashes and no blur, and all of it is gone by
   the landing. A new `whir` SFX plays at 0.5 (about −6 dB). In bar 4 the
   camera pushes to 1.95x on the three restored History rows. Their emerald
   edge and glow hold for 2.9 s with one swell each, three soft `emerald`
   chimes play 4 frames apart, and "3 commits. Back." (`copy.sceneC.back`)
   sits beside the rows. The camera eases out as the headline arrives.
3. **00:43.** `HeadlineBlock` (in `scenes/kit.tsx`) stacks the headline and
   sub in normal flow with a 28 px gap. A headline shrinks 4 px at a time
   until it fits two lines (`@remotion/layout-utils`), and the scrim is
   sized to cover the block. Every scene uses it: C's headline and sub, and
   F's lead and headline. Every spell plate now sits 40 px below its scene's
   headline block. A 2-line headline used to overlap the plate.
4. **Scene D.** `measure-ui.mjs` measures each row's Move earlier and Move
   later buttons and its action select, plus Autosquash, Start rebase, Split
   this commit and the Split confirm. It gained `outer >> inner` selectors
   for this. The `Cursor` primitive was rewritten for every scene:
   - Stops live in app coordinates and are mapped through the camera every
     frame.
   - Moves follow a 10% arc with ease-in-out, over
     clamp(10 + d/60, 10, 24) frames.
   - The pointer arrives 5 frames early and dwells 6 after a click. The
     press is 3 frames at 0.88 with a ring.
   - Targets get a hover ring and a 12-frame flash, and results stay.

   The reorder slides the two rows by the measured 55 px pitch, with the
   moving row on top and both opaque. Then the DOM order becomes real.
5. **Scene E and compositing.** New rule: never draw one snapshot's content
   over another's. E's base expands the Worktrees section and scrolls the
   sidebar to it (`src/ui/edits.ts`, measured as `worktreesOpen`). Every
   dialog uses `ModalLayer`: the backdrop dims and blurs in and the card
   scales from 0.96, over 7 frames each way. That covers the SSH window,
   Account mismatch, recovery, Restore confirm, planner, edit stop, Split
   confirm, Launch window and palette. A's SSH Key dropdown fades and hides
   the base's segment under it. B's diffs and F's terminal panel are opaque
   and clipped, and B hides the staging view under the diff.
6. **Glitches.**
   - Glows shorter than 10 frames are gone: the counter's tick accent and
     the key-cap press glow now last 12 frames.
   - The montage no longer shakes on every bar.
   - The lanes' last pain card no longer slides over the first question.
   - The E terminals no longer cut in over the stage.
7. **End card.** See the table. The CTA row is laid out exactly
   (`measureText`), so the cursor clicks the real button. The URL and
   tagline are readable for 5.3 s and 5.8 s before the fade starts. `Film`
   fades picture, counter and grain to black over `fadeOutFrames` (20), and
   the synth fades the score over the same frames.
8. **The spell plate** is `rgba(8,9,13,0.98)`, about 15% darker than before
   and effectively opaque. A soft 35% scrim sits on the stage around it.
   The border, glow, text and collapse are unchanged.

Audio (`npm run audio`, then `node audio/check-audio.mjs`):
- The score is −14.5 LUFS and −2.3 dBTP.
- The preview mix with every SFX is **−14.2 LUFS and −1.2 dBTP**. To get
  there, F's Ctrl+K thock came down from 0.7 to 0.6 and A's alarm from 0.55
  to 0.5.
- The waveform with 65 bar lines shows the drop on bar 11, the tape-stop
  in bar 26 landing on 27, the stinger silence in bar 55 with the hit on
  56, and the end chord decaying into the fade.

Review: two rounds in `review/revision-1/` (`r1-*`, `r2-*`), 10 image views
in all. The smoke clip covers scene C from the rewind to the headline, at
0.25 and 3.1 s long. It has H.264 video and AAC 48 kHz stereo, and it isn't
committed.

### Deviations

- **The brief's own positions vs the reading rule.** A few lines sit where
  the brief placed them, and there they get less time than
  max(1.5 s, 0.3 s × words + 0.6 s):

  | Line | Readable | The rule |
  | --- | --- | --- |
  | Cold open: "It's also a spellbook." ([5,2]) | ~1 s | 1.8 s |
  | Lanes: each pain line (one pair per bar) | ~1.6 s | 2.1-2.4 s |
  | Lanes: the fourth question ([5,3]) | ~0.8 s | 2.1 s |
  | C: the 24-hour card ([6,2]) | 1.1 s | 2.4 s |
  | D: the lease note ([6,2]) | 1.1 s | 2.7 s |
  | E: the agents line ([5,3]) | 2.9 s | 6.6 s |

  The Restore confirm gets the 1 s the cue table gives it, not the 2.5 s
  dialog rule. The reveal caption gets 1.9 s (2.4 s). The two-lanes indigo
  caption gets 3.2 s (3.6 s). The stinger's "You just watched 45 commands."
  gets about 1.2 s.
- **Scene A** has nine beats in 5 bars, plus the 2.5 s dialog and 1.5 s
  stamp. The collapse moves to [1,4,10], the Auto-select window gets 1 s
  and the second repo about 0.6 s.
- **Scene B:** the natural cursor needs at least 21 frames between clicks
  (5 early, 6 dwell, 10 to move). Six real clicks plus the caption's
  reading time leave no room in 4 bars for the quick flex (word diff, then
  image diff), so the master drops those two cues. The scene still
  supports them. The three line clicks come about 0.7 s apart.
- **Clicks added so nothing pops:**
  - C: the recovery row's restore icon, at [2,4,12], opens the confirm.
  - D: Start rebase, at [4,4,5], opens the edit stop.
  - D: Split this commit is the click that opens the Split confirm.

  D's headline leaves at the collapse, so the camera can frame the planner
  at 1.6x without the headline over its title.
- **The planner's action select.** In the app, `select.rebase-action` picks
  up the app's full-width form rule. That pushes each row's subject and Move
  buttons out of the card: see `assets/captures/rebase-planner.webp`, where
  the rows only show `pick`. The film sizes it `width: auto` in
  `src/ui/promo.css`, which is what `.rebase-action` intends. See the TODOs.
- **Montage:** two or three cards show at once, as the brief asks. With one
  card per beat, that puts each card on screen for about 2.2 s, but fully in
  frame for about 1.4 s. The centre card is 0.78x and its neighbours are
  0.6x at 60%.
- **The fix sheet** samples every 10th frame, because 12 frames at every 4th
  wouldn't cover the spans. It's tiled 6×6 so the frames stay legible.

### TODOs

- **App:** give `select.rebase-action` in the rebase planner `width: auto`
  (or `flex: 0 0 auto`), so each row shows its subject and Move buttons.
  Then the promo.css override can go.
- **Owner:** judge A and B by eye. They're the densest scenes. If runtime
  allows, one more bar each would let the Auto-select window and the word
  and image diff flex breathe.
- **Owner:** listen to the tape whir (optional, `whir` at 0.5 in scene C's
  SFX) and the new end chord.


## The storyboard as first built (superseded by Revision 1 for the master)

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

Cutdowns (each with its own arrangement, music and counter in `timing.json`):

| Cut | Bars | Sections (scene/variant) | Counter |
| --- | --- | --- | --- |
| `Promo30` 1920x1080, 900 frames | 15 | coldOpen30 (1-2), jab30 (3), reveal30 (4-5), sceneA30 (6-8), sceneD30 (9-10), sceneC30 (11-12), stinger30 (13), endCard30 (14-15) | 6 -> 15 -> 17; "You just watched 17 commands." |
| `Vertical` 1080x1920, 600 frames | 10 | hookV (1: hook + D's spell), splitV (2: collapse into Split this commit), revealV (3), taglineV (4), sceneAV (5-6), stingerV (7: "15 commands."), endCardV (8-10) | 9 -> 15 |
| `ReadmeGif` 720x405, 600 frames at 30 fps (GIF at 15 fps) | 10 | logoGif (1), sceneAGif (2-3), sceneBGif (4-5), sceneCGif (6-7), sceneEGif (8-9), endCardGif (10) | none |

`Vertical` and `ReadmeGif` crop a window around the action out of the
landscape feature scenes (1:1 for the vertical, 0.75x for the GIF) and set
their own titles, so UI text stays readable; all vertical text sits inside
y 250-1550. The GIF's last frame matches its first (0.37% RMSE, grain only),
so it loops seamlessly on the logo.

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

**In the film, every UI shot is the live rebuild**: the captured DOM under
the app's own scoped CSS, animated per frame (selections, dropdown flips,
dialogs, row moves, new History and recovery rows). No screenshot plates
appear in the film. The WebP plates are references, and `workspace.webp` is
used once, in the dev-only `Fidelity` composition (review round 1), which puts
the capture beside the rebuild: they match.

Rebuilt rather than captured:

- The cold-open terminal, the spells, the montage cards' frames and the
  stinger/checklist/end-card typography are film graphics, not app UI.
- A few montage controls are built from the app's real classes and labels
  (Undo, Amend, Revert, Use HEAD (Ours) / Use Incoming (Theirs), Start bisect,
  Fetch all, Update all, Force Push (with lease), Delete merged branches), the
  rest are real captured rows and palette items.
- The Terminal panel in scene F is the captured panel with its body reduced to
  the film's eight real write commands (the account switch, stage selection,
  discard selection, commit, the hard reset, the restore, worktree add), in
  the app's own markup. cwd, exit code and duration come from the captured
  `LogEntry` records.
- The three agent terminals in scene E only show the command that started
  them and a cursor, as the spec asks.

## Known issues and TODOs

Ranked, most important first:

1. **Never seen in motion at full size.** The budget allowed stills, contact
   sheets and one 5 s smoke clip at 0.25 scale, so the first full render is
   yours. Watch for text overlaps during camera moves and any beat that feels
   late.
2. **The music is untested by ear.** Loudness, peaks and bar placement are
   measured (-14.1 LUFS / -1.0 dBTP for the mix; drop on bar 9, tape-stop on
   bar 20, silence on bar 40), but the balance and the sound design need a
   listen.
3. **UI text size.** UI shots push in to 1.6-2.2x, but some frames (the
   History panel in scene C, the terminal lines in scene F, the TUI) still
   carry app text around 20 px. Check on a phone, especially the vertical.
4. **The montage is fast by design** (a card per beat): each card is fully on
   screen for about 8 frames.
5. **Scene F's counter crack and glyph pour** are simple (a crack line and 28
   glyphs on arcs); a richer shatter would sell the twist more.
6. **The GIF's size is unmeasured** (no full renders here). `render:gif`
   prints it; lower `max_colors` if it's over 10 MB.
7. **Motion-blurred whips** render 5 samples for 6 frames per cut, which adds
   render time.
8. **`npm run render:review` needs ImageMagick** (`montage`, `identify`) on
   the PATH.
9. The spec's `docs/images/multi-git-promo.gif` should only be replaced once
   the new GIF is approved (not done here: files outside `promo/` are out of
   bounds for this session).

## Licenses

- **Remotion** is source-available under the Remotion License: free for
  individuals, non-profits and companies of up to 3 employees; larger
  companies need a company license. Check that this applies before
  publishing.
- **Inter** and **JetBrains Mono** are SIL Open Font License 1.1 (license
  texts in `public/fonts/`); **Material Symbols** is Apache-2.0.
- **The music and SFX** are original, synthesized here by `audio/synth.mjs`
  from a seeded PRNG. No samples are used.
- The captured UI is Multi-Git's own (MIT). All people, emails, keys and
  repositories in it are the spec's fictional cast.
