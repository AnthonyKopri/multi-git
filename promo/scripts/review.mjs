// Cheap visual review: bundle once, one browser, JPEG stills, tiled contact
// sheets (every sheet <= 1600 px wide).
//
//   node scripts/review.mjs round <N>            the round's standard sheets
//   node scripts/review.mjs sheet --comp=Promo --frames=0-2699:15 --scale=0.2 --tile=10x --geometry=152x86 --out=review/tmp/x.jpg
//   node scripts/review.mjs cut <Promo30|Vertical|ReadmeGif> <N>   one overview sheet per cut
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { openBrowser, renderFrames, renderStill, selectComposition } from '@remotion/renderer';

const PROMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(PROMO, 'review', 'tmp');
const pad = (n) => String(n).padStart(4, '0');
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d ?? ''}`).split('=').slice(1).join('=');

function parseFrames(spec, duration) {
  const out = [];
  for (const part of spec.split(',')) {
    const m = /^(\d+)-(\d+)(?::(\d+))?$/.exec(part);
    if (m) { for (let f = +m[1]; f <= Math.min(+m[2], duration - 1); f += +(m[3] ?? 1)) out.push(f); }
    else if (part !== '') out.push(Math.min(+part, duration - 1));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

let serveUrl, browser;
const compCache = {};
async function setup() {
  if (serveUrl) return;
  serveUrl = await bundle({ entryPoint: path.join(PROMO, 'src', 'index.ts') });
  browser = await openBrowser('chrome', { browserExecutable: process.env.REMOTION_BROWSER ?? null, chromiumOptions: { gl: 'swangle' } });
}
async function comp(id) {
  compCache[id] ??= await selectComposition({ serveUrl, id, puppeteerInstance: browser, inputProps: {} });
  return compCache[id];
}

// Renders `frames` of `id` at `scale` into dir as f0000.jpg files.
async function renderList(id, frames, scale, dir) {
  const c = await comp(id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const contiguous = frames.length > 1 && frames.every((f, i) => i === 0 || f === frames[i - 1] + 1);
  const step = frames.length > 2 ? frames[1] - frames[0] : 0;
  const evenly = frames.length > 2 && frames.every((f, i) => i === 0 || f - frames[i - 1] === step);
  if (contiguous || (evenly && frames[0] === 0)) {
    const raw = path.join(dir, 'raw');
    await renderFrames({
      composition: c, serveUrl, outputDir: raw, inputProps: {}, imageFormat: 'jpeg', jpegQuality: 82, scale, puppeteerInstance: browser,
      frameRange: [frames[0], frames[frames.length - 1]], everyNthFrame: contiguous ? 1 : step, concurrency: 4, onStart: () => {},
    });
    const files = fs.readdirSync(raw).filter((f) => /\.(jpe?g)$/.test(f)).sort((a, b) => Number(/(\d+)/.exec(a)[1]) - Number(/(\d+)/.exec(b)[1]));
    files.forEach((f, i) => fs.renameSync(path.join(raw, f), path.join(dir, `f${pad(frames[i])}.jpg`)));
    fs.rmSync(raw, { recursive: true, force: true });
  } else {
    for (const f of frames) {
      await renderStill({ composition: c, serveUrl, frame: f, output: path.join(dir, `f${pad(f)}.jpg`), imageFormat: 'jpeg', jpegQuality: 85, scale, puppeteerInstance: browser, inputProps: {} });
    }
  }
}

function tile(dir, out, tileSpec, geometry) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(dir, f));
  const r = spawnSync('montage', [...files, '-tile', tileSpec, '-geometry', `${geometry}+4+4`, '-background', '#0a0c10', '-fill', '#9ca3af', '-pointsize', '12', '-label', '%t', '-quality', '82', out]);
  if (r.status !== 0) throw new Error(`montage failed: ${r.stderr}`);
  const id = spawnSync('identify', ['-format', '%w x %h', out], { encoding: 'utf8' }).stdout;
  console.log(`${path.relative(PROMO, out)}  ${id}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

async function sheet(id, spec, scale, out, tileSpec, geometry) {
  const c = await comp(id);
  const dir = path.join(TMP, path.basename(out, '.jpg'));
  await renderList(id, parseFrames(spec, c.durationInFrames), scale, dir);
  tile(dir, out, tileSpec, geometry);
}

// The frames each round looks at closely (master).
const KEY = [15, 105, 200, 470, 500, 560, 745, 870, 990, 1215, 1455, 1620, 1760, 1860, 2100, 2250, 2430, 2640];
const STRIPS = [[712, 723], [480, 491], [1165, 1176]]; // collapse A, logo fusion, the rewind

await setup();
const mode = args[0];
if (mode === 'round') {
  const n = args[1] ?? '1';
  const out = path.join(PROMO, 'review', `round-${n}`);
  const c = await comp('Promo');
  const all = parseFrames(`0-${c.durationInFrames - 1}:15`, c.durationInFrames);
  const third = Math.ceil(all.length / 3);
  for (let s = 0; s < 3; s++) {
    const part = all.slice(s * third, (s + 1) * third);
    const dir = path.join(TMP, `overview-${s + 1}`);
    await renderList('Promo', part, 0.2, dir);
    tile(dir, path.join(out, `overview-${s + 1}.jpg`), '10x', '152x86');
  }
  const keyDir = path.join(TMP, 'key');
  await renderList('Promo', KEY, 0.5, keyDir);
  tile(keyDir, path.join(out, 'key-frames.jpg'), '3x', '524x295');
  const stripDir = path.join(TMP, 'strips');
  fs.rmSync(stripDir, { recursive: true, force: true });
  fs.mkdirSync(stripDir, { recursive: true });
  for (const [a, b] of STRIPS) {
    const d = path.join(TMP, `strip-${a}`);
    await renderList('Promo', parseFrames(`${a}-${b}`, c.durationInFrames), 0.3, d);
    for (const f of fs.readdirSync(d)) fs.renameSync(path.join(d, f), path.join(stripDir, f));
  }
  tile(stripDir, path.join(out, 'filmstrips.jpg'), '12x', '128x72');
} else if (mode === 'cut') {
  const id = args[1], n = args[2] ?? '1';
  const c = await comp(id);
  const every = id === 'ReadmeGif' ? 15 : 15;
  const geo = c.width > c.height ? '152x86' : '86x152';
  await sheet(id, `0-${c.durationInFrames - 1}:${every}`, id === 'ReadmeGif' ? 0.5 : 0.2, path.join(PROMO, 'review', `round-${n}`, `cut-${id}.jpg`), c.width > c.height ? '10x' : '15x', geo);
} else {
  await sheet(opt('comp', 'Promo'), opt('frames', '0'), Number(opt('scale', '0.5')), path.resolve(PROMO, opt('out', 'review/tmp/sheet.jpg')), opt('tile', '4x'), opt('geometry', '392x220'));
}
await browser.close({ silent: true });
