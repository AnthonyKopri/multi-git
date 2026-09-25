# Revision 1: pacing, the recovery moment, and three visual glitches

This is a revision pass on the finished film in `promo/`. The owner has
rendered the master locally and watched it. This file is your whole brief:

- Don't follow the milestones in `promo/CLOUD_PROMPT.md`.
- Don't rebuild anything that already works.
- The music and the undo sequence are loved, so don't change their character.

Work autonomously and never stop to ask. Log decisions in `promo/NOTES.md`
under a new **Revision 1** heading.

## What the owner said

1. **Too fast to read.** "I couldn't catch up with anything, almost." Give
   readable moments more time on screen. The owner suggested running about
   20% slower. Runtime isn't a constraint, because this isn't a paid ad.
2. **The recovery isn't emphasised.** "The part where the deleted parts are
   recovered doesn't get enough emphasis and is transitioned away too fast."
3. **At 00:43:** "Even the undo." sits on top of "Undo the scary stuff." with
   no background, and it looks like an accidental overlap.
4. **At 00:46:** "The mouse movements and the context highlights are wrong and
   unnatural." This is scene D, the rebase planner.
5. **At 00:50:** remote branch names are written over the Worktrees text in
   the GUI, and the shots that follow all have other parts of the GUI rendered
   on top of them. This is scene E.
6. More generally, some graphics look glitchy by accident.
7. **The end card** needs more emphasis, and the film should wait longer
   before cutting off.
8. **The red "manual way" terminal (the spell plate) is too transparent.** Make
   it about 15% darker.

## Budget and rules

- About $40 of credit is left. Tokens are the only cost.
- One agent, working linearly. No subagents or Workflow tools.
- Read this file in full. Of `PromoSpecifications.md`, read only the sections
  you need. Of `promo/NOTES.md`, read only the top. Beyond that, read only the
  files you change.
- Keep command output short (`| tail -n 25`), and write whole files in one
  pass.
- **At most 15 image views, and at most 2 review rounds.** Look at contact
  sheets only. No video renders except one smoke clip of 5 s or less at scale
  0.25.
- **Soft budget of about 180 tool calls.** If you pass 200, finish the step
  you're on and go straight to step 7.
- **Commit and push after every step.** Use `git push -u origin HEAD`. The
  first session pushed straight to `promo/video-2`, and that's fine again.
- **Stay inside `promo/`,** with the same privacy rules as before.
- `npm run check` must pass at every commit.
- **Environment:** the Ubuntu 24.04 VM is set up as before. Run `npm ci` at
  the repo root and again in `promo/`. The captures and `rects.generated.json`
  are committed, so **don't re-capture** anything, although you may re-run
  `scripts/measure-ui.mjs` to measure new selectors.

## Step 1: a new timeline for the master

Change **only** `Promo`. The cutdowns (`Promo30`, `Vertical`, `ReadmeGif`)
keep their timing. They share scene components, though, so make sure the
fixes below don't break them.

Keep the grid at 120 BPM and 60 frames per bar, and keep the synth
parameters. The extra time goes into **holds**, not slower motion. Typing,
collapses (8 frames), pops, whips and the tape-stop keep their speed.

The new arrangement is 65 bars, 3,900 frames, 2:10:

| Section | Old bars | New bars | New range |
| --- | --- | --- | --- |
| coldOpen | 4 | 5 | 1–5 |
| lanes | 4 | 5 | 6–10 |
| reveal | 3 | 4 | 11–14 |
| sceneA | 4 | 5 | 15–19 |
| sceneB | 3 | 4 | 20–23 |
| sceneC | 4 | 6 | 24–29 |
| sceneD | 3 | 6 | 30–35 |
| sceneE | 4 | 6 | 36–41 |
| sceneF | 3 | 4 | 42–45 |
| montage | 5 | 6 | 46–51 |
| twoLanes | 2 | 3 | 52–54 |
| stinger | 2 | 2 | 55–56 |
| checklist | 2 | 4 | 57–60 |
| endCard | 2 | 5 | 61–65 |

In `timing.json`, update the `Promo` arrangement and each section's `bars`,
then re-place every cue using these **reading rules**:

- **Text meant to be read** stays fully legible for at least
  **max(1.5 s, 0.3 s × words + 0.6 s)** before it changes or leaves. "Fully
  legible" means its entrance has finished and it isn't moving or fading.
- **A dialog or UI copy the viewer should read** stays up for at least 2.5 s.
- **Each visible state change** (a click result, a row moving, a new card)
  gets at least 1 s before the next one. Never more than one click per beat.
- **Beats stay on the grid.** Every cue still lands on a beat or a beat
  offset. Music parameters stored as cues (`dropout`, `shatterBar`, `jabBar`,
  `tapeStop`, `swellAt`, `silenceBeats`) move with their visuals.
- **The synth must follow the new lengths.** Confirm it renders the new
  section lengths cleanly: phrase-aligned fills, a riser that still lands on
  the drop, and the tape-stop still under the rewind.

The cue plans for sections C, D, E, the montage and the checklist are in
steps 2–4 and the list below. Place the rest by the rules. Some guidance:

- **Cold open:** each error stays readable for about 1.5–2 s, and
  "…wait." holds for at least 1 s. After the shatter, the two slam lines hold
  for the rest of bar 5.
- **Lanes:** one pain pair per bar for bars 1–3. The four switcher questions
  land 2 beats apart over bars 4–5, with a riser across both bars.
- **Reveal:** "All of Git." and "None of the wizardry." each hold at least
  1.5 s before the UI starts to assemble.
- **Scene A:** hold the Account mismatch dialog 2.5 s before **Cancel**, and
  hold the "Caught before it happened." stamp at least 1.5 s.
- **Montage (6 bars): use a conveyor.**
  - Cards ride the lane. Each card enters from the right, is centred and
    highlighted on its beat (tick sound, counter +1), stays readable on screen
    for at least 2 s, and exits left. Two or three cards are visible at once,
    with the neighbours dimmed to about 60%.
  - Cards 1–10 centre on section beats 2–11. The lane switch and swell come
    at beat 12. Cards 11–20 centre on beats 14–23, and beat 24 is the outro.
- **Two lanes (3 bars):** the merge preview gets at least 2.5 s of readable
  time. The TUI keys come after the merge preview's main sentence has landed.
- **Checklist (4 bars):** `q1 [1,1]`, `q2 [1,3]`, `q3 [2,1]`, `q4 [2,3]`,
  `c5 [3,1]`, `c6 [3,3]`, `c7 [4,1]`, then hold.
- **End card (5 bars):** see step 4b.

The counter math is unchanged (45). Commit: `promo: slower master timeline`.

## Step 2: scene C, the recovery moment, and the 00:43 overlap

### The new cue plan (6 bars)

| Cue | Position | What happens |
| --- | --- | --- |
| `oops` / `fall` | `[1,1]` / `[1,2]` | The reset types, and the three rows fall |
| `spell` | `[2,1]` | The panicked spell |
| `collapse` | `[2,3]` | The spell collapses into the recovery-point row |
| `confirm` | `[3,1]` | The real Restore confirm, readable for about 1 bar |
| click | `[3,3]` | The cursor clicks **Restore** |
| `tapeStop` | `[3,3]` | Music: the tape-stop over beats 3–4 |
| `rewind` | `[3,3,6]` | The rows fly back |
| `land` | `[4,1]` | The groove slams back |
| new caption | `[4,2]` | See below |
| `headline` | `[5,1]` | "Undo the scary stuff." |
| `newPoint` + `sub` | `[5,3]` | The new recovery point and "Even the undo." |
| `card` | `[6,2]` | The 24-hour card |

### The rewind: a playful VHS nod (new)

From the Restore click at `[3,3]` to `land` at `[4,1]` (about 24 frames), lay
a classic VCR rewind over the stage, in sync with the tape-stop:

- A **◀◀ REW** on-screen display, top-left inside the safe margin, in white
  JetBrains Mono with a hard drop shadow (or Material Symbols
  `fast_rewind` with "REW").
- Two or three horizontal **tracking-noise bands** rolling upward.
- Faint scanlines.
- A 2–4 px horizontal jitter on the stage.
- A slight red/cyan edge fringe, made with two offset, tinted, low-opacity
  copies of the stage *only during these frames*.
- A little desaturation.

It's a quick wink, not a takeover:

- Off by `land`, with the emerald landing arriving clean.
- No full-screen luminance flashes (keep to the accessibility rules).
- No large `filter: blur()` layers.
- A short, deterministic noise texture from `@remotion/noise` is fine.

Add an optional tape-whir SFX layered on the existing rewind sound, at about
−6 dB.

### The emphasis (new)

Bar 4 belongs to the restored commits:

- The camera pushes in (about 1.8–2×) on the three restored History rows, and
  holds.
- The emerald left edge and glow **persist for at least 2.5 s**, replacing
  today's 40-frame flash, with a gentle pulse on the landing.
- The row subjects are readable.
- Soft emerald chimes play, one per row, 4 frames apart. The existing SFX can
  do this.
- Add the caption **3 commits. Back.** at `[4,2]`. Add it to `copy.json` as
  `sceneC.back`, and keep the check script's banned-phrase scan passing.
- The camera eases back out as the headline arrives at `[5,1]`.

### The 00:43 overlap

**Cause:** `SceneHeadline` defaults to 112 px in a 1,000 px box, so "Undo
the scary stuff." wraps to two lines (about y 70–300), while `Sub` is pinned
at an absolute `y={214}`.

**Fix it by construction, not by nudging:**

- Add a `HeadlineBlock` in `kit.tsx` that stacks the headline and sub in
  normal flow: a flex column with a gap of at least 24 px. The sub then always
  sits below the headline's real bottom edge.
- Choose widths so every headline fits in two lines or fewer (use
  `@remotion/layout-utils` if needed).
- Keep `HeadlineScrim` behind the block, sized to cover it.
- Use the block wherever a scene shows a headline and a sub together (C, D's
  small note if it's near the headline, and F's lines).
- Audit every scene for text boxes that can intersect, including captions
  against the headline.

Commit: `promo: scene C recovery emphasis and headline layout`.

## Step 3: scene D (00:46), natural cursor and highlights

### Causes

- `moveBtn()` in `Features.tsx` *guesses* the Move earlier / Move later button
  positions as offsets from the row rect.
- Six clicks are packed into one bar, 7–8 frames apart, each with a 6-frame
  aim.
- The dropdown glows last 6 frames, which reads as a flicker.
- The rows swap by ±55 px regardless of their real height.

### The new cue plan (6 bars)

| Cue | Position |
| --- | --- |
| `headline` / `spell` | `[1,1]` / `[1,2]` |
| `collapse` | `[2,1]` |
| `move1` (one reorder only; drop `move2`) | `[2,3]` |
| `squash` / `fixup` | `[3,1]` / `[3,3]` |
| `drop` / `autosquash` | `[4,1]` / `[4,3]` |
| `splitPulse` / `confirm` (the Split confirm, readable) | `[5,1]` / `[5,2]` |
| click **Split** | `[5,4]` |
| `split` (one node becomes three) / `small` | `[6,1]` / `[6,2]` |

Then hold.

### Measure the real targets

Add selectors to `scripts/measure-ui.mjs`:

- each planner row's real **Move earlier** and **Move later** buttons (their
  `title` attributes)
- each row's `select.rebase-action`
- the Split button, and the confirm button

Re-run it, and aim at the centres of those rects.

### A natural cursor, fixed in the `Cursor` primitive so every scene benefits

- **Coordinates:** keep cursor positions in *app (stage)* coordinates, and
  push them through the camera every frame, so the pointer stays glued to the
  UI while the camera moves.
- **Paths:** move along a gentle arc (a quadratic curve with a perpendicular
  offset of about 10% of the distance).
  - Duration: `clamp(10 + distance / 60, 10, 24)` frames, with ease-in-out.
  - Arrive at least 5 frames before the click.
  - The press is 3 frames at scale 0.88, followed by a small ring.
  - Dwell at least 6 frames after a click before moving on.
- **Never teleport.** If a target changes layer, glide to it.
- **Highlights:**
  - A subtle hover ring (1–2 px indigo) appears as the cursor arrives, then a
    flash on the press.
  - The resulting state (the select's new value, a dimmed dropped row) simply
    *stays*.
  - No glow shorter than 10 frames. Fades take 6–8 frames.
- **Row reordering:** animate with the measured row pitch, then make the new
  order real (reorder the DOM once the animation has settled), so no two rows
  ever overlap.

Apply the same cursor model in A, B and C, and check them in the review
sheets. Commit: `promo: natural cursor and real click targets`.

## Step 4: scene E (00:50) and layer compositing everywhere

### Cause

`<AppLayer snap="worktrees-section" at={wtAt}>` draws a partial snapshot with
a transparent background over the base `workspace-body` snapshot. The base's
sidebar at the same spot shows the branch list, remote branches included, so
the two sets of text print over each other. The rows' fan-out transforms also
push them beyond their box. The mini windows and the agent-launch window that
follow get composited over the live workspace without the surfaces the real
app has.

### The fix and the rule

**Never draw one snapshot's content over a different snapshot's content.**

- Show the Worktrees section by changing the base layer itself (the way scene
  C's `apply` edits its own snapshot), or give the overlay an opaque panel
  background clipped to its rect and hide the base region underneath it.
- Keep the fan-out inside the section's bounds.
- Windows and dialogs get the app's real modal treatment: the dimmed backdrop
  and an opaque card, opening and closing over 6–8 frames, never popping on
  top of other content.
- The mini windows get opaque, clipped frames.

### The cue plan (6 bars)

| Cue | Position |
| --- | --- |
| `headline` / `spell` | `[1,1]` / `[1,2]` |
| `collapse` | `[2,1]` |
| `row1` / `row2` / `row3` | `[2,2]` / `[2,3]` / `[2,4]` |
| `windows` (then hold through bar 3) | `[3,1]` |
| `launcher` | `[4,1]` |
| `card1` / `card2` / `card3` | `[4,2]` / `[4,3]` / `[4,4]` |
| `fly` | `[5,1]` |
| `terminals` / `small` (then hold) | `[5,2]` / `[5,3]` |

### Audit every other overlay

Check every non-base `AppLayer` and every `…Vis` layer swap in all scenes for
the same problem: `recovery-after-reset`, `restore-confirm`,
`rebase-planner`, `rebase-edit-stop`, `split-confirm`, `agent-launch`, the
merge preview, the palette, and anything else. Look for transparent overlays,
elements rendered twice, and layers that pop without their open/close
motion.

### The spell plate (item 8)

In `SpellStack.tsx`, the plate behind the "manual way" terminal is
`rgba(10,12,16,0.9)`, and the busy UI shows through it. Make it about **15%
darker and effectively opaque**: roughly `rgba(8,9,13,0.98)`. Also add a soft
dark scrim of about 35% on the stage around the plate while it's visible, so
the UI behind is subdued rather than competing. Keep the red border, the glow
and the text colors as they are, and keep the collapse animation unchanged.

Commit: `promo: opaque overlays and scene E layout`.

## Step 4b: the end card, bigger and held longer (5 bars)

- **Bar 1:** the lanes sweep in and fuse into the logo, at a larger hero size
  and centred. The arrowheads pop and the disc scales in, like a slightly
  slower replay of the reveal.
- **Bar 2:** the logo settles upward. The wordmark **Multi-Git** slams in on
  beat 1, and the tagline **All of Git. None of the wizardry.** arrives on
  beat 3.
- **Bar 3:** **Download free →** and `github.com/AnthonyKopri/multi-git`
  arrive on beat 1, and **Windows · macOS · Linux** on beat 2. The button's
  glow breathes gently from here on.
- **Bar 4:** the cursor glides to the button with the natural cursor from
  step 3. It clicks on beat 2, the button presses with a ripple, and the
  corner counter ticks to **46**.
- **Bar 5:** hold. Everything is still, apart from a slow push of about 2%.
  The final F-major chord rings out. Over the last 20 frames, fade picture
  and sound to black and silence together.

Both the URL and the tagline must be readable for **at least 4 s** before the
cut. In the synth, extend the `end` section so the chord sustains across bars
4–5 and decays naturally into the fade. Don't let it simply stop.

Commit: `promo: end card emphasis and longer hold`.

## Step 5: the music follows the new lengths

- Run `npm run audio`.
- Check the loudness (about −14 LUFS integrated, −1 dBTP true peak).
- Look at **one** waveform-plus-spectrogram image with the 65 bar gridlines.
  Confirm the drop, the tape-stop (now in scene C, bar 3) and the stinger
  silence sit at their new bars.
- Re-make `review/mix-preview.mp3`.
- Don't change `PARAMS` or any instrument, only the arrangement lengths.

Commit: `promo: re-render the score for the new timeline`.

## Step 6: review, at most 2 rounds and 15 images

Put the sheets in `promo/review/revision-1/`.

1. **Overview:** every 30th frame of the new master at scale 0.2, in
   2 sheets. Check pacing, holds and blank frames.
2. **Fix sheets:** one sheet of 3 rows of 12 frames at scale 0.3, sampled
   every 4th frame:
   - scene C from `rewind` through `sub`
   - scene D from `collapse` through `drop`
   - scene E from `collapse` through `launcher`

   Check for overlaps, cursor paths and highlight durations.
3. **Headlines:** one key-frame sheet showing each scene's headline and sub
   at full hold. Add a spell plate over busy UI, and the end card's bars 2,
   3 and 5.
4. **Cutdowns:** one overview sheet covering all three, to prove nothing
   broke.

Checklist:

- No text over text.
- No transparent GUI over GUI.
- The cursor always lands on the real control, with no teleports.
- No glow shorter than 10 frames.
- Every reading rule is met.
- The spell plate is dark and opaque, and nothing reads through it.
- The VHS rewind is gone by `land`.
- The end card holds its URL and tagline for at least 4 s, then fades
  cleanly.
- The copy matches the spec.
- `npm run check` passes.

Render one smoke clip (scene C's `rewind`→`headline`, scale 0.25) and confirm
with `ffprobe` that it has an audio stream. Don't commit it.

Commit: `promo: revision 1 review`.

## Step 7: docs and the final push

- **`promo/NOTES.md`:**
  - Add a **Revision 1** section: what changed and why, the new storyboard
    table (section, bars, frames), deviations, and any remaining TODOs.
  - Update the morning checklist.
- **`promo/README.md`:** fix anything that mentions 90 s or 2,700 frames.
- Don't edit `PromoSpecifications.md`. Its bar and frame numbers for the
  master are superseded by the table in step 1, which NOTES should say. Its
  copy and order still apply.
- Run the final checks: `npm run check`, `npx remotion compositions`, and
  `npm run lint:links` at the root. Confirm nothing outside `promo/` changed.
- Push.
- End with a short summary: what changed, the new runtime, and the command to
  render (`cd promo && npm run render`).
