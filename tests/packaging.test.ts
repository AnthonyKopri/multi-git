// Ported from the "packaging" and "element-ids" checks in scripts/check.js.
//
// These guard the two mistakes that ship a broken build without failing any
// other test: a runtime file left out of the Electron Builder file list, and a
// DOM id the client looks up but the HTML never defines.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';

interface PackageManifest {
  version?: string;
  main?: string;
  scripts?: Record<string, string>;
  build?: { files?: string[] };
}

function readManifest(): PackageManifest {
  return JSON.parse(fs.readFileSync(fromAppRoot('package.json'), 'utf8')) as PackageManifest;
}

describe('packaging', () => {
  const manifest = readManifest();
  const packaged = manifest.build?.files ?? [];

  it('declares a semantic version', () => {
    expect(manifest.version ?? '').toMatch(/^\d+\.\d+\.\d+/);
  });

  it('ships the template bodies the new-repository wizard reads', () => {
    // These are data files loaded at runtime, not code, so no bundler pulls
    // them in. Losing this entry breaks the wizard only in packaged builds.
    expect(packaged).toContain('templates/**/*');
  });

  it('ships every entry point the app loads at runtime', () => {
    const main = manifest.main ?? '';
    expect(main).not.toBe('');

    // The main entry must be covered by one of the packaged globs.
    const covered = packaged.some((glob) => {
      const prefix = glob.replace(/\*\*.*$/, '').replace(/\/$/, '');
      return glob === main || (prefix !== '' && main.startsWith(prefix));
    });

    expect(covered, `package.json "main" (${main}) is not covered by build.files`).toBe(true);
  });

  it('ships the compiled output, which is now the whole application', () => {
    // main.js, preload.js, server.js and ssh-config.js are all compiled from
    // src/ into out/ now; nothing at the repository root runs any more.
    expect(packaged).toContain('out/**/*');

    for (const retired of ['server.js', 'ssh-config.js', 'main.js', 'preload.js', 'repo-templates.js']) {
      expect(fs.existsSync(fromAppRoot(retired)), `${retired} should have been migrated`).toBe(false);
    }
  });

  it('ships the static assets the renderer loads', () => {
    const servesFromPublic = packaged.includes('public/**/*');
    const servesFromOut = packaged.some((glob) => glob.startsWith('out/'));

    expect(
      servesFromPublic || servesFromOut,
      'neither public/**/* nor an out/ glob is packaged, so the UI would not load'
    ).toBe(true);
  });
});

describe('element ids', () => {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const definedIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1] as string));

  /**
   * Collects every id the client looks up.
   *
   * Once src/renderer/dom/elements.ts exists it is imported and asked for its
   * declared ids, which is exact. Until then the un-migrated public/app.js is
   * scanned for getElementById calls, which is what scripts/check.js did.
   * Either way an empty result fails the test, so the check can never quietly
   * stop finding anything.
   */
  async function collectLookups(): Promise<{ source: string; ids: Set<string> }> {
    const registry = fromAppRoot('src', 'renderer', 'dom', 'elements.ts');

    if (fs.existsSync(registry)) {
      // Indirect specifier: the module does not exist until Phase 5, so a
      // literal import would fail type resolution before then.
      const specifier = '../src/renderer/dom/elements';
      const module = (await import(/* @vite-ignore */ specifier)) as {
        ELEMENT_IDS?: readonly string[];
      };

      if (!Array.isArray(module.ELEMENT_IDS)) {
        throw new Error(
          'src/renderer/dom/elements.ts must export ELEMENT_IDS so this check can verify it'
        );
      }

      return { source: 'src/renderer/dom/elements.ts', ids: new Set(module.ELEMENT_IDS) };
    }

    const source = fs.readFileSync(fromAppRoot('public', 'app.js'), 'utf8');
    return {
      source: 'public/app.js',
      ids: new Set(
        [...source.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1] as string)
      )
    };
  }

  it('resolves every id the client looks up', async () => {
    const { source, ids } = await collectLookups();

    expect(
      ids.size,
      `no id lookups found in ${source}; the scan has gone stale`
    ).toBeGreaterThan(0);

    const missing = [...ids].filter((id) => !definedIds.has(id));

    expect(missing, `${source} looks up ids that index.html does not define`).toEqual([]);
  });

  it('finds ids defined in index.html', () => {
    expect(definedIds.size).toBeGreaterThan(0);
  });
});

describe('the log window', () => {
  it('is packaged alongside the main page', () => {
    expect(fs.existsSync(fromAppRoot('public', 'logs.html'))).toBe(true);
  });
});
