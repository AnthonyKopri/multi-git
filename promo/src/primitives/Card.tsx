// The montage card: a question (<= 5 words), the one real control that
// answers it, and the command it replaces, struck through in small mono.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { clamp01, expoOut } from '../lib/anim';
import { FONT, useColors } from '../theme';

export const MontageCard: React.FC<{
  q: string; struck: string; lane: 'cyan' | 'indigo'; at: number; width?: number; height?: number; control: React.ReactNode; keycap?: React.ReactNode;
}> = ({ q, struck, lane, at, width = 820, height = 470, control, keycap }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const accent = lane === 'cyan' ? c.cyan : c.indigo;
  const strike = expoOut(clamp01((frame - at - 5) / 7));
  return (
    <div style={{ width, height, borderRadius: 26, background: c.card, border: `2px solid ${accent}66`, boxShadow: `0 0 60px ${accent}22, 0 30px 80px rgba(0,0,0,0.5)`, display: 'flex', flexDirection: 'column', padding: '34px 40px 30px', boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 52, letterSpacing: '-0.02em', color: c.text, lineHeight: 1.05 }}>{q}</div>
        {keycap}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{control}</div>
      <div style={{ position: 'relative', alignSelf: 'flex-start', maxWidth: '100%', fontFamily: FONT.mono, fontSize: 26, color: c.spell, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {struck}
        <div style={{ position: 'absolute', left: 0, top: '54%', height: 2, width: `${strike * 100}%`, background: c.red, opacity: 0.85 }} />
      </div>
    </div>
  );
};
