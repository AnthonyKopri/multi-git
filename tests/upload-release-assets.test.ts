import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface UploadOptions {
  tag: string | null;
  repo: string | null;
  dryRun: boolean;
  help: boolean;
}

interface UploadScriptApi {
  parseArgs(argv: string[]): UploadOptions;
  quoteForDisplay(value: string): string;
}

const require = createRequire(import.meta.url);
const uploadScript = require('../scripts/upload-release-assets.js') as UploadScriptApi;

describe('release upload command', () => {
  it('lets gh infer the current release tag and repository', () => {
    expect(uploadScript.parseArgs([])).toEqual({
      tag: null,
      repo: null,
      dryRun: false,
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
