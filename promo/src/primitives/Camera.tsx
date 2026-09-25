// A 2D camera: keyframed framing (punch-ins land over 6-8 frames), a gentle
// drift of 1-2% across the shot, and optional shakes (<= 6 px, <= 4 frames).
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { expoInOut, prog, shake } from '../lib/anim';

export interface CamKey { at: number; x: number; y: number; scale: number; dur?: number }

export function cameraAt(keys: CamKey[], frame: number) {
  let cur = keys[0];
  let x = cur.x, y = cur.y, s = cur.scale;
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (frame < k.at) break;
    const t = expoInOut(prog(frame, k.at, k.dur ?? 7));
    x = cur.x + (k.x - cur.x) * t; y = cur.y + (k.y - cur.y) * t; s = cur.scale + (k.scale - cur.scale) * t;
    cur = { ...k, x, y, scale: s };
  }
  return { x, y, scale: s };
}

export const Camera: React.FC<{
  keys: CamKey[]; width: number; height: number; drift?: number; driftFrames?: number; shakes?: number[];
  children: React.ReactNode; style?: React.CSSProperties;
}> = ({ keys, width, height, drift = 0.015, driftFrames = 240, shakes = [], children, style }) => {
  const frame = useCurrentFrame();
  const c = cameraAt(keys, frame);
  const s = c.scale * (1 + drift * Math.min(1, frame / driftFrames));
  const sh = shakes.reduce((acc, at) => { const d = shake(frame, at); return { x: acc.x + d.x, y: acc.y + d.y }; }, { x: 0, y: 0 });
  const tx = width / 2 - c.x * s + sh.x, ty = height / 2 - c.y * s + sh.y;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...style }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width, height, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        {children}
      </div>
    </div>
  );
};
