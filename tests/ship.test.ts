// The release driver's argument and answer handling.
//
// The steps themselves spawn the documented commands and are exercised by
// running them; what is worth pinning here is the two places a wrong reading
// would do something the user did not ask for — a misparsed flag, and a
// mistyped answer at a prompt.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface ShipOptions {
  bump: string | null;
  tag: string | null;
  repo: string | null;
  yes: boolean;
  dryRun: boolean;
  publish: boolean;
  changelog: boolean;
  intro: string | null;
  verification: string | null;
  help: boolean;
}

interface AskerLike {
  rl: { close: () => void } | null;
  close(): void;
}

interface ShipApi {
  parseArgs(argv: string[]): ShipOptions;
  answerToAction(answer: unknown): 'run' | 'skip' | 'quit' | 'unclear';
  Asker: new (options: { yes: boolean }) => AskerLike;
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
const ship = require('../scripts/ship.js') as ShipApi;

describe('parseArgs', () => {
  it('asks about everything when told nothing', () => {
    expect(ship.parseArgs([])).toEqual({
      bump: null,
      tag: null,
      repo: null,
      yes: false,
      dryRun: false,
      // Publishing is what makes a release public, so it never happens
      // because a flag was left off.
      publish: false,
      changelog: true,
      // The two halves of the notes nobody can derive. Absent by default, and
      // the release says so rather than filling them in.
      intro: null,
      verification: null,
      help: false
    });
  });

  it('reads the flags in either form', () => {
    expect(ship.parseArgs(['--bump=minor', '-R', 'owner/repo', '--dry-run'])).toMatchObject({
      bump: 'minor',
      repo: 'owner/repo',
      dryRun: true
    });

    expect(ship.parseArgs(['--bump', 'patch', '--tag', 'Release_v9.9.9', '-y'])).toMatchObject({
      bump: 'patch',
      tag: 'Release_v9.9.9',
      yes: true
    });
  });

  it('accepts the upload step’s own flag, so it means the same thing here', () => {
    // Reaching for `--no-changelog` on the command that wraps the upload is
    // the obvious thing to do, and it used to stop the release with
    // "Unknown option".
    expect(ship.parseArgs(['--no-changelog']).changelog).toBe(false);
    expect(ship.parseArgs([]).changelog).toBe(true);
  });

  it('refuses an unknown flag rather than ignoring it', () => {
    // A typo in a release command should stop the release, not run one that
    // silently means something else.
    expect(() => ship.parseArgs(['--publsh'])).toThrow('Unknown option');
    // And says where the list is, rather than leaving it to be guessed.
    expect(() => ship.parseArgs(['--publsh'])).toThrow('--help');
  });

  it('refuses a flag whose value was swallowed by the next flag', () => {
    expect(() => ship.parseArgs(['--bump', '--yes'])).toThrow('--bump requires a value');
  });
});

describe('answerToAction', () => {
  it('treats a bare Enter as yes, because the prompt says [Y]', () => {
    expect(ship.answerToAction('')).toBe('run');
    expect(ship.answerToAction('y')).toBe('run');
    expect(ship.answerToAction('YES')).toBe('run');
  });

  it('reads a skip and a refusal the same way', () => {
    // Both mean "not this step", and neither means "stop everything".
    expect(ship.answerToAction('s')).toBe('skip');
    expect(ship.answerToAction('n')).toBe('skip');
    expect(ship.answerToAction('no')).toBe('skip');
  });

  it('reads a quit', () => {
    expect(ship.answerToAction('q')).toBe('quit');
    expect(ship.answerToAction('abort')).toBe('quit');
  });

  it('calls anything else unclear rather than guessing', () => {
    // "yeah" is not yes here. Guessing at a release step is how something
    // gets published that nobody meant to publish.
    expect(ship.answerToAction('yeah')).toBe('unclear');
    expect(ship.answerToAction('maybe')).toBe('unclear');
    expect(ship.answerToAction(undefined)).toBe('unclear');
  });

  it('ignores surrounding whitespace and case', () => {
    expect(ship.answerToAction('  Q  ')).toBe('quit');
    expect(ship.answerToAction(' Skip ')).toBe('skip');
  });
});

describe('the prompt across a step that owns the terminal', () => {
  it('forgets a closed interface, so a later step can ask again', () => {
    // Step 1 closes this so `release.js` can own the terminal for its own
    // questions. Leaving the closed interface in place made every step after
    // it throw "readline was closed" — after the build had already succeeded,
    // which is the worst possible moment to lose the ability to ask.
    const asker = new ship.Asker({ yes: false });
    let closed = 0;
    asker.rl = { close: () => { closed += 1; } };

    asker.close();

    expect(closed).toBe(1);
    expect(asker.rl).toBeNull();
  });

  it('can be closed twice without complaining', () => {
    // The steps close it on the way out of several branches, and main() closes
    // it again in its finally.
    const asker = new ship.Asker({ yes: false });
    let closed = 0;
    asker.rl = { close: () => { closed += 1; } };

    asker.close();
    asker.close();

    expect(closed).toBe(1);
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
  it('reads the Unreleased entries, which is where they are at step 3', () => {
    // The notes are written before the changelog is closed, so a version with
    // no heading of its own is the ordinary case rather than an error.
    expect(ship.changelogSections(CHANGELOG, '2.1.0')).toEqual([
      { heading: "What's fixed", body: '- **A thing stopped being broken.** With a second line.' },
      { heading: "What's changed", body: '- **Something else moved.**' }
    ]);
  });

  it('prefers the version’s own section once the changelog is closed', () => {
    expect(ship.changelogSections(CHANGELOG, '2.0.0')).toEqual([
      { heading: "What's new", body: '- **A feature.**' }
    ]);
  });

  it('stops at the next version rather than swallowing the whole file', () => {
    // The oldest version has no version after it, so the thing that ends its
    // section is the block of link definitions -- which would otherwise be
    // quoted into the notes as though it were an entry.
    const sections = ship.changelogSections(CHANGELOG, '1.9.0');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.body).toBe('- **An older feature.**');
  });

  it('drops the guidance comment, and a heading with nothing under it', () => {
    const empty = '## [Unreleased]\n\n<!--\nAdd changes here.\n-->\n\n### Fixed\n\n## [1.0.0] - x\n';
    expect(ship.changelogSections(empty, '1.1.0')).toEqual([]);
  });

  it('keeps a heading it has no nicer name for', () => {
    const odd = '## [Unreleased]\n\n### Performance\n\n- **Faster.**\n';
    expect(ship.changelogSections(odd, '1.1.0')).toEqual([
      { heading: 'Performance', body: '- **Faster.**' }
    ]);
  });
});

describe('previousVersion', () => {
  it('is the release before this one', () => {
    expect(ship.previousVersion(CHANGELOG, '2.0.0')).toBe('1.9.0');
  });

  it('is the newest release when this one has no heading yet', () => {
    expect(ship.previousVersion(CHANGELOG, '2.1.0')).toBe('2.0.0');
  });

  it('is null for the first release there has ever been', () => {
    expect(ship.previousVersion('## [1.0.0] - 2026-01-01\n', '1.0.0')).toBeNull();
  });
});

describe('downloadsSection', () => {
  it('names the files the upload will actually put there', () => {
    // Built from the same table `upload-release-assets.js` uploads from, so
    // the notes cannot promise a filename that never arrives.
    expect(ship.downloadsSection('2.1.0')).toBe(
      [
        '- **Windows installer (recommended):** `Multi-Git-Client-Setup-2.1.0.exe`',
        '- **Portable Windows executable:** `Multi-Git-Client-Portable-2.1.0.exe`',
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
    expect(ship.unwrapSoftBreaks('One sentence\nwrapped in two.')).toBe('One sentence wrapped in two.');
    expect(ship.unwrapSoftBreaks('- **A fix.** It was\n  wrapped here.')).toBe(
      '- **A fix.** It was wrapped here.'
    );
  });

  it('keeps each list item, heading and table row on its own line', () => {
    const source = '## Heading\n\n- first\n- second\n  - nested\n\n| a | b |\n| - | - |';

    expect(ship.unwrapSoftBreaks(source)).toBe(source);
  });

  it('keeps the line breaks inside a fenced code block', () => {
    const source = '```\nfirst line\nsecond line\n```\n\ntext that\nwraps';

    expect(ship.unwrapSoftBreaks(source)).toBe('```\nfirst line\nsecond line\n```\n\ntext that wraps');
  });

  it('keeps an indented code block, including one inside a list item', () => {
    // Four spaces past the prose is a code block, and the blank line in the
    // middle of one does not end it.
    const top = '    one\n\n    two';
    expect(ship.unwrapSoftBreaks(top)).toBe(top);

    const inItem = '- **A fix.** Measured:\n\n      before 786ms\n      after 4ms';
    expect(ship.unwrapSoftBreaks(inItem)).toBe(inItem);
  });

  it('honours a break the writer asked for', () => {
    // Markdown's own hard break: two trailing spaces, or a backslash.
    expect(ship.unwrapSoftBreaks('first  \nsecond')).toBe('first  \nsecond');
    expect(ship.unwrapSoftBreaks('first\\\nsecond')).toBe('first\\\nsecond');
  });

  it('leaves blank lines between blocks alone', () => {
    expect(ship.unwrapSoftBreaks('one\n\ntwo')).toBe('one\n\ntwo');
  });

  it('joins a changelog checked out with CRLF endings', () => {
    // Not hypothetical: this is how CHANGELOG.md sits in the working tree on
    // Windows, where releases are built. A carriage return left behind ends up
    // inside the joined line, and GitHub renders it as the break it was.
    expect(ship.unwrapSoftBreaks('- **A fix.** It was\r\n  wrapped here.\r\n')).toBe(
      '- **A fix.** It was wrapped here.\n'
    );
    expect(ship.unwrapSoftBreaks('one\r\n\r\ntwo')).toBe('one\n\ntwo');
  });
});

describe('releaseNotes', () => {
  const notes = (extra: Record<string, string> = {}) =>
    ship.releaseNotes({
      version: '2.1.0',
      branch: 'main',
      tag: 'Release_v2.1.0',
      source: CHANGELOG,
      ...extra
    });

  it('says what changed rather than linking to it', () => {
    // The point of the rewrite: someone reading the release in a notification
    // should not have to open the changelog to learn what they are getting.
    const body = notes();
    expect(body).toContain("## What's fixed");
    expect(body).toContain('- **A thing stopped being broken.**');
    expect(body).toContain("## What's changed");
  });

  it('lists the downloads and compares against the previous release', () => {
    const body = notes();
    expect(body).toContain('`Multi-Git-Client-Setup-2.1.0.exe`');
    expect(body).toContain(
      '[All changes since 2.0.0](https://github.com/owner/repo/compare/Release_v2.0.0...Release_v2.1.0)'
    );
    expect(body).toContain('/blob/main/CHANGELOG.md#210---');
  });

  it('leaves out the parts nobody wrote, rather than inventing them', () => {
    // An opening line and an account of what was verified are judgement, and a
    // bland placeholder would be worse than their absence.
    const body = notes();
    expect(body).not.toContain('## Verification');
    expect(body.startsWith("## What's fixed")).toBe(true);
  });

  it('places the author’s own words where they belong', () => {
    const body = notes({ intro: '  2.1.0 is a bug-fix release.  ', verification: 'CI was green.' });
    expect(body.startsWith('2.1.0 is a bug-fix release.\n\n')).toBe(true);
    expect(body).toContain('## Verification\n\nCI was green.');
    // Still before the footer links, which stay last.
    expect(body.trimEnd().endsWith(')')).toBe(true);
  });

  it('falls back to a link when there is nothing to quote', () => {
    const body = ship.releaseNotes({ version: '2.1.0', branch: 'main', source: '' });
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

    const body = ship.releaseNotes({ version: '2.1.0', branch: 'main', source: wrapped });

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

    const body = ship.releaseNotes({ version: '2.1.0', branch: 'main', source: withCode });

    expect(body).toContain('      through the bridge  786ms\n      direct                4ms');
  });
});
