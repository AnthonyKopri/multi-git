// Builds a patch that carries only the changes the user selected.
//
// The whole of precision staging is this transformation. Given the diff the
// user was looking at and a set of hunk or line ids, produce a patch that git
// will apply — one that contains the selected changes and leaves everything
// else exactly where it was.
//
// # Which lines survive, and in what form
//
// Git applies a patch in one of two directions, and the rule inverts between
// them. Forward, the patch turns the *old* side into the new one; reversed, it
// turns the *new* side back into the old one. Either way, the side being
// consumed must match the file on disk exactly, so an unselected change is
// either dropped (it is not in that side) or demoted to context (it is).
//
//   forward (git apply)             reversed (git apply --reverse)
//   ------------------------        ------------------------------
//   selected +   → kept as +        selected +   → kept as +
//   unselected + → dropped          unselected + → demoted to context
//   selected -   → kept as -        selected -   → kept as -
//   unselected - → demoted          unselected - → dropped
//
// A pleasant consequence: the side being consumed always ends up complete and
// unmodified. Forward, the old side is every context and deletion line the
// original hunk had; reversed, the new side is every context and addition
// line. So that side's `@@` start and count are copied straight from the
// original hunk, and only the side being produced needs recounting.
import type { DiffFile, DiffHunk, PatchSelection, StructuredDiffLine } from '../../shared/diff-types';

export class PatchSelectionError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'PatchSelectionError';
    this.statusCode = statusCode;
  }
}

export interface BuiltPatch {
  /** Ready to write to `git apply` on stdin. Always ends with a newline. */
  text: string;
  hunksApplied: number;
  linesApplied: number;
}

/** Resolves a selection to the exact set of line ids it covers. */
function selectedLineIds(file: DiffFile, selection: PatchSelection): Set<string> {
  // Omitting both lists means the whole file. Sending an empty one does not:
  // a UI that lost track of its checkboxes should get an error, not stage
  // everything the user was deciding between.
  if (selection.hunkIds === undefined && selection.lineIds === undefined) {
    return new Set(
      file.hunks.flatMap((hunk) =>
        hunk.lines.filter((line) => line.kind !== 'context').map((line) => line.id)
      )
    );
  }

  const hunkIds = selection.hunkIds ?? [];
  const lineIds = selection.lineIds ?? [];

  const byHunkId = new Map(file.hunks.map((hunk) => [hunk.id, hunk]));
  const selected = new Set<string>();

  for (const hunkId of hunkIds) {
    const hunk = byHunkId.get(hunkId);
    if (!hunk) {
      throw new PatchSelectionError(
        'The file changed since these changes were displayed. Reload the diff and try again.',
        409
      );
    }
    for (const line of hunk.lines) {
      if (line.kind !== 'context') {
        selected.add(line.id);
      }
    }
  }

  const known = new Set(
    file.hunks.flatMap((hunk) => hunk.lines.map((line) => line.id))
  );

  for (const lineId of lineIds) {
    if (!known.has(lineId)) {
      throw new PatchSelectionError(
        'The file changed since these changes were displayed. Reload the diff and try again.',
        409
      );
    }
    selected.add(lineId);
  }

  return selected;
}

type EmittedLine = { prefix: '+' | '-' | ' '; line: StructuredDiffLine } | null;

/** Applies the table at the top of this file to one line. */
function emit(line: StructuredDiffLine, isSelected: boolean, reverse: boolean): EmittedLine {
  if (line.kind === 'context') {
    return { prefix: ' ', line };
  }

  if (isSelected) {
    return { prefix: line.kind === 'addition' ? '+' : '-', line };
  }

  const survivesAsContext = reverse ? line.kind === 'addition' : line.kind === 'deletion';
  return survivesAsContext ? { prefix: ' ', line } : null;
}

interface ReducedHunk {
  lines: { prefix: '+' | '-' | ' '; line: StructuredDiffLine }[];
  oldCount: number;
  newCount: number;
  changed: number;
}

function reduceHunk(
  hunk: DiffHunk,
  selected: Set<string>,
  reverse: boolean
): ReducedHunk | null {
  const lines: ReducedHunk['lines'] = [];
  let oldCount = 0;
  let newCount = 0;
  let changed = 0;

  for (const line of hunk.lines) {
    const emitted = emit(line, selected.has(line.id), reverse);
    if (!emitted) {
      continue;
    }

    lines.push(emitted);

    if (emitted.prefix !== '+') {
      oldCount += 1;
    }
    if (emitted.prefix !== '-') {
      newCount += 1;
    }
    if (emitted.prefix !== ' ') {
      changed += 1;
    }
  }

  // Nothing selected here: the hunk would be pure context, which is a no-op
  // that only gives git another chance to fail to place it.
  return changed === 0 ? null : { lines, oldCount, newCount, changed };
}

/** `@@ -a,b +c,d @@`, with a count of 1 elided the way git elides it. */
function formatRange(start: number, count: number): string {
  // An empty side is written as "0,0" — the start is the line it would follow.
  return count === 1 ? String(start) : `${start},${count}`;
}

interface EmittedEntry {
  prefix: '+' | '-' | ' ';
  content: string;
  noNewline: boolean;
}

/**
 * Decides where `\ No newline at end of file` belongs in the reduced patch.
 *
 * The marker states that the line above it ends its file without a newline, so
 * it is only meaningful on a line that is genuinely last — and "last" is
 * per side. A deletion is the old side's last line when nothing after it is a
 * deletion or context; an addition is the new side's last line by the same
 * rule; a context line has to be last on both.
 *
 * Dropping the marker from a line that is no longer at either end is what
 * keeps a partial selection from producing a patch that claims one line is
 * simultaneously the end of the file and followed by another.
 */
function placeNoNewlineMarkers(entries: EmittedEntry[]): void {
  let laterOldSide = false;
  let laterNewSide = false;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as EmittedEntry;
    const onOldSide = entry.prefix !== '+';
    const onNewSide = entry.prefix !== '-';

    if (entry.noNewline) {
      entry.noNewline =
        (!onOldSide || !laterOldSide) && (!onNewSide || !laterNewSide);
    }

    laterOldSide ||= onOldSide;
    laterNewSide ||= onNewSide;
  }
}

/** The `---`/`+++` line the patch produces, as opposed to the one it consumes. */
function producedMarker(reverse: boolean): string {
  return reverse ? '--- ' : '+++ ';
}

function sidePath(line: string): string {
  return line.slice(4).split('\t')[0] ?? '';
}

/**
 * Rewrites `a/x` as `b/x` or the other way round, keeping git's quoting.
 *
 * Git quotes the whole side including its prefix — `"a/say \"hi\".txt"` — so
 * the letter to swap is the one after the opening quote.
 */
function flipSidePrefix(pathPart: string, toOldSide: boolean): string {
  const quoted = pathPart.startsWith('"');
  const inner = quoted ? pathPart.slice(1) : pathPart;
  const flipped = (toOldSide ? 'a/' : 'b/') + inner.slice(2);
  return quoted ? `"${flipped}` : flipped;
}

/**
 * The header lines the reduced patch should carry.
 *
 * Usually the originals, verbatim. The exception is a partial selection out of
 * a file that was wholly added or wholly deleted: the patch no longer creates
 * or removes the file, it modifies it, and a header still claiming otherwise
 * makes git refuse with "new file … depends on old contents". So the
 * create/delete markers come off and the `/dev/null` side is pointed at the
 * real path, which is taken from the other side's header line rather than
 * re-quoted here.
 */
function reducedHeaderLines(
  file: DiffFile,
  reverse: boolean,
  producedLineCount: number
): string[] {
  const producedPrefix = producedMarker(reverse);
  const consumedPrefix = reverse ? '+++ ' : '--- ';

  const producedLine = file.headerLines.find((line) => line.startsWith(producedPrefix));
  const consumedLine = file.headerLines.find((line) => line.startsWith(consumedPrefix));

  if (
    producedLineCount === 0 ||
    !producedLine ||
    !consumedLine ||
    sidePath(producedLine) !== '/dev/null'
  ) {
    return file.headerLines;
  }

  const realPath = flipSidePrefix(sidePath(consumedLine), reverse);

  return file.headerLines
    .filter(
      (line) =>
        !line.startsWith('new file mode ') &&
        !line.startsWith('deleted file mode ') &&
        // The blob hashes describe the whole-file change this no longer is.
        !line.startsWith('index ')
    )
    .map((line) => (line === producedLine ? `${producedPrefix}${realPath}` : line));
}

/**
 * Builds the patch for a selection.
 *
 * `reverse` describes how the caller intends to apply it: unstaging and
 * discarding both undo a change that is already present, and so pass true.
 */
export function buildSelectedPatch(
  file: DiffFile,
  selection: PatchSelection,
  reverse: boolean
): BuiltPatch {
  if (file.binary) {
    throw new PatchSelectionError(
      'This file is binary, so individual lines cannot be staged. Use the whole-file action instead.'
    );
  }

  const selected = selectedLineIds(file, selection);
  if (selected.size === 0) {
    throw new PatchSelectionError('Select at least one changed line.');
  }

  const headers: { at: number; text: string }[] = [];
  const entries: EmittedEntry[] = [];
  let hunksApplied = 0;
  let linesApplied = 0;

  // How far the produced side's line numbers have drifted from the numbers the
  // original diff gave that side. Every hunk contributes, including the ones
  // left out entirely: skipping a hunk means the produced file keeps the
  // consumed side's lines there instead of the ones git recorded.
  let drift = 0;

  for (const hunk of file.hunks) {
    const producedCount = reverse ? hunk.oldCount : hunk.newCount;
    const untouchedCount = reverse ? hunk.newCount : hunk.oldCount;

    const reduced = reduceHunk(hunk, selected, reverse);
    if (!reduced) {
      drift += untouchedCount - producedCount;
      continue;
    }

    hunksApplied += 1;
    linesApplied += reduced.changed;

    // The consumed side survives intact, so its range is copied from the
    // original hunk. Only the produced side is recounted and shifted.
    const reducedProducedCount = reverse ? reduced.oldCount : reduced.newCount;
    const shifted = (reverse ? hunk.oldStart : hunk.newStart) + drift;

    // Git writes a start of 0 only for an empty side. A whole-file add or
    // delete has one, and a partial selection out of it does not stay empty.
    const producedStart = reducedProducedCount > 0 ? Math.max(shifted, 1) : shifted;

    const oldStart = reverse ? producedStart : hunk.oldStart;
    const oldCount = reverse ? reducedProducedCount : hunk.oldCount;
    const newStart = reverse ? hunk.newStart : producedStart;
    const newCount = reverse ? hunk.newCount : reducedProducedCount;

    drift += reducedProducedCount - producedCount;

    headers.push({
      at: entries.length,
      text: `@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`
    });

    for (const { prefix, line } of reduced.lines) {
      entries.push({ prefix, content: line.content, noNewline: line.noNewline });
    }
  }

  if (hunksApplied === 0) {
    throw new PatchSelectionError('Select at least one changed line.');
  }

  placeNoNewlineMarkers(entries);

  const body: string[] = [];
  let nextHeader = 0;

  for (let index = 0; index <= entries.length; index += 1) {
    while (nextHeader < headers.length && (headers[nextHeader] as { at: number }).at === index) {
      body.push((headers[nextHeader] as { text: string }).text);
      nextHeader += 1;
    }
    const entry = entries[index];
    if (entry) {
      body.push(entry.prefix + entry.content);
      if (entry.noNewline) {
        body.push('\\ No newline at end of file');
      }
    }
  }

  const producedLineCount = entries.filter((entry) =>
    reverse ? entry.prefix !== '+' : entry.prefix !== '-'
  ).length;

  return {
    text: `${[...reducedHeaderLines(file, reverse, producedLineCount), ...body].join('\n')}\n`,
    hunksApplied,
    linesApplied
  };
}
