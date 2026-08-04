// Builds the TypeScript sources with esbuild.
//
//   src/main/*.ts     -> out/node/main/*.js     CommonJS, Electron externals
//   src/server/cli.ts -> out/node/server/cli.js CommonJS, node_modules external
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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads esbuild, explaining itself when it is missing.
 *
 * A static import fails at module load with a raw ERR_MODULE_NOT_FOUND stack,
 * which does not say what to do about it. Anyone whose node_modules predates
 * the TypeScript migration hits exactly this, and the answer is always
 * `npm install`. scripts/release.js guards electron-builder the same way.
 */
async function loadEsbuild() {
  try {
    return (await import('esbuild')).build;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        'esbuild is not installed. Run "npm install" (with dev dependencies) before building.'
      );
    }
    throw error;
  }
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');

const watch = process.argv.includes('--watch');

/**
 * Node 22.12 is the documented minimum in README.md and the floor Electron 43
 * declares in its own `engines`. Electron 43 itself embeds Node 24, so this is
 * the lower of the two environments the server bundle has to run in.
 */
const NODE_TARGET = 'node22.12';
/** Electron 43 ships a very recent Chromium; the browser bundle can be modern. */
const WEB_TARGET = 'es2022';

const nodeEntries = [
  { in: 'src/main/main.ts', out: 'out/node/main/main.js', external: ['electron'] },
  { in: 'src/main/preload.ts', out: 'out/node/main/preload.js', external: ['electron'] },
  // cli.ts, not index.ts: index.ts is a library that the Electron bundle also
  // inlines, so it must have no top-level side effects. Bundling the CLI entry
  // is what keeps that distinction from being purely conventional.
  { in: 'src/server/cli.ts', out: 'out/node/server/cli.js', external: ['express'] }
];

const webEntries = [{ in: 'src/renderer/main.ts', out: 'out/web/app.js' }];

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

async function buildEntry(build, entry, options) {
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

  let copied = 0;

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    fs.copyFileSync(path.join(source, entry.name), path.join(destination, entry.name));
    copied += 1;
  }

  return copied;
}

async function run() {
  const build = await loadEsbuild();

  fs.mkdirSync(OUT, { recursive: true });

  const results = [];

  for (const entry of nodeEntries) {
    results.push(
      await buildEntry(build, entry, {
        platform: 'node',
        format: 'cjs',
        target: NODE_TARGET,
        packages: 'external'
      })
    );
  }

  for (const entry of webEntries) {
    results.push(
      await buildEntry(build, entry, {
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
  // A missing dependency has a message worth reading on its own; a compile
  // failure has a stack worth keeping.
  console.error(error?.code === 'ERR_MODULE_NOT_FOUND' ? error : (error.message ?? error));
  process.exit(1);
});
