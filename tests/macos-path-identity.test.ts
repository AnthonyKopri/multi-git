import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalWindowName } from '../src/renderer/features/windows/name';
import {
  legacyRepoTrashDir,
  listTrash,
  repoTrashDir,
  writeRepoTrashIndex,
  writeTrashIndex
} from '../src/server/safety-net/trash';

describe('repository identity on case-sensitive and Unicode filesystems', () => {
  it('does not give distinct Unicode repository names the same browser-window target', () => {
    expect(canonicalWindowName('/Users/jane/Projects/项目')).not.toBe(
      canonicalWindowName('/Users/jane/Projects/资料')
    );
  });

  it.runIf(process.platform !== 'win32')(
    'does not merge case-distinct POSIX repositories into one browser-window target',
    () => {
      expect(canonicalWindowName('/Users/jane/Projects/App')).not.toBe(
        canonicalWindowName('/Users/jane/Projects/app')
      );
    }
  );

  it.runIf(process.platform !== 'win32')(
    'does not merge case-distinct POSIX repositories into one Safety Net directory',
    () => {
      expect(repoTrashDir('/Users/jane/Projects/App')).not.toBe(
        repoTrashDir('/Users/jane/Projects/app')
      );
    }
  );

  it.runIf(process.platform !== 'win32')(
    'keeps pre-parity Safety Net snapshots visible through their remaining TTL',
    () => {
      const repo = path.join('/tmp', `Multi-Git-Legacy-${process.pid}-${Date.now()}`);
      const currentDir = repoTrashDir(repo);
      const legacyDir = legacyRepoTrashDir(repo);
      const trashFile = path.join(legacyDir, 'legacy.bin');
      const entry = {
        id: 'legacy-entry',
        path: 'src/app.txt',
        savedAt: Date.now(),
        trashFile
      };

      expect(currentDir).not.toBe(legacyDir);
      try {
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(trashFile, 'recover me');
        writeTrashIndex(legacyDir, [entry]);

        expect(listTrash(repo)).toEqual([entry]);
        writeRepoTrashIndex(repo, []);
        expect(listTrash(repo)).toEqual([]);
      } finally {
        fs.rmSync(currentDir, { recursive: true, force: true });
        fs.rmSync(legacyDir, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform !== 'win32')(
    'does not assign one legacy Safety Net bucket to case-colliding repositories',
    () => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-case-trash-'));
      const upper = path.join(parent, 'App');
      const lower = path.join(parent, 'app');
      fs.mkdirSync(upper);
      fs.mkdirSync(lower, { recursive: true });

      // Default APFS is case-insensitive. Linux and case-sensitive APFS can
      // represent both names and exercise the ambiguity this regression owns.
      const names = fs
        .readdirSync(parent)
        .filter((name) => name.toLowerCase() === 'app');
      if (new Set(names).size < 2) {
        fs.rmSync(parent, { recursive: true, force: true });
        return;
      }

      const legacyDir = legacyRepoTrashDir(upper);
      const trashFile = path.join(legacyDir, 'shared-legacy.bin');
      const entry = {
        id: 'shared-legacy',
        path: 'src/app.txt',
        savedAt: Date.now(),
        trashFile
      };

      expect(legacyDir).toBe(legacyRepoTrashDir(lower));
      expect(repoTrashDir(upper)).not.toBe(legacyDir);
      expect(repoTrashDir(lower)).not.toBe(legacyDir);
      try {
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(trashFile, 'belongs to an unknown case variant');
        writeTrashIndex(legacyDir, [entry]);

        expect(listTrash(upper)).toEqual([]);
        expect(listTrash(lower)).toEqual([]);
        expect(fs.existsSync(trashFile)).toBe(true);
      } finally {
        fs.rmSync(repoTrashDir(upper), { recursive: true, force: true });
        fs.rmSync(repoTrashDir(lower), { recursive: true, force: true });
        fs.rmSync(legacyDir, { recursive: true, force: true });
        fs.rmSync(parent, { recursive: true, force: true });
      }
    }
  );
});
