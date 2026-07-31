// Ported from the "syntax" check in scripts/check.js.
//
// `tsc --noEmit` covers everything under src/, but the migration is not
// finished: server.js, public/app.js, and the build scripts are still plain
// JavaScript that nothing else type-checks. This keeps them from shipping
// unparseable, and it shrinks to nothing on its own as files move to
// TypeScript.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';

const CANDIDATES = [
  'main.js',
  'preload.js',
  'public/app.js',
  'scripts/after-pack.js',
  'scripts/build.mjs',
  'scripts/release.js'
];

const present = CANDIDATES.filter((file) => fs.existsSync(fromAppRoot(file)));

describe('remaining JavaScript sources', () => {
  it('still has files to check, or the list has gone stale', () => {
    // When this finally hits zero the migration is complete and this file can
    // be deleted along with the last JavaScript source.
    expect(present.length).toBeGreaterThan(0);
  });

  it.each(present)('%s parses', (file) => {
    expect(() => {
      execFileSync(process.execPath, ['--check', fromAppRoot(file)], { stdio: 'pipe' });
    }).not.toThrow();
  });
});
