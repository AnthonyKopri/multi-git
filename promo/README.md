# Multi-Git promo film

The second Multi-Git promo: a 90-second master plus three cutdowns, built with
[Remotion](https://www.remotion.dev/) from the spec in
[PromoSpecifications.md](../PromoSpecifications.md). Everything on screen is
generated here: the UI is the real app's captured DOM rendered under the app's
own stylesheet, and the music and sound effects are synthesized from code.

## Setup (Windows, macOS or Linux)

You need Node 22 LTS (Node 20 or newer works for rendering).

```sh
cd promo
npm ci
npm run studio
```

`npm run studio` synthesizes the audio if it's missing, then opens Remotion
Studio. There you can scrub every composition and edit its props live: every
on-screen string, the colours, scene lengths in bars, music and SFX volume,
and whether the counter shows.

## Rendering

| Command | Output | Notes |
| --- | --- | --- |
| `npm run render` | `out/promo-1080p.mp4` | The 90 s master. Runs `npm run audio` first, then H.264 CRF 18, `yuv420p`, BT.709, AAC 320 kbps |
| `npm run render:prores` | `out/promo-master-prores.mov` | ProRes 422 HQ with PCM audio (the mezzanine) |
| `npm run render:30` | `out/promo-30s.mp4` | `Promo30`, 30 s, 1920x1080 |
| `npm run render:vertical` | `out/promo-vertical.mp4` | `Vertical`, 20 s, 1080x1920 |
| `npm run render:gif` | `out/multi-git-promo.gif` | `ReadmeGif`: renders a 720-wide MP4, then a two-pass ffmpeg palette (`palettegen`/`paletteuse`) at 15 fps, aiming for 10 MB or less |
| `npm run render:thumbnail` | `out/thumbnail-1280x720.jpg` | The stinger frame, "You typed zero." |
| `npm run render:review` | `review/latest/` | Rebuilds the contact sheets (needs ImageMagick) |
| `npm run audio` | `public/audio/` | Re-synthesizes the music (one WAV per composition) and the SFX |

The render commands take extra Remotion flags after `--`, for example:

```sh
npm run render -- --concurrency=50%
npm run render -- --gl=angle
```

- **Speed:** tune `--concurrency` (try `50%` or a number of cores). On
  Windows, `--gl=angle` helps if canvas or WebGL effects are slow. The whip
  pans use motion blur for 6 frames per cut, so those frames render slower.
- **The GIF** needs ffmpeg on the `PATH` (or set `FFMPEG` to its path) for
  the palette pipeline; without it the script falls back to Remotion's own GIF
  encoder. If the GIF comes out over 10 MB, lower `max_colors` in
  [`scripts/render-gif.mjs`](scripts/render-gif.mjs).
- **Browser:** Remotion downloads its own Chrome Headless Shell on first use.
  If that host is blocked where you render, point `REMOTION_BROWSER` at any
  Chromium and `remotion.config.ts` will use it.

## Where to change things

| What | Where |
| --- | --- |
| Any on-screen copy | [`src/copy.json`](src/copy.json), or the `copy` props in Studio. `npm run check` re-counts the spells against the stinger numbers |
| Colours | The `colors` props in Studio; defaults in [`src/theme.ts`](src/theme.ts) |
| Timing: bars, cues, SFX placement, counter ticks | [`timing.json`](timing.json). Each section has named cues (`[bar, beat, frameOffset]`), its SFX rows and its counter rows. Change it, then run `npm run audio` so the music follows |
| Scene lengths (quick experiments) | The `sceneBars` props in Studio. These move the visuals only; the music follows `timing.json` |
| Music | `PARAMS` at the top of [`audio/synth.mjs`](audio/synth.mjs): loudness target, sidechain, levels, supersaw detune, seed. Then `npm run audio` |
| SFX volume | The `sfxVolume` prop (all SFX), or the per-event volume in each `sfx` row of `timing.json` |
| Music volume | The `musicVolume` prop |

After any change, run `npm run check`: it type-checks, re-counts the counter
math for every cut, scans the copy for banned phrases, and runs the privacy
scan.

## How it's built

- **UI:** [`scripts/build-app-css.mjs`](scripts/build-app-css.mjs) scopes the
  app's real `public/style.css` under `.mg-app`.
  [`scripts/build-snapshots.mjs`](scripts/build-snapshots.mjs) turns the
  captured DOM into `src/ui/snapshots.generated.ts`, and
  [`scripts/measure-ui.mjs`](scripts/measure-ui.mjs) records where each
  control sits. Scenes animate the real nodes frame by frame.
- **Timing:** one grid (120 BPM, 30 fps, 15 frames per beat) in
  [`timing.json`](timing.json), read by the scenes, the SFX placement, the
  counter and the synth.
- **Audio:** [`audio/synth.mjs`](audio/synth.mjs) (plain Node, seeded) masters
  each score in JS to about -14.5 LUFS and -2 dBTP, so the finished mix with
  SFX lands at about -14 LUFS and -1 dBTP. `npm run audio:check` (needs ffmpeg
  and ImageMagick) measures every file with `ebur128` and rebuilds
  [`review/mix-preview.mp3`](review/mix-preview.mp3).
- **Review:** [`scripts/review.mjs`](scripts/review.mjs) renders JPEG stills
  and tiles them into contact sheets (`review/round-N/`, `review/cutdowns/`).

## Re-capturing the app (Linux)

The capture scripts rebuild a fictional demo world in `/home/jane` and drive
the real app. They're for Linux (they need `git`, `ssh-keygen`, `tmux` and the
app built at the repository root); on Windows, re-capturing is optional.

```sh
# at the repository root
npm ci && npm run compile
# in promo/
MG_CAPTURE=1 npm ci        # downloads Puppeteer's Chrome
npm run capture            # demo world, GUI, CLI, TUI, MCP, privacy scan
node scripts/build-snapshots.mjs && node scripts/measure-ui.mjs
```

See `capture/` for each step, and `assets/captures/manifest.json` for what
every capture shows and how it was made.
