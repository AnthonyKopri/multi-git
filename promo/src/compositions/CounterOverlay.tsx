// The corner counter, driven by the timeline (counter.ts). It appears with the
// first collapse, steps aside for the stinger (which shows it huge), cracks
// open in scene F (the scene draws that), and ticks to 46 on the end card.
import React, { useMemo } from 'react';
import { useCurrentFrame } from 'remotion';
import { counterTicks, valueAtFrom } from '../counter';
import { enter } from '../lib/anim';
import { CornerCounter } from '../primitives/Counter';
import { useFilm } from '../theme';
import { cueOf, type PlacedSection } from '../timing';

export function counterHidden(placed: PlacedSection[], frame: number, comp: string) {
  for (const p of placed) {
    if (frame < p.from || frame >= p.from + p.duration) continue;
    const scene = p.def.scene;
    if (scene === 'Stinger') return true;
    if (scene === 'EndCard' && comp !== 'Promo') return true;
    if (scene === 'SceneF') {
      const crack = cueOf(p.def, 'crack') ?? 0, glint = cueOf(p.def, 'glint') ?? p.duration;
      const local = frame - p.from;
      if (local >= crack && local < glint) return true;
    }
  }
  return false;
}

export const CounterOverlay: React.FC<{ placed: PlacedSection[] }> = ({ placed }) => {
  const frame = useCurrentFrame();
  const { props, copy, comp, width, height } = useFilm();
  const ticks = useMemo(() => counterTicks(placed, copy), [placed, copy]);
  const valueAt = useMemo(() => valueAtFrom(ticks), [ticks]);
  if (!props.showCounter || !ticks.length) return null;
  const first = ticks[0].frame - 14;
  if (frame < first) return null;
  // Hidden stretches cut out hard (the stinger is a hard cut); on the way
  // back the counter re-enters with the usual expo-out.
  if (counterHidden(placed, frame, comp)) return null;
  let k = 0;
  while (k < 10 && frame - k - 1 >= first && !counterHidden(placed, frame - k - 1, comp)) k++;
  const vis = enter(frame, first, 10) * (k < 10 && frame - k - 1 >= first ? enter(k, 0, 10) : 1);
  const recent = ticks.some((t) => frame >= t.frame && frame < t.frame + 8);
  const vertical = height > width;
  return <CornerCounter valueAt={valueAt} label={copy.counterLabel} x={vertical ? 72 : 96} y={vertical ? 262 : 54} opacity={vis} accent={recent} scale={width < 1000 && !vertical ? 0.6 : 1} />;
};
