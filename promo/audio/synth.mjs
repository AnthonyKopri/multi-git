// Synthesizes the score (one WAV per composition, from its arrangement in
// timing.json) and the sound effects. Plain Node, no native modules, seeded
// PRNG: the same inputs always give the same files.
//
//   node audio/synth.mjs              render everything into public/audio/
//   node audio/synth.mjs --if-missing only when a file is missing or stale
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as D from './dsp.mjs';

const { SR } = D;
const PROMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = JSON.parse(fs.readFileSync(path.join(PROMO, 'timing.json'), 'utf8'));
const OUT = path.join(PROMO, 'public', 'audio');
const BEAT = Math.round((SR * 60) / T.bpm); // 24000 samples
const BAR = BEAT * T.beatsPerBar;
const STEP = BEAT / 4; // a 16th
const FRAME = SR / T.fps; // 1600 samples

// ---- the knobs (see README "Where to change things") ---------------------
export const PARAMS = {
  seed: 20260925,
  // The music bus is mastered a little under the delivery target, so the SFX
  // added in Remotion land the finished mix at about -14 LUFS / -1 dBTP.
  targetLufs: -14.5,
  ceilingDbtp: -2.0,
  duckUnderLeadSfxDb: -10, // music dips under the thunk, the drop impact and the stinger hit
  sidechain: { bass: 0.82, music: 0.38, releaseMs: 150 },
  level: { kick: 1.0, clap: 0.62, hat: 0.26, snare: 0.7, sub: 0.62, bass: 0.22, stab: 0.46, pad: 0.2, arp: 0.2, pluck: 0.34, drone: 0.4, clack: 0.18, riser: 0.34 },
  supersaw: { voices: 7, detune: 0.24 },
  reverbSend: 1.0,
};

// F minor: i, VI, III, VII (Fm, Db, Ab, Eb); F major for the final chord.
const CHORDS = {
  Fm: { notes: [53, 56, 60, 65], sub: 29 },
  Db: { notes: [53, 56, 61, 65], sub: 37 },
  Ab: { notes: [51, 56, 60, 63], sub: 32 },
  Eb: { notes: [51, 55, 58, 63], sub: 39 },
  F: { notes: [53, 57, 60, 65, 69], sub: 29 },
};
const PROG = ['Fm', 'Db', 'Ab', 'Eb'];
const PLUCK_MOTIF = [[0, 72], [3, 68], [6, 65], [8, 67], [10, 68], [12, 72], [14, 75]];

// ---- instruments -----------------------------------------------------------
const add = (buf, i, l, r) => { if (i >= 0 && i < buf[0].length) { buf[0][i] += l; buf[1][i] += r; } };

function kick(ctx, at, g = 1) {
  const n = Math.round(0.42 * SR);
  let ph = 0;
  const G = g * PARAMS.level.kick * 0.9;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 44 + 110 * Math.exp(-t * 28) + 40 * Math.exp(-t * 90);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.min(1, t / 0.002) * Math.exp(-t * 6.5);
    let y = Math.tanh(Math.sin(ph) * env * 1.6) / Math.tanh(1.6);
    if (i < 120) y += (ctx.rng() * 2 - 1) * Math.exp(-i / 22) * 0.22;
    add(ctx.bus.drums, at + i, y * G, y * G);
  }
  ctx.kicks.push(at);
}
function clap(ctx, at, g = 1) {
  const bp = new D.Biquad('bp', 1250, 1.3), hp = new D.Biquad('hp', 450);
  const n = Math.round(0.3 * SR), G = g * PARAMS.level.clap * 2.4;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0;
    for (const o of [0, 0.011, 0.023]) if (t >= o) env = Math.max(env, Math.exp(-(t - o) * (o > 0.02 ? 19 : 160)));
    const y = bp.process(hp.process(ctx.rng() * 2 - 1)) * env * G;
    add(ctx.bus.drums, at + i, y * 0.95, y);
    add(ctx.bus.send, at + i, y * 0.12, y * 0.12);
  }
}
function hat(ctx, at, g = 1, open = false) {
  const hp = new D.Biquad('hp', 7200), lp = new D.Biquad('lp', 10500);
  const n = Math.round((open ? 0.24 : 0.06) * SR), G = g * PARAMS.level.hat;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const y = lp.process(hp.process(ctx.rng() * 2 - 1)) * Math.exp(-t * (open ? 14 : 62)) * G;
    add(ctx.bus.drums, at + i, y * 0.8, y);
  }
}
function snare(ctx, at, g = 1) {
  const bp = new D.Biquad('bp', 1900, 0.9), hp = new D.Biquad('hp', 700);
  const n = Math.round(0.26 * SR), G = g * PARAMS.level.snare;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (190 + 60 * Math.exp(-t * 40))) / SR;
    const body = Math.sin(ph) * Math.exp(-t * 28) * 0.7;
    const noise = bp.process(hp.process(ctx.rng() * 2 - 1)) * Math.exp(-t * 17) * 2.2;
    const y = (body + noise) * G;
    add(ctx.bus.drums, at + i, y, y * 0.95);
    add(ctx.bus.send, at + i, y * 0.18, y * 0.18);
  }
}
function crash(ctx, at, g = 1) {
  const hp = new D.Biquad('hp', 3200), lp = new D.Biquad('lp', 9500);
  const n = Math.round(1.6 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const y = lp.process(hp.process(ctx.rng() * 2 - 1)) * Math.exp(-t * 2.6) * g * 0.32;
    add(ctx.bus.drums, at + i, y, y * 0.9);
  }
}
function sub(ctx, at, len, note, g = 1) {
  const f = D.midiHz(note), f2 = D.midiHz(note + 12);
  const lp = new D.Biquad('lp', 420, 0.9);
  const rel = Math.round(0.03 * SR);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < len + rel; i++) {
    const env = Math.min(1, i / 240) * (i < len ? 1 : Math.exp(-(i - len) / (rel / 4)));
    ph += (2 * Math.PI * f) / SR;
    ph2 += f2 / SR; if (ph2 >= 1) ph2 -= 1;
    const s = Math.tanh(Math.sin(ph) * 1.25) * PARAMS.level.sub;
    const saw = lp.process(2 * ph2 - 1 - D.polyblep(ph2, f2 / SR)) * PARAMS.level.bass;
    const y = (s + saw) * env * g;
    add(ctx.bus.bass, at + i, y, y);
  }
}
function supersaw(ctx, bus, at, len, notes, g, o = {}) {
  const { cutoff = 2600, cutoffEnv = 1.6, attack = 0.004, decay = 0.2, sustain = 0.55, release = 0.12, send = 0.22, voices = PARAMS.supersaw.voices, detune = PARAMS.supersaw.detune, q = 0.8 } = o;
  const det = [-1, -0.62, -0.28, 0, 0.28, 0.62, 1].slice(0, voices);
  const relN = Math.round(release * SR);
  const endLevel = sustain + (1 - sustain) * Math.exp(-(len / SR - attack) / decay);
  for (const note of notes) {
    const f0 = D.midiHz(note);
    const lpL = new D.Biquad('lp', cutoff, q), lpR = new D.Biquad('lp', cutoff, q);
    const vs = det.map((d, k) => ({ inc: (f0 * 2 ** ((d * detune) / 12)) / SR, ph: ctx.rng(), pan: voices > 1 ? (k / (voices - 1)) * 2 - 1 : 0 }));
    const G = (g * 1.7) / Math.sqrt(voices * notes.length);
    for (let i = 0; i < len + relN; i++) {
      const t = i / SR;
      const env = i < len ? (t < attack ? t / attack : sustain + (1 - sustain) * Math.exp(-(t - attack) / decay)) : endLevel * Math.exp(-(i - len) / (relN / 4));
      if ((i & 31) === 0) {
        const c = cutoff * (1 + cutoffEnv * Math.exp(-t / 0.12));
        lpL.set('lp', c, q); lpR.set('lp', c, q);
      }
      let l = 0, r = 0;
      for (const v of vs) {
        const y = 2 * v.ph - 1 - D.polyblep(v.ph, v.inc);
        v.ph += v.inc; if (v.ph >= 1) v.ph -= 1;
        l += y * (0.5 - v.pan * 0.4); r += y * (0.5 + v.pan * 0.4);
      }
      l = lpL.process(l) * env * G; r = lpR.process(r) * env * G;
      add(bus, at + i, l, r);
      if (send) add(ctx.bus.send, at + i, l * send * PARAMS.reverbSend, r * send * PARAMS.reverbSend);
    }
  }
}
const stab = (ctx, at, len, chord, g = 1, o = {}) => supersaw(ctx, ctx.bus.music, at, len, CHORDS[chord].notes, PARAMS.level.stab * g, o);
const pad = (ctx, at, len, notes, g = 1, o = {}) => supersaw(ctx, ctx.bus.music, at, len, notes, PARAMS.level.pad * g,
  { cutoff: 1300, cutoffEnv: 0, attack: 0.3, decay: 1, sustain: 0.9, release: 0.5, send: 0.55, voices: 5, detune: 0.16, ...o });
function pluck(ctx, at, note, g = 1, pan = -0.3) {
  const f = D.midiHz(note), n = Math.round(0.5 * SR);
  const lp = new D.Biquad('lp', 6000, 1.1);
  const vs = [-0.06, 0.06].map((d) => ({ inc: (f * 2 ** (d / 12)) / SR, ph: ctx.rng() }));
  const [pl, pr] = D.panGains(pan), G = g * PARAMS.level.pluck;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 15) === 0) lp.set('lp', 800 + 6400 * Math.exp(-t / 0.05), 1.1);
    let y = 0;
    for (const v of vs) { y += 2 * v.ph - 1 - D.polyblep(v.ph, v.inc); v.ph += v.inc; if (v.ph >= 1) v.ph -= 1; }
    y = lp.process(y * 0.5) * Math.exp(-t * 7) * Math.min(1, t / 0.002) * G;
    add(ctx.bus.music, at + i, y * pl, y * pr);
    add(ctx.bus.send, at + i, y * 0.35 * pl, y * 0.35 * pr);
  }
}
function arpNote(ctx, at, note, g, cutoff, pan) {
  const f = D.midiHz(note), n = Math.round(0.16 * SR), inc = f / SR;
  const lp = new D.Biquad('lp', cutoff, 1.4);
  const [pl, pr] = D.panGains(pan), G = g * PARAMS.level.arp;
  let ph = ctx.rng(), ph2 = (ph + 0.35) % 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const a = 2 * ph - 1 - D.polyblep(ph, inc), b = 2 * ph2 - 1 - D.polyblep(ph2, inc);
    ph += inc; if (ph >= 1) ph -= 1; ph2 += inc; if (ph2 >= 1) ph2 -= 1;
    const y = lp.process((a - b) * 0.5) * Math.exp(-t * 16) * Math.min(1, t / 0.002) * G;
    add(ctx.bus.music, at + i, y * pl, y * pr);
    add(ctx.bus.send, at + i, y * 0.2 * pl, y * 0.2 * pr);
  }
}
function drone(ctx, at, len, g = 1) {
  const lp = new D.Biquad('lp', 220, 1.1);
  const vs = [[29, -0.07], [29, 0.07], [41, -0.05], [41, 0.06]].map(([n, d]) => ({ inc: (D.midiHz(n) * 2 ** (d / 12)) / SR, ph: ctx.rng() }));
  const G = g * PARAMS.level.drone;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if ((i & 63) === 0) lp.set('lp', 220 + 70 * Math.sin(2 * Math.PI * 0.25 * t), 1.1);
    let y = 0;
    for (const v of vs) { y += 2 * v.ph - 1 - D.polyblep(v.ph, v.inc); v.ph += v.inc; if (v.ph >= 1) v.ph -= 1; }
    const env = Math.min(1, i / 480) * Math.min(1, (len - i) / 960);
    y = lp.process(y * 0.3) * env * G;
    add(ctx.bus.music, at + i, y, y);
  }
}
function clack(ctx, at, g = 1) {
  const bp = new D.Biquad('bp', 2400 + ctx.rng() * 1200, 2.2);
  const n = Math.round(0.03 * SR), pan = ctx.rng() * 0.8 - 0.4;
  const [pl, pr] = D.panGains(pan), G = g * PARAMS.level.clack * 3;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * 330) / SR;
    const y = (bp.process(ctx.rng() * 2 - 1) * Math.exp(-t * 700) + Math.sin(ph) * Math.exp(-t * 260) * 0.4) * G;
    add(ctx.bus.drums, at + i, y * pl, y * pr);
  }
}
function riser(ctx, at, len, g = 1) {
  const bp = new D.Biquad('bp', 300, 2.5);
  const G = g * PARAMS.level.riser;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    if ((i & 31) === 0) bp.set('bp', 250 * 28 ** u, 2.5);
    ph += D.midiHz(53 + 30 * u) / SR; if (ph >= 1) ph -= 1;
    const y = (bp.process(ctx.rng() * 2 - 1) * 1.6 + (2 * ph - 1) * 0.05) * u * u * G;
    add(ctx.bus.fx, at + i, y, y);
  }
}
function revCymbal(ctx, endAt, len, g = 1) {
  const hp = new D.Biquad('hp', 3800), lp = new D.Biquad('lp', 10000);
  const tmp = new Float32Array(len);
  for (let i = 0; i < len; i++) tmp[i] = lp.process(hp.process(ctx.rng() * 2 - 1)) * Math.exp(-(i / SR) * 3.2) * g * 0.45;
  for (let i = 0; i < len; i++) add(ctx.bus.fx, endAt - i, tmp[i], tmp[i] * 0.95);
}

// ---- sections ------------------------------------------------------------------
function chordAt(ctx, localBar) {
  const abs = ctx.absBar0 + localBar - 1;
  return PROG[(((abs - ctx.progAnchor) % 4) + 4) % 4];
}
const pos = (ctx, bar, beat = 1, step = 0) => ctx.start + (bar - 1) * BAR + (beat - 1) * BEAT + Math.round(step * STEP);

function grooveBar(ctx, bar, o = {}) {
  const at = pos(ctx, bar);
  const ch = o.chord ?? chordAt(ctx, bar);
  const lastBeatFill = o.fill;
  for (let s = 0; s < 16; s += 4) if (!(lastBeatFill && s === 12)) kick(ctx, at + s * STEP);
  if (!o.noClap) { clap(ctx, at + 4 * STEP); if (!lastBeatFill) clap(ctx, at + 12 * STEP); }
  for (let s = 0; s < 16; s++) {
    if (s % 4 === 2) hat(ctx, at + s * STEP, 1);
    else if (o.doubleHats || s % 2 === 1) hat(ctx, at + s * STEP, o.doubleHats ? 0.55 : 0.28);
  }
  sub(ctx, at, BAR, CHORDS[ch].sub, o.subGain ?? 1);
  if (!o.noStabs) for (const [s, l] of [[0, 2], [3, 2], [6, 3], [10, 2], [13, 2]]) stab(ctx, at + s * STEP, l * STEP - 400, ch, s === 0 ? 1 : 0.8);
  if (!o.noArp) {
    const tones = CHORDS[ch].notes;
    const pat = o.counterMelody ? [3, 1, 2, 0, 3, 2, 1, 2, 3, 1, 2, 0, 1, 2, 3, 2] : [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2];
    const oct = o.counterMelody ? 24 : 12;
    for (let s = 0; s < 16; s++) arpNote(ctx, at + s * STEP, tones[pat[s]] + oct, o.counterMelody ? 1.2 : 0.85, (o.arpCutoff ?? 2200) + 500 * Math.sin((s / 16) * Math.PI), s % 2 ? 0.3 : -0.3);
  }
  pad(ctx, at, BAR - 1200, CHORDS[ch].notes, o.padGain ?? 0.6);
  if (lastBeatFill) {
    for (let k = 0; k < 4; k++) snare(ctx, at + (12 + k) * STEP, 0.45 + k * 0.17);
    hat(ctx, at + 15 * STEP, 0.9, true);
  }
}

const SECTIONS = {
  none() {},
  coldOpen(ctx, p) {
    const [dBar, dBeat] = p.dropout ?? [2, 3];
    // The silence runs to the next bar, or until the chaos restarts (dropoutUntil).
    const dropStart = pos(ctx, dBar, dBeat), dropEnd = p.dropoutUntil ? pos(ctx, p.dropoutUntil[0], p.dropoutUntil[1]) : pos(ctx, dBar + 1);
    const inDrop = (at) => at >= dropStart && at < dropEnd;
    drone(ctx, ctx.start, dropStart - ctx.start);
    if (dropEnd < ctx.end) drone(ctx, dropEnd, ctx.end - dropEnd);
    // The terminal shatters at shatterAt ([bar, beat]): the clacks stop, and a
    // kick and a riser carry the headline into the next section.
    const shatter = p.shatterAt ? pos(ctx, p.shatterAt[0], p.shatterAt[1]) : Infinity;
    const accents = [1, 0, 0.5, 0.8, 0, 0, 0.7, 0, 0.9, 0, 0.6, 0.5, 0, 0, 0.8, 0.4];
    for (let bar = 1; bar <= ctx.bars; bar++) {
      for (let s = 0; s < 16; s++) {
        const at = pos(ctx, bar, 1, s);
        if (accents[s] && !inDrop(at) && at < shatter) clack(ctx, at, accents[s]);
      }
      if ((bar === 1 || bar === 3) && !inDrop(pos(ctx, bar)) && pos(ctx, bar) < shatter) kick(ctx, pos(ctx, bar), 0.55);
    }
    if (p.shatterAt) { riser(ctx, shatter, ctx.end - shatter, 0.8); kick(ctx, shatter, 0.8); }
  },
  lanes(ctx, p) {
    const jab = p.jabBar ?? 0;
    for (let bar = 1; bar <= ctx.bars; bar++) {
      const ch = chordAt(ctx, bar), at = pos(ctx, bar);
      pad(ctx, at, BAR - 800, CHORDS[ch].notes, 1.1);
      const tones = CHORDS[ch].notes;
      const cut = 350 + 3000 * ((bar - 1 + 0.5) / ctx.bars);
      for (let s = 0; s < 16; s++) arpNote(ctx, at + s * STEP, tones[[0, 1, 2, 3][s % 4]] + 12, 1.25, cut * (1 + 0.4 * (s / 16)), s % 2 ? 0.35 : -0.35);
      if (jab && bar >= jab) {
        // The switcher jab runs from jabBar to the drop: one snare per question
        // (every beat over one bar, every other beat over two), one riser.
        // `jabHits` pins the snares to the question cues instead, for a jab
        // that starts mid-bar or holds after its last question.
        const hits = p.jabHits;
        if (hits) {
          hits.forEach(([hb, hbeat], i) => {
            if (hb === bar) snare(ctx, pos(ctx, hb, hbeat), 0.75 + (i + 1) * (0.32 / hits.length));
          });
        } else {
          const span = ctx.bars - jab + 1, beats = span === 1 ? [1, 2, 3, 4] : [1, 3];
          beats.forEach((b, i) => snare(ctx, pos(ctx, bar, b), 0.75 + ((bar - jab) * beats.length + i + 1) * (0.32 / (span * beats.length))));
        }
        if (bar === jab) {
          const from = hits ? pos(ctx, hits[0][0], hits[0][1]) : at;
          riser(ctx, from, ctx.end - from, 1.1);
        }
        sub(ctx, at, BAR, CHORDS[ch].sub, 0.5);
      } else {
        for (const [s, n] of PLUCK_MOTIF) pluck(ctx, at + s * STEP, n, 1.45, -0.35);
        kick(ctx, at, 0.75); kick(ctx, at + 8 * STEP, 0.7);
        clap(ctx, at + 12 * STEP, 0.55);
        for (let s = 2; s < 16; s += 4) hat(ctx, at + s * STEP, 0.8);
        sub(ctx, at, BAR, CHORDS[ch].sub, 0.6);
      }
    }
  },
  jab(ctx) {
    const at = pos(ctx, 1), ch = chordAt(ctx, 1);
    pad(ctx, at, BAR - 800, CHORDS[ch].notes, 1.1);
    for (let b = 1; b <= 4; b++) snare(ctx, pos(ctx, 1, b), 0.75 + b * 0.08);
    riser(ctx, at, BAR, 1.1);
    for (let s = 0; s < 16; s++) arpNote(ctx, at + s * STEP, CHORDS[ch].notes[s % 4] + 12, 0.9, 2500 + 150 * s, s % 2 ? 0.35 : -0.35);
  },
  build(ctx) {
    const at = pos(ctx, 1), ch = chordAt(ctx, 1);
    pad(ctx, at, BAR - 800, CHORDS[ch].notes, 1);
    for (let s = 0; s < 16; s++) arpNote(ctx, at + s * STEP, CHORDS[ch].notes[s % 4] + 12, 0.9, 1200 + 200 * s, s % 2 ? 0.35 : -0.35);
    for (let s = 0; s < 16; s += 4) kick(ctx, at + s * STEP, 0.7);
    for (let b = 2; b <= 4; b += 2) snare(ctx, pos(ctx, 1, b), 0.6);
    riser(ctx, at, BAR, 0.9);
  },
  drop(ctx) {
    ctx.progAnchor = ctx.absBar0;
    const at = pos(ctx, 1);
    crash(ctx, at, 1);
    stab(ctx, at, BEAT - 1200, 'Fm', 1.35, { decay: 0.35, cutoff: 3200 });
    stab(ctx, pos(ctx, 1, 2), BEAT - 2400, 'Fm', 1.15, { cutoff: 3600 });
    for (let s = 0; s < 16; s += 4) kick(ctx, at + s * STEP, 1.05);
    clap(ctx, at + 4 * STEP); clap(ctx, at + 12 * STEP);
    for (let s = 2; s < 16; s += 4) hat(ctx, at + s * STEP);
    sub(ctx, at, BAR, CHORDS.Fm.sub, 1.1);
    pad(ctx, at, BAR - 1200, CHORDS.Fm.notes, 0.8);
    for (let bar = 2; bar <= ctx.bars; bar++) grooveBar(ctx, bar, { fill: bar === ctx.bars && ctx.next !== 'none' });
  },
  groove(ctx, p) {
    const [tsBar, tsBeat] = p.tapeStop ?? [0, 0];
    for (let bar = 1; bar <= ctx.bars; bar++) {
      const dip = p.filterDip && p.filterDip[0] === bar;
      grooveBar(ctx, bar, { fill: p.fill && bar === ctx.bars, noStabs: dip, noArp: dip, padGain: dip ? 1.1 : 0.6 });
    }
    if (tsBar) {
      const t0 = pos(ctx, tsBar, tsBeat), t1 = pos(ctx, tsBar + 1);
      ctx.tapeStops.push([t0, t1]);
      revCymbal(ctx, t1, t1 - t0, 1.1);
      if (tsBar + 1 <= ctx.bars) crash(ctx, t1, 1);
    }
  },
  montage(ctx, p) {
    const [swBar, swBeat] = p.swellAt ?? [0, 0];
    for (let bar = 1; bar <= ctx.bars; bar++) grooveBar(ctx, bar, { doubleHats: true, counterMelody: true, arpCutoff: 2800, fill: bar === ctx.bars });
    if (swBar) { const at = pos(ctx, swBar, swBeat); riser(ctx, at - BEAT, BEAT, 1.0); crash(ctx, at, 0.8); }
  },
  twoLanes(ctx) {
    for (let bar = 1; bar <= ctx.bars; bar++) {
      const at = pos(ctx, bar), ch = chordAt(ctx, bar);
      for (let s = 0; s < 16; s += 4) kick(ctx, at + s * STEP, 0.9);
      sub(ctx, at, BAR, CHORDS[ch].sub, 0.7);
      for (const [s, n] of PLUCK_MOTIF.filter(([s]) => s < 8)) pluck(ctx, at + s * STEP, n, 1.1, -0.4);
      pad(ctx, at + 8 * STEP, 8 * STEP, CHORDS[ch].notes, 1.4, { attack: 0.08 });
    }
  },
  stinger(ctx, p) {
    const silence = p.silenceBeats ?? 4;
    const hitAt = ctx.start + silence * BEAT;
    const end = ctx.end, tail = end - hitAt;
    // The cutdowns go straight from the hit to the end card's F major, so
    // there the dark (F minor) hit is cut short instead of ringing into it.
    const short = tail < BEAT * 3;
    // A reverse cymbal swells through the pause into the hit.
    revCymbal(ctx, hitAt, Math.round(BEAT * 1.5), 0.9);
    // Sub drop and a dark chord under the SFX hit, then a pulse that builds.
    const subLen = short ? Math.min(Math.round(1.8 * SR), tail) : Math.round(1.8 * SR);
    const subFade = Math.round(0.12 * SR);
    let ph = 0;
    for (let i = 0; i < subLen; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (30 + 45 * Math.exp(-t * 3))) / SR;
      const y = Math.tanh(Math.sin(ph) * 1.4) * Math.exp(-t * 1.6) * 0.75 * (short ? Math.min(1, (subLen - i) / subFade) : 1);
      add(ctx.bus.bass, hitAt + i, y, y);
    }
    supersaw(ctx, ctx.bus.music, hitAt, short ? tail - Math.round(0.25 * SR) : Math.round(1.2 * SR), [41, 48, 53, 56], 0.5,
      { cutoff: 1100, cutoffEnv: 2, decay: 0.8, sustain: 0.3, release: short ? 0.25 : 0.8, send: short ? 0.3 : 0.6 });
    if (short) return;
    const pulses = Math.floor((tail - BEAT) / (STEP * 2));
    for (let k = 0; k < pulses; k++) {
      const at = hitAt + BEAT + k * STEP * 2, u = (k + 1) / pulses;
      kick(ctx, at, 0.25 + 0.6 * u);
      sub(ctx, at, STEP * 2 - 600, 29, 0.3 + 0.6 * u);
    }
    riser(ctx, end - BEAT * 2, BEAT * 2, 0.9);
  },
  lift(ctx) {
    // Db for the first half, Eb for the second; the arp opens up across the section.
    for (let bar = 1; bar <= ctx.bars; bar++) grooveBar(ctx, bar, { chord: bar <= ctx.bars / 2 ? 'Db' : 'Eb', doubleHats: bar === ctx.bars, arpCutoff: 2400 + (1400 * (bar - 1)) / Math.max(1, ctx.bars - 1), fill: bar === ctx.bars });
    riser(ctx, pos(ctx, ctx.bars), BAR, 0.9);
  },
  end(ctx) {
    const at = pos(ctx, 1), len = ctx.end - at;
    crash(ctx, at, 0.9);
    kick(ctx, at, 1.1);
    if (ctx.bars >= 4) {
      // The master's long ending: the F chord rings under bars 1-3, is struck
      // again on bar 4 (the click) and sustains through bar 5, decaying into the fade.
      const again = pos(ctx, 4);
      supersaw(ctx, ctx.bus.music, at, again - at, CHORDS.F.notes, 0.62, { cutoff: 2400, cutoffEnv: 1.2, attack: 0.01, decay: 1.8, sustain: 0.35, release: 0.6, send: 0.6 });
      sub(ctx, at, again - at, 29, 0.9);
      const notes = [65, 69, 72, 77, 81, 77, 72, 69];
      for (let k = 0; k < 24; k++) pluck(ctx, at + k * STEP * 2, notes[k % notes.length], 0.9 * (1 - k / 30), k % 2 ? 0.3 : -0.3);
      crash(ctx, again, 0.5);
      supersaw(ctx, ctx.bus.music, again, ctx.end - again, CHORDS.F.notes, 0.58, { cutoff: 2200, cutoffEnv: 0.8, attack: 0.02, decay: 2.4, sustain: 0.1, release: 0.3, send: 0.8 });
      sub(ctx, again, ctx.end - again, 29, 0.55); // the sub has no decay of its own: the fade takes it out
      return;
    }
    supersaw(ctx, ctx.bus.music, at, len - Math.round(0.2 * SR), CHORDS.F.notes, 0.62, { cutoff: 2400, cutoffEnv: 1.2, attack: 0.01, decay: 1.8, sustain: 0.35, release: 0.2, send: 0.6 });
    sub(ctx, at, len - Math.round(0.25 * SR), 29, 0.9);
    const arp = [65, 69, 72, 77, 81, 77, 72, 69];
    for (let k = 0; k < 16; k++) pluck(ctx, at + k * STEP * 2, arp[k % arp.length], 0.9 * (1 - k / 20), k % 2 ? 0.3 : -0.3);
  },
};

// ---- per-composition render ------------------------------------------------------
function cueFrame(section, name) {
  const c = section.cues?.[name];
  if (!c) return null;
  return (c[0] - 1) * T.barFrames + (c[1] - 1) * T.beatFrames + (c[2] ?? 0);
}

export function sfxEvents(compName) {
  const comp = T.compositions[compName];
  const events = [];
  for (const a of comp.arrangement) {
    const sec = T.sections[a.section];
    const base = (a.fromBar - 1) * T.barFrames;
    for (const [id, cue, off = 0, vol = 0.5, count = 1, every = 2] of sec.sfx ?? []) {
      const f = cueFrame(sec, cue);
      if (f === null) continue;
      for (let k = 0; k < count; k++) events.push({ id, frame: base + f + off + k * every, volume: vol, section: a.section });
    }
  }
  return events.sort((x, y) => x.frame - y.frame);
}

function renderComposition(name) {
  const comp = T.compositions[name];
  const bars = comp.arrangement[comp.arrangement.length - 1].toBar;
  const len = bars * BAR;
  const bus = { drums: D.stereo(len), bass: D.stereo(len), music: D.stereo(len), fx: D.stereo(len), send: D.stereo(len) };
  const ctx = { rng: D.mulberry32(PARAMS.seed), bus, kicks: [], tapeStops: [], progAnchor: 0 };
  comp.arrangement.forEach((a, idx) => {
    const sec = T.sections[a.section];
    const type = sec.music?.type ?? 'none';
    Object.assign(ctx, {
      start: (a.fromBar - 1) * BAR, end: a.toBar * BAR, bars: a.toBar - a.fromBar + 1, absBar0: a.fromBar - 1,
      next: T.sections[comp.arrangement[idx + 1]?.section]?.music?.type ?? 'none',
    });
    SECTIONS[type](ctx, sec.music ?? {});
  });

  // Sidechain: duck the bass hard and the music gently on every kick.
  const duck = new Float32Array(len).fill(1);
  const rel = (PARAMS.sidechain.releaseMs / 1000) * SR;
  for (const k of ctx.kicks) for (let i = 0; i < rel * 3 && k + i < len; i++) {
    const d = Math.min(1, i / 96) * Math.exp(-i / rel);
    duck[k + i] = Math.min(duck[k + i], 1 - d);
  }
  const wet = D.reverb(bus.send, { room: 0.84, damp: 0.4 });
  const mix = D.stereo(len);
  for (let i = 0; i < len; i++) {
    const db = 1 - PARAMS.sidechain.bass * (1 - duck[i]), dm = 1 - PARAMS.sidechain.music * (1 - duck[i]);
    for (let c = 0; c < 2; c++) mix[c][i] = bus.drums[c][i] + bus.bass[c][i] * db + (bus.music[c][i] + wet[c][i]) * dm;
  }
  // Tape-stop: resample the mix with a playback rate that falls to zero.
  for (const [t0, t1] of ctx.tapeStops) {
    const n = t1 - t0, src = [mix[0].slice(t0, t1), mix[1].slice(t0, t1)];
    let p = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n, rate = Math.max(0, (1 - u) ** 1.6);
      const j = Math.floor(p), fr = p - j;
      const fade = Math.min(1, (1 - u) * 6);
      for (let c = 0; c < 2; c++) mix[c][t0 + i] = ((src[c][j] ?? 0) * (1 - fr) + (src[c][j + 1] ?? 0) * fr) * fade;
      p += rate;
    }
  }
  for (let i = 0; i < len; i++) { mix[0][i] += bus.fx[0][i]; mix[1][i] += bus.fx[1][i]; }
  // Music dips under the lead SFX so the collapse thunk and the hits lead.
  const dip = D.dbToLin(PARAMS.duckUnderLeadSfxDb);
  for (const e of sfxEvents(name)) {
    if (!['thunk', 'hit', 'impact', 'boom'].includes(e.id) || e.volume < 0.5) continue;
    const at = e.frame * FRAME - 240;
    for (let i = 0; i < SR * 0.4 && at + i < len; i++) {
      if (at + i < 0) continue;
      const u = i < 240 ? i / 240 : Math.exp(-(i - 240) / (0.12 * SR));
      const g = 1 - (1 - dip) * u;
      mix[0][at + i] *= g; mix[1][at + i] *= g;
    }
  }
  // Master: gain-stage to about the target, round off only the transient
  // peaks with a soft clip, then loudness and a true-peak-safe limiter.
  const raw = { lufs: D.integratedLoudness(mix), peak: D.linToDb(D.peak(mix)) };
  D.gain(mix, D.dbToLin(PARAMS.targetLufs + 1 - raw.lufs));
  D.softClip(mix, 0.9);
  const ceiling = D.dbToLin(PARAMS.ceilingDbtp - 0.4);
  let measured = D.integratedLoudness(mix);
  for (let pass = 0; pass < 3; pass++) {
    D.gain(mix, D.dbToLin(PARAMS.targetLufs - measured));
    D.limit(mix, ceiling);
    measured = D.integratedLoudness(mix);
    if (Math.abs(measured - PARAMS.targetLufs) < 0.15) break;
  }
  let tp = D.truePeak(mix);
  for (let k = 0; k < 4 && tp > PARAMS.ceilingDbtp; k++) { D.limit(mix, D.dbToLin(PARAMS.ceilingDbtp - 0.4 - (tp - PARAMS.ceilingDbtp) - 0.1 * (k + 1))); tp = D.truePeak(mix); }
  // The master fades out over its last fadeOutFrames, with the picture.
  const fadeIn = 240, fadeOut = comp.fadeOutFrames ? Math.round(comp.fadeOutFrames * FRAME) : Math.round(0.35 * SR);
  for (let i = 0; i < fadeIn; i++) { mix[0][i] *= i / fadeIn; mix[1][i] *= i / fadeIn; }
  for (let i = 0; i < fadeOut; i++) { const g = i / fadeOut; mix[0][len - 1 - i] *= g; mix[1][len - 1 - i] *= g; }
  return { mix, raw, lufs: D.integratedLoudness(mix), tp: D.truePeak(mix) };
}

// ---- sound effects ---------------------------------------------------------------
function sfxBuffer(seconds) { return D.stereo(Math.round(seconds * SR)); }
function norm(buf, peakDb) { const p = D.peak(buf); if (p > 0) D.gain(buf, D.dbToLin(peakDb) / p); return buf; }
const SFX = {
  clatter(rng) {
    const b = sfxBuffer(0.65);
    let t = 0.005;
    while (t < 0.58) {
      const at = Math.round(t * SR), pan = rng() * 0.7 - 0.35, [pl, pr] = D.panGains(pan);
      const bp = new D.Biquad('bp', 2200 + rng() * 1600, 2.5), body = 170 + rng() * 60, g = 0.6 + rng() * 0.4;
      let ph = 0;
      for (let i = 0; i < 0.035 * SR; i++) {
        const x = i / SR; ph += (2 * Math.PI * body) / SR;
        const y = (bp.process(rng() * 2 - 1) * Math.exp(-x * 520) * 1.6 + Math.sin(ph) * Math.exp(-x * 180) * 0.5) * g;
        add(b, at + i, y * pl, y * pr);
      }
      t += 0.028 + rng() * 0.03;
    }
    return norm(b, -3);
  },
  glitch(rng) {
    const b = sfxBuffer(0.6);
    let held = 0;
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR;
      if (i % (t < 0.2 ? 10 : 18) === 0) {
        const buzz = Math.sign(Math.sin(2 * Math.PI * 70 * t)) * 0.6 + Math.sign(Math.sin(2 * Math.PI * 141 * t)) * 0.3;
        held = t < 0.2 ? buzz : (rng() * 2 - 1) * 0.8;
        held = Math.round(held * 6) / 6;
      }
      const y = held * (t < 0.2 ? 1 : Math.exp(-(t - 0.2) * 9));
      add(b, i, y, y * 0.9);
    }
    const lp = [new D.Biquad('lp', 5000), new D.Biquad('lp', 5000)];
    for (let i = 0; i < b[0].length; i++) { b[0][i] = lp[0].process(b[0][i]); b[1][i] = lp[1].process(b[1][i]); }
    return norm(b, -3);
  },
  shatter(rng) {
    const b = sfxBuffer(1.4);
    const bp = new D.Biquad('bp', 6000, 1.2);
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR;
      if ((i & 31) === 0) bp.set('bp', 6000 * 0.08 ** (t / 1.4), 1.2);
      const y = bp.process(rng() * 2 - 1) * Math.exp(-t * 2.4) * 1.4;
      add(b, i, y, y);
    }
    for (let k = 0; k < 26; k++) {
      const at = Math.round((rng() ** 2) * 0.5 * SR), f = 2200 + rng() * 5200, [pl, pr] = D.panGains(rng() * 1.6 - 0.8);
      for (let i = 0; i < 0.25 * SR; i++) { const y = Math.sin((2 * Math.PI * f * i) / SR) * Math.exp(-(i / SR) * 26) * 0.25; add(b, at + i, y * pl, y * pr); }
    }
    return norm(b, -3);
  },
  swish(rng) {
    const b = sfxBuffer(0.4), bp = new D.Biquad('bp', 800, 1.4);
    for (let i = 0; i < b[0].length; i++) {
      const u = i / b[0].length;
      if ((i & 31) === 0) bp.set('bp', 700 * 4.5 ** u, 1.4);
      const y = bp.process(rng() * 2 - 1) * Math.sin(Math.PI * u) ** 2 * 1.5, [pl, pr] = D.panGains(u * 1.2 - 0.6);
      add(b, i, y * pl, y * pr);
    }
    return norm(b, -4);
  },
  impact(rng) {
    const b = sfxBuffer(1.8), lp = new D.Biquad('lp', 2800);
    let ph = 0;
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (34 + 90 * Math.exp(-t * 9))) / SR;
      const y = Math.tanh(Math.sin(ph) * 2) * Math.exp(-t * 2.2) + lp.process(rng() * 2 - 1) * Math.exp(-t * 7) * 0.6;
      add(b, i, y, y);
    }
    return norm(b, -3);
  },
  whoosh(rng) {
    const b = sfxBuffer(0.3), bp = new D.Biquad('bp', 300, 1.2);
    for (let i = 0; i < b[0].length; i++) {
      const u = i / b[0].length;
      if ((i & 31) === 0) bp.set('bp', 300 * 14 ** u, 1.2);
      const y = bp.process(rng() * 2 - 1) * u ** 2.2 * 1.8;
      add(b, i, y, y);
    }
    return norm(b, -4);
  },
  thunk(rng) {
    const b = sfxBuffer(0.5), bp = new D.Biquad('bp', 900, 1.5);
    let ph = 0, ph2 = 0;
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (52 + 60 * Math.exp(-t * 22))) / SR;
      ph2 += (2 * Math.PI * 215) / SR;
      const y = Math.tanh(Math.sin(ph) * 1.8) * Math.exp(-t * 9) + Math.sin(ph2) * Math.exp(-t * 40) * 0.35 + bp.process(rng() * 2 - 1) * Math.exp(-t * 160) * 0.9;
      add(b, i, y, y);
    }
    return norm(b, -3);
  },
  flip(rng) {
    const b = sfxBuffer(0.05), hp = new D.Biquad('hp', 1800);
    for (const [o, g] of [[0, 1], [0.009, 0.6]]) for (let i = 0; i < 0.012 * SR; i++) {
      const t = i / SR, y = (hp.process(rng() * 2 - 1) * Math.exp(-t * 900) + Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 500) * 0.4) * g;
      add(b, Math.round(o * SR) + i, y, y);
    }
    return norm(b, -4);
  },
  alarm() {
    const b = sfxBuffer(0.36), lp = new D.Biquad('lp', 3000);
    for (const [o, f] of [[0, 880], [0.16, 660]]) for (let i = 0; i < 0.12 * SR; i++) {
      const t = i / SR, env = Math.min(1, t / 0.004) * Math.min(1, (0.12 - t) / 0.02);
      const y = lp.process(Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.5 + Math.sin(2 * Math.PI * f * t) * 0.5) * env;
      add(b, Math.round(o * SR) + i, y, y);
    }
    return norm(b, -4);
  },
  chime() {
    const b = sfxBuffer(1.3);
    for (const [ratio, g, dec] of [[1, 1, 3], [2.76, 0.4, 5], [5.4, 0.18, 8]]) for (let i = 0; i < b[0].length; i++) {
      const t = i / SR, y = Math.sin(2 * Math.PI * 1046.5 * ratio * t) * g * Math.exp(-t * dec) * Math.min(1, t / 0.002);
      add(b, i, y, y);
    }
    return norm(b, -4);
  },
  boom(rng) {
    const b = sfxBuffer(1.2), lp = new D.Biquad('lp', 900);
    let ph = 0;
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (30 + 30 * Math.exp(-t * 4))) / SR;
      const y = Math.tanh(Math.sin(ph) * 2.2) * Math.exp(-t * 3) + lp.process(rng() * 2 - 1) * Math.exp(-t * 10) * 0.4;
      add(b, i, y, y);
    }
    return norm(b, -3);
  },
  emerald() {
    const b = sfxBuffer(1.0);
    [[0, 81], [0.07, 84], [0.14, 89]].forEach(([o, n]) => {
      const f = D.midiHz(n);
      for (let i = 0; i < 0.8 * SR; i++) {
        const t = i / SR, y = (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 2.01 * t) * 0.2) * Math.exp(-t * 5) * Math.min(1, t / 0.003);
        add(b, Math.round(o * SR) + i, y * 0.9, y);
      }
    });
    return norm(b, -5);
  },
  crack(rng) {
    const b = sfxBuffer(0.5), hp = new D.Biquad('hp', 3000);
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR;
      let y = hp.process(rng() * 2 - 1) * Math.exp(-t * 60) * 1.4;
      if (rng() < 0.004 * Math.exp(-t * 6)) y += (rng() * 2 - 1) * 2;
      y += Math.sin(2 * Math.PI * 3400 * t) * Math.exp(-t * 18) * 0.3;
      add(b, i, y, y * 0.92);
    }
    return norm(b, -3);
  },
  cascade(rng) {
    const b = sfxBuffer(1.3);
    for (let k = 0; k < 44; k++) {
      const u = k / 44, at = Math.round((u ** 0.8) * 1.1 * SR), f = 3200 * 0.2 ** u, [pl, pr] = D.panGains(rng() * 1.2 - 0.6);
      for (let i = 0; i < 0.03 * SR; i++) { const t = i / SR, y = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 160) * (0.5 + 0.5 * rng()); add(b, at + i, y * pl, y * pr); }
    }
    return norm(b, -4);
  },
  thock(rng) {
    const b = sfxBuffer(0.12), bp = new D.Biquad('bp', 1700, 2);
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR, y = Math.sin(2 * Math.PI * (140 + 80 * Math.exp(-t * 60)) * t) * Math.exp(-t * 45) + bp.process(rng() * 2 - 1) * Math.exp(-t * 300) * 0.8;
      add(b, i, y, y);
    }
    return norm(b, -3);
  },
  click(rng) {
    const b = sfxBuffer(0.04), bp = new D.Biquad('bp', 2600, 2);
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR, y = bp.process(rng() * 2 - 1) * Math.exp(-t * 700) + Math.sin(2 * Math.PI * 900 * t) * Math.exp(-t * 400) * 0.4;
      add(b, i, y, y);
    }
    return norm(b, -4);
  },
  pop() {
    const b = sfxBuffer(0.14);
    let ph = 0;
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (300 + 500 * (1 - Math.exp(-t * 60)))) / SR;
      const y = Math.sin(ph) * Math.exp(-t * 30) * Math.min(1, t / 0.002);
      add(b, i, y, y);
    }
    return norm(b, -5);
  },
  swell(rng) {
    const b = sfxBuffer(1.0), bp = new D.Biquad('bp', 400, 1);
    for (let i = 0; i < b[0].length; i++) {
      const u = i / b[0].length;
      if ((i & 31) === 0) bp.set('bp', 400 * 12 ** u, 1);
      const y = bp.process(rng() * 2 - 1) * u ** 2 * 1.3 + Math.sin(2 * Math.PI * D.midiHz(65 + 12 * u) * (i / SR)) * u ** 3 * 0.2;
      add(b, i, y, y);
    }
    return norm(b, -4);
  },
  whir(rng) {
    // A VCR's rewind whir for the tape-stop: a motor tone sliding up under filtered hiss.
    const b = sfxBuffer(1.0), bp = new D.Biquad('bp', 1200, 1.2);
    let ph = 0;
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR, u = t / 1.0;
      const env = Math.min(1, t / 0.05) * Math.min(1, (1 - u) / 0.25);
      ph += (2 * Math.PI * (180 + 420 * u)) / SR;
      if ((i & 63) === 0) bp.set('bp', 1200 + 2600 * u, 1.2);
      const y = (Math.sin(ph) * 0.35 + Math.sin(ph * 2.01) * 0.15 + bp.process(rng() * 2 - 1) * 0.6) * env * (0.8 + 0.2 * Math.sin(2 * Math.PI * 23 * t));
      add(b, i, y, y * 0.95);
    }
    return norm(b, -3);
  },
  hit(rng) {
    const b = sfxBuffer(2.6), hp = new D.Biquad('hp', 1500), lp = new D.Biquad('lp', 8000);
    let ph = 0;
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (30 + 120 * Math.exp(-t * 7))) / SR;
      const boom = Math.tanh(Math.sin(ph) * 2.5) * Math.exp(-t * 1.5);
      const crashN = lp.process(hp.process(rng() * 2 - 1)) * Math.exp(-t * 2.2) * 0.5;
      add(b, i, boom + crashN, boom + crashN * 0.95);
    }
    const tmp = { rng, bus: { music: b, send: D.stereo(b[0].length) } };
    supersaw(tmp, b, 0, Math.round(0.6 * SR), [53, 56, 60, 65, 68], 0.9, { cutoff: 3000, decay: 0.3, sustain: 0.2, release: 0.6, send: 0 });
    return norm(b, -3);
  },
};
for (let k = 0; k < 5; k++) {
  SFX[`tick-${k}`] = (rng) => {
    const b = sfxBuffer(0.12), f = D.midiHz(77 + k);
    for (let i = 0; i < b[0].length; i++) {
      const t = i / SR, y = (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 2 * t) * 0.25) * Math.exp(-t * 38) * Math.min(1, t / 0.001) + (i < 40 ? (rng() * 2 - 1) * 0.3 : 0);
      add(b, i, y, y);
    }
    return norm(b, -4);
  };
}

// ---- main --------------------------------------------------------------------------
function stale(file, deps) {
  if (!fs.existsSync(file)) return true;
  const m = fs.statSync(file).mtimeMs;
  return deps.some((d) => fs.statSync(d).mtimeMs > m);
}

export function loudnormAvailable() {
  const r = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });
  return r.status === 0 && /loudnorm/.test(r.stdout);
}

// Two-pass ffmpeg loudnorm (linear) when ffmpeg is on the PATH. The JS master
// already sits on target, so pass 2 is only run if pass 1 measures a drift.
function ffmpegLoudnorm(file) {
  const ff = process.env.FFMPEG ?? 'ffmpeg';
  const target = `I=${PARAMS.targetLufs}:TP=${PARAMS.ceilingDbtp}:LRA=11`;
  const p1 = spawnSync(ff, ['-hide_banner', '-nostats', '-i', file, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /\{[\s\S]*\}/.exec(p1.stderr ?? '');
  if (!m) return null;
  const j = JSON.parse(m[0]);
  const drift = Math.abs(Number(j.input_i) - PARAMS.targetLufs);
  if (drift > 0.3 || Number(j.input_tp) > PARAMS.ceilingDbtp) {
    const tmp = file.replace(/\.wav$/, '.ln.wav');
    const args = `${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
    spawnSync(ff, ['-hide_banner', '-y', '-i', file, '-af', `loudnorm=${args}`, '-ar', String(SR), '-c:a', 'pcm_s16le', tmp]);
    if (fs.existsSync(tmp)) fs.renameSync(tmp, file);
  }
  return { measuredI: Number(j.input_i), measuredTP: Number(j.input_tp), pass2: drift > 0.3 };
}

export function renderAll({ ifMissing = false, quiet = false } = {}) {
  const self = fileURLToPath(import.meta.url);
  const deps = [path.join(PROMO, 'timing.json'), self, path.join(PROMO, 'audio', 'dsp.mjs')];
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const useFfmpeg = loudnormAvailable();
  for (const [id, fn] of Object.entries(SFX)) {
    const file = path.join(OUT, 'sfx', `${id}.wav`);
    if (ifMissing && !stale(file, deps)) continue;
    D.writeWav(file, fn(D.mulberry32(PARAMS.seed + id.length * 131 + id.charCodeAt(0))));
  }
  log(`sfx: ${Object.keys(SFX).length} files in public/audio/sfx`);
  for (const [name, comp] of Object.entries(T.compositions)) {
    if (!comp.audio) continue;
    const file = path.join(OUT, `music-${name}.wav`);
    if (ifMissing && !stale(file, deps)) { log(`music-${name}.wav is up to date`); continue; }
    const t0 = Date.now();
    const { mix, raw, lufs, tp } = renderComposition(name);
    log(`  raw mix before mastering: ${raw.lufs.toFixed(1)} LUFS, peak ${raw.peak.toFixed(1)} dBFS`);
    D.writeWav(file, mix);
    const ln = useFfmpeg ? ffmpegLoudnorm(file) : null;
    log(`music-${name}.wav  ${(mix[0].length / SR).toFixed(1)} s  ${lufs.toFixed(1)} LUFS  ${tp.toFixed(1)} dBTP${ln ? `  (ffmpeg loudnorm check: ${ln.measuredI} LUFS, ${ln.measuredTP} dBTP${ln.pass2 ? ', pass 2 applied' : ''})` : ''}  ${Date.now() - t0} ms`);
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  renderAll({ ifMissing: process.argv.includes('--if-missing') });
}
