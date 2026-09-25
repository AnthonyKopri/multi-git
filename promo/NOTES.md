Session branch: promo/video-2

# Multi-Git promo: build notes

## Progress log

- [x] M0 orient — 2026-09-25T02:43Z — `promo: start notes`
- [x] M1 environment — 2026-09-25T02:48Z — `promo: scaffold the Remotion project`
- [x] M2 demo world and captures — 2026-09-25T03:18Z — `promo: capture the demo world and real UI/CLI output`
- [x] M3 timing and audio — 2026-09-25T03:33Z — `promo: synthesize the score and sound effects`
- [x] M4 scaffold and primitives — 2026-09-25T03:46Z — `promo: add the motion primitives` (sheet: `review/m4-primitives.jpg`)
- [ ] M5 rough cut
- [ ] M6 review round 1 and hero polish
- [ ] M7 review round 2
- [ ] M8 review round 3 (optional)
- [ ] M9 cutdowns
- [ ] M10 docs, checks and the final push

Earlier sessions: none. This session started from `67963aa` on `promo/video-2`.

## Morning checklist

_(filled in at M10)_

## The storyboard as built

_(filled in as scenes land)_

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
   the body. Real values: *Reset main back to e5e83a4b? … anything committed
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
