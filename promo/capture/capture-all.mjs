// Runs the whole capture pipeline (Linux): build the demo world, start the
// app, seed it, capture the GUI (pristine steps first, then the state-changing
// ones), rebuild the clean world, capture the terminal edition, stop.
//   npm run capture
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PROMO, startServer, stopServer } from './lib.mjs';
import { makeDemoWorld, seedThroughApi } from './make-demo-world.mjs';

const run = (script, ...args) => execFileSync(process.execPath, [path.join(PROMO, 'capture', script), ...args], { stdio: 'inherit' });
const fresh = async () => {
  await stopServer(); // it caches the config: stop it before rebuilding
  makeDemoWorld();
  await startServer();
  await seedThroughApi();
};

await fresh();
run('capture-gui.mjs');
await fresh();
run('capture-cli.mjs');
await stopServer();
run('privacy-scan.mjs');
console.log('captures done');
