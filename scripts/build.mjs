// Builds the TypeScript sources with esbuild.
//
//   src/main/*.ts     -> out/node/main/*.js     CommonJS, Electron externals
//   src/server/*.ts   -> out/node/server/*.js   CommonJS, node_modules external
//   src/renderer/*.ts -> out/web/app.js         IIFE, self-contained
//   public/*          -> out/web/               copied verbatim
//
// templates/ is deliberately NOT copied. src/server/app-root.ts locates it by
// walking up to the package.json that identifies this app, which lands on the
// repository root in development and on the asar root once packaged. Copying
// would create a second source of truth for files that must stay byte-identical
// to their upstream originals.
//
// Entry points that do not exist yet are skipped, so this runs cleanly while
// the migration is still in progress.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');

const watch = process.argv.includes('--watch');

/** Node 18 is the documented minimum in README.md. */
const NODE_TARGET = 'node18';
/** Electron 42 ships a very recent Chromium; the browser bundle can be modern. */
const WEB_TARGET = 'es2022';

const nodeEntries = [
  { in: 'src/main/main.ts', out: 'out/node/main/main.js', external: ['electron'] },
  { in: 'src/main/preload.ts', out: 'out/node/main/preload.js', external: ['electron'] },
  { in: 'src/server/index.ts', out: 'out/node/server/index.js', external: ['express'] },
  // Transitional: the un-migrated server.js requires this so the extracted
  // modules have a single implementation. Removed with server.js in Phase 3.
  { in: 'src/server/legacy-bridge.ts', out: 'out/node/server/legacy-bridge.js' }
];

const webEntries = [{ in: 'src/renderer/main.ts', out: 'out/web/app.js' }];

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

async function buildEntry(entry, options) {
  if (!exists(entry.in)) {
    return { skipped: entry.in };
  }

  const context = {
    absWorkingDir: ROOT,
    entryPoints: [entry.in],
    outfile: entry.out,
    bundle: true,
    sourcemap: true,
    logLevel: 'warning',
    ...options
  };

  if (entry.external) {
    context.external = [...(options.external ?? []), ...entry.external];
  }

  await build(context);
  return { built: entry.out };
}

function copyStaticAssets() {
  const source = path.join(ROOT, 'public');
  const destination = path.join(OUT, 'web');

  if (!fs.existsSync(source)) {
    return 0;
  }

  fs.mkdirSync(destination, { recursive: true });

  // app.js in public/ is the pre-migration renderer. Once src/renderer exists
  // the bundle writes out/web/app.js, and copying the old file over it would
  // silently ship the un-migrated version.
  const bundleExists = exists(webEntries[0].in);
  let copied = 0;

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (bundleExists && entry.name === 'app.js') {
      continue;
    }

    fs.copyFileSync(path.join(source, entry.name), path.join(destination, entry.name));
    copied += 1;
  }

  return copied;
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });

  const results = [];

  for (const entry of nodeEntries) {
    results.push(
      await buildEntry(entry, {
        platform: 'node',
        format: 'cjs',
        target: NODE_TARGET,
        packages: 'external'
      })
    );
  }

  for (const entry of webEntries) {
    results.push(
      await buildEntry(entry, {
        platform: 'browser',
        format: 'iife',
        target: WEB_TARGET,
        minify: !watch
      })
    );
  }

  const copied = copyStaticAssets();

  const built = results.filter((result) => result.built);
  const skipped = results.filter((result) => result.skipped);

  console.log(`Built ${built.length} bundle(s), copied ${copied} static file(s).`);
  built.forEach((result) => console.log(`  + ${result.built}`));
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} entry point(s) not yet migrated:`);
    skipped.forEach((result) => console.log(`  - ${result.skipped}`));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
