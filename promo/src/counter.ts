// The counter's timeline. Counting rule (spec): only commands Multi-Git
// replaces count: each command line of a collapsing spell (a line ending
// `# ×N` counts N), plus the struck command on each montage card. Comments,
// prompts, prompt answers, file contents and output don't count.
import { BEAT, cueOf, type PlacedSection } from './timing';
import type { Copy } from './schema';

const COMMAND = /^(git|ssh-keygen|ssh-add|ssh|gh|cd|for|echo)\b/;
export function countSpell(lines: string[]): number {
  let n = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!COMMAND.test(line)) continue;
    const times = /#\s*×\s*(\d+)\s*$/.exec(line);
    n += times ? Number(times[1]) : 1;
  }
  return n;
}

export interface Tick { frame: number; total: number; source: string }

export function counterTicks(placed: PlacedSection[], copy: Copy): Tick[] {
  const ticks: Tick[] = [];
  let total = 0;
  const spells = copy.spells as Record<string, string[]>;
  for (const p of placed) {
    for (const row of p.def.counter ?? []) {
      const [cue, source, delayRaw] = row as [string, string, number?];
      const f = cueOf(p.def, cue);
      if (f === null) continue;
      const delay = delayRaw ?? 3;
      if (source === 'card') {
        const cards = p.def.cards!;
        const n = Math.min(cards.count, copy.montage.cards.length);
        for (let k = 0; k < n; k++) {
          // A conveyor montage lists the section beat each card centres on.
          const at = p.from + (cards.beats ? (cards.beats[k] - 1) * BEAT : f + k * cards.everyFrames) + delay;
          if (at < p.from + p.duration) ticks.push({ frame: at, total: ++total, source: 'card' });
        }
      } else {
        const n = source === 'viewer' ? 1 : countSpell(spells[source] ?? []);
        for (let k = 0; k < n; k++) ticks.push({ frame: p.from + f + delay + k * 2, total: ++total, source });
      }
    }
  }
  return ticks.sort((a, b) => a.frame - b.frame);
}

export const valueAtFrom = (ticks: Tick[]) => (frame: number) => {
  let v = 0;
  for (const t of ticks) { if (t.frame <= frame) v = t.total; else break; }
  return v;
};

/** The total a stinger should claim: every tick except the viewer's own click. */
export const spellTotal = (ticks: Tick[]) => ticks.filter((t) => t.source !== 'viewer').length;
