// Reading a file's bytes at a particular version, for the things a unified
// diff cannot show: what an image looked like before and after, and how big a
// binary actually got.
import fs from 'node:fs';

import { pathArg } from './args';
import { runGitCommand, tryGitCommand } from './run';
import { resolveInsideRepo } from '../fs/paths';
import type { DiffSource } from '../../shared/diff-types';

/** Images this will hand back as a data URI. Anything else is a download. */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml'
};

/**
 * 8 MiB. A data URI is base64, so the payload is a third larger again, and it
 * all has to survive a JSON round trip into the renderer.
 */
export const MAX_BLOB_BYTES = 8 * 1024 * 1024;

export function imageMimeType(filePath: string): string | null {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_TYPES[extension] ?? null;
}

/** Which side of the comparison a blob comes from. */
export type BlobSide = 'old' | 'new';

export interface BlobResult {
  /** Null when this side has no version of the file — an add, or a delete. */
  dataUri: string | null;
  sizeBytes: number;
  mimeType: string | null;
  exists: boolean;
}

/**
 * Where each side lives.
 *
 * The old side of a working-tree diff is the index, not HEAD: that is what the
 * diff was taken against, and showing HEAD would be a picture of a different
 * comparison.
 */
function revisionFor(source: DiffSource, side: BlobSide, filePath: string): string | null {
  if (side === 'new') {
    // The new side of a working-tree diff is the file on disk.
    return source === 'index' ? `:${filePath}` : null;
  }

  return source === 'index' ? `HEAD:${filePath}` : `:${filePath}`;
}

async function readFromGit(
  repoPath: string,
  revision: string
): Promise<{ buffer: Buffer; size: number } | null> {
  // Ask for the size first: reading a 400 MB blob into memory to discover it
  // is too big is the mistake this avoids.
  const sized = await tryGitCommand(repoPath, ['cat-file', '-s', revision]);
  const size = Number.parseInt(sized?.stdout.trim() ?? '', 10);

  if (!Number.isFinite(size)) {
    return null;
  }
  if (size > MAX_BLOB_BYTES) {
    return { buffer: Buffer.alloc(0), size };
  }

  // Decoding as text would replace every invalid UTF-8 sequence, which for an
  // image means the bytes that come back are not the file any more.
  const blob = await runGitCommand(repoPath, ['cat-file', 'blob', revision], null, {
    binaryStdout: true
  });
  return { buffer: blob.stdoutBuffer ?? Buffer.alloc(0), size };
}

/**
 * One side of a file comparison.
 *
 * The working-tree side is read from the filesystem and a committed side from
 * git, both as bytes. A size that exceeds the cap comes back with the size and
 * no content, so the UI can say how big it is rather than showing nothing.
 */
export async function readBlobSide(
  repoPath: string,
  rawPath: unknown,
  source: DiffSource,
  side: BlobSide
): Promise<BlobResult> {
  const filePath = pathArg(rawPath);
  const mimeType = imageMimeType(filePath);
  const revision = revisionFor(source, side, filePath);

  if (revision === null) {
    // The working tree, read as bytes.
    const fullPath = resolveInsideRepo(repoPath, filePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      return { dataUri: null, sizeBytes: 0, mimeType, exists: false };
    }

    const size = fs.statSync(fullPath).size;
    if (size > MAX_BLOB_BYTES || mimeType === null) {
      return { dataUri: null, sizeBytes: size, mimeType, exists: true };
    }

    const buffer = fs.readFileSync(fullPath);
    return {
      dataUri: `data:${mimeType};base64,${buffer.toString('base64')}`,
      sizeBytes: size,
      mimeType,
      exists: true
    };
  }

  const blob = await readFromGit(repoPath, revision);
  if (blob === null) {
    return { dataUri: null, sizeBytes: 0, mimeType, exists: false };
  }

  if (blob.size > MAX_BLOB_BYTES || mimeType === null) {
    return { dataUri: null, sizeBytes: blob.size, mimeType, exists: true };
  }

  return {
    dataUri: `data:${mimeType};base64,${blob.buffer.toString('base64')}`,
    sizeBytes: blob.size,
    mimeType,
    exists: true
  };
}

export interface BinaryComparison {
  filePath: string;
  source: DiffSource;
  /** Set when the extension is one this can render. */
  isImage: boolean;
  old: BlobResult;
  new: BlobResult;
  /** Positive when the file grew. */
  sizeDelta: number;
}

/** Both sides at once, which is what an image or binary view needs. */
export async function compareBlobs(
  repoPath: string,
  rawPath: unknown,
  source: DiffSource
): Promise<BinaryComparison> {
  const filePath = pathArg(rawPath);

  const [before, after] = await Promise.all([
    readBlobSide(repoPath, filePath, source, 'old'),
    readBlobSide(repoPath, filePath, source, 'new')
  ]);

  return {
    filePath,
    source,
    isImage: imageMimeType(filePath) !== null,
    old: before,
    new: after,
    sizeDelta: after.sizeBytes - before.sizeBytes
  };
}
