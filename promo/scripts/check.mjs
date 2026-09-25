// npm run check: types, counter math, banned phrases, privacy. Exits non-zero
// on any failure. Plain Node, so it runs the same on Windows.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanPrivacy } from './privacy.mjs';

const PROMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = JSON.parse(fs.readFileSync(path.join(PROMO, 'timing.json'), 'utf8'));
const copy = JSON.parse(fs.readFileSync(path.join(PROMO, 'src', 'copy.json'), 'utf8'));
const failures = [];
const ok = (msg) => console.log(`  ok  ${msg}`);
const fail = (msg) => { failures.push(msg); console.log(`  FAIL ${msg}`); };

// 1. Types ------------------------------------------------------------------
console.log('types');
const tsc = spawnSync(process.execPath, [path.join(PROMO, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', path.join(PROMO, 'tsconfig.json')], { encoding: 'utf8' });
if (tsc.status === 0) ok('tsc --noEmit'); else fail(`tsc --noEmit\n${(tsc.stdout + tsc.stderr).split('\n').slice(0, 20).join('\n')}`);

// 2. Counter math (the same rule as src/counter.ts) -------------------------
console.log('counter');
const COMMAND = /^(git|ssh-keygen|ssh-add|ssh|gh|cd|for|echo)\b/;
const countSpell = (lines) => lines.reduce((n, raw) => {
  const line = raw.trim();
  if (!COMMAND.test(line)) return n;
  const times = /#\s*×\s*(\d+)\s*$/.exec(line);
  return n + (times ? Number(times[1]) : 1);
}, 0);
const cueFrame = (def, name) => { const c = def.cues[name]; return c ? (c[0] - 1) * T.barFrames + (c[1] - 1) * T.beatFrames + (c[2] ?? 0) : null; };
for (const [id, spell] of Object.entries(copy.spells)) console.log(`       spell ${id}: ${countSpell(spell)} commands`);
const expectMaster = [6, 3, 2, 9, 5, 20];
for (const [comp, def] of Object.entries(T.compositions)) {
  let bar = 1, total = 0;
  const steps = [];
  let stingerFrame = null;
  for (const a of def.arrangement) {
    const sec = T.sections[a.section];
    const from = (bar - 1) * T.barFrames;
    const bars = a.toBar - a.fromBar + 1;
    if (sec.scene === 'Stinger' && stingerFrame === null) stingerFrame = from;
    for (const [cue, source] of sec.counter ?? []) {
      if (cueFrame(sec, cue) === null) { fail(`${comp}/${a.section}: counter cue "${cue}" is missing`); continue; }
      if (source === 'viewer') continue;
      const n = source === 'card' ? Math.min(sec.cards.count, copy.montage.cards.length) : countSpell(copy.spells[source] ?? []);
      if (stingerFrame !== null) fail(`${comp}/${a.section}: counts after the stinger`);
      total += n;
      steps.push(n);
    }
    bar += bars;
  }
  const stinger = copy.stinger[comp];
  if (!stinger) { if (comp === 'ReadmeGif') ok(`${comp}: no counter, no stinger`); else fail(`${comp}: no stinger copy`); continue; }
  const claimed = Number(/(\d+)/.exec(stinger[0])?.[1]);
  if (claimed === total) ok(`${comp}: spells add up to ${total} (${steps.map((s) => `+${s}`).join(' ')}), and the stinger says ${claimed}`);
  else fail(`${comp}: spells add up to ${total} but the stinger says ${claimed}`);
  if (comp === 'Promo') {
    if (JSON.stringify(steps) === JSON.stringify(expectMaster)) ok('Promo: +6 +3 +2 +9 +5 +20, as the spec lays out');
    else fail(`Promo: increments ${steps.join(',')} differ from the spec's ${expectMaster.join(',')}`);
  }
}
const expected = { Promo: 45, Promo30: 17, Vertical: 15 };
for (const [comp, n] of Object.entries(expected)) {
  const claimed = Number(/(\d+)/.exec(copy.stinger[comp]?.[0] ?? '')?.[1]);
  if (claimed !== n) fail(`${comp}: the spec's stinger number is ${n}, the copy says ${claimed}`);
}

// 3. Banned phrases across the default props --------------------------------
console.log('banned phrases');
const BANNED = ['the only', 'first ever', 'unlike other', 'backup', 'never lose', 'AI-powered', 'Supercharged', 'Keep ours', 'Stash selection',
  'GitHub Desktop', 'Sourcetree', 'Tower', 'GitKraken', 'fastest', 'lightweight', 'notarized', 'verified publisher'];
const strings = [];
const walk = (v, where) => {
  if (typeof v === 'string') strings.push([where, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
};
walk(copy, 'copy');
let banned = 0;
for (const [where, s] of strings) for (const b of BANNED) {
  if (new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s)) { fail(`banned "${b}" in ${where}: ${s}`); banned++; }
}
if (!banned) ok(`${strings.length} strings, none banned`);
// Headlines stay at 6 words or fewer (the vertical hook is the spec's own 7-word hook; see NOTES).
const HEADLINES = ['coldOpen.line1', 'coldOpen.line2', 'sceneA.headline', 'sceneB.headline', 'sceneC.headline', 'sceneD.headline', 'sceneE.headline', 'reveal.tag1', 'reveal.tag2'];
for (const key of HEADLINES) {
  const s = key.split('.').reduce((o, k) => o[k], copy);
  const words = s.split(/\s+/).filter(Boolean).length;
  if (words > 6) fail(`headline ${key} has ${words} words: ${s}`);
}
ok('headlines are 6 words or fewer');

// 4. Privacy ----------------------------------------------------------------
console.log('privacy');
const findings = scanPrivacy(['src', 'public', 'assets', 'review'].map((d) => path.join(PROMO, d)));
if (findings.length) findings.slice(0, 20).forEach((f) => fail(f)); else ok('no keys, container paths, drive paths or stray e-mail addresses');

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
