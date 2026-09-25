// The spell: the first line types (about 45 characters a second), then the
// rest floods in with the gap shrinking from 6 frames to 1, all inside the
// flood budget (<= 45 frames). On its cue the stack collapses (8 frames,
// expo-in, with a streak) into the target rect, which then pulses indigo.
import React, { useMemo } from 'react';
import { useCurrentFrame } from 'remotion';
import { measureText } from '@remotion/layout-utils';
import { clamp01, expoIn, pulse, prog } from '../lib/anim';
import { FONT, useColors } from '../theme';

export interface Rect { x: number; y: number; w: number; h: number }

export function spellSchedule(lines: string[], flood = 30) {
  const n = lines.length;
  let gaps = Array.from({ length: Math.max(0, n - 1) }, (_, i) => Math.max(1, Math.round(6 * (1 / 6) ** (i / Math.max(1, n - 2)))));
  const typeWanted = Math.ceil(lines[0].length / 1.5);
  let sum = gaps.reduce((a, b) => a + b, 0);
  const budget = Math.max(8, flood - Math.min(typeWanted, Math.round(flood * 0.4)));
  if (sum > budget) { const k = budget / sum; gaps = gaps.map((g) => Math.max(1, Math.round(g * k))); sum = gaps.reduce((a, b) => a + b, 0); }
  const typeFrames = Math.max(6, Math.min(typeWanted, flood - sum));
  const starts = [0];
  let t = typeFrames;
  for (const g of gaps) { starts.push(t); t += g; }
  return { typeFrames, starts, end: t };
}

export const SpellStack: React.FC<{
  lines: string[]; at: number; collapseAt?: number; target?: Rect; box: { x: number; y: number; w: number };
  fontSize?: number; flood?: number; shaky?: boolean; hideAfterCollapse?: boolean;
}> = ({ lines, at, collapseAt, target, box, fontSize = 28, flood = 30, shaky = false }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const sched = useMemo(() => spellSchedule(lines, flood), [lines, flood]);
  const size = useMemo(() => {
    let fs = fontSize;
    while (fs > 24) {
      const widest = Math.max(...lines.map((l) => measureText({ text: l || ' ', fontFamily: FONT.mono, fontSize: fs, fontWeight: '400' }).width));
      if (widest <= box.w - 48) break;
      fs -= 1;
    }
    return fs;
  }, [lines, fontSize, box.w]);
  const widths = useMemo(() => lines.map((l) => measureText({ text: l || ' ', fontFamily: FONT.mono, fontSize: size, fontWeight: '400' }).width), [lines, size]);
  const lh = size * 1.35;
  const local = frame - at;
  if (local < 0) return null;
  const collapsing = collapseAt !== undefined && frame >= collapseAt;
  const cp = collapsing ? expoIn(prog(frame, collapseAt!, 8)) : 0;
  const done = collapsing && frame >= collapseAt! + 8;
  const stackH = lines.length * lh;
  const plate = { x: box.x, y: box.y, w: Math.min(box.w, Math.max(...widths) + 64), h: stackH + 48 };

  const lineEl = (i: number, p: number, ghost = 1) => {
    const start = sched.starts[i];
    if (local < start) return null;
    const text = i === 0 && local < sched.typeFrames ? lines[0].slice(0, Math.floor(local * 1.5) + 1) : lines[i];
    const appear = i === 0 ? 1 : clamp01((local - start + 1) / 3);
    const lx = plate.x + 32, ly = plate.y + 24 + i * lh;
    let tx = 0, ty = 0, sx = 1, sy = 1, op = appear * ghost;
    if (target && p > 0) {
      const cx = lx + widths[i] / 2, cy = ly + lh / 2;
      tx = (target.x + target.w / 2 - cx) * p; ty = (target.y + target.h / 2 - cy) * p;
      sx = 1 + (Math.min(1, target.w / Math.max(widths[i], 1)) - 1) * p; sy = 1 - 0.8 * p; op *= 1 - 0.7 * p;
    }
    const jitter = shaky && !collapsing ? Math.sin((frame + i * 7) * 2.1) * 2.2 : 0;
    const isComment = /^\s*(#|\()/.test(lines[i]);
    return (
      <div key={`${i}-${ghost}`} style={{
        position: 'absolute', left: lx, top: ly, height: lh, whiteSpace: 'pre', fontFamily: FONT.mono, fontSize: size, lineHeight: `${lh}px`,
        color: isComment ? c.spell : '#b8bfcc', opacity: op, transformOrigin: 'center center',
        transform: `translate(${tx + jitter}px, ${ty + (1 - appear) * 8}px) scale(${sx}, ${sy})`,
        textShadow: `0 0 14px ${c.red}40`,
      }}>{text}{i === 0 && local < sched.typeFrames + 4 && !collapsing ? <span style={{ background: c.text, opacity: 0.8 }}> </span> : null}</div>
    );
  };

  return (
    <>
      {!done && (
        <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', left: plate.x, top: plate.y, width: plate.w, height: plate.h, borderRadius: 18,
            background: 'rgba(10,12,16,0.9)', border: `1.5px solid ${c.red}33`, boxShadow: `0 0 80px ${c.red}22, 0 30px 80px rgba(0,0,0,0.6)`,
            opacity: (1 - cp) * clamp01((local + 1) / 4), transform: target ? `scale(${1 - 0.5 * cp})` : undefined, transformOrigin: 'center',
          }} />
          <div style={{ position: 'absolute', left: plate.x - 80, top: plate.y - 60, width: plate.w + 160, height: plate.h + 120, opacity: 0.25 * (1 - cp),
            background: `radial-gradient(ellipse at center, ${c.red}55 0%, transparent 65%)` }} />
          {collapsing && lines.map((_, i) => lineEl(i, Math.max(0, cp - 0.3), 0.15))}
          {collapsing && lines.map((_, i) => lineEl(i, Math.max(0, cp - 0.15), 0.35))}
          {lines.map((_, i) => lineEl(i, cp))}
        </div>
      )}
      {target && collapseAt !== undefined && <TargetPulse rect={target} at={collapseAt + 8} />}
    </>
  );
};

/** Indigo glow and ring on the collapse target: scale 1 -> 1.08 -> 1 over 6 frames. */
export const TargetPulse: React.FC<{ rect: Rect; at: number; color?: string }> = ({ rect, at, color }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const t = prog(frame, at, 14);
  if (frame < at || t >= 1) return null;
  const s = pulse(frame, at);
  const col = color ?? c.indigo;
  return (
    <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, transform: `scale(${s})`, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: -60, background: `radial-gradient(ellipse at center, ${col}66 0%, transparent 62%)`, opacity: 1 - t }} />
      <div style={{ position: 'absolute', inset: -4, borderRadius: 12, border: `3px solid ${col}`, opacity: 1 - t, boxShadow: `0 0 30px ${col}` }} />
    </div>
  );
};
