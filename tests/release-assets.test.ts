import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

type ArtifactKey = 'installer' | 'portable';
type TargetName = ArtifactKey | 'both';

interface ArtifactSpec {
  label: string;
  basename(version: string): string;
}

interface SelectedArtifact {
  key: ArtifactKey;
  basename: string;
  label: string;
  path: string;
}

interface ChecksumManifestResult {
  manifestPath: string;
  contents: string;
  assets: ReadonlyArray<SelectedArtifact & { sha256: string }>;
}

interface ReleaseAssetsApi {
  RELEASE_ASSETS: Readonly<Record<ArtifactKey, ArtifactSpec>>;
  CHECKSUM_BASENAME: string;
  CHECKSUM_LABEL: string;
  selectedAssetKinds(targetName: TargetName | string): ArtifactKey[];
  resolveReleaseAssets(options: {
    version: string;
    targetName: TargetName;
    outputDir?: string;
  }): SelectedArtifact[];
  writeChecksumManifest(options: {
    version: string;
    targetName: TargetName;
    outputDir?: string;
  }): Promise<ChecksumManifestResult>;
  releaseTag(version: string): string;
  buildGhUploadArgs(options: {
    tag: string;
    version: string;
    outputDir?: string;
    repo?: string;
  }): string[];
}

const require = createRequire(import.meta.url);
const releaseAssets = require('../scripts/release-assets.js') as ReleaseAssetsApi;

const INSTALLER_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const PORTABLE_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

let workspace: string;
let outputDir: string;

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-release-assets-')));
  outputDir = path.join(workspace, 'dist folder');
  fs.mkdirSync(outputDir);
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function artifactPath(key: ArtifactKey, version = '3.0.0'): string {
  return path.join(outputDir, releaseAssets.RELEASE_ASSETS[key].basename(version));
}

describe('release artifact metadata', () => {
  it('uses distinct, GitHub-safe installer and portable names', () => {
    expect(releaseAssets.RELEASE_ASSETS.installer.basename('3.0.0')).toBe(
      'Multi-Git-Client-Setup-3.0.0.exe'
    );
    expect(releaseAssets.RELEASE_ASSETS.portable.basename('3.0.0')).toBe(
      'Multi-Git-Client-Portable-3.0.0.exe'
    );
    expect(releaseAssets.RELEASE_ASSETS.installer.label).toBe('Windows installer (recommended)');
    expect(releaseAssets.RELEASE_ASSETS.portable.label).toBe('Portable Windows executable');
  });

  it('maps each release target and keeps both in installer-first order', () => {
    expect(releaseAssets.selectedAssetKinds('installer')).toEqual(['installer']);
    expect(releaseAssets.selectedAssetKinds('portable')).toEqual(['portable']);
    expect(releaseAssets.selectedAssetKinds('both')).toEqual(['installer', 'portable']);
  });

  it('returns a copy so callers cannot mutate the central target mapping', () => {
    const selected = releaseAssets.selectedAssetKinds('both');
    selected.reverse();

    expect(releaseAssets.selectedAssetKinds('both')).toEqual(['installer', 'portable']);
  });

  it('supports the prerelease versions accepted by the release driver', () => {
    const artifacts = releaseAssets.resolveReleaseAssets({
      version: '3.1.0-beta.2',
      targetName: 'both',
      outputDir
    });

    expect(artifacts.map((artifact) => artifact.basename)).toEqual([
      'Multi-Git-Client-Setup-3.1.0-beta.2.exe',
      'Multi-Git-Client-Portable-3.1.0-beta.2.exe'
    ]);
    expect(releaseAssets.releaseTag('3.1.0-beta.2')).toBe('Release_v3.1.0-beta.2');
  });

  it('rejects unknown targets and unsafe versions', () => {
    expect(() => releaseAssets.selectedAssetKinds('zip')).toThrow('Invalid release target');
    expect(() => releaseAssets.selectedAssetKinds('toString')).toThrow('Invalid release target');
    expect(() =>
      releaseAssets.resolveReleaseAssets({
        version: '../3.0.0',
        targetName: 'both',
        outputDir
      })
    ).toThrow('Invalid release version');
  });
});

describe('SHA256SUMS.txt', () => {
  it('writes only exact selected artifacts in stable order and format', async () => {
    fs.writeFileSync(artifactPath('installer'), 'abc');
    fs.writeFileSync(artifactPath('portable'), '');
    fs.writeFileSync(path.join(outputDir, 'Multi-Git-Client-Portable-2.9.0.exe'), 'stale version');
    fs.writeFileSync(path.join(outputDir, 'unrelated.exe'), 'stale target');
    fs.writeFileSync(path.join(outputDir, releaseAssets.CHECKSUM_BASENAME), 'old checksums\r\n');

    const result = await releaseAssets.writeChecksumManifest({
      version: '3.0.0',
      targetName: 'both',
      outputDir
    });
    const expected =
      `${INSTALLER_SHA256}  Multi-Git-Client-Setup-3.0.0.exe\n` +
      `${PORTABLE_SHA256}  Multi-Git-Client-Portable-3.0.0.exe\n`;
    const bytes = fs.readFileSync(result.manifestPath);

    expect(result.contents).toBe(expected);
    expect(bytes.toString('ascii')).toBe(expected);
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(expected).not.toContain('\r');
    expect(expected.endsWith('\n')).toBe(true);
    expect(result.assets.map((entry) => entry.key)).toEqual(['installer', 'portable']);
    expect(fs.readdirSync(outputDir).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('does not include an unselected same-version artifact', async () => {
    fs.writeFileSync(artifactPath('installer'), 'abc');
    fs.writeFileSync(artifactPath('portable'), '');

    const result = await releaseAssets.writeChecksumManifest({
      version: '3.0.0',
      targetName: 'portable',
      outputDir
    });

    expect(result.contents).toBe(
      `${PORTABLE_SHA256}  Multi-Git-Client-Portable-3.0.0.exe\n`
    );
    expect(result.contents).not.toContain('Setup');
  });

  it('fails on a missing selected artifact without replacing the previous manifest', async () => {
    fs.writeFileSync(artifactPath('installer'), 'abc');
    const checksumPath = path.join(outputDir, releaseAssets.CHECKSUM_BASENAME);
    fs.writeFileSync(checksumPath, 'previous manifest\n');

    await expect(
      releaseAssets.writeChecksumManifest({ version: '3.0.0', targetName: 'both', outputDir })
    ).rejects.toThrow('Multi-Git-Client-Portable-3.0.0.exe');

    expect(fs.readFileSync(checksumPath, 'utf8')).toBe('previous manifest\n');
    expect(fs.readdirSync(outputDir).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('fails when an expected artifact path is not a regular file', async () => {
    fs.mkdirSync(artifactPath('installer'));

    await expect(
      releaseAssets.writeChecksumManifest({ version: '3.0.0', targetName: 'installer', outputDir })
    ).rejects.toThrow('Expected release artifact is not a file');
  });
});

describe('GitHub release upload arguments', () => {
  it('targets an existing version tag and attaches display labels without clobbering', () => {
    const args = releaseAssets.buildGhUploadArgs({
      tag: 'Release_v3.0.0',
      version: '3.0.0',
      outputDir,
      repo: 'AnthonyKopri/multi-git'
    });

    expect(args).toEqual([
      'release',
      'upload',
      'Release_v3.0.0',
      `${artifactPath('installer')}#Windows installer (recommended)`,
      `${artifactPath('portable')}#Portable Windows executable`,
      `${path.join(outputDir, 'SHA256SUMS.txt')}#SHA-256 checksums`,
      '--repo',
      'AnthonyKopri/multi-git'
    ]);
    expect(args).not.toContain('--clobber');
  });

  it('rejects an empty repository override', () => {
    expect(() =>
      releaseAssets.buildGhUploadArgs({
        tag: 'Release_v3.0.0',
        version: '3.0.0',
        outputDir,
        repo: '  '
      })
    ).toThrow('GitHub repository must be a non-empty');
  });

  it('requires the existing release tag instead of creating or guessing one', () => {
    expect(() =>
      releaseAssets.buildGhUploadArgs({
        tag: '',
        version: '3.0.0',
        outputDir
      })
    ).toThrow('GitHub release tag must be a non-empty');
  });
});
