// Two glowing light trails (cyan: newcomers, indigo: veterans). The head
// leads, the tail fades out, and the glow is a pre-rendered radial sprite.
import React, { useMemo } from 'react';
import { getLength, getPointAtLength } from '@remotion/paths';

export interface Lane { d: string; color: string; head: number; tail?: number; width?: number; opacity?: number }

const SEGMENTS = 18;

export const LaneTrails: React.FC<{ lanes: Lane[]; width: number; height: number; style?: React.CSSProperties }> = ({ lanes, width, height, style }) => {
  const lengths = useMemo(() => lanes.map((l) => getLength(l.d)), [lanes.map((l) => l.d).join('|')]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', ...style }}>
      <defs>
        {lanes.map((l, i) => (
          <radialGradient key={i} id={`lane-glow-${i}`}>
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
            <stop offset="18%" stopColor={l.color} stopOpacity={0.9} />
            <stop offset="100%" stopColor={l.color} stopOpacity={0} />
          </radialGradient>
        ))}
      </defs>
      {lanes.map((l, i) => {
        const L = lengths[i];
        const head = Math.max(0, Math.min(1, l.head)) * L;
        const tail = Math.max(0, head - (l.tail ?? 0.45) * L);
        const w = l.width ?? 6;
        const op = l.opacity ?? 1;
        if (head <= 0.5 || op <= 0) return null;
        const seg = (head - tail) / SEGMENTS;
        const pt = getPointAtLength(l.d, head) ?? { x: 0, y: 0 };
        return (
          <g key={i} opacity={op}>
            {Array.from({ length: SEGMENTS }, (_, k) => {
              const a = tail + k * seg;
              const f = (k + 1) / SEGMENTS;
              return (
                <g key={k}>
                  <path d={l.d} fill="none" stroke={l.color} strokeWidth={w * 5} strokeOpacity={0.1 * f * f} strokeLinecap="round" strokeDasharray={`${seg + 1} ${L + 10}`} strokeDashoffset={-a} />
                  <path d={l.d} fill="none" stroke={l.color} strokeWidth={w} strokeOpacity={f ** 1.6} strokeLinecap="round" strokeDasharray={`${seg + 1} ${L + 10}`} strokeDashoffset={-a} />
                </g>
              );
            })}
            <circle cx={pt.x} cy={pt.y} r={w * 7} fill={`url(#lane-glow-${i})`} />
          </g>
        );
      })}
    </svg>
  );
};
