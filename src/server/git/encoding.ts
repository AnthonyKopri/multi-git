// Keeping a diff's bytes exactly as git produced them.
//
// A patch this application builds is applied back to the user's files, so
// every byte in it has to survive the round trip. Decoding git's output as
// UTF-8 does not survive it: a file in Latin-1, Windows-1252, Shift-JIS or any
// other encoding contains byte sequences that are not valid UTF-8, and the
// decoder replaces each one with U+FFFD. Encoding that back produces different
// bytes from the ones that went in.
//
// It is not a theoretical problem. Staging one line of a Latin-1 file used to
// either fail with "patch does not apply" — when a mangled context line no
// longer matched — or, when the context happened to be ASCII, succeed and
// silently rewrite `Café` as `Caf<U+FFFD>` in the index.
//
// The fix is to treat a diff as bytes throughout the pipeline that builds and
// applies patches, and to decode only at the edge where a human reads it:
//
//   git → Buffer → latin1 string → parse → model → patch → Buffer → git
//                                            ↓
//                                     UTF-8 for display
//
// `latin1` is the transport, not a claim about the file's encoding. It is the
// one decoding where every byte 0x00–0xFF maps to exactly one code unit and
// back again, so the string is a faithful stand-in for the bytes. Everything
// the parser looks at — `@@` headers, the `+`/`-`/space prefixes, newlines —
// is ASCII, and ASCII means the same thing in both, so parsing is unaffected.
import type { DiffFile, DiffHunk, StructuredDiffLine } from '../../shared/diff-types';

/** Git's raw output as a byte-faithful string. */
export function bytesToTransport(buffer: Buffer): string {
  return buffer.toString('latin1');
}

/** A transport string back to the exact bytes it came from. */
export function transportToBytes(text: string): Buffer {
  return Buffer.from(text, 'latin1');
}

/**
 * A transport string as text for a person.
 *
 * The result is what the old code produced for every file, replacement
 * characters and all — the difference is that it is now only ever used for
 * display, never for building something git will apply.
 */
export function transportToDisplay(text: string): string {
  return transportToBytes(text).toString('utf8');
}

function displayLine(line: StructuredDiffLine): StructuredDiffLine {
  return { ...line, content: transportToDisplay(line.content) };
}

function displayHunk(hunk: DiffHunk): DiffHunk {
  return {
    ...hunk,
    header: transportToDisplay(hunk.header),
    lines: hunk.lines.map(displayLine)
  };
}

/**
 * Converts a parsed diff for the renderer.
 *
 * Ids are left alone deliberately. They are hashes of the transport content,
 * the server recomputes them from a fresh read when a selection is applied,
 * and the renderer only ever echoes them back — so they must not depend on how
 * the text was decoded for display.
 */
export function toDisplayDiffFile(file: DiffFile): DiffFile {
  return {
    ...file,
    oldPath: file.oldPath === null ? null : transportToDisplay(file.oldPath),
    newPath: file.newPath === null ? null : transportToDisplay(file.newPath),
    headerLines: file.headerLines.map(transportToDisplay),
    hunks: file.hunks.map(displayHunk)
  };
}

export function toDisplayDiffFiles(files: readonly DiffFile[]): DiffFile[] {
  return files.map(toDisplayDiffFile);
}
