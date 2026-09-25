// One film = a composition's sections laid end to end (timing.json), each in
// a <Sequence> with its scene and its SFX, plus the counter, grain and music.
import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { CameraMotionBlur } from '@remotion/motion-blur';
import { Music, SfxTrack } from '../audio';
import { FontGate } from '../fonts';
import { Grain } from '../primitives/Grain';
import type { PromoProps } from '../schema';
import { sceneFor } from '../scenes';
import { FilmCtx } from '../theme';
import { placeSections, TIMING, type CompositionId } from '../timing';
import { CounterOverlay } from './CounterOverlay';
import { LaneSweep } from '../scenes/kit';

// Whip pans: the last 3 frames of a scene and the first 3 of the next slide
// with the lane (right to left) under motion blur, so every cut is a whip.
const WHIP = 3, WHIP_PX = 320;
const WhipMover: React.FC<{ duration: number; whipIn: boolean; whipOut: boolean; children: React.ReactNode }> = ({ duration, whipIn, whipOut, children }) => {
  const f = useCurrentFrame();
  const inT = whipIn && f < WHIP ? 1 - f / WHIP : 0;
  const outT = whipOut && f >= duration - WHIP ? (f - (duration - WHIP) + 1) / WHIP : 0;
  const x = inT * WHIP_PX - outT * WHIP_PX;
  return <AbsoluteFill style={x ? { transform: `translateX(${x}px)` } : undefined}>{children}</AbsoluteFill>;
};
const Whip: React.FC<{ duration: number; whipIn: boolean; whipOut: boolean; children: React.ReactNode }> = (p) => {
  const f = useCurrentFrame();
  const active = (p.whipIn && f < WHIP) || (p.whipOut && f >= p.duration - WHIP);
  const mover = <WhipMover {...p} />;
  return active ? <CameraMotionBlur shutterAngle={200} samples={5}>{mover}</CameraMotionBlur> : mover;
};

export const makeFilm = (comp: CompositionId): React.FC<PromoProps> => {
  const Film: React.FC<PromoProps> = (props) => {
    const { width, height } = useVideoConfig();
    const placed = useMemo(() => placeSections(comp, props.sceneBars), [props.sceneBars]);
    const ctx = useMemo(() => ({ comp, props, colors: props.colors, copy: props.copy, width, height }), [props, width, height]);
    const audio = TIMING.compositions[comp].audio;
    // ReadmeGif scenes are laid out on the 1920x1080 stage and scaled down.
    const stageScale = comp === 'ReadmeGif' ? width / 1920 : 1;
    return (
      <FilmCtx.Provider value={ctx}>
        <FontGate>
          <AbsoluteFill style={{ background: props.colors.background, overflow: 'hidden' }}>
            {placed.map((p, i) => {
              const Scene = sceneFor(p.def.scene);
              return (
                <Sequence key={p.section} from={p.from} durationInFrames={p.duration} name={`${p.section} (bars ${p.fromBar}-${p.toBar})`}>
                  <AbsoluteFill style={stageScale !== 1 ? { width: 1920, height: 1080, transform: `scale(${stageScale})`, transformOrigin: '0 0' } : undefined}>
                    <Whip duration={p.duration}
                      whipIn={i > 0 && !['Stinger', 'Checklist'].includes(p.def.scene)}
                      whipOut={i < placed.length - 1 && !['Stinger'].includes(p.def.scene) && placed[i + 1].def.scene !== 'Stinger'}>
                      <Scene placed={p} variant={p.def.variant} />
                    </Whip>
                  </AbsoluteFill>
                  {audio && <SfxTrack def={p.def} volume={props.sfxVolume} />}
                </Sequence>
              );
            })}
            {placed.map((p, i) => (i === 0 || p.def.scene === 'Stinger' || p.def.scene === 'Checklist' ? null : (
              <LaneSweep key={`sweep-${p.section}`} at={p.from} color={i % 2 ? props.colors.cyan : props.colors.indigo} width={width} height={height} dir={i % 2 ? 1 : -1} />
            )))}
            <CounterOverlay placed={placed} />
            <Grain />
            {audio && <Music comp={comp} volume={props.musicVolume} />}
          </AbsoluteFill>
        </FontGate>
      </FilmCtx.Provider>
    );
  };
  return Film;
};

export const Promo = makeFilm('Promo');
export const Promo30 = makeFilm('Promo30');
export const Vertical = makeFilm('Vertical');
export const ReadmeGif = makeFilm('ReadmeGif');
