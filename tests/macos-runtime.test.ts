import { describe, expect, it } from 'vitest';
import path from 'node:path';

import {
  bootstrapMacOSPath,
  macExecutableDirectories,
  macExecutablePath
} from '../src/main/macos-environment';
import { ExternalRepoOpenQueue, repoPathFromCommandLine } from '../src/main/external-open';
import { macApplicationMenuTemplate } from '../src/main/application-menu';

describe('macOS Finder-launch PATH repair', () => {
  it('prepends existing Homebrew and user tool locations to the launchd PATH', () => {
    const existing = new Set([
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/Users/jane/.local/bin',
      '/Users/jane/.volta/bin'
    ]);

    expect(
      macExecutablePath({
        platform: 'darwin',
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        homeDirectory: '/Users/jane',
        isDirectory: (candidate) => existing.has(candidate)
      })
    ).toBe(
      '/opt/homebrew/bin:/usr/local/bin:/Users/jane/.local/bin:/Users/jane/.volta/bin:' +
        '/usr/bin:/bin:/usr/sbin:/sbin'
    );
  });

  it('does not duplicate or reorder entries the process already inherited', () => {
    expect(
      macExecutablePath({
        platform: 'darwin',
        env: { PATH: '/custom/bin:/opt/homebrew/bin:/usr/bin' },
        homeDirectory: '/Users/jane',
        isDirectory: (candidate) => candidate === '/opt/homebrew/bin'
      })
    ).toBe('/opt/homebrew/bin:/custom/bin:/usr/bin');
  });

  it('uses POSIX home paths even when the test itself runs on Windows', () => {
    expect(macExecutableDirectories('/Users/Jane Doe')).toContain('/Users/Jane Doe/.local/bin');
  });

  it('leaves other platforms untouched', () => {
    const env = { PATH: 'C:\\Tools;C:\\Windows' };
    expect(
      bootstrapMacOSPath({
        platform: 'win32',
        env,
        homeDirectory: '/irrelevant',
        isDirectory: () => true
      })
    ).toBe(env.PATH);
    expect(env.PATH).toBe('C:\\Tools;C:\\Windows');
  });
});

describe('operating-system repository open requests', () => {
  const resolve = (candidate: string): string => {
    if (!candidate.includes('repo')) {
      throw new Error('not a repository');
    }
    return candidate.replace(/\\/g, '/');
  };

  it('reads a packaged Explorer/Finder path without treating the executable as one', () => {
    expect(
      repoPathFromCommandLine(
        ['/Applications/Multi-Git.app/Contents/MacOS/Multi-Git', '/Users/jane/my repo'],
        true,
        resolve
      )
    ).toBe('/Users/jane/my repo');
  });

  it('skips both Electron and the source app argument in development', () => {
    expect(repoPathFromCommandLine(['/usr/bin/electron', '.', '/Users/jane/repo'], false, resolve)).toBe(
      '/Users/jane/repo'
    );
    expect(repoPathFromCommandLine(['/usr/bin/electron', '.'], false, () => '/wrong')).toBeNull();
  });

  it('resolves a relative second-instance argument from that instance working directory', () => {
    const resolved: string[] = [];
    const workingDirectory =
      process.platform === 'win32' ? 'C:\\Users\\jane\\work' : '/Users/jane/work';
    const found = repoPathFromCommandLine(
      ['Multi-Git', 'repo'],
      true,
      (candidate) => {
        resolved.push(candidate);
        return candidate;
      },
      workingDirectory
    );

    expect(found).toBe(path.resolve(workingDirectory, 'repo'));
    expect(resolved).toEqual([path.resolve(workingDirectory, 'repo')]);
  });

  it('queues an early macOS open-file event until the window registry exists', () => {
    const queue = new ExternalRepoOpenQueue(resolve);
    const opened: string[] = [];

    expect(queue.enqueue('/Users/jane/repo')).toBe(true);
    expect(opened).toEqual([]);
    expect(queue.attach((repoPath) => opened.push(repoPath))).toBe(1);
    expect(opened).toEqual(['/Users/jane/repo']);

    queue.enqueue('/Users/jane/other-repo');
    expect(opened).toEqual(['/Users/jane/repo', '/Users/jane/other-repo']);
  });

  it('drops invalid requests and de-duplicates queued ones', () => {
    const queue = new ExternalRepoOpenQueue(resolve);
    const opened: string[] = [];

    expect(queue.enqueue('/tmp/not-a-project')).toBe(false);
    queue.enqueue('/Users/jane/repo');
    queue.enqueue('/Users/jane/repo');
    expect(queue.attach((repoPath) => opened.push(repoPath))).toBe(1);
    expect(opened).toEqual(['/Users/jane/repo']);
  });
});

describe('native macOS application menu', () => {
  it('provides standard app, text-editing, window, and quit roles', () => {
    const template = macApplicationMenuTemplate('Multi-Git Client');
    const roles = template.flatMap((item) =>
      Array.isArray(item.submenu)
        ? item.submenu.flatMap((child) => (child.role === undefined ? [] : [child.role]))
        : []
    );

    expect(template.map((item) => item.label)).toEqual([
      'Multi-Git Client',
      'File',
      'Edit',
      'View',
      'Window'
    ]);
    expect(roles).toEqual(
      expect.arrayContaining(['about', 'services', 'quit', 'undo', 'copy', 'paste', 'selectAll', 'minimize'])
    );
  });
});
