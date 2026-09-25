// npm run render:gif
// Renders ReadmeGif (720x405) to MP4, then converts it to a GIF at 15 fps with
// a two-pass ffmpeg palette (palettegen + paletteuse), aiming for <= 10 MB.
// Without ffmpeg on the PATH (set FFMPEG to point at one), it falls back to
// Remotion's own GIF encoder at every second frame.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(PROMO, 'out');
fs.mkdirSync(OUT, { recursive: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: PROMO, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
};
const ff = process.env.FFMPEG ?? 'ffmpeg';
const hasFfmpeg = spawnSync(ff, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout?.includes('palettegen');
const extra = process.argv.slice(2);
const gif = path.join(OUT, 'multi-git-promo.gif');

if (hasFfmpeg) {
  const mp4 = path.join(OUT, 'readme-720.mp4');
  run(npx, ['remotion', 'render', 'src/index.ts', 'ReadmeGif', mp4, '--codec=h264', '--crf=16', '--muted', ...extra]);
  const palette = path.join(OUT, 'readme-palette.png');
  const filters = 'fps=15,scale=720:-1:flags=lanczos';
  run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-vf', `${filters},palettegen=max_colors=192:stats_mode=diff`, palette]);
  run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-i', palette, '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', '0', gif]);
} else {
  console.log('ffmpeg not found: using Remotion\'s GIF encoder (every second frame = 15 fps).');
  run(npx, ['remotion', 'render', 'src/index.ts', 'ReadmeGif', gif, '--codec=gif', '--every-nth-frame=2', '--number-of-gif-loops=0', ...extra]);
}
const mb = fs.statSync(gif).size / 1024 / 1024;
console.log(`${path.relative(PROMO, gif)}: ${mb.toFixed(2)} MB${mb > 10 ? ' (over the 10 MB target: try a smaller max_colors)' : ''}`);
