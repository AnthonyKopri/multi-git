// Keycaps: JetBrains Mono 500 on a #171b26 cap, 2 px border, 6 px bottom edge.
// A press is 3 frames down and 4 frames up.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { pop } from '../lib/anim';
import { FONT, TYPE, useColors } from '../theme';

export const pressDepth = (frame: number, at: number) => {
  const k = frame - at;
  if (k < 0 || k >= 7) return 0;
  return k < 3 ? (k + 1) / 3 : 1 - (k - 2) / 4;
};

export const KeyCap: React.FC<{ label: string; enterAt?: number; pressAt?: number; size?: number; glow?: boolean }> = ({ label, enterAt = 0, pressAt = -99, size = TYPE.keycap.fontSize, glow = true }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const s = pop(frame, enterAt);
  const d = pressDepth(frame, pressAt);
  const edge = 6 - 4 * d;
  const lit = glow && d > 0;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: size * 1.5, height: size * 1.75,
      padding: `0 ${size * 0.45}px`, boxSizing: 'border-box', fontFamily: FONT.mono, fontWeight: 500, fontSize: size, color: c.text,
      background: c.card, border: `2px solid ${lit ? c.indigo : c.border}`, borderBottomWidth: 2 + edge, borderRadius: size * 0.28,
      transform: `translateY(${d * 4}px) scale(${s})`, boxShadow: lit ? `0 0 ${size * 0.8}px ${c.indigo}66` : '0 8px 24px rgba(0,0,0,0.45)',
    }}>{label}</div>
  );
};

export const KeyCombo: React.FC<{ keys: string[]; enterAt?: number; pressAt?: number; size?: number; style?: React.CSSProperties }> = ({ keys, enterAt = 0, pressAt = -99, size, style }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: (size ?? 40) * 0.35, ...style }}>
      {keys.map((k, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: (size ?? 40) * 0.8, color: c.muted, opacity: pop(frame, enterAt + i * 2) }}>+</span>}
          <KeyCap label={k} enterAt={enterAt + i * 2} pressAt={pressAt} size={size} />
        </React.Fragment>
      ))}
    </div>
  );
};
