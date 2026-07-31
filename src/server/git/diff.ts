// Parser for unified `git diff` / `git show` output.
import type { DiffLine } from '../../shared/git-types';

// Metadata lines that appear between "diff --git" and the first hunk. None of
// them carry content, and none advance the line counters.
const METADATA_PREFIXES = [
  'diff --git',
  'index ',
  '--- ',
  '+++ ',
  'new file mode',
  'deleted file mode',
  'old mode',
  'new mode',
  'similarity index',
  'dissimilarity index',
  'rename from',
  'rename to',
  'copy from',
  'copy to',
  'Binary files'
];

function isMetadataLine(line: string): boolean {
  return METADATA_PREFIXES.some((prefix) => line.startsWith(prefix));
}

export function parseGitDiffText(diffText: string): DiffLine[] {
  const result: DiffLine[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;
  let inDiff = false;

  for (const line of diffText.split('\n')) {
    // Everything before the first "diff --git" is commit metadata.
    if (!inDiff) {
      if (line.startsWith('diff --git')) {
        inDiff = true;
      }
      continue;
    }

    if (isMetadataLine(line)) {
      continue;
    }

    // "\ No newline at end of file" annotates the preceding line rather than
    // being content of its own. Counting it would shift every line number
    // after it by one.
    if (line.startsWith('\\')) {
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match?.[1] && match[2]) {
        oldLineNum = Number.parseInt(match[1], 10);
        newLineNum = Number.parseInt(match[2], 10);
        result.push({ type: 'hunk', content: line, oldLine: null, newLine: null });
      }
      continue;
    }

    if (line.startsWith('+')) {
      result.push({
        type: 'addition',
        content: line.substring(1),
        oldLine: null,
        newLine: newLineNum++
      });
    } else if (line.startsWith('-')) {
      result.push({
        type: 'deletion',
        content: line.substring(1),
        oldLine: oldLineNum++,
        newLine: null
      });
    } else {
      // Context lines carry a leading space, which substring(1) removes.
      result.push({
        type: 'normal',
        content: line.substring(1),
        oldLine: oldLineNum++,
        newLine: newLineNum++
      });
    }
  }

  return result;
}
