Session branch: promo/video-2

# Multi-Git promo: build notes

## Progress log

- [x] M0 orient — 2026-09-25T02:43Z — `promo: start notes`
- [x] M1 environment — 2026-09-25T02:48Z — `promo: scaffold the Remotion project`
- [ ] M2 demo world and captures
- [ ] M3 timing and audio
- [ ] M4 scaffold and primitives
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
- The session's own branch is `promo/video-2` itself (`git branch --show-current`
  at the start), so the morning fast-forward is a no-op.

## Spec issues and deviations

_(none yet)_

## Captured vs. rebuilt

_(filled in at M2 and M5)_

## Known issues and TODOs

_(none yet)_

## Licenses

_(filled in at M10)_
