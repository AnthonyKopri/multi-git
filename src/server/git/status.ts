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

/** Decodes the C-style quoting used by Git's non-`-z` path output. */
function decodeQuotedGitPath(contents: string): string {
  let decoded = '';

  for (let index = 0; index < contents.length; ) {
    if (contents[index] !== '\\') {
      decoded += contents[index];
      index += 1;
      continue;
    }

    // Git writes non-ASCII filenames as runs of octal-escaped UTF-8 bytes,
    // e.g. café.txt becomes "caf\303\251.txt". Decode the complete byte run
    // together; decoding one escape at a time would produce two replacement
    // characters instead of é.
    const bytes: number[] = [];
    let byteIndex = index;
    while (contents[byteIndex] === '\\') {
      const match = contents.slice(byteIndex).match(/^\\([0-7]{1,3})/);
      if (!match?.[1]) {
        break;
      }
      bytes.push(Number.parseInt(match[1], 8));
      byteIndex += match[0].length;
    }

    if (bytes.length > 0) {
      decoded += Buffer.from(bytes).toString('utf8');
      index = byteIndex;
      continue;
    }

    const escaped = contents[index + 1];
    if (escaped && Object.prototype.hasOwnProperty.call(ESCAPE_REPLACEMENTS, escaped)) {
      decoded += ESCAPE_REPLACEMENTS[escaped] as string;
      index += 2;
      continue;
    }

    // Preserve unknown/incomplete escapes exactly as Git supplied them.
    decoded += '\\';
    index += 1;
  }

  return decoded;
}

/**
 * Git quotes paths containing special characters and escapes the contents:
 * `"path \"x\".txt"`. Unquoted paths are returned trimmed.
 */
export function unquoteGitPath(rawPath: string): string {
  const trimmed = rawPath.trim();

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return decodeQuotedGitPath(trimmed.slice(1, -1));
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

/** Finds Git's rename arrow without mistaking one inside a quoted filename. */
function splitRenamePath(rawPath: string): [string, string] | null {
  let quoted = false;

  for (let index = 0; index <= rawPath.length - 4; index += 1) {
    const character = rawPath[index];
    if (character === '\\') {
      // In a quoted path the next character belongs to this escape (and an
      // octal escape's remaining digits cannot contain a quote or arrow).
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && rawPath.startsWith(' -> ', index)) {
      return [rawPath.slice(0, index), rawPath.slice(index + 4)];
    }
  }

  return null;
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

    const rawFilePath = line.substring(3);
    let filePath = unquoteGitPath(rawFilePath);
    let origPath: string | null = null;

    // Renames and copies are reported as "old -> new"; the new path is the
    // one the user acts on.
    if (indexStatus === 'R' || indexStatus === 'C') {
      const rename = splitRenamePath(rawFilePath);
      if (rename) {
        origPath = unquoteGitPath(rename[0]);
        filePath = unquoteGitPath(rename[1]);
      }
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
