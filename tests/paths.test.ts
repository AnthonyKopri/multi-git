import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveInsideRepo } from '../src/server/fs/paths';

let workspace: string;
let repo: string;
let outside: string;

/**
 * Creating a *file* symlink on Windows needs Developer Mode or elevation,
 * while directory junctions work unprivileged. Cases that cannot run report a
 * skip rather than passing silently, so an environment that quietly stops
 * exercising the containment check is visible in the test output.
 *
 * The directory-junction cases run everywhere, and they are the ones that
 * cover the escape: without the realpath check, `docs/id_ed25519` through a
 * junction resolves to a private key outside the repository.
 */
function trySymlink(target: string, linkPath: string, type: 'file' | 'dir'): boolean {
  try {
    fs.symlinkSync(target, linkPath, type === 'dir' ? 'junction' : 'file');
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-paths-')));
  repo = path.join(workspace, 'repo');
  outside = path.join(workspace, 'outside');

  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo', 'utf8');
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export {};', 'utf8');
  fs.writeFileSync(path.join(outside, 'id_ed25519'), 'PRIVATE KEY', 'utf8');
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('resolveInsideRepo', () => {
  it('resolves a file inside the repository', () => {
    expect(resolveInsideRepo(repo, 'README.md')).toBe(path.join(repo, 'README.md'));
    expect(resolveInsideRepo(repo, 'src/app.ts')).toBe(path.join(repo, 'src', 'app.ts'));
  });

  it('normalises redundant segments that stay inside', () => {
    expect(resolveInsideRepo(repo, './src/../README.md')).toBe(path.join(repo, 'README.md'));
  });

  it('rejects parent-directory traversal', () => {
    expect(resolveInsideRepo(repo, '../outside/id_ed25519')).toBeNull();
    expect(resolveInsideRepo(repo, '../../etc/passwd')).toBeNull();
    expect(resolveInsideRepo(repo, 'src/../../outside/id_ed25519')).toBeNull();
  });

  it('rejects an absolute path', () => {
    expect(resolveInsideRepo(repo, path.join(outside, 'id_ed25519'))).toBeNull();
  });

  it('rejects the repository root itself', () => {
    expect(resolveInsideRepo(repo, '.')).toBeNull();
    expect(resolveInsideRepo(repo, '')).toBeNull();
  });

  it('rejects a file that does not exist unless allowMissing is set', () => {
    expect(resolveInsideRepo(repo, 'not-here.txt')).toBeNull();
    expect(resolveInsideRepo(repo, 'not-here.txt', { allowMissing: true })).toBe(
      path.join(repo, 'not-here.txt')
    );
  });

  it('allows creating a file in a directory that does not exist yet', () => {
    expect(resolveInsideRepo(repo, 'new/deep/file.txt', { allowMissing: true })).toBe(
      path.join(repo, 'new', 'deep', 'file.txt')
    );
  });

  it('rejects a symlinked file pointing outside the repository', (ctx) => {
    const link = path.join(repo, 'innocent.txt');
    if (!trySymlink(path.join(outside, 'id_ed25519'), link, 'file')) {
      ctx.skip('symlink creation is unavailable in this environment');
      return;
    }

    // Lexically this is just "innocent.txt" inside the repo. Only resolving
    // the symlink reveals that reading it would leak a private key.
    expect(resolveInsideRepo(repo, 'innocent.txt')).toBeNull();
  });

  it('rejects a path underneath a symlinked directory pointing outside', (ctx) => {
    const link = path.join(repo, 'docs');
    if (!trySymlink(outside, link, 'dir')) {
      ctx.skip('symlink creation is unavailable in this environment');
      return;
    }

    expect(resolveInsideRepo(repo, 'docs/id_ed25519')).toBeNull();
  });

  it('rejects writing through a symlinked directory pointing outside', (ctx) => {
    const link = path.join(repo, 'docs');
    if (!trySymlink(outside, link, 'dir')) {
      ctx.skip('symlink creation is unavailable in this environment');
      return;
    }

    expect(resolveInsideRepo(repo, 'docs/new-file.txt', { allowMissing: true })).toBeNull();
  });

  it('accepts a symlink that stays inside the repository', (ctx) => {
    const link = path.join(repo, 'alias.md');
    if (!trySymlink(path.join(repo, 'README.md'), link, 'file')) {
      ctx.skip('symlink creation is unavailable in this environment');
      return;
    }

    expect(resolveInsideRepo(repo, 'alias.md')).toBe(link);
  });

  it('returns null for an unreadable repository root', () => {
    expect(resolveInsideRepo(path.join(workspace, 'no-such-repo'), 'README.md')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(resolveInsideRepo(repo, null as unknown as string)).toBeNull();
    expect(resolveInsideRepo(null as unknown as string, 'README.md')).toBeNull();
  });
});
