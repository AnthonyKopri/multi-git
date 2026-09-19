import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar';
import { cleanupRepos, createTempDir } from './helpers/temp-repo';

const { extractArchive, safeEntry, writeZip } = require('../scripts/terminal-package.cjs') as {
  extractArchive(file: string, destination: string, select?: (name: string) => boolean): Promise<void>;
  safeEntry(name: string): string;
  writeZip(source: string, file: string): void;
};
afterEach(cleanupRepos);

function archive(entries: { path: string; type: 'File' | 'SymbolicLink'; text: string }[]): string {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.type === 'File' ? entry.text : '');
    const header = new Header({ path: entry.path, type: entry.type, size: data.length, mode: 0o755,
      ...(entry.type === 'SymbolicLink' ? { linkpath: entry.text } : {}) });
    header.encode();
    chunks.push(header.block!, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  const file = path.join(createTempDir('terminal-archive-'), 'payload.tar.gz');
  fs.writeFileSync(file, gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)])));
  return file;
}

describe('terminal package extraction', () => {
  it('extracts the selected Node runtime without accepting unrelated npm symlinks', async () => {
    const file = archive([{ path: 'node/bin/node', type: 'File', text: 'runtime' }, { path: 'node/bin/npm', type: 'SymbolicLink', text: '../lib/npm.js' }]);
    const target = createTempDir('terminal-extracted-');
    await extractArchive(file, target, (name) => name === 'node/bin/node');
    expect(fs.readFileSync(path.join(target, 'node/bin/node'), 'utf8')).toBe('runtime');
    expect(fs.existsSync(path.join(target, 'node/bin/npm'))).toBe(false);
  });
  it('refuses selected links, traversal, device names, aliases and duplicates', async () => {
    for (const name of ['../outside', '/outside', 'C:/outside', 'folder\\outside', 'nul.txt', 'folder/file.', 'file:stream']) {
      expect(() => safeEntry(name)).toThrow('Unsafe');
    }
    await expect(extractArchive(archive([{ path: 'link', type: 'SymbolicLink', text: '../outside' }]), createTempDir('terminal-link-'))).rejects.toThrow('Links');
    await expect(extractArchive(archive([{ path: 'file', type: 'File', text: 'one' }, { path: 'FILE', type: 'File', text: 'two' }]), createTempDir('terminal-duplicate-'))).rejects.toThrow('Duplicate');
  });
  it('round-trips ZIP Unicode paths and refuses nonempty extraction destinations', async () => {
    const source = createTempDir('terminal-zip-');
    fs.writeFileSync(path.join(source, 'Türkçe 文件.txt'), 'payload');
    const zip = path.join(createTempDir('terminal-zip-output-'), 'package.zip');
    writeZip(source, zip);
    const destination = createTempDir('terminal-unzip-');
    await extractArchive(zip, destination);
    expect(fs.readFileSync(path.join(destination, 'Türkçe 文件.txt'), 'utf8')).toBe('payload');
    await expect(extractArchive(zip, destination)).rejects.toThrow('empty destination');
  });
});
