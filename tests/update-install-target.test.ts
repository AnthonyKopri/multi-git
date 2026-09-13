import { describe, expect, it } from 'vitest';

import {
  DPKG_FILE_LIST,
  appImageFile,
  detectInstallKind,
  installCommand,
  portableDirectory
} from '../src/main/update/install-target';
import type { InstallEnvironment } from '../src/main/update/install-target';

function environment(overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return { platform: 'win32', isPackaged: true, env: {}, ...overrides };
}

/** A Linux machine on which exactly these paths exist. */
function linux(paths: string[], overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return environment({
    platform: 'linux',
    execPath: '/opt/Multi-Git Client/multi-git',
    exists: (filePath) => paths.includes(filePath),
    ...overrides
  });
}

/** What the AppImage runtime sets up for the app it starts. */
const RUNNING_APPIMAGE: Partial<InstallEnvironment> = {
  env: {
    APPIMAGE: '/home/ada/Apps/Multi-Git-Client-Linux-5.0.0-x86_64.AppImage',
    APPDIR: '/tmp/.mount_MultiGabc123'
  },
  execPath: '/tmp/.mount_MultiGabc123/multi-git'
};

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

  it('treats a packaged Mac build as one updated from the release page', () => {
    // Whatever the environment says: the portable variable means nothing there.
    const env = environment({ platform: 'darwin', env: { PORTABLE_EXECUTABLE_DIR: '/tmp/x' } });
    expect(detectInstallKind(env)).toBe('macos');
    expect(detectInstallKind(environment({ platform: 'darwin', isPackaged: false }))).toBe('unsupported');
  });

  it('ignores a blank variable rather than treating it as a directory', () => {
    expect(detectInstallKind(environment({ env: { PORTABLE_EXECUTABLE_DIR: '   ' } }))).toBe(
      'installer'
    );
  });
});

describe('detecting how a Linux copy was installed', () => {
  it('recognises the AppImage the runtime started, and the file it runs from', () => {
    const env = linux([], RUNNING_APPIMAGE);

    expect(detectInstallKind(env)).toBe('appimage');
    expect(appImageFile(env)).toBe('/home/ada/Apps/Multi-Git-Client-Linux-5.0.0-x86_64.AppImage');
  });

  it('prefers the AppImage over a package that is also installed', () => {
    expect(detectInstallKind(linux([DPKG_FILE_LIST, '/var/lib/rpm'], RUNNING_APPIMAGE))).toBe('appimage');
  });

  it('does not take an APPIMAGE inherited from another AppImage for this one', () => {
    // A terminal opened from a running AppImage passes its variables on to
    // whatever is started from it, including the .deb copy of this app.
    const inherited = linux([DPKG_FILE_LIST], {
      env: RUNNING_APPIMAGE.env!,
      execPath: '/opt/Multi-Git Client/multi-git'
    });

    expect(appImageFile(inherited)).toBeNull();
    expect(detectInstallKind(inherited)).toBe('deb');
  });

  it('refuses an AppImage path it cannot place', () => {
    const relative = linux([], {
      ...RUNNING_APPIMAGE,
      env: { ...RUNNING_APPIMAGE.env, APPIMAGE: 'Multi-Git.AppImage' }
    });
    const escaping = linux([], { ...RUNNING_APPIMAGE, execPath: '/tmp/.mount_MultiGabc123/../elsewhere/multi-git' });
    const noMount = linux([], { ...RUNNING_APPIMAGE, env: { APPIMAGE: RUNNING_APPIMAGE.env!['APPIMAGE'] } });

    for (const env of [relative, escaping, noMount]) {
      expect(appImageFile(env)).toBeNull();
      expect(detectInstallKind(env)).toBe('unsupported');
    }
  });

  it('recognises a .deb by the file list dpkg keeps for the installed package', () => {
    expect(DPKG_FILE_LIST).toBe('/var/lib/dpkg/info/multi-git.list');
    expect(detectInstallKind(linux([DPKG_FILE_LIST]))).toBe('deb');
    // Checked before rpm, which a Debian machine may have installed as a tool.
    expect(detectInstallKind(linux([DPKG_FILE_LIST, '/var/lib/rpm']))).toBe('deb');
  });

  it('takes a copy on an rpm-based system, in either database location, to be the .rpm', () => {
    expect(detectInstallKind(linux(['/var/lib/rpm']))).toBe('rpm');
    expect(detectInstallKind(linux(['/usr/lib/sysimage/rpm']))).toBe('rpm');
  });

  it('offers nothing to a copy that matches no published build', () => {
    expect(detectInstallKind(linux([]))).toBe('unsupported');
    // Without a way to look, no package is assumed.
    expect(detectInstallKind(environment({ platform: 'linux' }))).toBe('unsupported');
  });

  it('updates nothing from a checkout, whatever the environment says', () => {
    const unpackaged = linux([DPKG_FILE_LIST], { ...RUNNING_APPIMAGE, isPackaged: false });

    expect(detectInstallKind(unpackaged)).toBe('unsupported');
    expect(appImageFile(unpackaged)).toBeNull();
  });

  it('never reads an AppImage variable on another platform', () => {
    expect(appImageFile(environment({ ...RUNNING_APPIMAGE, platform: 'win32' }))).toBeNull();
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

  it('starts the AppImage that has replaced the running one', () => {
    expect(installCommand('appimage', '/home/ada/Apps/Multi-Git.AppImage')).toEqual({
      file: '/home/ada/Apps/Multi-Git.AppImage',
      args: []
    });
  });

  it('refuses to build a command for a build that cannot update', () => {
    expect(() => installCommand('unsupported', 'C:\\x.exe')).toThrow(/does not install updates/);
    expect(() => installCommand('macos', '/tmp/x.dmg')).toThrow(/does not install updates/);
    expect(() => installCommand('deb', '/tmp/x.deb')).toThrow(/does not install updates/);
    expect(() => installCommand('rpm', '/tmp/x.rpm')).toThrow(/does not install updates/);
  });
});
