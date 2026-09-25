// A quick VCR-rewind wink over the stage: a ◀◀ REW on-screen display, two or
// three tracking-noise bands rolling upward and faint scanlines. The scene adds
// the stage jitter, the red/cyan fringe copies and the desaturation (VhsStage).
// No luminance flashes and no blur; everything is off at `to`.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { noise2D } from '@remotion/noise';
import { FONT } from '../theme';

/** Deterministic horizontal jitter in px (2-4 px, alternating). */
export const vhsJitter = (frame: number) => (frame % 2 ? 1 : -1) * (2 + 2 * ((noise2D('vhs-jit', frame * 0.7, 0) + 1) / 2));

/** The stage during the rewind: jittered, a little desaturated, with two tinted, offset, low-opacity copies. */
export const VhsStage: React.FC<{ active: boolean; stage: React.ReactNode }> = ({ active, stage }) => {
  const frame = useCurrentFrame();
  if (!active) return <>{stage}</>;
  const jx = vhsJitter(frame);
  const fringe = (tint: string, dx: number) => (
    <div style={{ position: 'absolute', inset: 0, transform: `translateX(${jx + dx}px)`, opacity: 0.2, mixBlendMode: 'screen', isolation: 'isolate', pointerEvents: 'none' }}>
      {stage}
      <div style={{ position: 'absolute', inset: 0, background: tint, mixBlendMode: 'multiply' }} />
    </div>
  );
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, transform: `translateX(${jx}px)`, filter: 'saturate(0.55)' }}>{stage}</div>
      {fringe('#ff3040', -4)}
      {fringe('#20d8f0', 4)}
    </>
  );
};

export const VhsOverlay: React.FC<{ from: number; to: number; width: number; height: number }> = ({ from, to, width, height }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  const t = frame - from;
  const bands = [0, 1, 2].map((i) => {
    const h = 36 + 18 * i;
    const y = height - ((t * (30 + 9 * i) + i * height * 0.41) % (height + h));
    const stripes = Array.from({ length: 16 }, (_, s) => {
      const n1 = (noise2D(`vhs-x${i}`, s * 0.53, frame * 0.8) + 1) / 2;
      const n2 = (noise2D(`vhs-w${i}`, s * 0.71, frame * 1.1) + 1) / 2;
      return { left: n1 * width * 0.9 - 60, w: 60 + 420 * n2, top: (s / 16) * h, a: 0.18 + 0.4 * n2 };
    });
    return (
      <div key={i} style={{ position: 'absolute', left: 0, top: y, width, height: h, background: 'rgba(210,214,224,0.07)', borderTop: '2px solid rgba(235,238,245,0.22)', overflow: 'hidden' }}>
        {stripes.map((st, k) => <div key={k} style={{ position: 'absolute', left: st.left, top: st.top, width: st.w, height: 2, background: `rgba(235,238,245,${st.a.toFixed(3)})` }} />)}
      </div>
    );
  });
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40 }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.5, background: 'repeating-linear-gradient(to bottom, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 1px, transparent 1px, transparent 4px)' }} />
      {bands}
      <div style={{ position: 'absolute', left: 96, top: 64, display: 'flex', alignItems: 'center', gap: 14, fontFamily: FONT.mono, fontWeight: 700, fontSize: 60, color: '#ffffff',
        textShadow: '4px 4px 0 #000000', letterSpacing: '0.04em' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 76, textShadow: '4px 4px 0 #000000' }}>fast_rewind</span>REW
      </div>
    </div>
  );
};
