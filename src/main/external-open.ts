// Repository paths delivered by the operating system rather than the page.
//
// Windows Explorer starts the registered executable with the selected folder
// as an argument. macOS can deliver a Finder-open request before Electron is
// ready. Both must survive until the window registry exists, and every path is
// put through the same repository validator used by renderer IPC.
import path from 'node:path';

export type RepoPathResolver = (rawPath: string) => string;
export type RepoPathOpener = (repoPath: string) => void;

/**
 * Finds the last valid repository argument on an Electron command line.
 *
 * An unpackaged invocation starts `electron .`, so its first two entries are
 * infrastructure rather than user input. Testing every argument there would
 * mistake the source checkout itself for an Explorer/Finder request.
 */
export function repoPathFromCommandLine(
  commandLine: readonly string[],
  isPackaged: boolean,
  resolveRepoPath: RepoPathResolver,
  workingDirectory?: string
): string | null {
  const candidates = commandLine.slice(isPackaged ? 1 : 2);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate === undefined || candidate === '') {
      continue;
    }

    try {
      const fromCaller = workingDirectory && !path.isAbsolute(candidate)
        ? path.resolve(workingDirectory, candidate)
        : candidate;
      return resolveRepoPath(fromCaller);
    } catch {
      // Electron/Chromium flags and unrelated document arguments are not
      // repositories. Keep looking rather than turning OS startup into an
      // error dialog.
    }
  }

  return null;
}

/** Holds early OS open requests until BrowserWindow can service them. */
export class ExternalRepoOpenQueue {
  private readonly pending: string[] = [];
  private opener: RepoPathOpener | null = null;

  constructor(private readonly resolveRepoPath: RepoPathResolver) {}

  /** Validates and either opens or queues one raw path. */
  enqueue(rawPath: string): boolean {
    let resolved: string;
    try {
      resolved = this.resolveRepoPath(rawPath);
    } catch {
      return false;
    }

    if (this.opener) {
      this.opener(resolved);
      return true;
    }

    if (!this.pending.includes(resolved)) {
      this.pending.push(resolved);
    }
    return true;
  }

  enqueueCommandLine(
    commandLine: readonly string[],
    isPackaged: boolean,
    workingDirectory?: string
  ): boolean {
    const repoPath = repoPathFromCommandLine(
      commandLine,
      isPackaged,
      this.resolveRepoPath,
      workingDirectory
    );
    return repoPath === null ? false : this.enqueue(repoPath);
  }

  /** Installs the window opener, drains queued requests, and returns the count. */
  attach(opener: RepoPathOpener): number {
    this.opener = opener;
    const queued = this.pending.splice(0);
    for (const repoPath of queued) {
      opener(repoPath);
    }
    return queued.length;
  }
}
