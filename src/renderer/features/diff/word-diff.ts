// Intra-line highlighting: which words in a changed line actually changed.
//
// A unified diff says the line is different. When one character moved, that is
// technically true and practically useless — the reader has to compare two
// eighty-column lines by eye. Pairing each removed line with the added line
// that replaced it and diffing the words is what turns "this line changed"
// into "this word changed".
//
// The algorithm is a plain longest-common-subsequence over tokens. Lines are
// short, the pairing is one-to-one, and the input is bounded by the diff
// renderer's window, so the quadratic table is small and the result is the
// minimal edit rather than a heuristic.
import type { DiffHunk, StructuredDiffLine } from '../../../shared/diff-types';

export type SegmentKind = 'same' | 'changed';

export interface WordSegment {
  kind: SegmentKind;
  text: string;
}

/**
 * Beyond this many tokens a line is emitted whole.
 *
 * The table is tokens squared; a minified bundle on one line would otherwise
 * cost tens of millions of cells to tell the reader something they cannot read
 * anyway.
 */
export const MAX_TOKENS = 400;

/**
 * Splits into words, runs of whitespace, and single punctuation characters.
 *
 * Keeping whitespace as its own token means an indentation change highlights
 * as an indentation change, rather than as the whole line.
 */
export function tokenize(line: string): string[] {
  return line.match(/[A-Za-z0-9_$]+|\s+|[^\sA-Za-z0-9_$]/g) ?? [];
}

/** Longest common subsequence of two token lists, as a table of lengths. */
function lcsTable(left: readonly string[], right: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0)
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      (table[i] as number[])[j] =
        left[i] === right[j]
          ? ((table[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((table[i + 1] as number[])[j] as number, (table[i] as number[])[j + 1] as number);
    }
  }

  return table;
}

/** Merges neighbouring segments of the same kind, so the DOM stays small. */
function coalesce(segments: readonly WordSegment[]): WordSegment[] {
  const merged: WordSegment[] = [];

  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.kind === segment.kind) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

export interface WordDiff {
  /** Segments for the removed line. */
  oldSegments: WordSegment[];
  /** Segments for the added line. */
  newSegments: WordSegment[];
}

/**
 * Diffs two lines by word.
 *
 * Returns everything as `changed` when either side is too long to compare,
 * which is the same information a diff without this gives, and never worse.
 */
export function diffWords(oldLine: string, newLine: string): WordDiff {
  const left = tokenize(oldLine);
  const right = tokenize(newLine);

  if (left.length > MAX_TOKENS || right.length > MAX_TOKENS) {
    return {
      oldSegments: oldLine === '' ? [] : [{ kind: 'changed', text: oldLine }],
      newSegments: newLine === '' ? [] : [{ kind: 'changed', text: newLine }]
    };
  }

  const table = lcsTable(left, right);
  const oldSegments: WordSegment[] = [];
  const newSegments: WordSegment[] = [];

  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      oldSegments.push({ kind: 'same', text: left[i] as string });
      newSegments.push({ kind: 'same', text: right[j] as string });
      i += 1;
      j += 1;
    } else if (
      ((table[i + 1] as number[])[j] as number) >= ((table[i] as number[])[j + 1] as number)
    ) {
      oldSegments.push({ kind: 'changed', text: left[i] as string });
      i += 1;
    } else {
      newSegments.push({ kind: 'changed', text: right[j] as string });
      j += 1;
    }
  }

  for (; i < left.length; i += 1) {
    oldSegments.push({ kind: 'changed', text: left[i] as string });
  }
  for (; j < right.length; j += 1) {
    newSegments.push({ kind: 'changed', text: right[j] as string });
  }

  return { oldSegments: coalesce(oldSegments), newSegments: coalesce(newSegments) };
}

/**
 * Pairs each removed line with the added line that replaced it.
 *
 * Git emits a replacement as a run of deletions followed by a run of
 * additions. Pairing them by position within the run is what every diff viewer
 * does, and it is right whenever the runs are the same length — which is the
 * case that matters, an edit in place.
 *
 * Runs of different lengths are paired as far as they go: the extra lines on
 * whichever side is longer are genuine whole-line additions or removals, and
 * highlighting part of them would invent a relationship that is not there.
 */
export function pairChangedLines(hunk: DiffHunk): Map<string, string> {
  const pairs = new Map<string, string>();

  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index] as StructuredDiffLine;
    if (line.kind !== 'deletion') {
      index += 1;
      continue;
    }

    const deletions: StructuredDiffLine[] = [];
    while (index < hunk.lines.length && (hunk.lines[index] as StructuredDiffLine).kind === 'deletion') {
      deletions.push(hunk.lines[index] as StructuredDiffLine);
      index += 1;
    }

    const additions: StructuredDiffLine[] = [];
    while (index < hunk.lines.length && (hunk.lines[index] as StructuredDiffLine).kind === 'addition') {
      additions.push(hunk.lines[index] as StructuredDiffLine);
      index += 1;
    }

    for (let offset = 0; offset < Math.min(deletions.length, additions.length); offset += 1) {
      const removed = deletions[offset] as StructuredDiffLine;
      const added = additions[offset] as StructuredDiffLine;
      pairs.set(removed.id, added.id);
      pairs.set(added.id, removed.id);
    }
  }

  return pairs;
}
