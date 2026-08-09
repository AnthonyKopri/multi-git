// The browser-tab equivalent of a window key.
//
// Pure and separate so it can be tested without a DOM. The rule it has to keep
// is the same one the main process registry keeps: two spellings of one folder
// must produce one name, or "open in a new window" opens a second tab that
// fights the first over the same index lock.

/**
 * A stable `window.open` target name for a repository path.
 *
 * Case is folded and separators normalised for the same reason the server's
 * canonical key does it — `D:\Work\App` and `d:/work/app` are one folder. A
 * trailing separator is dropped so `…\app\` and `…\app` agree.
 *
 * Deliberately not the path itself: a window name may not contain whitespace
 * in some browsers, and the value is visible in `window.name`, so it is
 * reduced to characters that are safe to put there.
 */
export function canonicalWindowName(repoPath: string): string {
  const normalized = repoPath
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();

  // Not a hash: a readable name is far easier to recognise in a browser's
  // window list, and collisions between two different folders are prevented by
  // keeping every distinguishing character rather than by the escaping.
  return `multi-git-${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}
