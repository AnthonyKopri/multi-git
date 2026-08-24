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
  build?: {
    files?: string[];
    icon?: string;
    win?: { icon?: string };
    mac?: {
      icon?: string;
      artifactName?: string;
      category?: string;
      extendInfo?: {
        CFBundleDocumentTypes?: Array<{
          CFBundleTypeName?: string;
          CFBundleTypeRole?: string;
          LSHandlerRank?: string;
          LSItemContentTypes?: string[];
        }>;
      };
      hardenedRuntime?: boolean;
      entitlements?: string;
      entitlementsInherit?: string;
      notarize?: boolean;
      target?: string[];
    };
    nsis?: { artifactName?: string };
    portable?: { artifactName?: string };
  };
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

  it('uses stable, target-specific Windows release filenames', () => {
    expect(manifest.build?.nsis?.artifactName).toBe(
      'Multi-Git-Client-Setup-${version}.${ext}'
    );
    expect(manifest.build?.portable?.artifactName).toBe(
      'Multi-Git-Client-Portable-${version}.${ext}'
    );
  });

  it('uses stable architecture-qualified macOS DMG and ZIP filenames', () => {
    expect(manifest.build?.mac?.artifactName).toBe(
      'Multi-Git-Client-macOS-${version}-${arch}.${ext}'
    );
    expect(manifest.build?.mac?.target).toEqual(['dmg', 'zip']);
    expect(manifest.scripts?.['build-mac:arm64']).toContain('--arm64');
    expect(manifest.scripts?.['build-mac:x64']).toContain('--x64');
    expect(manifest.scripts?.['build-mac:portable']).toContain('--mac zip');
  });

  it('ships the template bodies the new-repository wizard reads', () => {
    // These are data files loaded at runtime, not code, so no bundler pulls
    // them in. Losing this entry breaks the wizard only in packaged builds.
    expect(packaged).toContain('templates/**/*');
  });

  it('ships the application icon from the shared documentation assets', () => {
    const icon = 'docs/images/multi-git-logo.ico';

    expect(manifest.build?.icon).toBe(icon);
    expect(packaged).toContain(icon);
    expect(fs.existsSync(fromAppRoot(...icon.split('/')))).toBe(true);
  });

  it('has a macOS-sized transparent icon source without weakening the Windows icon', () => {
    const windowsIcon = 'docs/images/multi-git-logo.ico';
    const macIcon = 'docs/images/multi-git-logo.png';
    const bytes = fs.readFileSync(fromAppRoot(...macIcon.split('/')));

    expect(manifest.build?.win?.icon).toBe(windowsIcon);
    expect(manifest.build?.mac?.icon).toBe(macIcon);
    expect(packaged).toContain(macIcon);
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(512);
    expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(512);
    expect(bytes[25], 'macOS icon must retain its transparent background').toBe(6);
  });

  it('enables hardened signing, notarization, and Electron minimum entitlements on macOS', () => {
    const mac = manifest.build?.mac;
    expect(mac?.category).toBe('public.app-category.developer-tools');
    expect(mac?.hardenedRuntime).toBe(true);
    expect(mac?.notarize).toBe(true);

    for (const relative of [mac?.entitlements, mac?.entitlementsInherit]) {
      expect(relative).toBeTruthy();
      const plist = fs.readFileSync(fromAppRoot(...(relative as string).split('/')), 'utf8');
      expect(plist).toContain('com.apple.security.cs.allow-jit');
      expect(plist).toContain('com.apple.security.cs.allow-unsigned-executable-memory');
      expect(plist).not.toContain('com.apple.security.cs.disable-library-validation');
      expect(plist).not.toContain('com.apple.security.app-sandbox');
    }
  });

  it('registers repository folders with Finder without claiming to own every folder', () => {
    expect(manifest.build?.mac?.extendInfo?.CFBundleDocumentTypes).toEqual([
      {
        CFBundleTypeName: 'Git repository folder',
        CFBundleTypeRole: 'Viewer',
        LSHandlerRank: 'Alternate',
        LSItemContentTypes: ['public.folder']
      }
    ]);
  });

  it('builds and tests both macOS CPU families on native pinned runners', () => {
    const ci = fs.readFileSync(fromAppRoot('.github', 'workflows', 'ci.yml'), 'utf8');
    const release = fs.readFileSync(
      fromAppRoot('.github', 'workflows', 'release-macos.yml'),
      'utf8'
    );

    for (const workflow of [ci, release]) {
      expect(workflow).toContain('macos-15');
      expect(workflow).toContain('macos-15-intel');
      expect(workflow).toContain('arm64');
      expect(workflow).toContain('x64');
      expect(workflow).toContain('mach_arch: x86_64');
    }
    expect(release).toContain('MACOS_CSC_LINK');
    expect(release).toContain('MACOS_APPLE_API_KEY_BASE64');
    expect(release).toContain('allow_unsigned');
    expect(release).toContain('if: ${{ inputs.allow_unsigned == false }}');
    expect(release).toMatch(/permissions:\r?\n  contents: read/);
    expect(release).toContain('contents: write');
    expect(release).toContain('persist-credentials: false');
    expect(release).toContain('environment: macos-release');
    expect(release).toContain("GITHUB_REF\" != 'refs/heads/main'");
    expect(release).toContain('refs/tags/${{ inputs.tag }}');
    expect(release).toContain('refs/remotes/origin/main');
    expect(release).toContain('macos-unsigned-${{ matrix.arch }}');
    expect(release).toContain('pattern: macos-signed-*');
    expect(release).toContain('Remove temporary notarization key');
    expect(release).not.toContain('APPLE_API_KEY=$key_path\" >> \"$GITHUB_ENV');
    expect(release).toContain("xcrun stapler validate");
    expect(ci).toContain('actions/upload-artifact@v4');
    expect(ci).toContain('macos-smoke-${{ matrix.arch }}');
    expect(ci).toContain('retention-days: 14');
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

    for (const retired of ['server.js', 'ssh-config.js', 'main.js', 'preload.js', 'repo-templates.js', 'public/app.js']) {
      expect(fs.existsSync(fromAppRoot(retired)), `${retired} should have been migrated`).toBe(false);
    }
  });

  it('never lets electron-builder publish on its own', () => {
    // electron-builder publishes to GitHub Releases when the npm lifecycle
    // event is named "release", which every release script is. Without a
    // GH_TOKEN that fails *after* packaging succeeds, so the artifacts are
    // finished in dist/ while the command reports failure.
    const releaseDriver = fs.readFileSync(fromAppRoot('scripts', 'release.js'), 'utf8');

    expect(
      releaseDriver.includes("'--publish', 'never'"),
      'scripts/release.js must pass --publish never, or a release without GH_TOKEN fails after building'
    ).toBe(true);
  });

  it('creates checksums only after electron-builder finishes', () => {
    const releaseDriver = fs.readFileSync(fromAppRoot('scripts', 'release.js'), 'utf8');
    const buildCall = releaseDriver.indexOf('await runBuild');
    const checksumCall = releaseDriver.indexOf('await writeChecksumManifest');

    expect(buildCall, 'scripts/release.js does not await its package build').toBeGreaterThan(-1);
    expect(checksumCall, 'scripts/release.js does not create SHA256SUMS.txt').toBeGreaterThan(
      buildCall
    );
  });

  it('keeps GitHub release upload an explicit command', () => {
    expect(manifest.scripts?.['release:upload']).toBe('node scripts/upload-release-assets.js');
  });

  it('compiles before packaging in every path that packages', () => {
    // out/ is gitignored, so a fresh checkout has none of it. Any script that
    // reaches electron-builder without compiling first packages an asar with
    // no entry point, which only fails at package time and never in
    // development, where a stale out/ is usually lying around.
    const scripts = manifest.scripts ?? {};
    const releaseDriver = fs.readFileSync(fromAppRoot('scripts', 'release.js'), 'utf8');

    for (const [name, command] of Object.entries(scripts)) {
      if (!command.includes('electron-builder')) {
        continue;
      }
      expect(command, `npm script "${name}" packages without compiling first`).toContain(
        'compile'
      );
    }

    // release.js spawns electron-builder itself, so it has to compile itself.
    expect(
      releaseDriver.includes('runCompile'),
      'scripts/release.js invokes electron-builder without compiling first'
    ).toBe(true);
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
   * scripts/check.js grepped public/app.js for getElementById calls. The
   * registry is the exact list instead of a pattern match, and an empty
   * result fails, so this check cannot quietly stop finding anything.
   */
  async function collectLookups(): Promise<{ source: string; ids: Set<string> }> {
    const module = (await import('../src/renderer/dom/elements')) as {
      ELEMENT_IDS?: readonly string[];
    };

    if (!Array.isArray(module.ELEMENT_IDS)) {
      throw new Error(
        'src/renderer/dom/elements.ts must export ELEMENT_IDS so this check can verify it'
      );
    }

    return { source: 'src/renderer/dom/elements.ts', ids: new Set(module.ELEMENT_IDS) };
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

/**
 * Narrowing helpers must agree with the markup.
 *
 * `asInput`, `asSelect` and friends throw at runtime when the element is not
 * the tag they name — by design, so a mismatch is loud rather than silently
 * undefined. But nothing checked that they *match*, and `asInput` on the
 * `<select>` behind `#signing-mode` shipped: the signing settings dialog threw
 * "Expected #signing-mode to be HTMLInputElement, found HTMLSelectElement" the
 * moment it opened, and no test noticed because the id existed and the
 * TypeScript types are identical either way.
 *
 * This is a static check over every call site in the renderer, so the whole
 * class of mistake fails the suite rather than one instance of it.
 */
describe('typed element access', () => {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');

  const EXPECTED_TAG: Record<string, string> = {
    asInput: 'input',
    asSelect: 'select',
    asTextArea: 'textarea',
    asForm: 'form',
    asButton: 'button'
  };

  /** The tag of the element carrying an id, or null when it is not there. */
  function tagFor(id: string): string | null {
    const match = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\bid="${id}"`).exec(html);
    return match?.[1]?.toLowerCase() ?? null;
  }

  function rendererSources(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return rendererSources(full);
      }
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  }

  it('narrows every element to the tag index.html actually uses', async () => {
    const { ELEMENT_MAP } = (await import('../src/renderer/dom/elements')) as {
      ELEMENT_MAP: Record<string, string>;
    };

    const mismatches: string[] = [];
    let callSites = 0;

    for (const file of rendererSources(fromAppRoot('src', 'renderer'))) {
      const source = fs.readFileSync(file, 'utf8');

      for (const [, helper, key] of source.matchAll(
        /\b(asInput|asSelect|asTextArea|asForm|asButton)\(\s*ui\.(\w+)\s*\)/g
      )) {
        const id = ELEMENT_MAP[key as string];
        if (id === undefined) {
          continue;
        }

        callSites += 1;

        const actual = tagFor(id);
        const expected = EXPECTED_TAG[helper as string];

        if (actual !== null && actual !== expected) {
          mismatches.push(
            `${file.split(/[\\/]/).slice(-2).join('/')}: ${helper}(ui.${key}) but #${id} is a <${actual}>`
          );
        }
      }
    }

    // A regex that stopped matching would make this pass by finding nothing.
    expect(callSites, 'no typed element access found; the scan has gone stale').toBeGreaterThan(20);
    expect(mismatches).toEqual([]);
  });
});

describe('the log window', () => {
  it('is packaged alongside the main page', () => {
    expect(fs.existsSync(fromAppRoot('public', 'logs.html'))).toBe(true);
  });
});
