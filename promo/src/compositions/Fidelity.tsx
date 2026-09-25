// Dev only (review round 1): the real capture beside the film's rebuild of the
// header and Staging Area, at the same crop.
import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { FontGate } from '../fonts';
import { AppLayer } from '../scenes/kit';
import { defaultPropsFor } from '../schema';
import { DEFAULT_COLORS, FilmCtx, FONT } from '../theme';

const CROP = { x: 0, y: 0, w: 900, h: 560 };
const S = 1920 / 2 / CROP.w;
export const Fidelity: React.FC = () => {
  const props = defaultPropsFor('Promo');
  const label = (t: string, x: number) => <div style={{ position: 'absolute', left: x + 20, top: CROP.h * S + 20, fontFamily: FONT.mono, fontSize: 30, color: '#9ca3af' }}>{t}</div>;
  return (
    <FilmCtx.Provider value={{ comp: 'Promo', props, colors: DEFAULT_COLORS, copy: props.copy, width: 1920, height: 1080 }}>
      <FontGate>
        <AbsoluteFill style={{ background: '#0a0c10' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: 960, height: CROP.h * S, overflow: 'hidden' }}>
            <Img src={staticFile('captures/workspace.webp')} style={{ position: 'absolute', left: -CROP.x * S, top: -CROP.y * S, width: 1600 * S, height: 1000 * S }} />
          </div>
          <div style={{ position: 'absolute', left: 960, top: 0, width: 960, height: CROP.h * S, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: -CROP.x * S, top: -CROP.y * S, width: 1600, height: 1000, transform: `scale(${S})`, transformOrigin: '0 0' }}>
              <AppLayer snap="workspace-body" base />
            </div>
          </div>
          {label('capture (Puppeteer, real app)', 0)}
          {label('rebuild (captured DOM + scoped app CSS)', 960)}
        </AbsoluteFill>
      </FontGate>
    </FilmCtx.Provider>
  );
};
