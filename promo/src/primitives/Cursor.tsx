// A pointer that glides between keyframes and clicks with a small ripple.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { expoInOut, prog } from '../lib/anim';
import { useColors } from '../theme';

export interface CursorKey { at: number; x: number; y: number; dur?: number }

export const Cursor: React.FC<{ keys: CursorKey[]; clicks?: number[]; enterAt?: number; exitAt?: number; scale?: number }> = ({ keys, clicks = [], enterAt, exitAt, scale = 1 }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  let x = keys[0].x, y = keys[0].y;
  for (let i = 1; i < keys.length; i++) {
    if (frame < keys[i].at) break;
    const t = expoInOut(prog(frame, keys[i].at, keys[i].dur ?? 8));
    x = x + (keys[i].x - x) * t; y = y + (keys[i].y - y) * t;
  }
  const start = enterAt ?? keys[0].at;
  if (frame < start || (exitAt !== undefined && frame >= exitAt)) return null;
  const pressed = clicks.some((f) => frame >= f && frame < f + 3);
  return (
    <div style={{ position: 'absolute', left: x, top: y, pointerEvents: 'none', transform: `scale(${scale * (pressed ? 0.86 : 1)})`, transformOrigin: '0 0', zIndex: 50 }}>
      {clicks.map((f, i) => {
        const t = prog(frame, f, 10);
        if (frame < f || t >= 1) return null;
        return <div key={i} style={{ position: 'absolute', left: -22 * (0.4 + t), top: -22 * (0.4 + t), width: 44 * (0.4 + t), height: 44 * (0.4 + t), borderRadius: '50%', border: `3px solid ${c.indigo}`, opacity: 1 - t }} />;
      })}
      <svg width={34} height={40} viewBox="0 0 17 20" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.6))' }}>
        <path d="M1 1 L1 16 L5 12.5 L8 19 L10.5 18 L7.6 11.6 L13 11.6 Z" fill="#f3f4f6" stroke="#0a0c10" strokeWidth={1.2} strokeLinejoin="round" />
      </svg>
    </div>
  );
};
