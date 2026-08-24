import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface ReleaseTarget {
  label: string;
  args: string[];
  platform: 'win32' | 'darwin';
  arch?: 'arm64' | 'x64';
}

interface ReleaseApi {
  parseArgs(argv: string[]): {
    bump: string | null;
    target: string | null;
    yes: boolean;
    dryRun: boolean;
  };
  TARGETS: Record<string, ReleaseTarget>;
}

const require = createRequire(import.meta.url);
const release = require('../scripts/release.js') as ReleaseApi;

describe('native release targets', () => {
  it('maps Apple Silicon and Intel releases to native DMG and ZIP builds', () => {
    expect(release.TARGETS['mac-arm64']).toMatchObject({
      args: ['--mac', 'dmg', 'zip', '--arm64'],
      platform: 'darwin',
      arch: 'arm64'
    });
    expect(release.TARGETS['mac-x64']).toMatchObject({
      args: ['--mac', 'dmg', 'zip', '--x64'],
      platform: 'darwin',
      arch: 'x64'
    });
  });

  it('parses explicit macOS targets and refuses swallowed values', () => {
    expect(release.parseArgs(['--bump=none', '--target', 'mac-arm64', '--yes'])).toMatchObject({
      bump: 'none',
      target: 'mac-arm64',
      yes: true
    });
    expect(() => release.parseArgs(['--target', '--yes'])).toThrow('--target requires a value');
    expect(() => release.parseArgs(['--bump='])).toThrow('--bump requires a value');
  });
});
