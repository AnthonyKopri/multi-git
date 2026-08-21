import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface UploadOptions {
  tag: string | null;
  repo: string | null;
  dryRun: boolean;
  changelog: boolean;
  help: boolean;
}

interface VerifyAsset {
  basename: string;
  size: number;
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
  verifyUpload(options: VerifyOptions): Promise<'ok' | 'mismatch' | 'unknown'>;
}

const require = createRequire(import.meta.url);
const uploadScript = require('../scripts/upload-release-assets.js') as UploadScriptApi;

describe('release upload command', () => {
  it('lets gh infer the current release tag and repository', () => {
    expect(uploadScript.parseArgs([])).toEqual({
      tag: null,
      repo: null,
      dryRun: false,
      // Closing the Unreleased section is part of publishing a release, so it
      // is on unless it is turned off.
      changelog: true,
      help: false
    });
  });

  it('parses explicit release, repository, and dry-run options', () => {
    expect(
      uploadScript.parseArgs([
        '--tag=Release_v3.0.0',
        '-R',
        'AnthonyKopri/multi-git',
        '--dry-run'
      ])
    ).toMatchObject({
      tag: 'Release_v3.0.0',
      repo: 'AnthonyKopri/multi-git',
      dryRun: true
    });
  });

  it('can be told to leave the changelog alone', () => {
    expect(uploadScript.parseArgs(['--no-changelog']).changelog).toBe(false);
  });

  it('rejects unknown options and missing values before any upload', () => {
    expect(() => uploadScript.parseArgs(['--clobber'])).toThrow('Unknown option');
    expect(() => uploadScript.parseArgs(['--target', 'portable'])).toThrow('Unknown option');
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
  const assets: VerifyAsset[] = [
    { basename: 'Multi-Git-Client-Setup-3.1.3.exe', size: 100_779_194 },
    { basename: 'SHA256SUMS.txt', size: 201 }
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
        { name: 'Multi-Git-Client-Setup-3.1.3.exe', size: 100_779_194, state: 'uploaded' },
        { name: 'SHA256SUMS.txt', size: 201, state: 'uploaded' }
      ]),
      out
    });

    expect(verdict).toBe('ok');
    expect(lines.join(' ')).toContain('100779194 bytes, uploaded');
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
        { name: 'Multi-Git-Client-Setup-3.1.3.exe', size: 100_779_194, state: 'uploaded' },
        { name: 'SHA256SUMS.txt', size: 201, state: 'uploaded' }
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
        { name: 'Multi-Git-Client-Setup-3.1.3.exe', size: 42, state: 'uploaded' },
        { name: 'SHA256SUMS.txt', size: 201, state: 'uploaded' }
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
      read: release([{ name: 'SHA256SUMS.txt', size: 201, state: 'uploaded' }]),
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
});
