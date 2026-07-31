// Crash-safe file writes.
//
// The config file holds every SSH profile, account rule, and recent
// repository; the secrets file holds the encrypted passphrases. A plain
// writeFileSync that is interrupted leaves a truncated file and loses all of
// it. Writing to a sibling temp file and renaming makes the swap atomic on
// both POSIX and NTFS, so a reader sees either the old file or the new one.
//
// ssh-config.js already used this pattern for ~/.ssh/config. This is that
// approach lifted into one place so every sensitive write shares it.
import fs from 'node:fs';
import path from 'node:path';

export interface AtomicWriteOptions {
  /** File mode for the created file. Use 0o600 for anything secret. */
  mode?: number;
}

export function writeFileAtomic(
  filePath: string,
  contents: string,
  options: AtomicWriteOptions = {}
): void {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.tmp-${process.pid}`);

  const writeOptions: fs.WriteFileOptions = { encoding: 'utf8' };
  if (options.mode !== undefined) {
    writeOptions.mode = options.mode;
  }

  try {
    fs.writeFileSync(tempPath, contents, writeOptions);
    // rename() replaces the destination atomically.
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Leaving a temp file behind is not worth masking the original error.
    }
    throw error;
  }
}

export function writeJsonAtomic(
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions = {}
): void {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}
