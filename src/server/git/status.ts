// Parser for `git status --porcelain -b` output.
import type {
  ConflictedFile,
  PorcelainStatus,
  StagedFile,
  StatusCode,
  UnstagedFile
} from '../../shared/git-types';

const ESCAPE_REPLACEMENTS: Record<string, string> = {
  '\\': '\\',
  '"': '"',
  t: '\t',
  n: '\n',
  r: '\r'
};

/**
 * Git quotes paths containing special characters and escapes the contents:
 * `"path \"x\".txt"`. Unquoted paths are returned trimmed.
 */
export function unquoteGitPath(rawPath: string): string {
  const trimmed = rawPath.trim();

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\([\\"tnr])/g, (match, character: string) =>
        Object.prototype.hasOwnProperty.call(ESCAPE_REPLACEMENTS, character)
          ? (ESCAPE_REPLACEMENTS[character] as string)
          : match
      );
  }

  return trimmed;
}

interface BranchHeader {
  branch: string;
  tracking: string;
  ahead: number;
  behind: number;
  detached: boolean;
  noCommits: boolean;
}

/** Parses the `## …` line that `-b` prepends to the porcelain output. */
function parseBranchHeader(header: string): BranchHeader {
  const result: BranchHeader = {
    branch: 'HEAD',
    tracking: '',
    ahead: 0,
    behind: 0,
    detached: false,
    noCommits: false
  };

  // A repository with no commits reports "## No commits yet on main".
  const noCommitsMatch = header.match(/^No commits yet on (.+)$/);
  if (noCommitsMatch?.[1]) {
    result.branch = noCommitsMatch[1];
    result.noCommits = true;
    return result;
  }

  if (header === 'HEAD (no branch)') {
    result.branch = '(detached)';
    result.detached = true;
    return result;
  }

  // "main...origin/main [ahead 1, behind 2]"
  const [localPart, trackingPart] = header.split('...');
  result.branch = localPart || 'HEAD';

  if (trackingPart) {
    result.tracking = trackingPart.split(' ')[0] ?? '';

    const ahead = trackingPart.match(/ahead (\d+)/);
    const behind = trackingPart.match(/behind (\d+)/);
    if (ahead?.[1]) {
      result.ahead = Number.parseInt(ahead[1], 10);
    }
    if (behind?.[1]) {
      result.behind = Number.parseInt(behind[1], 10);
    }
  }

  return result;
}

/**
 * A conflicted entry is any of: an unmerged `U` in either column, both-added
 * (`AA`), or both-deleted (`DD`).
 */
function isConflictPair(index: string, workTree: string): boolean {
  return (
    index === 'U' ||
    workTree === 'U' ||
    (index === 'A' && workTree === 'A') ||
    (index === 'D' && workTree === 'D')
  );
}

export function parsePorcelainStatus(stdout: string): PorcelainStatus {
  const staged: StagedFile[] = [];
  const unstaged: UnstagedFile[] = [];
  const conflicts: ConflictedFile[] = [];

  let header: BranchHeader = {
    branch: 'HEAD',
    tracking: '',
    ahead: 0,
    behind: 0,
    detached: false,
    noCommits: false
  };

  for (const line of stdout.split('\n')) {
    if (!line) {
      continue;
    }

    if (line.startsWith('## ')) {
      header = parseBranchHeader(line.substring(3).trim());
      continue;
    }

    // Every file entry is "XY <path>", so anything shorter is not one.
    if (line.length < 4) {
      continue;
    }

    const indexStatus = line[0] as StatusCode;
    const workTreeStatus = line[1] as StatusCode;

    let filePath = unquoteGitPath(line.substring(3));
    let origPath: string | null = null;

    // Renames and copies are reported as "old -> new"; the new path is the
    // one the user acts on.
    if ((indexStatus === 'R' || indexStatus === 'C') && filePath.includes(' -> ')) {
      const [from, to] = filePath.split(' -> ');
      origPath = unquoteGitPath(from ?? '');
      filePath = unquoteGitPath(to ?? '');
    }

    if (isConflictPair(indexStatus, workTreeStatus)) {
      conflicts.push({ path: filePath, status: `${indexStatus}${workTreeStatus}` });
      continue;
    }

    if (indexStatus !== ' ' && indexStatus !== '?') {
      staged.push({ path: filePath, status: indexStatus, origPath });
    }

    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
      unstaged.push({ path: filePath, status: workTreeStatus });
    } else if (indexStatus === '?') {
      // Untracked files are reported as "??" in both columns.
      unstaged.push({ path: filePath, status: '?' });
    }
  }

  return { ...header, staged, unstaged, conflicts };
}
