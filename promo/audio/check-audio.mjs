// Checks the synthesized audio (Linux/macOS with ffmpeg + ImageMagick):
//  - ebur128 (I, LRA, true peak) of every music file
//  - review/mix-preview.mp3: the master's music plus every SFX at its event,
//    mixed in JS exactly as Remotion will (same frames, same volumes)
//  - review/tmp/mix-wave-spectrum.png: waveform above spectrogram, a line per
//    bar, with the drop, the tape-stop, the stinger and the end card in amber
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as D from './dsp.mjs';
import { sfxEvents } from './synth.mjs';

const PROMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = JSON.parse(fs.readFileSync(path.join(PROMO, 'timing.json'), 'utf8'));
const AUDIO = path.join(PROMO, 'public', 'audio');
const TMP = path.join(PROMO, 'review', 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const ff = process.env.FFMPEG ?? 'ffmpeg';

function ebur128(file) {
  const r = spawnSync(ff, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const tail = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const num = (re) => Number((re.exec(tail) ?? [])[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+([\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

for (const name of Object.keys(T.compositions)) {
  const file = path.join(AUDIO, `music-${name}.wav`);
  if (fs.existsSync(file)) console.log(`music-${name}.wav`, JSON.stringify(ebur128(file)));
}

// ---- mix preview (master) ----
const music = D.readWav(path.join(AUDIO, 'music-Promo.wav'));
const cache = {};
const FRAME = D.SR / T.fps;
for (const e of sfxEvents('Promo')) {
  const s = (cache[e.id] ??= D.readWav(path.join(AUDIO, 'sfx', `${e.id}.wav`)));
  const at = Math.round(e.frame * FRAME);
  for (let i = 0; i < s[0].length && at + i < music[0].length; i++) {
    if (at + i < 0) continue;
    music[0][at + i] += s[0][i] * e.volume;
    music[1][at + i] += s[1][i] * e.volume;
  }
}
const wav = path.join(TMP, 'mix-preview.wav');
D.writeWav(wav, music);
console.log('mix preview (music + SFX)', JSON.stringify(ebur128(wav)), `sample peak ${D.linToDb(D.peak(music)).toFixed(2)} dBFS`);
spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k', path.join(PROMO, 'review', 'mix-preview.mp3')]);

// ---- waveform above spectrogram, with bar gridlines ----
if (!process.argv.includes('--no-png')) {
  const W = 1600;
  const wave = path.join(TMP, 'wave.png'), spec = path.join(TMP, 'spec.png'), out = path.join(TMP, 'mix-wave-spectrum.png');
  spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-filter_complex', `aformat=channel_layouts=mono,showwavespic=s=${W}x220:colors=0x6366f1`, '-frames:v', '1', wave]);
  spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-lavfi', `showspectrumpic=s=${W}x300:legend=0:scale=log`, spec]);
  const arr = T.compositions.Promo.arrangement;
  const bars = arr.at(-1).toBar;
  const at = (name) => arr.find((a) => a.section === name)?.fromBar - 1;
  // Bar lines (0-based starts): the drop, the tape-stop bar in scene C and the
  // landing after it, the stinger and its hit, and the end card.
  const ts = T.sections.sceneC.music?.tapeStop?.[0] ?? 1;
  const keys = [0, at('reveal'), at('sceneC') + ts - 1, at('sceneC') + ts, at('stinger'), at('stinger') + 1, at('endCard')];
  const draw = [];
  for (let b = 0; b <= bars; b++) {
    const x = Math.round((b / bars) * (W - 1));
    const key = keys.includes(b);
    draw.push('-stroke', key ? '#f59e0b' : '#9ca3af80', '-draw', `line ${x},0 ${x},520`);
    if (b < bars && (b % 4 === 0 || key)) draw.push('-stroke', 'none', '-fill', '#f3f4f6', '-pointsize', '13', '-draw', `text ${x + 3},14 '${b + 1}'`);
  }
  spawnSync('convert', [wave, spec, '-append', '+repage', '-background', '#0a0c10', '-alpha', 'remove', '-alpha', 'off', ...draw, out]);
  console.log('wrote', path.relative(PROMO, out));
}
