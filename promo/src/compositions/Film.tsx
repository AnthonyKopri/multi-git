// One film = a composition's sections laid end to end (timing.json), each in
// a <Sequence> with its scene and its SFX, plus the counter, grain and music.
import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import { Music, SfxTrack } from '../audio';
import { FontGate } from '../fonts';
import { Grain } from '../primitives/Grain';
import type { PromoProps } from '../schema';
import { sceneFor } from '../scenes';
import { FilmCtx } from '../theme';
import { placeSections, TIMING, type CompositionId } from '../timing';
import { CounterOverlay } from './CounterOverlay';
import { LaneSweep } from '../scenes/kit';

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
            {placed.map((p) => {
              const Scene = sceneFor(p.def.scene);
              return (
                <Sequence key={p.section} from={p.from} durationInFrames={p.duration} name={`${p.section} (bars ${p.fromBar}-${p.toBar})`}>
                  <AbsoluteFill style={stageScale !== 1 ? { width: 1920, height: 1080, transform: `scale(${stageScale})`, transformOrigin: '0 0' } : undefined}>
                    <Scene placed={p} variant={p.def.variant} />
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
