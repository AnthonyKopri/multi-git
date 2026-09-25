// Two glowing light trails (cyan: newcomers, indigo: veterans). The head
// leads and the tail fades out along one continuous stroke (a single dash
// painted with a gradient that follows the path), so the trail has no joints.
// The head's glow is a pre-rendered radial sprite.
import React, { useId, useMemo } from 'react';
import { getLength, getPointAtLength } from '@remotion/paths';

/**
 * `head` and `tail` are fractions of the path's length. A head past 1 stays
 * at the end of the path, unless `exit` is set: then the head runs off the
 * end and the tail follows it out.
 */
export interface Lane { d: string; color: string; head: number; tail?: number; width?: number; opacity?: number; exit?: boolean }

const STOPS = 12;
const at = (d: string, s: number) => getPointAtLength(d, s) ?? { x: 0, y: 0 };

interface Stop { offset: number; u: number }

/**
 * Gradient stops for the visible stretch [a, b] of the path: each sample's
 * offset is its projection onto the a-b chord (the trails bend gently, so the
 * projection keeps its order), and `u` is how far along the fade it sits.
 */
function trailStops(d: string, a: number, b: number, r0: number, r1: number) {
  const A = at(d, a), B = at(d, b);
  const vx = B.x - A.x, vy = B.y - A.y, len2 = vx * vx + vy * vy;
  const stops: Stop[] = [];
  let last = 0;
  for (let k = 0; k <= STOPS; k++) {
    const s = a + ((b - a) * k) / STOPS;
    const p = at(d, s);
    const off = len2 < 1 ? k / STOPS : ((p.x - A.x) * vx + (p.y - A.y) * vy) / len2;
    last = Math.max(last, Math.min(1, Math.max(0, off)));
    stops.push({ offset: last, u: Math.min(1, Math.max(0, (s - r0) / Math.max(1e-6, r1 - r0))) });
  }
  return { A, B, stops };
}

export const LaneTrails: React.FC<{ lanes: Lane[]; width: number; height: number; style?: React.CSSProperties }> = ({ lanes, width, height, style }) => {
  // Unique per instance: two trails on screen at once (a scene's and a cut's
  // sweep) must not resolve each other's gradients.
  const uid = `lt${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const lengths = useMemo(() => lanes.map((l) => getLength(l.d)), [lanes.map((l) => l.d).join('|')]);
  const drawn = lanes.map((l, i) => {
    const L = lengths[i];
    const tailLen = (l.tail ?? 0.45) * L;
    const headAt = (l.exit ? Math.max(0, l.head) : Math.max(0, Math.min(1, l.head))) * L;
    const a = Math.max(0, headAt - tailLen), b = Math.min(L, headAt);
    const op = l.opacity ?? 1;
    if (b - a <= 0.5 || op <= 0) return null;
    // The fade runs from the tail (clamped to the path's start) to the head,
    // which can be past the end on the way out.
    const { A, B, stops } = trailStops(l.d, a, b, a, headAt);
    const tip = at(l.d, b);
    // The head's glow leaves with the head.
    const tipGlow = headAt <= L ? 1 : Math.max(0, 1 - (headAt - L) / (0.12 * L));
    return { l, i, L, a, b, op, A, B, stops, tip, tipGlow };
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', ...style }}>
      <defs>
        {drawn.map((t) => t && (
          <React.Fragment key={t.i}>
            <radialGradient id={`${uid}-glow-${t.i}`}>
              <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
              <stop offset="18%" stopColor={t.l.color} stopOpacity={0.9} />
              <stop offset="100%" stopColor={t.l.color} stopOpacity={0} />
            </radialGradient>
            <linearGradient id={`${uid}-core-${t.i}`} gradientUnits="userSpaceOnUse" x1={t.A.x} y1={t.A.y} x2={t.B.x} y2={t.B.y}>
              {t.stops.map((s, k) => <stop key={k} offset={s.offset} stopColor={t.l.color} stopOpacity={s.u ** 1.6} />)}
            </linearGradient>
            <linearGradient id={`${uid}-halo-${t.i}`} gradientUnits="userSpaceOnUse" x1={t.A.x} y1={t.A.y} x2={t.B.x} y2={t.B.y}>
              {t.stops.map((s, k) => <stop key={k} offset={s.offset} stopColor={t.l.color} stopOpacity={0.12 * s.u * s.u} />)}
            </linearGradient>
          </React.Fragment>
        ))}
      </defs>
      {drawn.map((t) => {
        if (!t) return null;
        const w = t.l.width ?? 6;
        const dash = { strokeDasharray: `${t.b - t.a} ${t.L + 10}`, strokeDashoffset: -t.a };
        return (
          <g key={t.i} opacity={t.op}>
            <path d={t.l.d} fill="none" stroke={`url(#${uid}-halo-${t.i})`} strokeWidth={w * 5} strokeLinecap="round" {...dash} />
            <path d={t.l.d} fill="none" stroke={`url(#${uid}-core-${t.i})`} strokeWidth={w} strokeLinecap="round" {...dash} />
            {t.tipGlow > 0 && <circle cx={t.tip.x} cy={t.tip.y} r={w * 7} fill={`url(#${uid}-glow-${t.i})`} opacity={t.tipGlow} />}
          </g>
        );
      })}
    </svg>
  );
};
