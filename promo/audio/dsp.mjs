// Small DSP toolkit for the synth: plain JS, Float32 buffers, 48 kHz.
import fs from 'node:fs';
import path from 'node:path';

export const SR = 48000;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const stereo = (n) => [new Float32Array(n), new Float32Array(n)];
export const midiHz = (n) => 440 * 2 ** ((n - 69) / 12);
export const dbToLin = (db) => 10 ** (db / 20);
export const linToDb = (x) => 20 * Math.log10(Math.max(x, 1e-12));
export const panGains = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

// PolyBLEP correction for a band-limited saw.
export function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// RBJ biquad. type: lp, hp, bp, peak, hs, ls.
export class Biquad {
  constructor(type = 'lp', f = 1000, q = 0.707, gainDb = 0) { this.z1 = 0; this.z2 = 0; this.set(type, f, q, gainDb); }
  set(type, f, q = 0.707, gainDb = 0) {
    const w = 2 * Math.PI * Math.min(Math.max(f, 10), SR * 0.49) / SR;
    const cw = Math.cos(w), sw = Math.sin(w), alpha = sw / (2 * q), A = 10 ** (gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'peak': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'hs': { const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      case 'ls': { const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      default: b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  // Transposed direct form II.
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

// Freeverb-style reverb (4 combs + 2 allpasses per channel).
export function reverb([inL, inR], { room = 0.82, damp = 0.35, width = 1 } = {}) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356].map((n) => Math.round(n * scale));
  const alls = [556, 441].map((n) => Math.round(n * scale));
  const out = stereo(inL.length);
  for (const [ch, input, spread] of [[0, inL, 0], [1, inR, 23]]) {
    const cbuf = combs.map((n) => ({ b: new Float32Array(n + spread), i: 0, f: 0 }));
    const abuf = alls.map((n) => ({ b: new Float32Array(n + spread), i: 0 }));
    const o = out[ch];
    for (let s = 0; s < input.length; s++) {
      const x = input[s] * 0.015;
      let acc = 0;
      for (const c of cbuf) {
        const y = c.b[c.i];
        c.f = y * (1 - damp) + c.f * damp;
        c.b[c.i] = x + c.f * room;
        c.i = (c.i + 1) % c.b.length;
        acc += y;
      }
      for (const a of abuf) {
        const bo = a.b[a.i];
        const y = -acc + bo;
        a.b[a.i] = acc + bo * 0.5;
        a.i = (a.i + 1) % a.b.length;
        acc = y;
      }
      o[s] = acc;
    }
  }
  if (width < 1) for (let s = 0; s < inL.length; s++) { const m = (out[0][s] + out[1][s]) / 2; out[0][s] = m + (out[0][s] - m) * width; out[1][s] = m + (out[1][s] - m) * width; }
  return out;
}

// ---- loudness (ITU-R BS.1770-4, 48 kHz) ----------------------------------
function kWeight(x) {
  const s1 = new Biquad(); s1.b0 = 1.53512485958697; s1.b1 = -2.69169618940638; s1.b2 = 1.19839281085285; s1.a1 = -1.69065929318241; s1.a2 = 0.73248077421585;
  const s2 = new Biquad(); s2.b0 = 1; s2.b1 = -2; s2.b2 = 1; s2.a1 = -1.99004745483398; s2.a2 = 0.99007225036621;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = s2.process(s1.process(x[i]));
  return y;
}
export function integratedLoudness([L, R]) {
  const kl = kWeight(L), kr = kWeight(R);
  const block = Math.round(0.4 * SR), hop = Math.round(0.1 * SR);
  const z = [];
  for (let s = 0; s + block <= kl.length; s += hop) {
    let a = 0, b = 0;
    for (let i = s; i < s + block; i++) { a += kl[i] * kl[i]; b += kr[i] * kr[i]; }
    z.push((a + b) / block);
  }
  const lk = (v) => -0.691 + 10 * Math.log10(Math.max(v, 1e-12));
  const abs = z.filter((v) => lk(v) > -70);
  if (!abs.length) return -70;
  const rel = lk(abs.reduce((p, v) => p + v, 0) / abs.length) - 10;
  const gated = abs.filter((v) => lk(v) > rel);
  return lk(gated.reduce((p, v) => p + v, 0) / gated.length);
}

// True peak by 4x oversampling with a windowed-sinc interpolator.
const TP_TAPS = 12;
const TP_KERNEL = [1, 2, 3].map((ph) => {
  const k = [];
  for (let t = -TP_TAPS; t < TP_TAPS; t++) {
    const x = t + 1 - ph / 4;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = 0.5 + 0.5 * Math.cos(Math.PI * x / TP_TAPS);
    k.push(sinc * w);
  }
  return k;
});
export function truePeak(chans) {
  let peak = 0;
  for (const x of chans) {
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
      if (a < peak * 0.5) continue; // inter-sample overs only matter near the peak
      for (const k of TP_KERNEL) {
        let acc = 0;
        for (let t = 0; t < k.length; t++) { const j = i + t - TP_TAPS + 1; if (j >= 0 && j < x.length) acc += x[j] * k[t]; }
        const b = Math.abs(acc);
        if (b > peak) peak = b;
      }
    }
  }
  return linToDb(peak);
}

// Lookahead peak limiter (linked stereo). ceiling is a linear sample peak.
export function limit([L, R], ceiling, { lookaheadMs = 5, releaseMs = 90 } = {}) {
  const n = L.length, la = Math.max(2, Math.round(lookaheadMs * SR / 1000));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])); need[i] = p > ceiling ? ceiling / p : 1; }
  // Minimum of need over [i, i + la] (monotonic deque, scanning backwards).
  const wmin = new Float32Array(n), dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + la) head++;
    wmin[i] = need[dq[head]];
  }
  // Instant attack (already early by the lookahead), smooth release...
  const rel = Math.exp(-1 / (releaseMs * SR / 1000));
  const g = new Float32Array(n);
  let cur = 1;
  for (let i = 0; i < n; i++) { const t = wmin[i]; cur = t < cur ? t : t + (cur - t) * rel; g[i] = cur; }
  // ...then a short moving average to round off the attack step. It settles
  // within la/2 samples, before the peak arrives; the clamp is a safety net.
  const w = Math.max(1, la >> 1);
  let acc = w; // w samples of unity gain before the start
  for (let i = 0; i < n; i++) {
    acc += g[i] - (i >= w ? g[i - w] : 1);
    const gg = Math.min(acc / w, need[i]);
    L[i] *= gg; R[i] *= gg;
  }
}

export function softClip([L, R], threshold = 0.7) {
  const knee = 1 - threshold;
  for (const x of [L, R]) for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > threshold) x[i] = Math.sign(x[i]) * (threshold + knee * Math.tanh((a - threshold) / knee));
  }
}

export function gain([L, R], g) { for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; } }
export function peak([L, R]) { let p = 0; for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); return p; }

// 16-bit PCM stereo WAV with deterministic TPDF dither.
export function writeWav(file, [L, R], rng = mulberry32(7)) {
  const n = L.length, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    for (const [c, x] of [[0, L], [1, R]]) {
      const d = (rng() - rng()) / 32768;
      const v = Math.max(-1, Math.min(1, x[i] + d));
      data.writeInt16LE(Math.round(v * 32767), i * 4 + c * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

export function readWav(file) {
  const b = fs.readFileSync(file);
  let o = 12, fmt = null, data = null;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(o + 10), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  const n = data.length / (fmt.channels * 2);
  const out = stereo(n);
  for (let i = 0; i < n; i++) {
    out[0][i] = data.readInt16LE(i * fmt.channels * 2) / 32768;
    out[1][i] = fmt.channels > 1 ? data.readInt16LE(i * fmt.channels * 2 + 2) / 32768 : out[0][i];
  }
  return out;
}
