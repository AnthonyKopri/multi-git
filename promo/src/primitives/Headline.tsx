// Kinetic type: words rise in (expo-out, 10 frames, 2-frame stagger) and
// leave with expo-in. *word* renders italic; `code` renders in mono.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { enter, leave } from '../lib/anim';
import { FONT, TYPE, useColors } from '../theme';

const tokens = (text: string) => text.split(/(\s+)/).filter((t) => t.length > 0);
const styleToken = (t: string): [string, React.CSSProperties] => {
  if (/^\*.*\*[.,!?]?$/.test(t)) return [t.replace(/\*/g, ''), { fontStyle: 'italic' }];
  if (/^`.*`[.,!?]?$/.test(t)) return [t.replace(/`/g, ''), { fontFamily: FONT.mono, fontWeight: 500, fontSize: '0.86em' }];
  return [t, {}];
};

export const Kinetic: React.FC<{
  text: string; at: number; exitAt?: number; style?: React.CSSProperties; stagger?: number; color?: string; rise?: number;
}> = ({ text, at, exitAt, style, stagger = 2, color, rise = 0.45 }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  let wi = 0;
  // Keep `code spans` with spaces together.
  const parts = tokens(text.replace(/`([^`]*)`/g, (m) => m.replace(/ /g, ' ')));
  const out = exitAt === undefined ? 1 : leave(frame, exitAt, 7);
  return (
    <div style={{ color: color ?? c.text, ...style }}>
      {parts.map((t, i) => {
        if (/^\s+$/.test(t)) return <span key={i}> </span>;
        const k = wi++;
        const p = enter(frame, at + k * stagger, 10);
        const [txt, st] = styleToken(t);
        return (
          <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', opacity: p * out, transform: `translateY(${(1 - p) * rise + (1 - out) * -0.25}em)`, ...st }}>{txt}</span>
        );
      })}
    </div>
  );
};

export const Headline: React.FC<{ text: string; at: number; exitAt?: number; size?: number; style?: React.CSSProperties; color?: string }> = ({ text, at, exitAt, size = TYPE.hero.fontSize, style, color }) => (
  <Kinetic text={text} at={at} exitAt={exitAt} color={color} style={{ ...TYPE.hero, fontSize: size, ...style }} />
);
