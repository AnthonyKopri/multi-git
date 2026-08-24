import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface UploadOptions {
  tag: string | null;
  repo: string | null;
  target: string;
  dryRun: boolean;
  changelog: boolean;
  help: boolean;
}

interface VerifyAsset {
  basename: string;
  size: number;
  sha256: string;
}

interface LocalUploadAsset extends VerifyAsset {
  path: string;
  label: string;
}

interface VerifyOptions {
  tag: string;
  repo?: string;
  assets: VerifyAsset[];
  read: (args: string[]) => Promise<string | null>;
  out: { log: (message: string) => void; warn: (message: string) => void };
}

interface UploadScriptApi {
  parseArgs(argv: string[]): UploadOptions;
  quoteForDisplay(value: string): string;
  normalizedSha256(value: unknown): string | null;
  selectMissingAssets(options: {
    tag: string;
    repo?: string;
    assets: LocalUploadAsset[];
    read: (args: string[]) => Promise<string | null>;
  }): Promise<LocalUploadAsset[]>;
  buildSelectedUploadArgs(options: {
    tag: string;
    repo?: string;
    assets: LocalUploadAsset[];
  }): string[];
  verifyUpload(options: VerifyOptions): Promise<'ok' | 'mismatch' | 'unknown'>;
}

const require = createRequire(import.meta.url);
const uploadScript = require('../scripts/upload-release-assets.js') as UploadScriptApi;

describe('release upload command', () => {
  it('lets gh infer the current release tag and repository', () => {
    expect(uploadScript.parseArgs([])).toEqual({
      tag: null,
      repo: null,
      target: 'both',
      dryRun: false,
      // Closing the Unreleased section is part of publishing a release, so it
      // is on unless it is turned off.
      changelog: true,
      help: false
    });
  });

  it('parses explicit release, repository, target, and dry-run options', () => {
    expect(
      uploadScript.parseArgs([
        '--tag=Release_v3.0.0',
        '-R',
        'AnthonyKopri/multi-git',
        '--target',
        'macos',
        '--dry-run'
      ])
    ).toMatchObject({
      tag: 'Release_v3.0.0',
      repo: 'AnthonyKopri/multi-git',
      target: 'macos',
      dryRun: true
    });
  });

  it('can be told to leave the changelog alone', () => {
    expect(uploadScript.parseArgs(['--no-changelog']).changelog).toBe(false);
  });

  it('rejects unknown options and missing values before any upload', () => {
    expect(() => uploadScript.parseArgs(['--clobber'])).toThrow('Unknown option');
    expect(() => uploadScript.parseArgs(['--target'])).toThrow('--target requires a value');
    expect(() => uploadScript.parseArgs(['--target='])).toThrow('--target requires a value');
    expect(() => uploadScript.parseArgs(['--tag', '--dry-run'])).toThrow(
      '--tag requires a value'
    );
  });

  it('quotes labeled paths when showing a dry-run command', () => {
    expect(
      uploadScript.quoteForDisplay(
        'D:\\repo\\dist\\Multi-Git-Client-Setup-3.0.0.exe#Windows installer (recommended)'
      )
    ).toBe(
      "'D:\\repo\\dist\\Multi-Git-Client-Setup-3.0.0.exe#Windows installer (recommended)'"
    );
  });
});

describe('verifying what reached the release', () => {
  const installerHash = 'a'.repeat(64);
  const manifestHash = 'b'.repeat(64);
  const assets: VerifyAsset[] = [
    {
      basename: 'Multi-Git-Client-Setup-3.1.3.exe',
      size: 100_779_194,
      sha256: installerHash
    },
    { basename: 'SHA256SUMS.txt', size: 201, sha256: manifestHash }
  ];

  /** Collects what the command told the user, so a test can read it back. */
  function recorder() {
    const lines: string[] = [];
    return {
      lines,
      out: { log: (message: string) => lines.push(message), warn: (message: string) => lines.push(message) }
    };
  }

  const release = (published: unknown) => async () => JSON.stringify({ assets: published });

  it('accepts a release holding every asset at its full size', async () => {
    const { lines, out } = recorder();

    const verdict = await uploadScript.verifyUpload({
      tag: 'Release_v3.1.3',
      assets,
      read: release([
        {
          name: 'Multi-Git-Client-Setup-3.1.3.exe',
          size: 100_779_194,
          digest: `sha256:${installerHash}`,
          state: 'uploaded'
        },
        {
          name: 'SHA256SUMS.txt',
          size: 201,
          digest: `sha256:${manifestHash}`,
          state: 'uploaded'
        }
      ]),
      out
    });

    expect(verdict).toBe('ok');
    expect(lines.join(' ')).toContain('100779194 bytes, SHA-256 verified, uploaded');
  });

  it("says not to trust GitHub's editor when the assets are in fact complete", async () => {
    // The editor shows CLI-uploaded assets as "Upload failed. Delete and try
    // uploading this file again", and following that deletes a working
    // download. This line is the whole reason the check prints anything.
    const { lines, out } = recorder();

    await uploadScript.verifyUpload({
      tag: 'Release_v3.1.3',
      assets,
      read: release([
        {
          name: 'Multi-Git-Client-Setup-3.1.3.exe',
          size: 100_779_194,
          digest: `sha256:${installerHash}`,
          state: 'uploaded'
        },
        {
          name: 'SHA256SUMS.txt',
          size: 201,
          digest: `sha256:${manifestHash}`,
          state: 'uploaded'
        }
      ]),
      out
    });

    expect(lines.join(' ')).toMatch(/Do not delete them/);
  });

  it('reports a truncated asset rather than calling the upload done', async () => {
    const { lines, out } = recorder();

    const verdict = await uploadScript.verifyUpload({
      tag: 'Release_v3.1.3',
      assets,
      read: release([
        {
          name: 'Multi-Git-Client-Setup-3.1.3.exe',
          size: 42,
          digest: `sha256:${installerHash}`,
          state: 'uploaded'
        },
        {
          name: 'SHA256SUMS.txt',
          size: 201,
          digest: `sha256:${manifestHash}`,
          state: 'uploaded'
        }
      ]),
      out
    });

    expect(verdict).toBe('mismatch');
    expect(lines.join(' ')).toContain('42 bytes on the release but 100779194 locally');
  });

  it('reports an asset that never arrived', async () => {
    const { lines, out } = recorder();

    const verdict = await uploadScript.verifyUpload({
      tag: 'Release_v3.1.3',
      assets,
      read: release([
        {
          name: 'SHA256SUMS.txt',
          size: 201,
          digest: `sha256:${manifestHash}`,
          state: 'uploaded'
        }
      ]),
      out
    });

    expect(verdict).toBe('mismatch');
    expect(lines.join(' ')).toContain('is not on the release');
  });

  it('says it could not look rather than claiming either answer', async () => {
    // The upload already succeeded by this point. Not being able to read the
    // release back is worth saying, and never worth failing the release over.
    const { lines, out } = recorder();

    const verdict = await uploadScript.verifyUpload({
      tag: 'Release_v3.1.3',
      assets,
      read: async () => null,
      out
    });

    expect(verdict).toBe('unknown');
    expect(lines.join(' ')).toMatch(/not verified/);
  });

  it('passes the repository through to gh when one was given', async () => {
    const seen: string[][] = [];
    const { out } = recorder();

    await uploadScript.verifyUpload({
      tag: 'Release_v3.1.3',
      repo: 'AnthonyKopri/multi-git',
      assets: [],
      read: async (args: string[]) => {
        seen.push(args);
        return '{"assets":[]}';
      },
      out
    });

    expect(seen[0]).toEqual([
      'release',
      'view',
      'Release_v3.1.3',
      '--json',
      'assets',
      '--repo',
      'AnthonyKopri/multi-git'
    ]);
  });

  it('rejects equal-size content whose release digest differs', async () => {
    const { lines, out } = recorder();
    const verdict = await uploadScript.verifyUpload({
      tag: 'Release_v3.1.3',
      assets: [assets[0]!],
      read: release([
        {
          name: assets[0]!.basename,
          size: assets[0]!.size,
          digest: `sha256:${'c'.repeat(64)}`
        }
      ]),
      out
    });

    expect(verdict).toBe('mismatch');
    expect(lines.join(' ')).toContain('different local and release SHA-256');
  });
});

describe('resuming an interrupted release upload', () => {
  const tag = 'Release_v3.1.3';
  const localAssets: LocalUploadAsset[] = [
    {
      basename: 'Multi-Git-Client-Setup-3.1.3.exe',
      path: 'D:\\dist\\Multi-Git-Client-Setup-3.1.3.exe',
      label: 'Windows installer (recommended)',
      size: 100,
      sha256: '1'.repeat(64)
    },
    {
      basename: 'Multi-Git-Client-Portable-3.1.3.exe',
      path: 'D:\\dist\\Multi-Git-Client-Portable-3.1.3.exe',
      label: 'Portable Windows executable',
      size: 80,
      sha256: '2'.repeat(64)
    },
    {
      basename: 'SHA256SUMS.txt',
      path: 'D:\\dist\\SHA256SUMS.txt',
      label: 'SHA-256 checksums',
      size: 201,
      sha256: '3'.repeat(64)
    }
  ];
  const installer = localAssets[0]!;
  const portable = localAssets[1]!;
  const checksums = localAssets[2]!;

  const release = (assets: unknown) => async () => JSON.stringify({ assets });

  it('skips every already-present asset when full sizes and SHA-256 digests match', async () => {
    const missing = await uploadScript.selectMissingAssets({
      tag,
      assets: localAssets,
      read: release(
        localAssets.map((asset) => ({
          name: asset.basename,
          size: asset.size,
          digest: `sha256:${asset.sha256}`
        }))
      )
    });

    expect(missing).toEqual([]);
  });

  it('keeps first-run behavior by selecting every asset from an empty release', async () => {
    const missing = await uploadScript.selectMissingAssets({
      tag,
      assets: localAssets,
      read: release([])
    });

    expect(missing).toEqual(localAssets);
  });

  it('uploads only missing assets in stable order with their original labels', async () => {
    const seen: string[][] = [];
    const missing = await uploadScript.selectMissingAssets({
      tag,
      repo: 'AnthonyKopri/multi-git',
      assets: localAssets,
      read: async (args: string[]) => {
        seen.push(args);
        return JSON.stringify({
          assets: [
            {
              name: installer.basename,
              size: installer.size,
              digest: `sha256:${installer.sha256}`
            }
          ]
        });
      }
    });
    const args = uploadScript.buildSelectedUploadArgs({
      tag,
      repo: 'AnthonyKopri/multi-git',
      assets: missing
    });

    expect(seen[0]).toEqual([
      'release',
      'view',
      tag,
      '--json',
      'assets',
      '--repo',
      'AnthonyKopri/multi-git'
    ]);
    expect(args).toEqual([
      'release',
      'upload',
      tag,
      `${portable.path}#Portable Windows executable`,
      `${checksums.path}#SHA-256 checksums`,
      '--repo',
      'AnthonyKopri/multi-git'
    ]);
    expect(args).not.toContain('--clobber');
  });

  it('fails before upload when an existing asset has a different size', async () => {
    await expect(
      uploadScript.selectMissingAssets({
        tag,
        assets: localAssets,
        read: release([{ name: installer.basename, size: 99 }])
      })
    ).rejects.toThrow(/release has 99 bytes, but the local file has 100/);
  });

  it('fails before upload when equal-size content has a different or missing digest', async () => {
    await expect(
      uploadScript.selectMissingAssets({
        tag,
        assets: localAssets,
        read: release([
          {
            name: installer.basename,
            size: installer.size,
            digest: `sha256:${'f'.repeat(64)}`
          }
        ])
      })
    ).rejects.toThrow(/SHA-256 differs/);

    await expect(
      uploadScript.selectMissingAssets({
        tag,
        assets: localAssets,
        read: release([{ name: installer.basename, size: installer.size }])
      })
    ).rejects.toThrow(/did not return its SHA-256/);
  });

  it('fails closed when the remote inventory is unavailable or malformed', async () => {
    await expect(
      uploadScript.selectMissingAssets({
        tag,
        assets: localAssets,
        read: async () => null
      })
    ).rejects.toThrow(/Could not inspect/);

    await expect(
      uploadScript.selectMissingAssets({
        tag,
        assets: localAssets,
        read: async () => '{"assets":"unknown"}'
      })
    ).rejects.toThrow(/assets array/);
  });
});
