// Split-flap counter: `commands you didn't type: N`. Each digit flips in 4
// frames; the value comes from the timeline (valueAt). Modes: the corner
// counter, and the huge hero counter for the stinger.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { FONT, useColors } from '../theme';

const digitsOf = (v: number, width: number) => String(Math.max(0, Math.floor(v))).padStart(width, ' ').slice(-width).split('');

const Flap: React.FC<{ from: string; to: string; t: number; size: number; bg: string; fg: string; line: string }> = ({ from, to, t, size, bg, fg, line }) => {
  const w = size * 0.72, h = size * 1.28;
  const half = (ch: string, top: boolean, rot = 0): React.ReactNode => (
    <div style={{ position: 'absolute', left: 0, top: top ? 0 : h / 2, width: w, height: h / 2, overflow: 'hidden', background: bg, borderRadius: top ? `${size * 0.1}px ${size * 0.1}px 0 0` : `0 0 ${size * 0.1}px ${size * 0.1}px`,
      transformOrigin: top ? '50% 100%' : '50% 0%', transform: rot ? `perspective(${size * 6}px) rotateX(${rot}deg)` : undefined, backfaceVisibility: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: top ? 0 : -h / 2, width: w, height: h, lineHeight: `${h}px`, textAlign: 'center', fontFamily: FONT.mono, fontWeight: 500, fontSize: size, color: fg }}>{ch.trim() ? ch : ''}</div>
    </div>
  );
  const flipping = t > 0 && t < 1 && from !== to;
  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      {half(flipping ? to : to, true)}
      {half(flipping && t < 0.5 ? from : to, false)}
      {flipping && t < 0.5 && half(from, true, -180 * t)}
      {flipping && t >= 0.5 && half(to, false, 180 * (1 - t))}
      <div style={{ position: 'absolute', left: 0, top: h / 2 - 1, width: w, height: 2, background: line }} />
    </div>
  );
};

export const SplitFlap: React.FC<{ valueAt: (f: number) => number; size: number; width?: number; color?: string; frameOverride?: number }> = ({ valueAt, size, width = 2, color, frameOverride }) => {
  const now = useCurrentFrame();
  const frame = frameOverride ?? now;
  const c = useColors();
  const cur = digitsOf(valueAt(frame), width);
  return (
    <div style={{ display: 'flex', gap: size * 0.08 }}>
      {cur.map((d, i) => {
        // The most recent change of this digit within the last 4 frames.
        let from = d, t = 1;
        for (let k = 1; k <= 4; k++) {
          const prev = digitsOf(valueAt(frame - k), width)[i];
          const next = digitsOf(valueAt(frame - k + 1), width)[i];
          if (prev !== next) { from = prev; t = k / 4; break; }
        }
        if (t >= 1) from = d;
        return <Flap key={i} from={from} to={d} t={t === 1 ? 1 : t - 0.25 + 0.25} size={size} bg={c.card} fg={color ?? c.text} line={c.background} />;
      })}
    </div>
  );
};

export const CornerCounter: React.FC<{ valueAt: (f: number) => number; label: string; x: number; y: number; opacity?: number; scale?: number; accent?: boolean }> = ({ valueAt, label, x, y, opacity = 1, scale = 1, accent }) => {
  const c = useColors();
  return (
    <div style={{ position: 'absolute', right: x, top: y, display: 'flex', alignItems: 'center', gap: 14, opacity, transform: `scale(${scale})`, transformOrigin: '100% 0',
      padding: '10px 14px 10px 18px', borderRadius: 14, background: 'rgba(17,20,26,0.82)', border: `1.5px solid ${accent ? c.indigo : c.border}`,
      boxShadow: accent ? `0 0 28px ${c.indigo}55` : '0 10px 30px rgba(0,0,0,0.4)' }}>
      <span style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, color: c.muted }}>{label}</span>
      <SplitFlap valueAt={valueAt} size={28} />
    </div>
  );
};
