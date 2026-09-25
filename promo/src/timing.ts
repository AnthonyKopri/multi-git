// The musical grid and every composition's arrangement, read from
// ../timing.json (the same file the audio synth reads).
import timingJson from '../timing.json';

export type CueTuple = [number, number, number?];
export type SfxRow = [string, string, number?, number?, number?, number?];
export interface SectionDef {
  scene: string;
  bars: number;
  variant?: string;
  music?: { type: string; [key: string]: unknown };
  cues: Record<string, number[]>;
  sfx?: (string | number)[][];
  counter?: string[][];
  cards?: { count: number; cue: string; everyFrames: number; switchAfter: number };
}
export interface ArrangementItem { section: string; fromBar: number; toBar: number }
export interface CompositionDef { width: number; height: number; audio: boolean; gifFps?: number; arrangement: ArrangementItem[] }
export type CompositionId = 'Promo' | 'Promo30' | 'Vertical' | 'ReadmeGif';

export const TIMING = timingJson as unknown as {
  fps: number; bpm: number; beatsPerBar: number; beatFrames: number; barFrames: number;
  compositions: Record<CompositionId, CompositionDef>;
  sections: Record<string, SectionDef>;
};

export const FPS = TIMING.fps;
export const BEAT = TIMING.beatFrames; // 15
export const BAR = TIMING.barFrames; // 60

/** Frame of bar n, beat b (1-based), relative to whatever n counts from. */
export const barFrame = (bar: number, beat = 1, offset = 0) => (bar - 1) * BAR + (beat - 1) * BEAT + offset;

export const section = (name: string): SectionDef => {
  const s = TIMING.sections[name];
  if (!s) throw new Error(`Unknown section ${name}`);
  return s;
};

/** A section-local cue as a frame, or null if the section has no such cue. */
export const cueOf = (def: SectionDef, name: string): number | null => {
  const c = def.cues[name];
  return c ? barFrame(c[0], c[1], c[2] ?? 0) : null;
};

export interface PlacedSection extends ArrangementItem { def: SectionDef; from: number; duration: number }

/**
 * Lays a composition's sections end to end. `barsOverride` (from the Studio
 * props) can lengthen or shorten a section; the default is timing.json.
 */
export function placeSections(id: CompositionId, barsOverride: Record<string, number> = {}): PlacedSection[] {
  let bar = 1;
  return TIMING.compositions[id].arrangement.map((a) => {
    const def = section(a.section);
    const bars = Math.max(1, Math.round(barsOverride[a.section] ?? a.toBar - a.fromBar + 1));
    const placed = { section: a.section, fromBar: bar, toBar: bar + bars - 1, def, from: (bar - 1) * BAR, duration: bars * BAR };
    bar += bars;
    return placed;
  });
}

export const durationOf = (id: CompositionId, barsOverride: Record<string, number> = {}) => {
  const placed = placeSections(id, barsOverride);
  const last = placed[placed.length - 1];
  return last.from + last.duration;
};
