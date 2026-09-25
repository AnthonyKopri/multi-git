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
import { cueOf, placeSections, TIMING, type CompositionId } from '../timing';
import { Kinetic } from '../primitives/Headline';
import { TYPE, useColors } from '../theme';
import type { Copy } from '../schema';

const TITLES: Record<string, (c: Copy) => string> = {
  SceneA: (c) => c.sceneA.headline, SceneB: (c) => c.sceneB.headline, SceneC: (c) => c.sceneC.headline, SceneE: (c) => c.sceneE.headline,
};
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

// The master ends by fading picture (and, in the synth, sound) to black together.
const FadeOut: React.FC<{ from: number; frames: number }> = ({ from, frames }) => {
  const f = useCurrentFrame();
  if (f < from) return null;
  return <AbsoluteFill style={{ background: '#000', opacity: Math.min(1, (f - from + 1) / frames) }} />;
};

// Cutdown framing: Vertical and ReadmeGif crop a window around the action
// out of the landscape feature scenes (UI stays at a readable scale).
interface Crop { sx: number; sy: number; w: number; h: number; dx: number; dy: number; scale: number }
const cropFor = (comp: CompositionId, scene: string, variant?: string): Crop | null => {
  if (comp === 'Vertical' && ((scene === 'SceneA' && variant === 'vertical') || (scene === 'SceneD' && variant === 'splitOnly'))) return { sx: 600, sy: 80, w: 1080, h: 1000, dx: 0, dy: 550, scale: 1 };
  if (comp === 'ReadmeGif' && variant === 'gif') return { sx: 700, sy: 360, w: 960, h: 540, dx: 0, dy: 0, scale: 0.75 };
  return null;
};

const CutdownTitle: React.FC<{ text: string; at: number; gif: boolean }> = ({ text, at, gif }) => {
  const c = useColors();
  return gif ? (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 720, height: 84, background: `linear-gradient(${c.background}f2 30%, transparent)` }} />
      <Kinetic text={text} at={at} style={{ ...TYPE.hero, fontSize: 30, position: 'absolute', left: 18, top: 14, width: 680 }} />
    </>
  ) : (
    <Kinetic text={text} at={at} style={{ ...TYPE.hero, fontSize: 84, position: 'absolute', left: 60, top: 352, width: 960 }} />
  );
};

export const makeFilm = (comp: CompositionId): React.FC<PromoProps> => {
  const Film: React.FC<PromoProps> = (props) => {
    const { width, height } = useVideoConfig();
    const placed = useMemo(() => placeSections(comp, props.sceneBars), [props.sceneBars]);
    const ctx = useMemo(() => ({ comp, props, colors: props.colors, copy: props.copy, width, height }), [props, width, height]);
    const audio = TIMING.compositions[comp].audio;
    const fadeFrames = TIMING.compositions[comp].fadeOutFrames ?? 0;
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
                  {(() => {
                    const crop = cropFor(comp, p.def.scene, p.def.variant);
                    const whip = (node: React.ReactNode) => (
                      <Whip duration={p.duration}
                        whipIn={i > 0 && !['Stinger', 'Checklist'].includes(p.def.scene)}
                        whipOut={i < placed.length - 1 && !['Stinger'].includes(p.def.scene) && placed[i + 1].def.scene !== 'Stinger'}>
                        {node}
                      </Whip>
                    );
                    if (!crop) {
                      return (
                        <FilmCtx.Provider value={stageScale !== 1 ? { ...ctx, width: 1920, height: 1080 } : ctx}>
                          <AbsoluteFill style={stageScale !== 1 ? { width: 1920, height: 1080, transform: `scale(${stageScale})`, transformOrigin: '0 0' } : undefined}>
                            {whip(<Scene placed={p} variant={p.def.variant} />)}
                          </AbsoluteFill>
                        </FilmCtx.Provider>
                      );
                    }
                    const title = TITLES[p.def.scene]?.(props.copy);
                    const titleAt = p.def.scene === 'SceneC' ? (cueOf(p.def, 'land') ?? 0) : 0;
                    return (
                      <AbsoluteFill>
                        <FilmCtx.Provider value={{ ...ctx, width: 1920, height: 1080 }}>
                          <div style={{ position: 'absolute', left: crop.dx, top: crop.dy, width: crop.w * crop.scale, height: crop.h * crop.scale, overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', left: -crop.sx * crop.scale, top: -crop.sy * crop.scale, width: 1920, height: 1080, transform: `scale(${crop.scale})`, transformOrigin: '0 0' }}>
                              {whip(<Scene placed={p} variant={p.def.variant} />)}
                            </div>
                          </div>
                        </FilmCtx.Provider>
                        {title && <CutdownTitle text={title} at={titleAt} gif={comp === 'ReadmeGif'} />}
                      </AbsoluteFill>
                    );
                  })()}
                  {audio && <SfxTrack def={p.def} volume={props.sfxVolume} />}
                </Sequence>
              );
            })}
            {placed.map((p, i) => (i === 0 || p.def.scene === 'Stinger' || p.def.scene === 'Checklist' ? null : (
              <LaneSweep key={`sweep-${p.section}`} at={p.from} color={i % 2 ? props.colors.cyan : props.colors.indigo} width={width} height={height} dir={i % 2 ? 1 : -1} />
            )))}
            <CounterOverlay placed={placed} />
            <Grain />
            {fadeFrames > 0 && <FadeOut from={placed[placed.length - 1].from + placed[placed.length - 1].duration - fadeFrames} frames={fadeFrames} />}
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
