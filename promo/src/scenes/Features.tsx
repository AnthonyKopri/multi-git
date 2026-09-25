// The feature scenes A-F: spell -> collapse into the real control -> the app
// does the job. All UI is captured app DOM under the app's own CSS.
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import writes from '../../assets/captures/data/terminal-writes.json';
import { clamp01, enter, expoIn, expoOut, leave, lerp, pop, prog } from '../lib/anim';
import { Camera, type CamKey } from '../primitives/Camera';
import { Cursor, type CursorMap, type CursorStop } from '../primitives/Cursor';
import { Kinetic } from '../primitives/Headline';
import { KeyCombo } from '../primitives/KeyCap';
import { LaneTrails } from '../primitives/LaneTrails';
import { SpellStack, TargetPulse } from '../primitives/SpellStack';
import { Caret, TerminalWindow, tildify, type LogRecord } from '../primitives/Terminal';
import { VhsOverlay, VhsStage } from '../primitives/Vhs';
import { FONT, TYPE, useColors, useFilm } from '../theme';
import { SNAP } from '../ui/snapshots.generated';
import { AppLayer, AppWindow, blockBottom, byText, cues, FEATURE_ANCHOR, HeadlineBlock, HeadlineScrim, ModalLayer, q, qa, rect, rgba, setText, Sub, toScreen, type R } from './kit';
import type { SceneProps } from './types';

const W = 1920, H = 1080;
const SPELL_BOX = { x: FEATURE_ANCHOR.x - 600, y: 250, w: 1200 };
/** The spell plate sits 40 px below the scene's headline block (cropped cutdowns keep their old spot). */
const spellBox = (headline: string | null, y = SPELL_BOX.y, size?: number) => ({ ...SPELL_BOX, y: headline ? Math.max(y, blockBottom([{ text: headline, at: 0, size }]) + 40) : y });

const Stage: React.FC<{ keys: CamKey[]; duration: number; shakes?: number[]; children: React.ReactNode }> = ({ keys, duration, shakes, children }) => (
  <Camera keys={keys} width={W} height={H} anchor={FEATURE_ANCHOR} drift={0.015} driftFrames={duration} shakes={shakes}>
    <AppWindow>{children}</AppWindow>
  </Camera>
);

const Stamp: React.FC<{ text: string; at: number; x: number; y: number }> = ({ text, at, x, y }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  if (frame < at) return null;
  const t = expoOut(prog(frame, at, 7));
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) rotate(-4deg) scale(${1.45 - 0.45 * t})`, opacity: t,
      padding: '18px 34px', border: `5px solid ${c.emerald}`, borderRadius: 18, background: 'rgba(10,12,16,0.92)', color: c.emerald,
      fontFamily: FONT.sans, fontWeight: 800, fontSize: 64, letterSpacing: '-0.01em', whiteSpace: 'nowrap', boxShadow: `0 0 60px ${c.emerald}55` }}>{text}</div>
  );
};

const Caption: React.FC<{ text: string; at: number; exitAt?: number; x: number; y: number; icon?: string; color?: string }> = ({ text, at, exitAt, x, y, icon, color }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const v = enter(frame, at, 10) * (exitAt === undefined ? 1 : leave(frame, exitAt, 7));
  if (v <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 14, opacity: v, transform: `translateY(${(1 - v) * 16}px)`,
      padding: '14px 24px', borderRadius: 14, background: 'rgba(17,20,26,0.92)', border: `1.5px solid ${c.border}`, fontFamily: FONT.sans, fontWeight: 600, fontSize: 34, color: color ?? c.text }}>
      {icon ? <span className="material-symbols-outlined" style={{ fontSize: 38, color: color ?? c.indigo }}>{icon}</span> : null}{text}
    </div>
  );
};

/** Maps stage points through a scene's camera, for the Cursor. */
const camMap = (keys: CamKey[], duration: number): CursorMap => (f, p) => {
  const r = toScreen(keys, f, { x: p.x, y: p.y, w: 0, h: 0 }, FEATURE_ANCHOR, 0.015, duration);
  return { x: r.x, y: r.y };
};
/** A click at (fx, fy) inside a stage rect, with the hover ring on the rect (unless `ring` is false). */
const clickOn = (at: number, r: R, fx = 0.5, fy = 0.5, ring = true): CursorStop => ({ at, x: r.x + r.w * fx, y: r.y + r.h * fy, click: true, ring: ring ? r : undefined });

// The capture machine had no SSH agent; its warning rows would steal the shot.
const hideAgentRows = (root: HTMLElement) => {
  const dd = q(root, '#profile-dropdown');
  if (!dd) return;
  [...dd.children].forEach((el) => {
    const t = el.textContent ?? '';
    if ((el as HTMLElement).classList.contains('agent-row') || /SSH agent|Agent:|Vault:/.test(t)) (el as HTMLElement).style.display = 'none';
  });
};

// Cutdowns that crop a window out of the scene render their own titles.
const wrappedV = (variant?: string) => variant === 'vertical' || variant === 'gif' || variant === 'splitOnly';

// ------------------------------------------------------------------ scene A --
export const SceneA: React.FC<SceneProps> = ({ placed, variant }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy } = useFilm();
  const cu = cues(placed.def);
  const spellAt = cu.at('spell'), collapse = cu.at('collapse'), pick = cu.at('pick'), flip = cu.has('flipRows') ? cu.at('flipRows') : pick + 6;
  const hasRules = cu.has('rule'), rule = cu.at('rule', 9999), second = cu.at('secondRepo', 9999);
  const keysAt = cu.at('keys'), mismatch = cu.at('mismatch'), cancel = cu.at('cancel'), stampAt = cu.at('stamp');
  const land = collapse + 8;
  const seg = rect('base', '#profile-segment-wrapper');
  const workItem = rect('dropdownWork', '[data-profile-id="work"]');
  const cancelBtn = rect('mismatch', '#btn-confirm-cancel');
  const keys: CamKey[] = [
    { at: 0, x: 1000, y: 250, scale: 1.25 },
    { at: land + 6, x: 1030, y: 290, scale: 1.7, dur: 7 },
    ...(hasRules ? [{ at: rule, x: 930, y: 420, scale: 1.55, dur: 7 }, { at: second, x: 620, y: 40, scale: 1.85, dur: 6 }] : []),
    { at: keysAt, x: 820, y: 140, scale: 1.6, dur: 7 },
    { at: mismatch, x: 800, y: 118, scale: 2.15, dur: 6 },
  ];
  const dropdownOpen = frame >= land && frame < (hasRules ? rule : keysAt);
  const flipT = prog(frame, flip, 8);
  const personalVis = dropdownOpen && flipT < 0.5;
  const workVis = dropdownOpen && flipT >= 0.5;
  const rulesVis = frame >= rule && frame < second;
  const mismatchVis = frame >= mismatch && frame < cancel + 5;
  const pastPick = frame >= flip + 4;
  const segName = frame >= keysAt ? 'Personal' : pastPick ? 'Work' : 'Personal';
  const flipRows = (root: HTMLElement, f: number, from: boolean) => {
    const t = prog(f, flip, 8);
    const ang = from ? Math.min(90, t * 180) : Math.max(0, 90 - (t - 0.5) * 180);
    for (const sel of ['#repo-account-block', '#identity-row', '#profile-segment']) {
      const el = q(root, sel);
      if (el) { el.style.transform = `perspective(600px) rotateX(${ang}deg)`; el.style.transformOrigin = '50% 50%'; }
    }
    const work = q(root, '[data-profile-id="work"]');
    if (work && from) work.style.background = f >= pick ? 'rgba(99,102,241,0.28)' : '';
    hideAgentRows(root);
  };
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <Stage keys={keys} duration={placed.duration} shakes={[mismatch]}>
        <AppLayer snap="workspace-body" base apply={(root) => {
          setText(q(root, '#profile-segment-name'), segName);
          setText(q(root, '#repo-segment-name'), frame >= second && frame < keysAt ? 'acme-web' : 'acme-api');
        }} />
        {personalVis && <AppLayer snap="ssh-dropdown-personal" at={seg} apply={(r, f) => flipRows(r, f, true)} />}
        {workVis && <AppLayer snap="ssh-dropdown-work" at={seg} apply={(r, f) => flipRows(r, f, false)} />}
        {rulesVis && <AppLayer snap="ssh-window" apply={(root, f) => {
          const h = byText(root, 'h3', 'Auto-select');
          let p: HTMLElement | null = h?.parentElement ?? null;
          while (p && p !== root && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
          if (p && h && p !== root) p.scrollTop = Math.max(0, h.offsetTop - 120);
          const rows = qa(root, '[data-rule-id], .rule-item, .account-rule, li').filter((li) => /github\.com\/acme\//.test(li.textContent ?? ''));
          rows.forEach((li) => { const s = pop(f, rule + 4); li.style.transform = `scale(${0.6 + 0.4 * s})`; li.style.opacity = String(clamp01(s)); li.style.boxShadow = f - rule < 20 ? `0 0 0 2px ${c.indigo}` : ''; });
        }} />}
        {mismatchVis && <AppLayer snap="account-mismatch" apply={(root, f) => {
          const card = q(root, '.modal-card');
          if (card) { const t = expoOut(prog(f, mismatch, 6)); card.style.transform = `scale(${1.18 - 0.18 * t})`; card.style.opacity = String(t); }
          const msg = q(root, '#confirm-message');
          if (msg && !msg.dataset.mg) {
            msg.dataset.mg = '1';
            msg.innerHTML = msg.innerHTML.replace('"Work"', '"<mark class="mg-hl">Work</mark>"').replace('"Personal"', '"<mark class="mg-hl">Personal</mark>"');
          }
          qa(root, 'mark.mg-hl').forEach((m) => { m.style.background = f >= mismatch + 5 ? `${c.amber}55` : 'transparent'; m.style.color = 'inherit'; m.style.borderRadius = '4px'; m.style.padding = '0 3px'; });
          const cb = q(root, '#btn-confirm-cancel');
          if (cb) cb.style.boxShadow = '';
        }} />}
      </Stage>
      {!wrappedV(variant) && <HeadlineBlock lines={[{ text: copy.sceneA.headline, at: cu.at('headline') }]} />}
      <SpellStack lines={copy.spells.a} at={spellAt} collapseAt={collapse} box={spellBox(wrappedV(variant) ? null : copy.sceneA.headline)} target={toScreen(keys, land, seg)} />
      <Cursor map={camMap(keys, placed.duration)} stops={[
        { at: land, x: seg.x + seg.w * 0.6, y: seg.y + seg.h * 0.8 },
        clickOn(pick, workItem, 0.4, 0.55),
        ...(hasRules ? [{ at: rule + 12, x: 1150, y: 560 }] : []),
        clickOn(cancel, cancelBtn, 0.5, 0.6),
      ]} enterAt={land} exitAt={stampAt} />
      {frame >= keysAt && <KeyCombo keys={['Ctrl', 'Alt', 'U']} enterAt={keysAt} pressAt={keysAt + 6} style={{ position: 'absolute', left: wrappedV(variant) ? 720 : 96, top: 840, opacity: leave(frame, stampAt + 20, 7) }} />}
      <Stamp text={copy.sceneA.stamp} at={stampAt} x={FEATURE_ANCHOR.x} y={560} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ scene B --
const LINE = { imp: 'import { expiresSoon }', ifl: 'if (expiresSoon(', ref: 'session.refreshedAt =', log1: "console.log('session'", log2: "console.log('refreshed'" };
const lineEl = (root: HTMLElement, text: string) => byText(root, '[data-line-id]', text);

export const SceneB: React.FC<SceneProps> = ({ placed, variant }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy } = useFilm();
  const cu = cues(placed.def);
  const collapse = cu.at('collapse'), land = collapse + 8;
  const sel = [cu.at('sel1'), cu.at('sel2'), cu.at('sel3')];
  const stage = cu.at('stage'), discardSel = cu.at('discardSel', 9999), discard = cu.at('discard', 9999);
  const keysAt = cu.at('keys', 9999), commit = cu.at('commit', 9999), wordDiff = cu.at('wordDiff', 9999), imageDiff = cu.at('imageDiff', 9999);
  const diffAt = rect('base', '#staging-view');
  const WORD = rect('word', '[data-line-id]::uptime');
  const off = 47; // the selection bar's height: lines sit below it
  const lr = (k: keyof typeof LINE) => { const r = rect('diff', `[data-line-id]::${LINE[k]}`); return { ...r, y: r.y + off }; };
  const keys: CamKey[] = [
    { at: 0, x: 900, y: 560, scale: 1.15 },
    { at: land + 6, x: 960, y: 430, scale: 1.8, dur: 7 },
    { at: sel[2] - 4, x: 960, y: 700, scale: 1.75, dur: 7 },
    { at: stage - 3, x: 900, y: 360, scale: 1.8, dur: 6 },
    { at: discardSel - 2, x: 960, y: 740, scale: 1.75, dur: 6 },
    { at: keysAt + 8, x: 1400, y: 330, scale: 1.55, dur: 7 },
    { at: wordDiff, x: WORD.x, y: WORD.y + WORD.h / 2, scale: 2.0, dur: 6 },
    { at: imageDiff, x: 930, y: 330, scale: 1.5, dur: 6 },
  ];
  const showDiff = frame < keysAt + 8 || (frame >= wordDiff && frame < imageDiff);
  const showImage = frame >= imageDiff;
  const stageBtn = rect('diffSelected', '#btn-diff-stage-selection'), discardBtn = rect('diffSelected', '#btn-diff-discard-selection');
  const applyDiff = (root: HTMLElement, f: number) => {
    const picked = [LINE.imp, LINE.ifl, LINE.ref];
    const logs = [LINE.log1, LINE.log2];
    let count = 0;
    picked.forEach((t, i) => {
      const el = lineEl(root, t); if (!el) return;
      const on = f >= sel[i] && f < stage + 3;
      if (on) count++;
      el.classList.toggle('diff-line-selected', on);
      el.style.boxShadow = f >= sel[i] && f < sel[i] + 12 ? `inset 3px 0 0 ${c.indigo}` : '';
      const gone = clamp01((f - stage - 6) / 6);
      el.style.maxHeight = f >= stage + 6 ? `${61 * (1 - gone)}px` : '';
      el.style.overflow = 'hidden';
      el.style.opacity = f >= stage + 2 ? String(1 - 0.6 * clamp01((f - stage - 2) / 4)) : '';
    });
    logs.forEach((t) => {
      const el = lineEl(root, t); if (!el) return;
      const on = f >= discardSel && f < discard + 3;
      if (on) count++;
      el.classList.toggle('diff-line-selected', on);
      const red = f >= discard;
      el.style.background = red ? 'rgba(239,68,68,0.28)' : '';
      el.style.textDecoration = red ? 'line-through' : '';
      const gone = clamp01((f - discard - 5) / 6);
      el.style.maxHeight = f >= discard + 5 ? `${61 * (1 - gone)}px` : '';
      el.style.overflow = 'hidden';
    });
    const barEl = q(root, '#diff-selection-bar');
    if (barEl) barEl.style.visibility = count > 0 ? 'visible' : 'hidden';
    setText(q(root, '#diff-selection-count'), `${count} line${count === 1 ? '' : 's'} selected`);
    const sb = q(root, '#btn-diff-stage-selection'), db = q(root, '#btn-diff-discard-selection');
    if (sb) sb.style.boxShadow = '';
    if (db) db.style.boxShadow = f >= discard && f < discard + 12 ? `0 0 0 2px ${c.red}` : '';
  };
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <Stage keys={keys} duration={placed.duration}>
        <AppLayer snap="workspace-body" base apply={(root, f) => insertCommitRow(root, f, commit, c.indigo)} />
        {showDiff && frame < wordDiff && <AppLayer snap="filediff-selected" at={diffAt} apply={applyDiff} />}
        {frame >= wordDiff && frame < imageDiff && <AppLayer snap="worddiff" at={diffAt} />}
        {showImage && <AppLayer snap="imagediff" at={diffAt} />}
      </Stage>
      {!wrappedV(variant) && <HeadlineBlock lines={[{ text: copy.sceneB.headline, at: cu.at('headline') }]} />}
      <SpellStack lines={copy.spells.b} at={cu.at('spell')} collapseAt={collapse} box={spellBox(wrappedV(variant) ? null : copy.sceneB.headline)} target={toScreen(keys, land, lr('imp'))} />
      <Cursor map={camMap(keys, placed.duration)} stops={[
        { at: land, x: lr('imp').x + lr('imp').w * 0.3, y: lr('imp').y + lr('imp').h * 0.5 },
        clickOn(sel[0], lr('imp'), 0.3, 0.5, false), clickOn(sel[1], lr('ifl'), 0.3, 0.5, false), clickOn(sel[2], lr('ref'), 0.3, 0.5, false),
        clickOn(stage, stageBtn), clickOn(discardSel, lr('log1'), 0.3, 0.5, false), clickOn(discard, discardBtn),
      ]} enterAt={land} exitAt={keysAt} />
      {!wrappedV(variant) && <Caption text={copy.sceneB.caption} at={discardSel} x={96} y={900} icon="shield" />}
      {frame >= keysAt && frame < wordDiff + 5 && <KeyCombo keys={['Ctrl', 'Enter']} enterAt={keysAt} pressAt={keysAt + 6} style={{ position: 'absolute', left: 96, top: 770, opacity: leave(frame, wordDiff, 6) }} />}
    </AbsoluteFill>
  );
};

/** Inserts the new "fix(auth): refresh the token before expiry" row above main's head. */
function insertCommitRow(root: HTMLElement, f: number, at: number, glow: string, extra?: (row: HTMLElement) => void) {
  const list = q(root, '#commit-history-list');
  if (!list) return;
  let row = q(list, 'li.mg-new');
  if (f < at) { row?.remove(); return; }
  if (!row) {
    const head = byText(list, 'li.commit-graph-row', 'docs: add API usage');
    if (!head) return;
    row = head.cloneNode(true) as HTMLElement;
    row.classList.add('mg-new');
    qa(row, '.ref-chip').forEach((chip) => chip.remove());
    const msg = [...row.querySelectorAll<HTMLElement>('*')].find((e) => e.children.length === 0 && /docs: add API usage/.test(e.textContent ?? ''));
    if (msg) msg.textContent = 'fix(auth): refresh the token before expiry';
    qa(row, '*').forEach((e) => { if (e.children.length === 0 && /Priya Nair/.test(e.textContent ?? '')) e.textContent = 'Jane Doe'; });
    head.parentElement!.insertBefore(row, head);
    const chip = q(head, '.ref-chip');
    if (chip) { const moved = chip.cloneNode(true) as HTMLElement; const refRow = q(row, '.commit-ref-row'); refRow?.appendChild(moved); }
  }
  const t = expoOut(prog(f, at, 8));
  row.style.maxHeight = `${46 * t}px`;
  row.style.overflow = 'hidden';
  row.style.boxShadow = f - at < 14 ? `inset 3px 0 0 ${glow}, 0 0 30px ${glow}66` : '';
  extra?.(row);
}

// ------------------------------------------------------------------ scene C --
// The three History rows the reset takes (the new commit is inserted above
// "docs: add API usage", so they sit at y 325, 371 and 463).
const RESTORED = { x: 1317, y: 325, w: 246, h: 184 };

export const SceneC: React.FC<SceneProps> = ({ placed, variant }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy } = useFilm();
  const cu = cues(placed.def);
  const oops = cu.at('oops'), fall = cu.at('fall'), collapse = cu.at('collapse'), land = collapse + 8, rewind = cu.at('rewind'), landing = cu.at('land');
  const pickPoint = cu.at('pickPoint', 9999), confirmAt = cu.at('confirm', 9999), restore = cu.at('restore', 9999);
  const back = cu.at('back', 9999), headAt = cu.at('headline', landing), newPoint = cu.at('newPoint', 9999), card = cu.at('card', 9999);
  const short = variant === 'short' || variant === 'gif';
  // The master clicks Restore itself, rewinds on tape and gives bar 4 to the restored commits.
  const full = !short && back < 9999;
  const falls = short ? [fall, fall + 3, fall + 6] : [fall, fall + 15, fall + 30];
  const keys: CamKey[] = [
    { at: 0, x: 1440, y: 360, scale: 1.55 },
    { at: land - 2, x: 800, y: 200, scale: 1.45, dur: 6 },
    ...(full ? [{ at: confirmAt, x: 800, y: 150, scale: 1.7, dur: 8 }] : []),
    { at: rewind, x: 1440, y: 360, scale: 1.55, dur: 6 },
    ...(full ? [
      { at: landing + 2, x: RESTORED.x + RESTORED.w / 2, y: RESTORED.y + RESTORED.h / 2, scale: 1.95, dur: 14 },
      { at: headAt, x: 1250, y: 380, scale: 1.4, dur: 16 },
    ] : []),
    ...(newPoint < 9999 ? [{ at: newPoint - 2, x: 800, y: 230, scale: 1.45, dur: 8 }] : []),
  ];
  const screen = (f: number, r: R) => toScreen(keys, f, r, FEATURE_ANCHOR, 0.015, placed.duration);
  const recRow = rect('recovery', '#recovery-points-list li');
  const recBtn = rect('recovery', '#recovery-points-list li >> button[data-action="restore"]');
  // The emerald landing holds until the new recovery point opens (>= 2.5 s in the master).
  const greenEnd = full ? Math.max(landing + 75, newPoint - 2) : landing + 40;
  const nodeState = (root: HTMLElement, f: number) => {
    insertCommitRow(root, f, -1, c.indigo);
    const list = q(root, '#commit-history-list');
    if (!list) return;
    const rows = [q(list, 'li.mg-new'), byText(list, 'li.commit-graph-row', 'docs: add API usage'), byText(list, 'li.commit-graph-row', 'fixup! feat(search)')];
    rows.forEach((row, k) => {
      if (!row) return;
      const redAt = falls[k];
      const backAt = rewind + (2 - k) * 3;
      let ty = 0, rot = 0, op = 1;
      if (f >= redAt && f < backAt) { const t = expoIn(prog(f, redAt + 4, 12)); ty = 280 * t; rot = 10 * t * (k % 2 ? -1 : 1); op = 1 - t; }
      if (f >= backAt && f < landing) { const t = expoOut(prog(f, backAt, landing - backAt)); ty = 280 * (1 - t); rot = 0; op = t; }
      row.style.transform = `translateY(${ty}px) rotate(${rot}deg)`;
      row.style.opacity = String(op);
      const red = f >= redAt && f < backAt;
      // Green from the landing: one gentle swell, a steady glow, then an 8-frame fade.
      const g = f >= landing ? clamp01((greenEnd - f) / 8) : 0;
      const swell = f >= landing ? Math.sin(Math.PI * prog(f, landing + k * 4, 22)) : 0;
      const circle = row.querySelector('circle');
      if (circle) (circle as SVGCircleElement).style.fill = red ? c.red : g > 0.5 ? c.emerald : '';
      const flying = f >= backAt && f < landing;
      row.style.boxShadow = flying ? `0 40px 0 ${c.emerald}33, 0 80px 0 ${c.emerald}1a, 0 120px 0 ${c.emerald}0d`
        : g > 0 ? `inset 3px 0 0 ${rgba(c.emerald, g)}, 0 0 ${22 + 20 * swell}px ${rgba(c.emerald, (0.3 + 0.25 * swell) * g)}`
        : red ? `inset 3px 0 0 ${c.red}` : '';
      row.style.background = g > 0 ? rgba(c.emerald, 0.1 * g) : '';
      row.style.color = red ? c.red : '';
    });
  };
  const recoveryApply = (root: HTMLElement, f: number) => {
    const list = q(root, '#recovery-points-list');
    const first = list?.querySelector<HTMLElement>('li:not(.mg-new)');
    if (first) first.style.boxShadow = f >= land && f < Math.min(rewind, pickPoint + 8) ? `inset 0 0 0 2px ${c.indigo}, 0 0 30px ${c.indigo}66` : '';
    if (list && f >= newPoint) {
      let nr = q(list, 'li.mg-new');
      if (!nr && first) {
        nr = first.cloneNode(true) as HTMLElement; nr.classList.add('mg-new');
        nr.style.boxShadow = '';
        const lab = nr.querySelector<HTMLElement>('.recovery-label');
        if (lab) lab.textContent = `Before restoring main to ${RESTORE_TO}`;
        list.insertBefore(nr, first);
      }
      if (nr) { const t = expoOut(prog(f, newPoint, 8)); nr.style.maxHeight = `${56 * t}px`; nr.style.overflow = 'hidden'; nr.style.boxShadow = `inset 0 0 0 2px ${c.emerald}`; }
    }
  };
  const stage = (
    <Stage keys={keys} duration={placed.duration} shakes={[oops]}>
      <AppLayer snap="workspace-body" base apply={nodeState} />
      <ModalLayer snap="recovery-after-reset" open={land - 2} close={full ? pickPoint + 2 : rewind} apply={recoveryApply} />
      {full && <ModalLayer snap="restore-confirm" open={confirmAt} close={restore + 1} />}
      {newPoint < 9999 && <ModalLayer snap="recovery-after-reset" open={newPoint - 2} apply={recoveryApply} />}
    </Stage>
  );
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <VhsStage active={full && frame >= restore && frame < landing} stage={stage} />
      {frame < land + 4 && !wrappedV(variant) && (
        <div style={{ position: 'absolute', left: 96, top: 110, opacity: leave(frame, land, 6) }}>
          <TerminalWindow title="~/code/acme-api" width={900} height={170}>
            <div style={{ fontFamily: FONT.mono, fontSize: 36, color: c.text, whiteSpace: 'pre' }}>
              <span style={{ color: c.emerald }}>$ </span>{copy.sceneC.oops.slice(0, Math.min(copy.sceneC.oops.length, Math.floor((frame - oops) * 2) + 1))}<Caret size={36} />
            </div>
          </TerminalWindow>
        </div>
      )}
      {!wrappedV(variant) && <HeadlineBlock lines={[
        { text: copy.sceneC.headline, at: headAt },
        ...(short ? [] : [{ kind: 'sub' as const, text: copy.sceneC.sub, at: cu.at('sub', 9999), color: c.emerald, size: 56 }]),
      ]} />}
      <SpellStack lines={copy.spells.c} at={cu.at('spell')} collapseAt={collapse} box={{ ...SPELL_BOX, y: 360 }} shaky flood={short ? 12 : 15} target={screen(land + 4, recRow)} />
      {full && <Caption text={copy.sceneC.back} at={back} exitAt={newPoint - 4} x={96} y={560} icon="history" color={c.emerald} />}
      {!short && <Caption text={copy.sceneC.card} at={card} x={96} y={880} icon="delete_history" />}
      {full && <Cursor map={camMap(keys, placed.duration)} stops={[
        { at: land, x: recBtn.x - 60, y: recBtn.y + 70 },
        clickOn(pickPoint, recBtn), clickOn(restore, rect('restore', '#btn-confirm-ok'), 0.5, 0.55),
      ]} enterAt={land} exitAt={restore + 8} />}
      {full && <VhsOverlay from={restore} to={landing} width={W} height={H} />}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ scene D --
// The planner rows in their captured order (data-index 0-4) and where they sit.
const PLAN_ROWS = ['rate limiting', 'token helpers', 'highlight matched', 'fixup!', 'API usage'];
const planRect = (slot: number, part = '') => rect('planner', `#rebase-plan-list li::${PLAN_ROWS[slot]}${part}`);
const SEL = ' >> select.rebase-action', MOVE_UP = ' >> button[title="Move earlier"]';
const PITCH = planRect(1).y - planRect(0).y; // the measured row pitch
const TOKEN = 1, FIX = 3, DOCS = 4; // data-index of the rows the scene edits
const smoothStep = (t: number) => { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };

export const SceneD: React.FC<SceneProps> = ({ placed, variant }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy, width, height } = useFilm();
  const cu = cues(placed.def);
  const vertical = height > width;
  const hook = variant === 'hook', splitOnly = variant === 'splitOnly';
  const collapse = cu.at('collapse', 9999), land = collapse + 8;
  const move1 = cu.at('move1', 9999), squash = cu.at('squash', 9999), fixup = cu.at('fixup', 9999), drop = cu.at('drop', 9999), auto = cu.at('autosquash', 9999);
  const start = cu.at('start', 9999), splitPulse = cu.at('splitPulse', 9999), confirm = cu.at('confirm', 9999), split = cu.at('split', 9999);
  // The master makes every change with a real click; the cutdowns keep their quick version.
  const full = start < 9999;
  const splitClick = cu.at('splitClick', confirm + 8);
  const settled = move1 + 10;
  const splitBtn = rect('editStop', '#btn-rebase-split'), okBtn = rect('split', '#btn-confirm-ok');
  const keys: CamKey[] = splitOnly
    ? [{ at: 0, x: 935, y: 200, scale: 1.9 }, { at: confirm, x: 800, y: 150, scale: 1.8, dur: 6 }]
    : full ? [
      { at: 0, x: 800, y: 380, scale: 1.3 },
      { at: land + 6, x: 800, y: 300, scale: 1.6, dur: 10 },
      { at: splitPulse - 2, x: 935, y: 200, scale: 1.85, dur: 8 },
      { at: confirm + 3, x: 800, y: 150, scale: 1.8, dur: 8 },
      { at: splitClick + 4, x: 800, y: 420, scale: 1.2, dur: 12 },
    ]
    : [{ at: 0, x: 800, y: 380, scale: 1.3 }, { at: land + 6, x: 800, y: 266, scale: 1.3, dur: 7 }, { at: splitPulse - 2, x: 935, y: 200, scale: 1.85, dur: 6 }, { at: confirm, x: 800, y: 150, scale: 1.8, dur: 6 }];
  const screen = (f: number, r: R) => toScreen(keys, f, r, FEATURE_ANCHOR, 0.015, placed.duration);
  const applyPlan = (root: HTMLElement, f: number) => {
    const list = q(root, '#rebase-plan-list');
    if (!list) return;
    const row = (i: number) => q(list, `li[data-index="${i}"]`);
    // Move earlier: the two rows trade places over 10 frames at the measured
    // pitch (the moving row on top, both opaque), then the new order is made real.
    const want = f >= settled ? [0, 1, 2, DOCS, FIX] : [0, 1, 2, 3, 4];
    if (qa(list, ':scope > li').map((li) => li.dataset.index).join() !== want.join()) want.forEach((i) => { const li = row(i); if (li) list.appendChild(li); });
    const t = f >= move1 && f < settled ? smoothStep((f - move1) / 10) : 0;
    [[DOCS, -1, 2], [FIX, 1, 1]].forEach(([i, dir, z]) => {
      const li = row(i); if (!li) return;
      li.style.transform = t ? `translateY(${dir * PITCH * t}px)` : '';
      li.style.position = 'relative'; li.style.zIndex = t ? String(z) : '';
      li.style.background = t ? 'var(--bg-panel)' : '';
      li.style.boxShadow = t && i === DOCS ? '0 6px 18px rgba(0,0,0,0.5)' : '';
    });
    const setAction = (i: number, v: string, at: number) => {
      const sel = row(i)?.querySelector<HTMLSelectElement>('select.rebase-action');
      if (!sel) return;
      sel.value = f >= at ? v : 'pick';
      // Without a cursor (the cutdowns) the change still gets a short, readable glow.
      sel.style.boxShadow = !full && f >= at && f < at + 12 ? `0 0 0 2px ${c.indigo}` : '';
    };
    setAction(TOKEN, 'squash', squash);
    setAction(FIX, 'fixup', fixup);
    setAction(DOCS, 'drop', drop);
    const d = row(DOCS);
    d?.classList.toggle('rebase-dropped', f >= drop);
    if (d) d.style.opacity = f >= drop ? '0.45' : '';
    const a = q(root, '#rebase-autosquash') as HTMLInputElement | null;
    if (a) a.checked = f >= auto;
  };
  return (
    <AbsoluteFill style={{ background: c.background }}>
      {!hook && (
        <Stage keys={keys} duration={placed.duration}>
          <AppLayer snap="workspace-body" base />
          {!splitOnly && <ModalLayer snap="rebase-planner" open={collapse} close={full ? start + 2 : splitPulse - 2} apply={applyPlan} />}
          <ModalLayer snap="rebase-edit-stop" open={splitOnly ? -30 : full ? splitPulse : splitPulse - 2} close={full ? confirm + 1 : confirm} />
          <ModalLayer snap="split-confirm" open={full ? confirm + 3 : confirm} close={full ? splitClick + 1 : split}
            apply={(root, f) => { const b = q(root, '#btn-confirm-ok'); if (b) b.style.boxShadow = !full && f >= splitClick && f < splitClick + 12 ? `0 0 0 3px ${c.indigo}` : ''; }} />
        </Stage>
      )}
      {splitOnly && <HeadlineScrim />}
      {!splitOnly && !hook && <HeadlineBlock lines={[{ text: copy.sceneD.headline, at: cu.at('headline'), exitAt: full ? collapse : undefined }]} />}
      {hook && <Kinetic text={copy.vertical.hook} at={cu.at('headline') - 6} style={{ ...TYPE.hero, fontSize: 96, position: 'absolute', left: 90, top: 290, width: width - 180 }} />}
      {!splitOnly && <SpellStack lines={copy.spells.d} at={cu.at('spell')} collapseAt={hook ? undefined : collapse}
        box={vertical ? { x: 60, y: 720, w: width - 120 } : spellBox(copy.sceneD.headline)} target={hook ? undefined : screen(land, rect('planner', '#rebase-plan-list'))} fontSize={vertical ? 30 : 28} />}
      {splitOnly && <SpellStack lines={copy.spells.d} at={-40} collapseAt={0} box={vertical ? { x: 60, y: 720, w: width - 120 } : SPELL_BOX} target={screen(8, splitBtn)} fontSize={vertical ? 30 : 28} />}
      {frame >= splitPulse && frame < confirm && <TargetPulse rect={screen(splitPulse + (full ? 4 : 0), splitBtn)} at={splitPulse + (full ? 4 : 0)} />}
      {full && (
        <Cursor map={camMap(keys, placed.duration)} stops={[
          { at: land, x: 1000, y: 560 },
          clickOn(move1, planRect(DOCS, MOVE_UP)),
          clickOn(squash, planRect(TOKEN, SEL)),
          clickOn(fixup, planRect(4, SEL)), // the fixup! row sits in the last slot after the reorder
          clickOn(drop, planRect(3, SEL)), // and "docs" in the one above it
          clickOn(auto, rect('planner', '#rebase-autosquash')),
          clickOn(start, rect('planner', '#btn-rebase-start')),
          clickOn(confirm, splitBtn),
          clickOn(splitClick, okBtn),
        ]} enterAt={land} exitAt={split} />
      )}
      {frame >= split && <SplitNodes at={split} x={vertical ? width / 2 : FEATURE_ANCHOR.x} y={vertical ? 900 : 560} />}
      {cu.has('small') && <Sub text={copy.sceneD.small} at={cu.at('small')} y={vertical ? 1440 : 930} x={vertical ? 70 : 96} width={vertical ? width - 140 : 1400} size={34} />}
    </AbsoluteFill>
  );
};

/** One commit node splits into three, on a graph lane. */
const SplitNodes: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const t = pop(frame, at + 3, 30, { damping: 13, stiffness: 190, mass: 0.8 });
  const nodes = [-1, 0, 1];
  return (
    <div style={{ position: 'absolute', left: x - 300, top: y - 180, width: 600, height: 360 }}>
      <div style={{ position: 'absolute', inset: -120, background: `radial-gradient(ellipse at center, ${c.background}f2 0%, ${c.background}cc 45%, transparent 72%)` }} />
      <svg width={600} height={360} style={{ overflow: 'visible' }}>
        <line x1={300} y1={-40} x2={300} y2={400} stroke={c.indigo} strokeWidth={8} strokeLinecap="round" opacity={0.7} />
        {nodes.map((k) => (
          <g key={k} transform={`translate(300 ${180 + k * 110 * t})`}>
            <circle r={34} fill={c.indigo} stroke={c.background} strokeWidth={8} />
            <circle r={52} fill="none" stroke={c.indigo} strokeWidth={3} opacity={k === 0 ? 1 - prog(frame, at, 14) : 0} />
          </g>
        ))}
      </svg>
    </div>
  );
};

// ------------------------------------------------------------------ scene E --
export const SceneE: React.FC<SceneProps> = ({ placed, variant }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy } = useFilm();
  const cu = cues(placed.def);
  const collapse = cu.at('collapse'), land = collapse + 8;
  const rows = [cu.at('row1'), cu.at('row2'), cu.at('row3')];
  const windowsAt = cu.at('windows', 9999), launcher = cu.at('launcher', 9999), cards = [cu.at('card1', 9999), cu.at('card2', 9999), cu.at('card3', 9999)], fly = cu.at('fly', 9999);
  const terminals = cu.at('terminals'), small = cu.at('small');
  const wtAt: R = { x: 20, y: 470, w: 240, h: 225 };
  const wtRows = ['acme-api', 'login', 'search'].map((n) => { const r = rect('worktrees', `.worktree-item::${n}`); const base = rect('worktrees', '.sidebar-section'); return { ...r, y: r.y - base.y + wtAt.y }; });
  const keys: CamKey[] = [
    { at: 0, x: 330, y: 560, scale: 1.7 },
    { at: land + 6, x: 300, y: 600, scale: 2.0, dur: 7 },
    ...(launcher < 9999 ? [{ at: launcher - 2, x: 800, y: 290, scale: 1.55, dur: 6 }] : []),
  ];
  const sectionVis = frame < launcher - 2;
  const agentVis = frame >= launcher - 2 && frame < fly + 8;
  const showStage = frame < terminals;
  return (
    <AbsoluteFill style={{ background: c.background }}>
      {showStage && (
        <Stage keys={keys} duration={placed.duration}>
          <AppLayer snap="workspace-body" base />
          {sectionVis && <AppLayer snap="worktrees-section" at={wtAt} apply={(root, f) => {
            qa(root, '.worktree-item').forEach((li, i) => {
              const t = pop(f, rows[i] ?? rows[0]);
              li.style.transform = `translate(${(1 - t) * -30}px, ${(1 - t) * -24 * (i + 1)}px) rotate(${(1 - t) * -8}deg)`;
              li.style.transformOrigin = '0 0';
              li.style.opacity = String(clamp01(t));
              li.style.boxShadow = f >= rows[i] && f < rows[i] + 10 ? `inset 3px 0 0 ${[c.emerald, c.cyan, c.indigo][i]}` : '';
            });
          }} />}
          {agentVis && <AppLayer snap="agent-launch" apply={(root, f) => {
            ['claude', 'codex', 'gemini'].forEach((id, i) => {
              const el = q(root, `[data-agent-id="${id}"]`);
              if (!el) return;
              const on = f >= cards[i] && f < fly;
              el.classList.toggle('agent-card-selected', on);
              el.style.boxShadow = on ? `0 0 0 2px ${c.indigo}, 0 0 34px ${c.indigo}88` : '';
              el.style.transform = f >= fly ? `translate(${(i - 1) * 300 * expoIn(prog(f, fly, 8))}px, ${600 * expoIn(prog(f, fly, 8))}px) scale(${1 - 0.5 * expoIn(prog(f, fly, 8))})` : '';
            });
            const card0 = q(root, '.modal-card'); if (card0) card0.style.opacity = String(enter(f, launcher - 2, 6));
          }} />}
        </Stage>
      )}
      {showStage && frame >= windowsAt && frame < launcher && <MiniWindows at={windowsAt} keys={keys} rows={wtRows} />}
      {frame >= terminals && <AgentTerminals at={terminals} compact={wrappedV(variant)} />}
      {!wrappedV(variant) && <HeadlineBlock lines={[{ text: copy.sceneE.headline, at: cu.at('headline'), size: 96 }]} />}
      <SpellStack lines={copy.spells.e} at={cu.at('spell')} collapseAt={collapse} box={spellBox(wrappedV(variant) ? null : copy.sceneE.headline, 330, 96)} target={toScreen(keys, land, wtAt)} />
      {!wrappedV(variant) && <Sub text={copy.sceneE.small} at={small} y={868} size={34} width={1700} color={c.text} />}
    </AbsoluteFill>
  );
};

const MiniWindows: React.FC<{ at: number; keys: CamKey[]; rows: R[] }> = ({ at, keys, rows }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  return (
    <>
      {rows.map((r, i) => {
        const s = toScreen(keys, at, r);
        const t = pop(frame, at + i * 2);
        const tx = 900 + i * 60, ty = 150 + i * 190;
        return (
          <div key={i} style={{ position: 'absolute', left: lerp(s.x + s.w, tx, t), top: lerp(s.y, ty, t), width: 440, height: 250, transform: `scale(${0.2 + 0.8 * t})`, transformOrigin: '0 0',
            borderRadius: 12, overflow: 'hidden', border: `2px solid ${[c.emerald, c.cyan, c.indigo][i]}`, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', background: c.panel }}>
            <div style={{ transform: 'scale(0.275)', transformOrigin: '0 0', width: 1600, height: 1000, position: 'relative' }}>
              <AppLayer snap="workspace-body" base />
            </div>
          </div>
        );
      })}
    </>
  );
};

const AgentTerminals: React.FC<{ at: number; compact?: boolean }> = ({ at, compact }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const items = [
    { title: '~/code/acme-api.worktrees/login', cmd: 'claude', col: c.cyan },
    { title: '~/code/acme-api.worktrees/search', cmd: 'codex', col: c.indigo },
    { title: '~/code/acme-api', cmd: 'gemini', col: c.emerald },
  ];
  return (
    <>
      {items.map((it, i) => {
        const t = pop(frame, at + i * 2);
        return (
          <div key={i} style={{ position: 'absolute', left: compact ? 716 + i * 318 : 96 + i * 586, top: compact ? 470 : 330, transform: `translateY(${(1 - t) * 60}px)`, opacity: clamp01(t) }}>
            <TerminalWindow title={compact ? it.title.replace('~/code/', '') : it.title} width={compact ? 300 : 556} height={compact ? 260 : 400} accent={it.col}>
              <div style={{ fontFamily: FONT.mono, fontSize: 40, color: c.text }}><span style={{ color: c.emerald }}>$ </span>{it.cmd}</div>
              <div style={{ marginTop: 14 }}><Caret size={36} /></div>
            </TerminalWindow>
          </div>
        );
      })}
    </>
  );
};

// ------------------------------------------------------------------ scene F --
// The film's own actions, in order (the second hard reset is the restore).
const RESTORE_TO = /back to ([0-9a-f]{7,})/.exec(SNAP['restore-confirm'] ?? '')?.[1] ?? '';
const RESET_TO = /Reset \(hard\) to ([0-9a-f]{7,})/.exec(SNAP['restore-confirm'] ?? '')?.[1] ?? '';
const FILM_CMDS = [/core\.sshCommand.*id_ed25519_work/, /user\.email jane@acme\.example/, /apply .*--cached/, /apply .*--reverse/, /^git commit -m/,
  new RegExp(`^git reset --hard ${RESET_TO || '[0-9a-f]'}`), new RegExp(`^git reset --hard ${RESTORE_TO || '[0-9a-f]'}`), /^git worktree add/];
const RECORDS = (writes as { command: LogRecord }[]).map((w) => w.command);
const recordFor = (i: number): LogRecord | undefined => RECORDS.find((r) => FILM_CMDS[i].test(r.argv.join(' ')));

export const SceneF: React.FC<SceneProps> = ({ placed }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy } = useFilm();
  const cu = cues(placed.def);
  const crack = cu.at('crack'), pour = cu.at('pour'), hover = cu.at('hover'), copyAt = cu.at('copy'), glint = cu.at('glint'), keysAt = cu.at('keys');
  const every = 3, landT = 16;
  const keys: CamKey[] = [
    { at: 0, x: 620, y: 880, scale: 1.75 },
    { at: hover - 4, x: 1000, y: 880, scale: 1.75, dur: 7 },
    { at: keysAt + 2, x: 800, y: 330, scale: 1.45, dur: 6 },
  ];
  const paletteVis = frame >= keysAt + 3;
  const hoverLine = 4; // the commit line
  const applyTerm = (root: HTMLElement, f: number) => {
    const body = q(root, '#terminal-body');
    if (!body) return;
    if (!body.dataset.mg) {
      const all = qa(body, '.terminal-line-cmd');
      const picked = FILM_CMDS.map((re) => all.find((l) => re.test(q(l, '.terminal-command')?.textContent ?? '')) ?? null).filter(Boolean) as HTMLElement[];
      body.innerHTML = '';
      const wrap = document.createElement('div');
      picked.forEach((p) => wrap.appendChild(p.cloneNode(true)));
      body.appendChild(wrap);
      body.dataset.mg = '1';
    }
    qa(body, '.terminal-line-cmd').forEach((l, i) => {
      const t = clamp01((f - (pour + landT + i * every)) / 4);
      l.style.opacity = String(t);
      l.style.transform = `translateY(${(1 - t) * -10}px)`;
      const hov = i === hoverLine && f >= hover;
      l.style.background = hov ? 'rgba(99,102,241,0.18)' : '';
      const btn = q(l, '.terminal-copy');
      if (btn) btn.style.opacity = hov ? '1' : '';
    });
  };
  const rec = recordFor(hoverLine);
  const termBody = rect('terminal', '#terminal-body');
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <Stage keys={keys} duration={placed.duration}>
        <AppLayer snap="workspace-body" base />
        <AppLayer snap="terminal-panel" at="bottom" apply={applyTerm} />
        {paletteVis && <AppLayer snap="palette" apply={(root, f) => { const card0 = q(root, '.modal-card') ?? (q(root, '#palette-modal')?.firstElementChild as HTMLElement | null); if (card0) { const t = expoOut(prog(f, keysAt + 3, 6)); card0.style.transform = `scale(${0.9 + 0.1 * t})`; card0.style.opacity = String(t); } }} />}
      </Stage>
      <CounterCrack at={crack} pour={pour} landT={landT} every={every} target={toScreen(keys, pour + landT, termBody)} />
      <HeadlineBlock width={1150} lines={[{ kind: 'sub', text: copy.sceneF.line1, at: cu.at('line1'), size: 52, color: c.text }, { text: copy.sceneF.line2, at: cu.at('line2'), size: 96 }]} />
      <HeadlineBlock scrim={false} lines={[{ text: copy.sceneF.noBlackBox, at: cu.at('noBlackBox'), exitAt: cu.at('line1') - 8 }]} />
      <Cursor map={camMap(keys, placed.duration)} stops={[{ at: hover - 10, x: 1300, y: 760 }, { at: hover, x: 1520, y: 822 + hoverLine * 22 }, clickOn(copyAt, { x: 1500, y: 811 + hoverLine * 22, w: 60, h: 22 })]}
        enterAt={hover - 10} exitAt={glint} />
      {rec && frame >= copyAt && frame < glint && <Caption text={`${tildify(rec.cwd)} · exit ${rec.exitCode ?? 0} · ${rec.durationMs ?? 0} ms`} at={copyAt} exitAt={glint - 7} x={96} y={470} icon="content_copy" />}
      {frame >= glint && (
        <LaneTrails width={W} height={H} lanes={[{ d: `M -100 ${H - 70} C 500 ${H - 100}, 1300 ${H - 40}, ${W + 100} ${H - 80}`, color: c.cyan, head: 0.1 + 1.2 * prog(frame, glint, 16), tail: 0.5, width: 7 }]} />
      )}
      <Sub text={copy.sceneF.learn} at={glint + 2} y={900} size={52} color={c.cyan} />
      {frame >= keysAt - 2 && <KeyCombo keys={['Ctrl', 'K']} enterAt={keysAt - 2} pressAt={keysAt} style={{ position: 'absolute', left: 96, top: 760, opacity: leave(frame, keysAt + 12, 5) }} />}
    </AbsoluteFill>
  );
};

/** The corner counter cracks and its glyphs pour down into the Terminal panel. */
const CounterCrack: React.FC<{ at: number; pour: number; landT: number; every: number; target: R }> = ({ at, pour, landT, target }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy } = useFilm();
  const text = `${copy.counterLabel} 25`;
  const box = { right: 96, top: 54 };
  if (frame < at || frame > pour + landT + 12) return null;
  const cracked = frame >= at;
  const origin = { x: W - box.right - 440, y: box.top + 28 };
  return (
    <>
      {frame < pour + 3 && (
        <div style={{ position: 'absolute', right: box.right, top: box.top, padding: '10px 18px', borderRadius: 14, background: 'rgba(17,20,26,0.9)', border: `1.5px solid ${c.indigo}`,
          fontFamily: FONT.mono, fontSize: 28, color: c.muted, transform: `translateX(${Math.sin(frame * 3) * 3}px)` }}>
          {text}
          {cracked && (
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <polyline points="30,0 60,22 48,38 90,64" fill="none" stroke={c.text} strokeWidth={2.5} opacity={0.9} />
              <polyline points="260,64 238,40 270,24 250,0" fill="none" stroke={c.text} strokeWidth={2.5} opacity={0.9} />
            </svg>
          )}
        </div>
      )}
      {text.split('').map((ch, i) => {
        if (ch === ' ') return null;
        const t0 = pour + i * 0.5;
        const t = clamp01((frame - t0) / landT);
        if (frame < t0 || t >= 1) return null;
        const e = expoIn(t);
        const sx = origin.x + i * 16.8, sy = origin.y;
        const tx = target.x + 40 + (i % 8) * 60, ty = target.y + 20 + Math.floor(i / 8) * 26;
        const x = lerp(sx, tx, e) + Math.sin(t * Math.PI) * -120, y = lerp(sy, ty, e);
        return <div key={i} style={{ position: 'absolute', left: x, top: y, fontFamily: FONT.mono, fontSize: 28, color: c.indigo, opacity: 1 - 0.4 * t, textShadow: `0 0 12px ${c.indigo}` }}>{ch}</div>;
      })}
    </>
  );
};

export const featureScenes = { SceneA, SceneB, SceneC, SceneD, SceneE, SceneF };
