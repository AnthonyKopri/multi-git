// The two pure pieces of precision staging: reading a diff into a model, and
// reducing that model back into a patch.
//
// Both are exercised against literal diff text rather than a repository, so a
// case that is awkward to produce on demand — a pure rename, a submodule
// pointer, a file whose name starts with a hyphen — is just a fixture.
import { describe, expect, it } from 'vitest';

import { parseStructuredDiff, parseSingleFileDiff } from '../src/server/git/structured-diff';
import { buildSelectedPatch, PatchSelectionError } from '../src/server/git/patch-build';
import type { DiffFile } from '../src/shared/diff-types';

/** Joins fixture lines and terminates them the way git does. */
function diffText(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

const SIMPLE_EDIT = diffText(
  'diff --git a/edit.txt b/edit.txt',
  'index 1111111..2222222 100644',
  '--- a/edit.txt',
  '+++ b/edit.txt',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  '+TWO',
  ' three'
);

function parseOne(text: string): DiffFile {
  const file = parseSingleFileDiff(text);
  expect(file).not.toBeNull();
  return file as DiffFile;
}

describe('parsing a unified diff', () => {
  it('reads paths, counts and line numbers from an ordinary edit', () => {
    const file = parseOne(SIMPLE_EDIT);

    expect(file.oldPath).toBe('edit.txt');
    expect(file.newPath).toBe('edit.txt');
    expect(file.status).toBe('modified');
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);

    const [hunk] = file.hunks;
    expect(hunk?.oldStart).toBe(1);
    expect(hunk?.oldCount).toBe(3);
    expect(hunk?.lines.map((line) => line.kind)).toEqual([
      'context',
      'deletion',
      'addition',
      'context'
    ]);
    expect(hunk?.lines[1]?.oldLine).toBe(2);
    expect(hunk?.lines[2]?.newLine).toBe(2);
    expect(hunk?.lines[3]?.oldLine).toBe(3);
  });

  it('treats an omitted hunk count as one, not as zero', () => {
    const file = parseOne(
      diffText(
        'diff --git a/one.txt b/one.txt',
        '--- a/one.txt',
        '+++ b/one.txt',
        '@@ -1 +1 @@',
        '-before',
        '+after'
      )
    );

    expect(file.hunks[0]?.oldCount).toBe(1);
    expect(file.hunks[0]?.newCount).toBe(1);
  });

  it('keeps every header line so a rebuilt patch can replay them', () => {
    const file = parseOne(SIMPLE_EDIT);

    expect(file.headerLines).toEqual([
      'diff --git a/edit.txt b/edit.txt',
      'index 1111111..2222222 100644',
      '--- a/edit.txt',
      '+++ b/edit.txt'
    ]);
  });

  it('recognises a rename that also changed content', () => {
    const file = parseOne(
      diffText(
        'diff --git a/old.txt b/new.txt',
        'similarity index 87%',
        'rename from old.txt',
        'rename to new.txt',
        '--- a/old.txt',
        '+++ b/new.txt',
        '@@ -1,2 +1,2 @@',
        ' keep',
        '-was',
        '+is'
      )
    );

    expect(file.status).toBe('renamed');
    expect(file.oldPath).toBe('old.txt');
    expect(file.newPath).toBe('new.txt');
    expect(file.headerLines).toContain('rename from old.txt');
  });

  it('reads a pure rename, which has no hunks at all', () => {
    const file = parseOne(
      diffText(
        'diff --git a/old.txt b/new.txt',
        'similarity index 100%',
        'rename from old.txt',
        'rename to new.txt'
      )
    );

    expect(file.status).toBe('renamed');
    expect(file.hunks).toEqual([]);
    expect(file.oldPath).toBe('old.txt');
    expect(file.newPath).toBe('new.txt');
  });

  it('reads a mode change with no content change', () => {
    const file = parseOne(
      diffText(
        'diff --git a/script.sh b/script.sh',
        'old mode 100644',
        'new mode 100755'
      )
    );

    expect(file.modeChanged).toBe(true);
    expect(file.status).toBe('modified');
    expect(file.hunks).toEqual([]);
  });

  it('marks added and deleted files from their mode headers', () => {
    const added = parseOne(
      diffText(
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,1 @@',
        '+hello'
      )
    );
    expect(added.status).toBe('added');
    expect(added.oldPath).toBeNull();

    const deleted = parseOne(
      diffText(
        'diff --git a/gone.txt b/gone.txt',
        'deleted file mode 100644',
        '--- a/gone.txt',
        '+++ /dev/null',
        '@@ -1,1 +0,0 @@',
        '-bye'
      )
    );
    expect(deleted.status).toBe('deleted');
    expect(deleted.newPath).toBeNull();
  });

  it('marks a binary file and gives it no lines', () => {
    const file = parseOne(
      diffText(
        'diff --git a/logo.png b/logo.png',
        'index 1111111..2222222 100644',
        'Binary files a/logo.png and b/logo.png differ'
      )
    );

    expect(file.binary).toBe(true);
    expect(file.hunks).toEqual([]);
  });

  it('attaches the no-newline marker to the line above it', () => {
    const file = parseOne(
      diffText(
        'diff --git a/tail.txt b/tail.txt',
        '--- a/tail.txt',
        '+++ b/tail.txt',
        '@@ -1,2 +1,2 @@',
        ' first',
        '-last',
        '\\ No newline at end of file',
        '+last changed',
        '\\ No newline at end of file'
      )
    );

    const [hunk] = file.hunks;
    expect(hunk?.lines.map((line) => line.noNewline)).toEqual([false, true, true]);
    // The marker must not be counted as a line of its own.
    expect(hunk?.lines).toHaveLength(3);
  });

  it('keeps the carriage return of a CRLF file inside the line content', () => {
    const file = parseOne(
      diffText(
        'diff --git a/crlf.txt b/crlf.txt',
        '--- a/crlf.txt',
        '+++ b/crlf.txt',
        '@@ -1,1 +1,1 @@',
        '-one\r',
        '+ONE\r'
      )
    );

    expect(file.hunks[0]?.lines[0]?.content).toBe('one\r');
    expect(file.hunks[0]?.lines[1]?.content).toBe('ONE\r');
  });

  it('does not invent a trailing blank line from the final newline', () => {
    const file = parseOne(SIMPLE_EDIT);

    expect(file.hunks[0]?.lines).toHaveLength(4);
    expect(file.hunks[0]?.lines.at(-1)?.content).toBe('three');
  });

  it('keeps a blank context line, which git writes as a single space', () => {
    const file = parseOne(
      diffText(
        'diff --git a/gap.txt b/gap.txt',
        '--- a/gap.txt',
        '+++ b/gap.txt',
        '@@ -1,3 +1,3 @@',
        ' head',
        ' ',
        '-tail',
        '+TAIL'
      )
    );

    expect(file.hunks[0]?.lines[1]).toMatchObject({ kind: 'context', content: '' });
  });

  it('reads a hunk whose header carries a section heading', () => {
    const file = parseOne(
      diffText(
        'diff --git a/code.ts b/code.ts',
        '--- a/code.ts',
        '+++ b/code.ts',
        '@@ -10,3 +10,3 @@ export function doThing(): void {',
        ' const a = 1;',
        '-const b = 2;',
        '+const b = 3;'
      )
    );

    expect(file.hunks[0]?.header).toContain('export function doThing()');
    expect(file.hunks[0]?.oldStart).toBe(10);
  });

  it('separates several files in one diff', () => {
    const files = parseStructuredDiff(
      diffText(
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-a',
        '+A',
        'diff --git a/b.txt b/b.txt',
        '--- a/b.txt',
        '+++ b/b.txt',
        '@@ -1 +1 @@',
        '-b',
        '+B'
      )
    );

    expect(files.map((file) => file.newPath)).toEqual(['a.txt', 'b.txt']);
    expect(files[0]?.hunks[0]?.lines).toHaveLength(2);
  });

  it('reads a submodule pointer move', () => {
    const file = parseOne(
      diffText(
        'diff --git a/vendor/lib b/vendor/lib',
        '--- a/vendor/lib',
        '+++ b/vendor/lib',
        '@@ -1 +1 @@',
        '-Subproject commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '+Subproject commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      )
    );

    expect(file.newPath).toBe('vendor/lib');
    expect(file.hunks[0]?.lines[1]?.content).toContain('Subproject commit bbbb');
  });

  it('reads a path that starts with a hyphen', () => {
    const file = parseOne(
      diffText(
        'diff --git a/-weird.txt b/-weird.txt',
        '--- a/-weird.txt',
        '+++ b/-weird.txt',
        '@@ -1 +1 @@',
        '-x',
        '+y'
      )
    );

    expect(file.newPath).toBe('-weird.txt');
  });

  it('unquotes a path git had to quote', () => {
    const file = parseOne(
      diffText(
        'diff --git "a/say \\"hi\\".txt" "b/say \\"hi\\".txt"',
        '--- "a/say \\"hi\\".txt"',
        '+++ "b/say \\"hi\\".txt"',
        '@@ -1 +1 @@',
        '-x',
        '+y'
      )
    );

    expect(file.newPath).toBe('say "hi".txt');
  });

  it('reads conflict markers as ordinary content', () => {
    const file = parseOne(
      diffText(
        'diff --git a/merge.txt b/merge.txt',
        '--- a/merge.txt',
        '+++ b/merge.txt',
        '@@ -1,1 +1,5 @@',
        ' base',
        '+<<<<<<< HEAD',
        '+ours',
        '+=======',
        '+theirs',
        '+>>>>>>> other'
      )
    );

    expect(file.additions).toBe(5);
    expect(file.hunks[0]?.lines[1]?.content).toBe('<<<<<<< HEAD');
  });

  it('stays linear on a very large hunk', () => {
    const body = Array.from({ length: 20000 }, (_, index) => `+line ${index}`);
    const file = parseOne(
      diffText(
        'diff --git a/big.txt b/big.txt',
        '--- a/big.txt',
        '+++ b/big.txt',
        `@@ -0,0 +1,${body.length} @@`,
        ...body
      )
    );

    expect(file.additions).toBe(20000);
    expect(file.hunks[0]?.lines.at(-1)?.newLine).toBe(20000);
  });
});

describe('hunk identity', () => {
  it('is stable across two reads of the same diff', () => {
    expect(parseOne(SIMPLE_EDIT).hunks[0]?.id).toBe(parseOne(SIMPLE_EDIT).hunks[0]?.id);
  });

  it('changes when the content of the hunk changes', () => {
    const other = parseOne(SIMPLE_EDIT.replace('+TWO', '+two!'));
    expect(other.hunks[0]?.id).not.toBe(parseOne(SIMPLE_EDIT).hunks[0]?.id);
  });

  it('differs between two textually identical hunks at different positions', () => {
    const file = parseOne(
      diffText(
        'diff --git a/twice.txt b/twice.txt',
        '--- a/twice.txt',
        '+++ b/twice.txt',
        '@@ -1,2 +1,2 @@',
        '-x',
        '+y',
        ' z',
        '@@ -20,2 +20,2 @@',
        '-x',
        '+y',
        ' z'
      )
    );

    expect(file.hunks[0]?.id).not.toBe(file.hunks[1]?.id);
  });

  it('gives every line in a file a distinct id', () => {
    const file = parseOne(SIMPLE_EDIT);
    const ids = file.hunks.flatMap((hunk) => hunk.lines.map((line) => line.id));

    expect(new Set(ids).size).toBe(ids.length);
  });
});

/** Two hunks 20 lines apart, so a selection can address them independently. */
const TWO_HUNKS = parseOne(
  diffText(
    'diff --git a/two.txt b/two.txt',
    'index aaaaaaa..bbbbbbb 100644',
    '--- a/two.txt',
    '+++ b/two.txt',
    '@@ -1,4 +1,5 @@',
    ' a',
    '-b',
    '+B',
    '+B2',
    ' c',
    ' d',
    '@@ -20,3 +21,3 @@',
    ' x',
    '-y',
    '+Y',
    ' z'
  )
);

describe('building a patch from a selection', () => {
  it('replays the file headers unchanged', () => {
    const patch = buildSelectedPatch(TWO_HUNKS, {}, false);

    expect(patch.text.startsWith('diff --git a/two.txt b/two.txt\nindex aaaaaaa..bbbbbbb 100644\n')).toBe(
      true
    );
    expect(patch.text).toContain('--- a/two.txt\n+++ b/two.txt\n');
    expect(patch.text.endsWith('\n')).toBe(true);
  });

  it('reproduces the original diff when the whole file is selected', () => {
    const patch = buildSelectedPatch(TWO_HUNKS, {}, false);

    expect(patch.text).toContain('@@ -1,4 +1,5 @@');
    expect(patch.text).toContain('@@ -20,3 +21,3 @@');
    expect(patch.hunksApplied).toBe(2);
    // -b, +B, +B2 in the first hunk; -y, +Y in the second.
    expect(patch.linesApplied).toBe(5);
  });

  it('drops an unselected addition and demotes an unselected deletion, going forward', () => {
    const additions = TWO_HUNKS.hunks[0]?.lines.filter((line) => line.kind === 'addition') ?? [];
    const patch = buildSelectedPatch(TWO_HUNKS, { lineIds: [additions[0]?.id as string] }, false);
    const hunk = patch.text.split('@@')[2] ?? '';

    // "-b" is not selected, so it survives as context; "+B2" is not selected,
    // so it is gone entirely — the index has no such line to leave alone.
    expect(hunk).toContain(' b\n');
    expect(hunk).toContain('+B\n');
    expect(hunk).not.toContain('+B2');
    // The old side is untouched, so its range is the original's.
    expect(patch.text).toContain('@@ -1,4 +1,5 @@');
  });

  it('demotes an unselected addition and drops an unselected deletion, in reverse', () => {
    const additions = TWO_HUNKS.hunks[0]?.lines.filter((line) => line.kind === 'addition') ?? [];
    const patch = buildSelectedPatch(TWO_HUNKS, { lineIds: [additions[0]?.id as string] }, true);
    const hunk = patch.text.split('@@')[2] ?? '';

    expect(hunk).not.toContain('-b\n');
    expect(hunk).toContain('+B\n');
    expect(hunk).toContain(' B2\n');
    // The new side is what the patch is applied against, so it is verbatim.
    expect(patch.text).toContain('+1,5 @@');
  });

  it('keeps the second hunk addressable when the first is skipped', () => {
    const patch = buildSelectedPatch(
      TWO_HUNKS,
      { hunkIds: [TWO_HUNKS.hunks[1]?.id as string] },
      false
    );

    expect(patch.hunksApplied).toBe(1);
    // Only the second hunk survives, and because the first was not applied the
    // produced side has not gained the line the original diff assumed.
    expect(patch.text).toContain('@@ -20,3 +20,3 @@');
    expect(patch.text).not.toContain('+B2');
  });

  it('skips a hunk in which nothing was selected', () => {
    const first = TWO_HUNKS.hunks[0]?.lines.find((line) => line.kind === 'addition');
    const patch = buildSelectedPatch(TWO_HUNKS, { lineIds: [first?.id as string] }, false);

    expect(patch.hunksApplied).toBe(1);
    expect(patch.text).not.toContain('@@ -20');
  });

  it('counts what it applied, so the UI can say so', () => {
    const patch = buildSelectedPatch(
      TWO_HUNKS,
      { hunkIds: [TWO_HUNKS.hunks[0]?.id as string] },
      false
    );

    expect(patch.hunksApplied).toBe(1);
    expect(patch.linesApplied).toBe(3);
  });

  it('refuses a hunk id the current diff does not contain', () => {
    expect(() => buildSelectedPatch(TWO_HUNKS, { hunkIds: ['gone'] }, false)).toThrow(
      PatchSelectionError
    );

    try {
      buildSelectedPatch(TWO_HUNKS, { hunkIds: ['gone'] }, false);
    } catch (error) {
      expect((error as PatchSelectionError).statusCode).toBe(409);
    }
  });

  it('refuses a line id the current diff does not contain', () => {
    expect(() => buildSelectedPatch(TWO_HUNKS, { lineIds: ['gone:0'] }, false)).toThrow(
      /changed since/i
    );
  });

  it('refuses an explicitly empty selection', () => {
    expect(() => buildSelectedPatch(TWO_HUNKS, { hunkIds: [], lineIds: [] }, false)).toThrow(
      /at least one/i
    );
  });

  it('refuses a selection of context lines only', () => {
    const context = TWO_HUNKS.hunks[0]?.lines.find((line) => line.kind === 'context');

    expect(() => buildSelectedPatch(TWO_HUNKS, { lineIds: [context?.id as string] }, false)).toThrow(
      /at least one/i
    );
  });

  it('refuses a binary file rather than producing a patch for it', () => {
    const binary = parseOne(
      diffText(
        'diff --git a/logo.png b/logo.png',
        'Binary files a/logo.png and b/logo.png differ'
      )
    );

    expect(() => buildSelectedPatch(binary, {}, false)).toThrow(/binary/i);
  });
});

describe('a partial selection out of a whole-file add or delete', () => {
  const ADDED = parseOne(
    diffText(
      'diff --git a/added.txt b/added.txt',
      'new file mode 100644',
      'index 0000000..de98044',
      '--- /dev/null',
      '+++ b/added.txt',
      '@@ -0,0 +1,3 @@',
      '+a',
      '+b',
      '+c'
    )
  );

  const DELETED = parseOne(
    diffText(
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      'index de98044..0000000',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-a',
      '-b',
      '-c'
    )
  );

  it('stops calling itself a file creation when part of the file survives', () => {
    // Reversed, the old side is what the patch produces, and it is no longer
    // empty. Git rejects a "new file" patch whose old side has content.
    const patch = buildSelectedPatch(ADDED, { lineIds: [ADDED.hunks[0]?.lines[1]?.id as string] }, true);

    expect(patch.text).not.toContain('new file mode');
    expect(patch.text).not.toContain('/dev/null');
    expect(patch.text).not.toContain('index 0000000');
    expect(patch.text).toContain('--- a/added.txt\n+++ b/added.txt\n');
    expect(patch.text).toContain('@@ -1,2 +1,3 @@\n a\n+b\n c\n');
  });

  it('keeps the creation header when the whole added file is selected', () => {
    const patch = buildSelectedPatch(ADDED, {}, true);

    expect(patch.text).toContain('new file mode 100644');
    expect(patch.text).toContain('--- /dev/null');
    expect(patch.text).toContain('@@ -0,0 +1,3 @@');
  });

  it('stops calling itself a file deletion when part of the file survives', () => {
    const patch = buildSelectedPatch(
      DELETED,
      { lineIds: [DELETED.hunks[0]?.lines[0]?.id as string] },
      false
    );

    expect(patch.text).not.toContain('deleted file mode');
    expect(patch.text).toContain('--- a/gone.txt\n+++ b/gone.txt\n');
    expect(patch.text).toContain('@@ -1,3 +1,2 @@\n-a\n b\n c\n');
  });

  it('keeps the deletion header when the whole file is selected', () => {
    const patch = buildSelectedPatch(DELETED, {}, false);

    expect(patch.text).toContain('deleted file mode 100644');
    expect(patch.text).toContain('@@ -1,3 +0,0 @@');
  });

  it('keeps git quoting when it has to name the surviving side', () => {
    const quoted = parseOne(
      diffText(
        'diff --git "a/say \\"hi\\".txt" "b/say \\"hi\\".txt"',
        'new file mode 100644',
        '--- /dev/null',
        '+++ "b/say \\"hi\\".txt"',
        '@@ -0,0 +1,2 @@',
        '+a',
        '+b'
      )
    );

    const patch = buildSelectedPatch(
      quoted,
      { lineIds: [quoted.hunks[0]?.lines[0]?.id as string] },
      true
    );

    expect(patch.text).toContain('--- "a/say \\"hi\\".txt"\n');
  });
});

describe('the no-newline marker in a reduced patch', () => {
  const TAIL = parseOne(
    diffText(
      'diff --git a/tail.txt b/tail.txt',
      '--- a/tail.txt',
      '+++ b/tail.txt',
      '@@ -1,2 +1,2 @@',
      ' first',
      '-last',
      '\\ No newline at end of file',
      '+last changed',
      '\\ No newline at end of file'
    )
  );

  it('keeps both markers when the whole hunk is taken', () => {
    const patch = buildSelectedPatch(TAIL, {}, false);

    expect(patch.text.match(/\\ No newline at end of file/g)).toHaveLength(2);
  });

  it('drops the marker from a line that is no longer at either end', () => {
    // Forward with only the addition selected demotes "-last" to context, and
    // a context line followed by another line is not the end of anything.
    const addition = TAIL.hunks[0]?.lines.find((line) => line.kind === 'addition');
    const patch = buildSelectedPatch(TAIL, { lineIds: [addition?.id as string] }, false);

    expect(patch.text).toContain(' last\n+last changed\n\\ No newline at end of file\n');
    expect(patch.text.match(/\\ No newline at end of file/g)).toHaveLength(1);
  });

  it('keeps a marker that is last on its own side but not last overall', () => {
    // "-last" ends the old side; the "+last changed" that follows is on the
    // new side only, so a marker between the two is exactly right.
    const patch = buildSelectedPatch(TAIL, {}, false);

    expect(patch.text).toContain(
      '-last\n\\ No newline at end of file\n+last changed\n\\ No newline at end of file\n'
    );
  });

  it('demotes rather than drops when reversing, and moves the marker with it', () => {
    // Reversed with only the deletion selected, the unselected addition
    // becomes context — which puts it on the old side too, so "-last" is no
    // longer that side's last line and loses its marker.
    const deletion = TAIL.hunks[0]?.lines.find((line) => line.kind === 'deletion');
    const patch = buildSelectedPatch(TAIL, { lineIds: [deletion?.id as string] }, true);

    expect(patch.text).toContain('-last\n last changed\n\\ No newline at end of file\n');
    expect(patch.text.match(/\\ No newline at end of file/g)).toHaveLength(1);
  });
});
