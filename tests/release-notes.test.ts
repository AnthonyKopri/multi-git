// The release notes the Release workflow publishes.
//
// Everything in them is derived from CHANGELOG.md and the release asset table,
// so what is pinned here is the derivation: which entries are quoted, which
// downloads are promised, and which line breaks survive GitHub's rendering.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface NotesOptions {
  version: string | null;
  tag: string | null;
  branch: string;
  intro: string | null;
  verification: string | null;
  out: string | null;
  help: boolean;
}

interface ReleaseNotesApi {
  parseArgs(argv: string[]): NotesOptions;
  changelogSections(source: string, version: string): { heading: string; body: string }[];
  downloadsSection(version: string): string;
  previousVersion(source: string, version: string): string | null;
  releaseNotes(input: {
    version: string;
    branch: string;
    tag?: string;
    source?: string;
    intro?: string;
    verification?: string;
  }): string;
  unwrapSoftBreaks(text: string): string;
}

const require = createRequire(import.meta.url);
const notes = require('../scripts/release-notes.js') as ReleaseNotesApi;

describe('parseArgs', () => {
  it('writes about package.json’s version, linking to main, when told nothing', () => {
    expect(notes.parseArgs([])).toEqual({
      version: null,
      tag: null,
      branch: 'main',
      intro: null,
      verification: null,
      out: null,
      help: false
    });
  });

  it('reads the flags in either form', () => {
    expect(notes.parseArgs(['--version=4.2.0', '--out', 'notes.md'])).toMatchObject({
      version: '4.2.0',
      out: 'notes.md'
    });
  });

  it('refuses an unknown flag and a swallowed value', () => {
    expect(() => notes.parseArgs(['--verison', '4.2.0'])).toThrow('Unknown option');
    expect(() => notes.parseArgs(['--tag', '--out', 'x'])).toThrow('--tag requires a value');
  });
});

// A changelog with the shape the real one has: an Unreleased section carrying
// the guidance comment, two closed versions, and the link definitions every
// generated URL is built from.
const CHANGELOG = `# Changelog

## [Unreleased]

<!--
Add changes here under the headings Added, Changed, Deprecated, Removed, Fixed,
or Security. Remove empty headings when preparing a release.
-->

### Fixed

- **A thing stopped being broken.** With a second line.

### Changed

- **Something else moved.**

## [2.0.0] - 2026-01-02

### Added

- **A feature.**

## [1.9.0] - 2026-01-01

### Added

- **An older feature.**

[Unreleased]: https://github.com/owner/repo/compare/Release_v2.0.0...HEAD
[2.0.0]: https://github.com/owner/repo/compare/Release_v1.9.0...Release_v2.0.0
[1.9.0]: https://github.com/owner/repo/compare/Release_v1.8.0...Release_v1.9.0
`;

describe('changelogSections', () => {
  it('reads the Unreleased entries for a version bumped without a heading of its own', () => {
    // `npm run release:prepare` gives the version a heading, but a bump made
    // by hand leaves the entries under Unreleased, and that is not an error.
    expect(notes.changelogSections(CHANGELOG, '2.1.0')).toEqual([
      { heading: "What's fixed", body: '- **A thing stopped being broken.** With a second line.' },
      { heading: "What's changed", body: '- **Something else moved.**' }
    ]);
  });

  it('prefers the version’s own section once the changelog is closed', () => {
    expect(notes.changelogSections(CHANGELOG, '2.0.0')).toEqual([
      { heading: "What's new", body: '- **A feature.**' }
    ]);
  });

  it('stops at the next version rather than swallowing the whole file', () => {
    // The oldest version has no version after it, so the thing that ends its
    // section is the block of link definitions -- which would otherwise be
    // quoted into the notes as though it were an entry.
    const sections = notes.changelogSections(CHANGELOG, '1.9.0');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.body).toBe('- **An older feature.**');
  });

  it('drops the guidance comment, and a heading with nothing under it', () => {
    const empty = '## [Unreleased]\n\n<!--\nAdd changes here.\n-->\n\n### Fixed\n\n## [1.0.0] - x\n';
    expect(notes.changelogSections(empty, '1.1.0')).toEqual([]);
  });

  it('keeps a heading it has no nicer name for', () => {
    const odd = '## [Unreleased]\n\n### Performance\n\n- **Faster.**\n';
    expect(notes.changelogSections(odd, '1.1.0')).toEqual([
      { heading: 'Performance', body: '- **Faster.**' }
    ]);
  });
});

describe('previousVersion', () => {
  it('is the release before this one', () => {
    expect(notes.previousVersion(CHANGELOG, '2.0.0')).toBe('1.9.0');
  });

  it('is the newest release when this one has no heading yet', () => {
    expect(notes.previousVersion(CHANGELOG, '2.1.0')).toBe('2.0.0');
  });

  it('is null for the first release there has ever been', () => {
    expect(notes.previousVersion('## [1.0.0] - 2026-01-01\n', '1.0.0')).toBeNull();
  });
});

describe('downloadsSection', () => {
  it('names the files the upload will actually put there', () => {
    // Built from the same table `upload-release-assets.js` uploads from, so
    // the notes cannot promise a filename that never arrives.
    expect(notes.downloadsSection('2.1.0')).toBe(
      [
        '- **Windows installer (recommended):** `Multi-Git-Client-Setup-2.1.0.exe`',
        '- **Portable Windows executable:** `Multi-Git-Client-Portable-2.1.0.exe`',
        '- **macOS disk image (Apple silicon and Intel):** `Multi-Git-Client-macOS-2.1.0.dmg`',
        '- **SHA-256 checksums:** `SHA256SUMS.txt`'
      ].join('\n')
    );
  });
});

// GitHub renders a release body with hard line breaks, so a paragraph wrapped
// at 80 columns -- which is how CHANGELOG.md is written -- publishes as a
// stack of short lines. What must survive is the breaks somebody meant.
describe('unwrapSoftBreaks', () => {
  it('joins the lines a writer wrapped, in a paragraph and in a bullet', () => {
    expect(notes.unwrapSoftBreaks('One sentence\nwrapped in two.')).toBe('One sentence wrapped in two.');
    expect(notes.unwrapSoftBreaks('- **A fix.** It was\n  wrapped here.')).toBe(
      '- **A fix.** It was wrapped here.'
    );
  });

  it('keeps each list item, heading and table row on its own line', () => {
    const source = '## Heading\n\n- first\n- second\n  - nested\n\n| a | b |\n| - | - |';

    expect(notes.unwrapSoftBreaks(source)).toBe(source);
  });

  it('keeps the line breaks inside a fenced code block', () => {
    const source = '```\nfirst line\nsecond line\n```\n\ntext that\nwraps';

    expect(notes.unwrapSoftBreaks(source)).toBe('```\nfirst line\nsecond line\n```\n\ntext that wraps');
  });

  it('keeps an indented code block, including one inside a list item', () => {
    // Four spaces past the prose is a code block, and the blank line in the
    // middle of one does not end it.
    const top = '    one\n\n    two';
    expect(notes.unwrapSoftBreaks(top)).toBe(top);

    const inItem = '- **A fix.** Measured:\n\n      before 786ms\n      after 4ms';
    expect(notes.unwrapSoftBreaks(inItem)).toBe(inItem);
  });

  it('honours a break the writer asked for', () => {
    // Markdown's own hard break: two trailing spaces, or a backslash.
    expect(notes.unwrapSoftBreaks('first  \nsecond')).toBe('first  \nsecond');
    expect(notes.unwrapSoftBreaks('first\\\nsecond')).toBe('first\\\nsecond');
  });

  it('leaves blank lines between blocks alone', () => {
    expect(notes.unwrapSoftBreaks('one\n\ntwo')).toBe('one\n\ntwo');
  });

  it('joins a changelog checked out with CRLF endings', () => {
    // Not hypothetical: this is how CHANGELOG.md sits in the working tree on
    // Windows, where releases are built. A carriage return left behind ends up
    // inside the joined line, and GitHub renders it as the break it was.
    expect(notes.unwrapSoftBreaks('- **A fix.** It was\r\n  wrapped here.\r\n')).toBe(
      '- **A fix.** It was wrapped here.\n'
    );
    expect(notes.unwrapSoftBreaks('one\r\n\r\ntwo')).toBe('one\n\ntwo');
  });
});

describe('releaseNotes', () => {
  const write = (extra: Record<string, string> = {}) =>
    notes.releaseNotes({
      version: '2.1.0',
      branch: 'main',
      tag: 'Release_v2.1.0',
      source: CHANGELOG,
      ...extra
    });

  it('says what changed rather than linking to it', () => {
    // The point of the rewrite: someone reading the release in a notification
    // should not have to open the changelog to learn what they are getting.
    const body = write();
    expect(body).toContain("## What's fixed");
    expect(body).toContain('- **A thing stopped being broken.**');
    expect(body).toContain("## What's changed");
  });

  it('lists the downloads and compares against the previous release', () => {
    const body = write();
    expect(body).toContain('`Multi-Git-Client-Setup-2.1.0.exe`');
    expect(body).toContain(
      '[All changes since 2.0.0](https://github.com/owner/repo/compare/Release_v2.0.0...Release_v2.1.0)'
    );
    expect(body).toContain('/blob/main/CHANGELOG.md#210---');
  });

  it('leaves out the parts nobody wrote, rather than inventing them', () => {
    // An opening line and an account of what was verified are judgement, and a
    // bland placeholder would be worse than their absence.
    const body = write();
    expect(body).not.toContain('## Verification');
    expect(body.startsWith("## What's fixed")).toBe(true);
  });

  it('places the author’s own words where they belong', () => {
    const body = write({ intro: '  2.1.0 is a bug-fix release.  ', verification: 'CI was green.' });
    expect(body.startsWith('2.1.0 is a bug-fix release.\n\n')).toBe(true);
    expect(body).toContain('## Verification\n\nCI was green.');
    // Still before the footer links, which stay last.
    expect(body.trimEnd().endsWith(')')).toBe(true);
  });

  it('falls back to a link when there is nothing to quote', () => {
    const body = notes.releaseNotes({ version: '2.1.0', branch: 'main', source: '' });
    expect(body).toContain('## What changed');
    expect(body).toContain('CHANGELOG.md');
    // No repository URL to build links from, so none are invented.
    expect(body).not.toContain('https://');
  });

  it('publishes a wrapped entry as one line per bullet', () => {
    // The changelog wraps its prose at 80 columns and a release body renders
    // every newline as a line break, so quoting it as written published a
    // paragraph broken mid-sentence at each wrap.
    const wrapped = [
      '## [Unreleased]',
      '',
      '### Fixed',
      '',
      '- **A thing stopped being broken.** It had been broken since the release',
      '  before this one, in a way nobody could see from the outside.',
      '- **A second thing.** Also wrapped',
      '  across two lines.',
      ''
    ].join('\n');

    const body = notes.releaseNotes({ version: '2.1.0', branch: 'main', source: wrapped });

    expect(body).toContain(
      '- **A thing stopped being broken.** It had been broken since the release before this one, in a way nobody could see from the outside.\n- **A second thing.** Also wrapped across two lines.'
    );
  });

  it('keeps the line breaks in a code block inside an entry', () => {
    const withCode = [
      '## [Unreleased]',
      '',
      '### Fixed',
      '',
      '- **Faster again.** Measured on Windows 11:',
      '',
      '      through the bridge  786ms',
      '      direct                4ms',
      ''
    ].join('\n');

    const body = notes.releaseNotes({ version: '2.1.0', branch: 'main', source: withCode });

    expect(body).toContain('      through the bridge  786ms\n      direct                4ms');
  });
});
