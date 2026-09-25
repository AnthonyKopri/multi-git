// Cold open, the two lanes (with the switcher jab) and the reveal.
import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { clamp01, enter, expoIn, expoOut, leave, lerp, pop, prog } from '../lib/anim';
import { Camera } from '../primitives/Camera';
import { Headline, Kinetic } from '../primitives/Headline';
import { LaneTrails } from '../primitives/LaneTrails';
import { LogoMerge, logoPoint, TRUNK_BASE } from '../primitives/LogoMerge';
import { Caret } from '../primitives/Terminal';
import { FONT, TYPE, useColors, useFilm } from '../theme';
import { AppLayer, AppWindow, cues, q, qa } from './kit';
import type { SceneProps } from './types';

// ---------------------------------------------------------------- cold open --
interface TLine { kind: 'cmd' | 'out' | 'err'; text: string; at: number; typed?: number }

const TerminalCard: React.FC<{ lines: TLine[]; vim?: { at: number; lines: string[] } | null; frame: number; w: number; h: number; errFlash: number }> = ({ lines, vim, frame, w, h, errFlash }) => {
  const c = useColors();
  const fs = 32, lh = fs * 1.4;
  const visible = lines.filter((l) => frame >= l.at);
  const maxRows = Math.floor((h - 110) / lh);
  const shown = visible.slice(-maxRows);
  const inVim = vim && frame >= vim.at;
  return (
    <div style={{ width: w, height: h, borderRadius: 20, background: c.panel, border: `2px solid ${errFlash > 0 ? `rgba(239,68,68,${0.35 + 0.5 * errFlash})` : c.border}`, overflow: 'hidden', position: 'relative',
      boxShadow: `0 50px 140px rgba(0,0,0,0.7), 0 0 ${80 * errFlash}px rgba(239,68,68,${0.35 * errFlash})` }}>
      <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px', background: c.panel, borderBottom: `1px solid ${c.border}`, fontFamily: FONT.mono, fontSize: 24, color: c.muted }}>
        <span className="material-symbols-outlined" style={{ fontSize: 28 }}>terminal</span>~/code/acme-api
      </div>
      <div style={{ padding: '22px 30px', fontFamily: FONT.mono, fontSize: fs, lineHeight: `${lh}px`, whiteSpace: 'pre' }}>
        {inVim
          ? vim!.lines.slice(0, Math.max(1, Math.floor((frame - vim!.at) * 1.4) + 1)).slice(0, maxRows).map((l, i) => (
            <div key={i} style={{ color: l.startsWith('#') ? c.spell : l === '~' ? '#4b5563' : l.startsWith('--') ? c.text : '#c7cdd6', fontWeight: l.startsWith('--') ? 700 : 400 }}>{l || ' '}</div>
          ))
          : shown.map((l, i) => {
            const isLast = i === shown.length - 1;
            const text = l.kind === 'cmd' && l.typed !== undefined ? l.text.slice(0, Math.min(l.text.length, Math.floor(l.typed + (frame - l.at) * 2))) : l.text;
            return (
              <div key={i} style={{ color: l.kind === 'err' ? c.red : l.kind === 'out' ? c.muted : c.text, textShadow: l.kind === 'err' ? `0 0 18px ${c.red}88` : undefined }}>
                {l.kind === 'cmd' ? <span style={{ color: c.emerald }}>$ </span> : null}{text}{isLast && l.kind === 'cmd' ? <Caret size={fs} /> : null}
              </div>
            );
          })}
      </div>
    </div>
  );
};

// 24 shards: a 4x3 grid, each cell cut into two triangles.
const SHARDS = Array.from({ length: 12 }, (_, i) => {
  const gx = i % 4, gy = Math.floor(i / 4);
  const x0 = gx * 25, x1 = x0 + 25, y0 = gy * 33.34, y1 = Math.min(100, y0 + 33.34);
  const jx = random(`sx${i}`) * 8 - 4, jy = random(`sy${i}`) * 8 - 4;
  return [
    `${x0}% ${y0}%, ${x1 + jx}% ${y0}%, ${x0}% ${y1 + jy}%`,
    `${x1 + jx}% ${y0}%, ${x1}% ${y1}%, ${x0}% ${y1 + jy}%`,
  ].map((poly, k) => ({ poly, cx: (x0 + x1) / 200, cy: (y0 + y1) / 200, k: i * 2 + k }));
}).flat();

export const ColdOpen: React.FC<SceneProps> = ({ placed }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy, width, height } = useFilm();
  const co = copy.coldOpen;
  const cu = cues(placed.def);
  const pushErr = cu.at('pushError'), reset = cu.at('reset'), resetOut = cu.at('resetOut'), dropout = cu.at('dropout'), wait = cu.at('wait');
  const hasRebase = cu.has('rebase'), rebase = cu.at('rebase', 9999), vimAt = cu.at('vimFlood', 9999), conflict = cu.at('conflict', 9999);
  const shatter = cu.has('shatter') ? cu.at('shatter') : 9999;
  const lines: TLine[] = [
    { kind: 'cmd', text: co.push, at: 0, typed: 6 },
    { kind: 'err', text: co.pushError[0], at: pushErr },
    { kind: 'err', text: co.pushError[1], at: pushErr + 2 },
    { kind: 'cmd', text: co.reset, at: reset, typed: 0 },
    { kind: 'out', text: co.resetOut, at: resetOut },
  ];
  if (hasRebase) {
    lines.push({ kind: 'cmd', text: co.rebase, at: rebase, typed: 0 });
    lines.push({ kind: 'err', text: co.conflict[0], at: conflict }, { kind: 'err', text: co.conflict[1], at: conflict + 2 });
  }
  const errHits = [pushErr, resetOut, conflict].filter((f) => f < 9999);
  const errFlash = Math.max(0, ...errHits.map((f) => (frame >= f ? 1 - prog(frame, f, 14) : 0)));
  const vim = hasRebase && frame < conflict ? { at: vimAt, lines: co.vim } : null;
  const W = Math.min(1400, width - 192), H = 520;
  const cardX = (width - W) / 2, cardY = (height - H) / 2 - 10;
  // Music drops out on beat 3 of bar 2: the card dims and "...wait." lands on beat 4.
  const dim = frame >= dropout && frame < (hasRebase ? rebase : placed.duration) ? 0.8 : 0;
  const shattered = frame >= shatter;
  const st = prog(frame, shatter, 16);
  const card = (
    <TerminalCard lines={lines} vim={vim} frame={frame} w={W} h={H} errFlash={errFlash} />
  );
  const laneStart = shatter + 3;
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <Camera keys={[{ at: 0, x: width / 2, y: height / 2, scale: 1 }]} width={width} height={height} drift={0.03} driftFrames={placed.duration} shakes={errHits.concat(hasRebase ? [rebase] : [])}>
        {!shattered && <div style={{ position: 'absolute', left: cardX, top: cardY, opacity: 1 - dim, transform: `scale(${1 - 0.02 * dim})` }}>{card}</div>}
        {shattered && st < 1 && SHARDS.map((s) => {
          const dx = (s.cx - 0.5) * 900 + 700 + random(`dx${s.k}`) * 300, dy = (s.cy - 0.5) * 800 + (random(`dy${s.k}`) - 0.5) * 200;
          const e = expoOut(st);
          return (
            <div key={s.k} style={{ position: 'absolute', left: cardX, top: cardY, clipPath: `polygon(${s.poly})`, opacity: 1 - st,
              transform: `translate(${dx * e}px, ${dy * e}px) rotate(${(random(`r${s.k}`) - 0.5) * 50 * e}deg) scale(${1 - 0.3 * e})`, transformOrigin: `${s.cx * 100}% ${s.cy * 100}%` }}>
              {card}
            </div>
          );
        })}
      </Camera>
      {frame >= wait && frame < (hasRebase ? rebase : placed.duration + 1) && (
        <>
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 50%, ${c.background}f0 0%, ${c.background}b0 40%, transparent 70%)` }} />
          <Headline text={co.wait} at={wait} size={150} style={{ position: 'absolute', left: 0, width, top: height / 2 - 90, textAlign: 'center' }} />
        </>
      )}
      {shattered && (
        <>
          <LaneTrails width={width} height={height} lanes={[
            { d: `M ${width / 2 - 100} ${height / 2} C ${width * 0.62} ${height * 0.2}, ${width * 0.85} ${height * 0.3}, ${width + 200} ${height * 0.33}`, color: c.cyan, head: prog(frame, laneStart, 20) * 1.05, tail: 0.6, width: 7 },
            { d: `M ${width / 2 - 100} ${height / 2} C ${width * 0.62} ${height * 0.8}, ${width * 0.85} ${height * 0.7}, ${width + 200} ${height * 0.69}`, color: c.indigo, head: prog(frame, laneStart + 3, 20) * 1.05, tail: 0.6, width: 7 },
          ]} />
          <Headline text={co.line1} at={cu.at('line1')} size={120} style={{ position: 'absolute', left: 96, top: height / 2 - 150, width: 1200 }} />
          <Headline text={co.line2} at={cu.at('line2')} size={120} style={{ position: 'absolute', left: 96, top: height / 2 - 20, width: 1400 }} />
        </>
      )}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------- lanes --
const Chip: React.FC<{ text: string; color: string; at: number; exitAt?: number; x: number; y: number }> = ({ text, color, at, exitAt, x, y }) => {
  const frame = useCurrentFrame();
  const v = enter(frame, at, 10) * (exitAt === undefined ? 1 : leave(frame, exitAt, 7));
  return (
    <div style={{ position: 'absolute', left: x, top: y, ...TYPE.chip, color, padding: '8px 18px', borderRadius: 999, background: `${color}1f`, border: `1.5px solid ${color}66`,
      opacity: v, transform: `translateX(${(1 - v) * -30}px)` }}>{text}</div>
  );
};

const PainCard: React.FC<{ text: string; color: string; at: number; exitAt: number; x: number; y: number; width: number }> = ({ text, color, at, exitAt, x, y, width }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  if (frame < at || frame >= exitAt + 8) return null;
  const inT = expoOut(prog(frame, at, 12)), outT = expoIn(prog(frame, exitAt, 8));
  const tx = (1 - inT) * (1920 - x) - outT * (x + width + 200);
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translateX(${tx}px)`, padding: '26px 38px', borderRadius: 22, background: c.card, border: `2px solid ${color}88`,
      boxShadow: `0 0 50px ${color}30, 0 20px 60px rgba(0,0,0,0.5)` }}>
      <Kinetic text={text} at={at + 3} style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 56, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }} />
    </div>
  );
};

export const Questions: React.FC<{ qs: string[]; ats: number[]; y0: number; gap: number; width: number; size?: number; exitAt?: number }> = ({ qs, ats, y0, gap, width, size = 76, exitAt }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const out = exitAt === undefined ? 1 : leave(frame, exitAt, 7);
  return (
    <>
      {qs.map((qq, i) => {
        if (frame < ats[i]) return null;
        const later = ats.slice(i + 1).some((a) => frame >= a);
        const p = pop(frame, ats[i]);
        return (
          <div key={i} style={{ position: 'absolute', left: 0, width, top: y0 + i * gap, textAlign: 'center', fontFamily: FONT.sans, fontWeight: 700, fontSize: size, letterSpacing: '-0.02em',
            color: c.text, opacity: (later ? 0.4 : 1) * out, transform: `scale(${0.85 + 0.15 * p})` }}>{qq}</div>
        );
      })}
    </>
  );
};

export const Lanes: React.FC<SceneProps> = ({ placed, variant }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy, width, height } = useFilm();
  const L = copy.lanes;
  const cu = cues(placed.def);
  const jab = cu.at('jab', 9999);
  const jabOnly = variant === 'jab';
  const apart = jabOnly ? 1 : expoOut(prog(frame, jab, 12));
  const yC = lerp(360, 120, apart), yI = lerp(740, 960, apart);
  const flow = (y: number, k: number) => `M -200 ${y + 10 * Math.sin(k)} C ${width * 0.3} ${y - 28}, ${width * 0.65} ${y + 28}, ${width + 200} ${y - 8}`;
  const drawIn = jabOnly ? 1 : prog(frame, 0, 14);
  const pulseHead = (off: number) => ((frame + off) % 45) / 45 * 1.25;
  const cards: [number, number][] = [[cu.at('cyan1'), cu.at('indigo1')], [cu.at('cyan2'), cu.at('indigo2')], [cu.at('cyan3'), cu.at('indigo3')]];
  const qAts = ['q1', 'q2', 'q3', 'q4'].map((k) => cu.at(k));
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <LaneTrails width={width} height={height} lanes={[
        { d: flow(yC, 0), color: c.cyan, head: 0.1 + 1.0 * drawIn, tail: 1.2, width: 6, opacity: 0.85 },
        { d: flow(yI, 1), color: c.indigo, head: 0.1 + 1.0 * drawIn, tail: 1.2, width: 6, opacity: 0.85 },
        { d: flow(yC, 0), color: '#a5f3fc', head: pulseHead(0), tail: 0.12, width: 4 },
        { d: flow(yI, 1), color: '#c7d2fe', head: pulseHead(22), tail: 0.12, width: 4 },
      ]} />
      {!jabOnly && (
        <>
          <Chip text={L.cyanLabel} color={c.cyan} at={cu.at('labels')} exitAt={jab} x={96} y={200} />
          <Chip text={L.indigoLabel} color={c.indigo} at={cu.at('labels') + 4} exitAt={jab} x={96} y={580} />
          {cards.map(([ca, ia], i) => {
            const nextC = cards[i + 1]?.[0] ?? jab, nextI = cards[i + 1]?.[1] ?? jab;
            return (
              <React.Fragment key={i}>
                <PainCard text={L.pains[i][0]} color={c.cyan} at={ca} exitAt={nextC} x={96} y={290} width={1300} />
                <PainCard text={L.pains[i][1]} color={c.indigo} at={ia} exitAt={nextI} x={96} y={670} width={1300} />
              </React.Fragment>
            );
          })}
        </>
      )}
      <Questions qs={L.questions} ats={qAts} y0={jabOnly ? 290 : 290} gap={128} width={width} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ reveal --
export const Reveal: React.FC<SceneProps> = ({ placed, variant }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy, width, height } = useFilm();
  const R = copy.reveal;
  const cu = cues(placed.def);
  const vertical = height > width;
  const drop = cu.at('drop', 0);
  const taglineOnly = variant === 'tagline';
  const wm = cu.has('wordmark') ? cu.at('wordmark') : 9999;
  const assemble = cu.has('header') ? cu.at('header') : 9999;
  // Logo placement: centred for the fusion, then it slides left for the wordmark.
  const slide = expoOut(prog(frame, wm, 9));
  const baseSize = vertical ? 520 : 470;
  const size = lerp(baseSize, vertical ? 520 : 380, slide);
  const cx = vertical ? width / 2 : lerp(width / 2, 590, slide);
  const cy = vertical ? (taglineOnly ? 620 : 820) : 480;
  const lift = expoIn(prog(frame, assemble, 9));
  const base = logoPoint(TRUNK_BASE.x, TRUNK_BASE.y + 60, cx, cy, size);
  const dive = prog(frame, drop - 4, 7);
  const bloom = frame >= drop ? 0.4 * (1 - prog(frame, drop, 22)) : 0;
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <Camera keys={[{ at: 0, x: width / 2, y: height / 2, scale: 1 }]} width={width} height={height} drift={0.02} driftFrames={placed.duration} shakes={taglineOnly ? [] : [drop]}>
        <div style={{ position: 'absolute', inset: 0, opacity: 1 - lift, transform: `translateY(${-260 * lift}px)` }}>
          {!taglineOnly && frame < drop + 16 && (
            <LaneTrails width={width} height={height} lanes={[
              { d: `M -150 ${height * 0.12} C ${width * 0.25} ${height * 0.1}, ${base.x - 260} ${base.y + 120}, ${base.x} ${base.y}`, color: c.cyan, head: 0.72 + 0.28 * dive, tail: 0.5, width: 8, opacity: 1 - prog(frame, drop + 4, 10) },
              { d: `M ${width + 150} ${height * 0.9} C ${width * 0.75} ${height * 0.95}, ${base.x + 260} ${base.y + 160}, ${base.x} ${base.y}`, color: c.indigo, head: 0.72 + 0.28 * dive, tail: 0.5, width: 8, opacity: 1 - prog(frame, drop + 4, 10) },
            ]} />
          )}
          {bloom > 0 && <div style={{ position: 'absolute', left: cx - 700, top: cy - 700, width: 1400, height: 1400, borderRadius: '50%', background: `radial-gradient(circle, ${c.indigo} 0%, transparent 60%)`, opacity: bloom }} />}
          <LogoMerge id={`reveal-${placed.section}`} at={taglineOnly ? -60 : drop} cx={cx} cy={cy} size={size} still={taglineOnly} />
          {!vertical && frame >= wm && (
            <div style={{ position: 'absolute', left: 820, top: 250 }}>
              <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 160, letterSpacing: '-0.03em', lineHeight: 1, color: c.text,
                transform: `scale(${1 + 0.35 * (1 - expoOut(prog(frame, wm, 7)))})`, transformOrigin: '0 50%', opacity: enter(frame, wm, 4) }}>{R.wordmark}</div>
              <Kinetic text={R.tag1} at={cu.at('tag1')} style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 64, letterSpacing: '-0.02em', marginTop: 34 }} />
              <Kinetic text={R.tag2} at={cu.at('tag2')} color={c.muted} style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 64, letterSpacing: '-0.02em', marginTop: 8 }} />
            </div>
          )}
          {vertical && taglineOnly && (
            <div style={{ position: 'absolute', left: 60, width: width - 120, top: 900, textAlign: 'center' }}>
              <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 140, letterSpacing: '-0.03em', color: c.text }}>{R.wordmark}</div>
              <Kinetic text={R.tag1} at={cu.at('tag1')} style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 92, letterSpacing: '-0.02em', marginTop: 40 }} />
              <Kinetic text={R.tag2} at={cu.at('tag2')} color={c.muted} style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 92, letterSpacing: '-0.02em', marginTop: 10 }} />
            </div>
          )}
        </div>
        {frame >= assemble && <AppAssemble at={assemble} cues={{ sidebar: cu.at('sidebar'), staging: cu.at('staging'), history: cu.at('history') }} caption={R.caption} />}
      </Camera>
    </AbsoluteFill>
  );
};

const AppAssemble: React.FC<{ at: number; cues: { sidebar: number; staging: number; history: number }; caption: string }> = ({ at, cues: k, caption }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const s = 0.78;
  const win = enter(frame, at, 10);
  const reveal = (el: HTMLElement | null, t: number, dx: number, dy: number) => {
    if (!el) return;
    el.style.opacity = String(t);
    el.style.transform = `translate(${(1 - t) * dx}px, ${(1 - t) * dy}px)`;
  };
  return (
    <>
      <div style={{ position: 'absolute', left: (1920 - 1600 * s) / 2, top: 128, width: 1600, height: 1000, transform: `scale(${s * (0.96 + 0.04 * win)})`, transformOrigin: '0 0', opacity: win }}>
        <AppWindow glow={c.indigo}>
          <AppLayer snap="workspace-body" base apply={(root, f) => {
            reveal(q(root, '.navbar'), enter(f, at, 10), 0, -40);
            reveal(q(root, '#sidebar-panel'), enter(f, k.sidebar, 10), -60, 0);
            const main = q(root, '#staging-view')?.parentElement ?? null;
            reveal(main, enter(f, k.staging, 10), 0, 40);
            reveal(q(root, '#history-panel'), enter(f, k.history, 10), 60, 0);
            qa(root, '#commit-history-list > li').forEach((li, i) => {
              const t = clamp01((f - k.history - 2 - i * 0.7) / 5);
              li.style.opacity = String(t);
              for (const p of li.querySelectorAll('path')) { (p as SVGPathElement).style.strokeDasharray = '46'; (p as SVGPathElement).style.strokeDashoffset = String(46 * (1 - t)); }
            });
          }} />
        </AppWindow>
      </div>
      <Kinetic text={caption} at={at + 4} color={c.muted} style={{ ...TYPE.sub, fontSize: 40, position: 'absolute', left: 0, width: 1920, top: 128 + 1000 * s + 22, textAlign: 'center' }} />
    </>
  );
};

export const openingScenes = { ColdOpen, Lanes, Reveal };
