import { describe, expect, it, vi } from 'vitest';

import { createUpdateService } from '../src/main/update/service';
import type { UpdateServiceDeps, UpdateSettings } from '../src/main/update/service';
import type { InstallKind, UpdateState } from '../src/shared/update-types';

const DIGEST = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function releases(version = '3.2.0'): unknown {
  const names = [
    `Multi-Git-Client-Setup-${version}.exe`,
    `Multi-Git-Client-Portable-${version}.exe`,
    'SHA256SUMS.txt'
  ];

  return [
    {
      tag_name: `Release_v${version}`,
      name: `Multi-Git ${version}`,
      body: 'Fixed things.',
      draft: false,
      prerelease: false,
      assets: names.map((name) => ({
        name,
        browser_download_url: `https://github.com/AnthonyKopri/multi-git/releases/download/Release_v${version}/${name}`
      }))
    }
  ];
}

function manifest(version = '3.2.0'): string {
  return [
    `${DIGEST}  Multi-Git-Client-Setup-${version}.exe`,
    `${DIGEST}  Multi-Git-Client-Portable-${version}.exe`,
    ''
  ].join('\n');
}

interface Harness {
  deps: UpdateServiceDeps;
  states: UpdateState[];
  spawned: { file: string; args: string[] }[];
  commits: string[];
  discards: string[];
  popups: number;
  quits: number;
  skipped: string[];
}

function harness(
  overrides: {
    installKind?: InstallKind;
    settings?: Partial<UpdateSettings>;
    digest?: string;
    fetchJson?: UpdateServiceDeps['fetchJson'];
    spawnDetached?: UpdateServiceDeps['spawnDetached'];
    isRateLimit?: UpdateServiceDeps['isRateLimit'];
  } = {}
): Harness {
  const states: UpdateState[] = [];
  const spawned: { file: string; args: string[] }[] = [];
  const commits: string[] = [];
  const discards: string[] = [];
  const skipped: string[] = [];
  const shared = { popups: 0, quits: 0 };

  const deps: UpdateServiceDeps = {
    currentVersion: '3.1.1',
    installKind: overrides.installKind ?? 'installer',
    portableDir: 'D:\\Tools\\MultiGit',
    tempDir: 'C:\\Temp',
    fetchJson: overrides.fetchJson ?? (() => Promise.resolve(releases())),
    fetchText: () => Promise.resolve(manifest()),
    downloadToFile: (_url, destPath) =>
      Promise.resolve({
        sha256: overrides.digest ?? DIGEST,
        bytes: 10,
        commit: async () => {
          commits.push(destPath);
        },
        discard: async () => {
          discards.push(destPath);
        }
      }),
    isRateLimit: overrides.isRateLimit ?? (() => false),
    spawnDetached:
      overrides.spawnDetached ??
      ((file, args) => {
        spawned.push({ file, args });
      }),
    quit: () => {
      shared.quits += 1;
    },
    broadcastState: (state) => states.push(state),
    requestPopup: () => {
      shared.popups += 1;
    },
    readSettings: () => ({ checkForUpdates: true, ...overrides.settings }),
    writeSkippedVersion: (version) => skipped.push(version)
  };

  return {
    deps,
    states,
    spawned,
    commits,
    discards,
    skipped,
    get popups() {
      return shared.popups;
    },
    get quits() {
      return shared.quits;
    }
  };
}

describe('checking for an update', () => {
  it('resolves a newer release and announces it once', async () => {
    const h = harness();
    const service = createUpdateService(h.deps);

    const state = await service.check();
    expect(state.phase).toBe('available');
    expect(state.latest?.version).toBe('3.2.0');
    expect(h.popups).toBe(1);

    // A second check must not put the popup in front of the user again.
    await service.check();
    expect(h.popups).toBe(1);
  });

  it('reports being current when nothing newer exists', async () => {
    const h = harness({ fetchJson: () => Promise.resolve(releases('3.0.0')) });
    const state = await createUpdateService(h.deps).check();

    expect(state.phase).toBe('up-to-date');
    expect(state.latest).toBeUndefined();
    expect(h.popups).toBe(0);
  });

  it('goes quiet on a spent rate limit rather than showing an error', async () => {
    const h = harness({
      fetchJson: () => Promise.reject(new Error('rate limited')),
      isRateLimit: () => true
    });

    const state = await createUpdateService(h.deps).check();
    expect(state.phase).toBe('idle');
    expect(state.message).toBeUndefined();
  });

  it('reports an ordinary network failure', async () => {
    const h = harness({ fetchJson: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) });
    const state = await createUpdateService(h.deps).check();

    expect(state.phase).toBe('error');
    expect(state.message).toMatch(/ENOTFOUND/);
  });

  it('does not reach the network at all when the setting is off', async () => {
    const fetchJson = vi.fn().mockResolvedValue(releases());
    const h = harness({ fetchJson, settings: { checkForUpdates: false } });

    await createUpdateService(h.deps).check();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('does nothing on a build that cannot update itself', async () => {
    const fetchJson = vi.fn().mockResolvedValue(releases());
    const h = harness({ installKind: 'unsupported', fetchJson });

    const state = await createUpdateService(h.deps).check();
    expect(state.supported).toBe(false);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});

describe('downloading', () => {
  it('verifies against the release checksum and only then puts the file in place', async () => {
    const h = harness();
    const service = createUpdateService(h.deps);

    await service.check();
    const state = await service.download();

    expect(state.phase).toBe('ready');
    expect(h.commits).toEqual(['C:\\Temp\\multi-git-update\\Multi-Git-Client-Setup-3.2.0.exe']);
    expect(h.discards).toEqual([]);
  });

  it('discards a file whose checksum does not match, and never runs it', async () => {
    const h = harness({ digest: 'f'.repeat(64) });
    const service = createUpdateService(h.deps);

    await service.check();
    const state = await service.download();

    expect(state.phase).toBe('error');
    expect(state.message).toMatch(/did not match the release checksum/);
    expect(h.discards).toHaveLength(1);
    // The two that matter: it never took the destination's name, and nothing ran.
    expect(h.commits).toEqual([]);
    expect(h.spawned).toEqual([]);

    // And the failed download cannot be installed by asking again.
    await service.install();
    expect(h.spawned).toEqual([]);
    expect(h.quits).toBe(0);
  });

  it('puts a portable download beside the running executable', async () => {
    const h = harness({ installKind: 'portable' });
    const service = createUpdateService(h.deps);

    await service.check();
    await service.download();

    expect(h.commits).toEqual(['D:\\Tools\\MultiGit\\Multi-Git-Client-Portable-3.2.0.exe']);
  });

  it('reports progress while it runs', async () => {
    const h = harness();
    h.deps.downloadToFile = (_url, destPath, onProgress) => {
      onProgress(25);
      onProgress(80);
      return Promise.resolve({
        sha256: DIGEST,
        bytes: 10,
        commit: async () => {
          h.commits.push(destPath);
        },
        discard: async () => {}
      });
    };

    const service = createUpdateService(h.deps);
    await service.check();
    await service.download();

    expect(h.states.filter((s) => s.phase === 'downloading').map((s) => s.percent)).toContain(80);
  });

  it('refuses a release that published no checksum list', async () => {
    const h = harness({
      fetchJson: () =>
        Promise.resolve([
          {
            tag_name: 'Release_v3.2.0',
            draft: false,
            prerelease: false,
            assets: [
              {
                name: 'Multi-Git-Client-Setup-3.2.0.exe',
                browser_download_url: 'https://github.com/a.exe'
              }
            ]
          }
        ])
    });

    const service = createUpdateService(h.deps);
    // It is not even offered: an unverifiable release is not an update.
    expect((await service.check()).phase).toBe('up-to-date');
  });
});

describe('installing', () => {
  it('runs the installer silently, then quits — in that order', async () => {
    const h = harness();
    const service = createUpdateService(h.deps);

    await service.check();
    await service.download();
    await service.install();

    expect(h.spawned).toEqual([
      {
        file: 'C:\\Temp\\multi-git-update\\Multi-Git-Client-Setup-3.2.0.exe',
        args: ['/S', '--force-run']
      }
    ]);
    expect(h.quits).toBe(1);
  });

  it('opens the new portable executable with no installer arguments', async () => {
    const h = harness({ installKind: 'portable' });
    const service = createUpdateService(h.deps);

    await service.check();
    await service.download();
    await service.install();

    expect(h.spawned).toEqual([
      { file: 'D:\\Tools\\MultiGit\\Multi-Git-Client-Portable-3.2.0.exe', args: [] }
    ]);
  });

  it('stays open when the installer could not be started', async () => {
    const h = harness({
      spawnDetached: () => {
        throw new Error('spawn ENOENT');
      }
    });
    const service = createUpdateService(h.deps);

    await service.check();
    await service.download();
    const state = await service.install();

    expect(state.phase).toBe('error');
    // Quitting here would close the app into nothing.
    expect(h.quits).toBe(0);
  });

  it('cannot be installed before it has been downloaded', async () => {
    const h = harness();
    const service = createUpdateService(h.deps);

    await service.check();
    await service.install();

    expect(h.spawned).toEqual([]);
    expect(h.quits).toBe(0);
  });
});

describe('skipping a version', () => {
  it('records the version and stops offering it', async () => {
    const h = harness();
    const service = createUpdateService(h.deps);

    await service.check();
    const state = await service.skipCurrent();

    expect(h.skipped).toEqual(['3.2.0']);
    expect(state.phase).toBe('up-to-date');
    expect(state.latest).toBeUndefined();
  });
});
