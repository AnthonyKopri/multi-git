import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findAppRoot } from '../src/server/app-root';

// Synthetic trees rather than the real repository, so these assertions stay
// true regardless of where the test file itself happens to live.
const tempRoots: string[] = [];

function makeTree(layout: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-app-root-'));
  tempRoots.push(root);

  for (const [relativePath, contents] of Object.entries(layout)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf8');
  }

  return root;
}

const APP_MANIFEST = JSON.stringify({ name: 'multi-git', version: '1.0.6' });

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe('findAppRoot', () => {
  it('resolves the dev layout, where sources sit at src/server', () => {
    const root = makeTree({
      'package.json': APP_MANIFEST,
      'templates/licenses/mit.txt': 'MIT',
      'src/server/app-root.ts': ''
    });

    expect(findAppRoot(path.join(root, 'src', 'server'))).toBe(fs.realpathSync(root));
  });

  it('resolves the built layout, two directories deeper than the sources', () => {
    const root = makeTree({
      'package.json': APP_MANIFEST,
      'templates/licenses/mit.txt': 'MIT',
      'out/node/server/app-root.js': ''
    });

    // This is the case a fixed number of `..` segments gets wrong: the built
    // file is at out/node/server, the sources were at src/server.
    expect(findAppRoot(path.join(root, 'out', 'node', 'server'))).toBe(fs.realpathSync(root));
  });

  it('resolves the packaged layout, where the asar root holds package.json', () => {
    const root = makeTree({
      'resources/app.asar/package.json': APP_MANIFEST,
      'resources/app.asar/templates/licenses/mit.txt': 'MIT',
      'resources/app.asar/out/node/server/app-root.js': ''
    });

    const asarRoot = path.join(root, 'resources', 'app.asar');
    expect(findAppRoot(path.join(asarRoot, 'out', 'node', 'server'))).toBe(asarRoot);
  });

  it('walks past a node_modules package.json belonging to a dependency', () => {
    const root = makeTree({
      'package.json': APP_MANIFEST,
      'node_modules/some-dep/package.json': JSON.stringify({ name: 'some-dep' }),
      'node_modules/some-dep/lib/index.js': ''
    });

    expect(findAppRoot(path.join(root, 'node_modules', 'some-dep', 'lib'))).toBe(
      fs.realpathSync(root)
    );
  });

  it('ignores a malformed package.json instead of throwing', () => {
    const root = makeTree({
      'package.json': APP_MANIFEST,
      'broken/package.json': '{ not json',
      'broken/nested/file.js': ''
    });

    expect(findAppRoot(path.join(root, 'broken', 'nested'))).toBe(fs.realpathSync(root));
  });

  it('returns null rather than looping when no application root exists', () => {
    const root = makeTree({ 'nested/deep/file.js': '' });

    expect(findAppRoot(path.join(root, 'nested', 'deep'))).toBeNull();
  });
});

describe('the real repository layout', () => {
  it('locates the templates directory the new-repo wizard reads', async () => {
    const { templatesDir, appRoot } = await import('../src/server/app-root');

    expect(fs.existsSync(appRoot())).toBe(true);
    expect(fs.existsSync(path.join(templatesDir(), 'licenses', 'mit.txt'))).toBe(true);
    expect(fs.existsSync(path.join(templatesDir(), 'gitignore', 'node.gitignore'))).toBe(true);
  });
});

describe('window titles', () => {
  it('reports the version the manifest declares', async () => {
    const { appVersion, appRoot } = await import('../src/server/app-root');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(appRoot(), 'package.json'), 'utf8')
    ) as { version: string };

    expect(appVersion()).toBe(manifest.version);
  });

  it('puts the version next to the product name', async () => {
    const { APP_DISPLAY_NAME, appTitle, appVersion } = await import('../src/server/app-root');

    // What the desktop window's caption reads, so a regression here is a
    // regression the user sees.
    expect(appTitle()).toBe(`${APP_DISPLAY_NAME} v${appVersion()}`);
    expect(appTitle()).toMatch(/ v\d+\.\d+\.\d+/);
  });

  it('keeps the version ahead of a window-specific suffix', async () => {
    const { appTitle } = await import('../src/server/app-root');

    expect(appTitle('Terminal Log')).toBe(`${appTitle()} - Terminal Log`);
  });
});
