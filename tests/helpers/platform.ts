// Running a test as though the host were another platform.
//
// The Windows-only paths -- the console bridge a visible launch needs, the
// registry PATH re-read that lets a freshly installed tool be found -- would
// otherwise be exercised only on a Windows runner, which is the minority of
// them. The behaviour is decided by `process.platform` and nothing else, so
// stating it is enough to cover the branch everywhere.

/** Runs `body` with `process.platform` reporting `platform`. */
export async function withPlatform<T>(
  platform: NodeJS.Platform,
  body: () => Promise<T>
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });

  try {
    return await body();
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  }
}
