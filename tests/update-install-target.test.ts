import { describe, expect, it } from 'vitest';

import {
  detectInstallKind,
  installCommand,
  portableDirectory
} from '../src/main/update/install-target';
import type { InstallEnvironment } from '../src/main/update/install-target';

function environment(overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return { platform: 'win32', isPackaged: true, env: {}, ...overrides };
}

describe('detecting how this copy was installed', () => {
  it('reads the variable electron-builder’s portable target sets', () => {
    const env = environment({ env: { PORTABLE_EXECUTABLE_DIR: 'D:\\Tools\\MultiGit' } });
    expect(detectInstallKind(env)).toBe('portable');
    expect(portableDirectory(env)).toBe('D:\\Tools\\MultiGit');
  });

  it('treats a packaged Windows build without that variable as installed', () => {
    expect(detectInstallKind(environment())).toBe('installer');
    expect(portableDirectory(environment())).toBeNull();
  });

  it('updates nothing when run from a checkout', () => {
    expect(detectInstallKind(environment({ isPackaged: false }))).toBe('unsupported');
  });

  it('updates nothing off Windows, whatever the environment says', () => {
    for (const platform of ['darwin', 'linux']) {
      const env = environment({ platform, env: { PORTABLE_EXECUTABLE_DIR: '/tmp/x' } });
      expect(detectInstallKind(env)).toBe('unsupported');
    }
  });

  it('ignores a blank variable rather than treating it as a directory', () => {
    expect(detectInstallKind(environment({ env: { PORTABLE_EXECUTABLE_DIR: '   ' } }))).toBe(
      'installer'
    );
  });
});

describe('starting the downloaded file', () => {
  it('runs the NSIS installer silently and asks it to relaunch the app', () => {
    expect(installCommand('installer', 'C:\\tmp\\Setup.exe')).toEqual({
      file: 'C:\\tmp\\Setup.exe',
      args: ['/S', '--force-run']
    });
  });

  it('just opens the new portable executable', () => {
    expect(installCommand('portable', 'D:\\Tools\\New.exe')).toEqual({
      file: 'D:\\Tools\\New.exe',
      args: []
    });
  });

  it('refuses to build a command for a build that cannot update', () => {
    expect(() => installCommand('unsupported', 'C:\\x.exe')).toThrow(/does not install updates/);
  });
});
