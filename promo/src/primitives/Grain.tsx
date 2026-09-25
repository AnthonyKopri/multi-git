// Deterministic film grain (2-3%, @remotion/noise) and a subtle vignette.
import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { noise2D } from '@remotion/noise';

const N = 160;
let tileUrl: string | null = null;
const tile = () => {
  if (tileUrl) return tileUrl;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = 128 + 110 * noise2D('grain', x * 1.37, y * 1.37);
    const o = (y * N + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  tileUrl = c.toDataURL('image/png');
  return tileUrl;
};

export const Grain: React.FC<{ amount?: number; vignette?: number }> = ({ amount = 0.05, vignette = 0.38 }) => {
  const frame = useCurrentFrame();
  const ox = Math.floor(random(`gx${frame}`) * N), oy = Math.floor(random(`gy${frame}`) * N);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,${vignette}) 100%)` }} />
      <AbsoluteFill style={{ backgroundImage: `url(${tile()})`, backgroundPosition: `${ox}px ${oy}px`, opacity: amount, mixBlendMode: 'overlay' }} />
    </AbsoluteFill>
  );
};
