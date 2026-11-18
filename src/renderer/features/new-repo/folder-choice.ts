// Where a new repository goes: a parent folder, and a name for the folder made
// inside it. Pure, so it can be tested without a page.

/**
 * Characters no folder name may hold on Windows, which is the strictest of the
 * three systems. A name that works there works everywhere, so a repository
 * made on a Mac can still be cloned by a teammate on Windows.
 */
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/;

/** Names Windows keeps for devices, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Why a repository name cannot be used, or null when it can. */
export function repoNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!name) {
    return 'Give the repository a name.';
  }
  if (name === '.' || name === '..') {
    return 'A folder cannot be called "." or "..".';
  }
  if (FORBIDDEN.test(name)) {
    return 'A folder name cannot contain < > : " / \\ | ? or *.';
  }
  if (/[. ]$/.test(name)) {
    return 'A folder name cannot end with a dot or a space.';
  }
  if (RESERVED.test(name)) {
    return `"${name}" is a name Windows keeps for itself.`;
  }
  return null;
}

/**
 * The new repository's folder: the name, inside the parent.
 *
 * Joined with whichever separator the parent already uses, so a Windows path
 * stays a Windows path. A trailing separator on the parent is not doubled.
 */
export function joinRepoPath(parent: string, name: string): string {
  const base = parent.trim();
  const leaf = name.trim();
  if (!base) {
    return leaf;
  }
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  // A drive or filesystem root keeps its one separator.
  if (/^[a-zA-Z]:[\\/]?$/.test(base) || base === '/') {
    return base.replace(/[\\/]?$/, separator) + leaf;
  }
  return base.replace(/[\\/]+$/, '') + separator + leaf;
}
