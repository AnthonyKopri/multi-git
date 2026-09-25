import React from 'react';
import { AbsoluteFill } from 'remotion';
import { TYPE, useColors } from '../theme';
import type { SceneProps } from './types';

export const Placeholder: React.FC<SceneProps> = ({ placed }) => {
  const c = useColors();
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: c.background }}>
      <div style={{ ...TYPE.sub, color: c.muted }}>{placed.section} · bars {placed.fromBar}-{placed.toBar}</div>
    </AbsoluteFill>
  );
};
