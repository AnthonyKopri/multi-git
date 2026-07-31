// Parser for `git blame --date=short` output.
import type { BlameLine } from '../../shared/git-types';

// "^abc1234 (Author Name 2026-01-31 42) the line contents"
// The caret marks a boundary commit; author names may contain spaces.
const BLAME_LINE = /^([\^0-9a-fA-F]+)\s+\((.*?)\s+(\d{4}-\d{2}-\d{2})\s+(\d+)\)\s?(.*)$/;

export function parseBlameOutput(stdout: string): BlameLine[] {
  const blame: BlameLine[] = [];

  for (const line of stdout.split('\n')) {
    if (!line) {
      continue;
    }

    const match = line.match(BLAME_LINE);
    if (match?.[1] && match[2] && match[3] && match[4]) {
      blame.push({
        hash: match[1],
        author: match[2].trim(),
        date: match[3],
        lineNum: Number.parseInt(match[4], 10),
        content: match[5] ?? ''
      });
      continue;
    }

    // Keep unparseable lines so the file still renders in full rather than
    // silently losing content.
    blame.push({
      hash: 'unknown',
      author: 'unknown',
      date: '',
      lineNum: blame.length + 1,
      content: line
    });
  }

  return blame;
}
