// Music (one synthesized WAV per composition) and the SFX, each placed with a
// <Sequence> at its section cue, so re-timing a scene moves its sounds.
import React from 'react';
import { Html5Audio, Sequence, staticFile } from 'remotion';
import { cueOf, TIMING, type CompositionId, type SectionDef } from './timing';

export const Music: React.FC<{ comp: CompositionId; volume: number }> = ({ comp, volume }) =>
  TIMING.compositions[comp].audio ? <Html5Audio src={staticFile(`audio/music-${comp}.wav`)} volume={volume} /> : null;

export const SfxTrack: React.FC<{ def: SectionDef; volume: number }> = ({ def, volume }) => (
  <>
    {(def.sfx ?? []).flatMap((row, i) => {
      const [id, cue, off = 0, vol = 0.5, count = 1, every = 2] = row as [string, string, number?, number?, number?, number?];
      const f = cueOf(def, cue);
      if (f === null) return [];
      return Array.from({ length: count }, (_, k) => (
        <Sequence key={`${i}-${k}`} from={f + off + k * every} durationInFrames={90} layout="none" name={`sfx ${id}`}>
          <Html5Audio src={staticFile(`audio/sfx/${id}.wav`)} volume={vol * volume} />
        </Sequence>
      ));
    })}
  </>
);
