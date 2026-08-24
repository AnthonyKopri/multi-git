// The browser-tab equivalent of a window key.
//
// Pure and separate so it can be tested without a DOM. The rule it has to keep
// is the same one the main process registry keeps: two spellings of one folder
// must produce one name, or "open in a new window" opens a second tab that
// fights the first over the same index lock.

/**
 * A stable `window.open` target name for a repository path.
 *
 * Windows paths are case-folded and have both separator spellings normalised,
 * for the same reason the server's canonical key does it — `D:\Work\App` and
 * `d:/work/app` are one folder. POSIX paths keep their case and backslashes:
 * both can distinguish real folders on a case-sensitive APFS volume.
 *
 * Deliberately not the path itself: a window name may not contain whitespace
 * in some browsers, and the value is visible in `window.name`, so it is
 * reduced to characters that are safe to put there.
 */
export function canonicalWindowName(repoPath: string): string {
  const windowsPath = /^[a-z]:[\\/]/i.test(repoPath) || /^\\\\/.test(repoPath);
  const normalized = (windowsPath ? repoPath.replace(/[\\/]+/g, '/') : repoPath.replace(/\/{2,}/g, '/'))
    .replace(/\/+$/, '')
    .normalize('NFC');
  const identity = windowsPath ? normalized.toLowerCase() : normalized;

  // Percent-encoding keeps every distinguishing Unicode code point while also
  // removing whitespace and separators that browsers restrict in target
  // names. The old ASCII slug erased all non-Latin names, so unrelated folders
  // such as 项目 and 资料 both targeted the same tab.
  return `multi-git-${encodeURIComponent(identity)}`;
}
