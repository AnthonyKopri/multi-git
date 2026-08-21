// Closing the Unreleased section when a release is uploaded.
//
// Every case here is a string in and a string out, which is the point: the
// release script can be trusted with the changelog without a test ever needing
// a git repository, a network, or a real release.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface ReleaseResult {
  changed: boolean;
  contents: string;
  reason: string;
}

interface ChangelogApi {
  today(now?: Date): string;
  repoUrlFromLinks(source: string): string | null;
  tagForVersion(source: string, version: string): string | null;
  releaseChangelog(
    source: string,
    options: { version: string; tag: string; date?: string }
  ): ReleaseResult;
}

const require = createRequire(import.meta.url);
const changelog = require('../scripts/changelog.js') as ChangelogApi;

const GUIDANCE = `<!--
Add changes here under the headings Added, Changed, Deprecated, Removed, Fixed,
or Security. Remove empty headings when preparing a release.
-->`;

const REPO = 'https://github.com/AnthonyKopri/multi-git';

function sample(unreleasedBody: string): string {
  return `# Changelog

Intro paragraph.

## [Unreleased]

${GUIDANCE}
${unreleasedBody}
## [3.1.2] - 2026-08-20

### Fixed

- Something older.

## [3.1.1] - 2026-08-11

### Fixed

- Something older still.

[Unreleased]: ${REPO}/compare/Release_v3.1.0...HEAD
[3.1.2]: ${REPO}/compare/Release_v3.1.1...Release_v3.1.2
[3.1.1]: ${REPO}/compare/Release_v3.1.0...Release_v3.1.1
`;
}

const ENTRIES = `
### Added

- A new thing.

### Fixed

- A fixed thing.

`;

function release(source: string, version = '3.1.3'): ReleaseResult {
  return changelog.releaseChangelog(source, {
    version,
    tag: `Release_v${version}`,
    date: '2026-08-21'
  });
}

describe('releaseChangelog', () => {
  it('moves the Unreleased entries under a heading for the version', () => {
    const { changed, contents } = release(sample(ENTRIES));

    expect(changed).toBe(true);
    expect(contents).toContain('## [3.1.3] - 2026-08-21');

    // The entries are below the new heading and above the previous release.
    const versionAt = contents.indexOf('## [3.1.3]');
    const previousAt = contents.indexOf('## [3.1.2]');
    const addedAt = contents.indexOf('- A new thing.');

    expect(addedAt).toBeGreaterThan(versionAt);
    expect(addedAt).toBeLessThan(previousAt);
  });

  it('leaves the guidance comment under Unreleased, where it belongs', () => {
    // It describes how to fill Unreleased in. Moving it into the release would
    // put instructions for the next release inside the one that just shipped.
    const { contents } = release(sample(ENTRIES));

    const unreleasedAt = contents.indexOf('## [Unreleased]');
    const guidanceAt = contents.indexOf('Add changes here under the headings');
    const versionAt = contents.indexOf('## [3.1.3]');

    expect(guidanceAt).toBeGreaterThan(unreleasedAt);
    expect(guidanceAt).toBeLessThan(versionAt);
    expect(contents.match(/Add changes here under the headings/g)).toHaveLength(1);
  });

  it('adds the version link and re-bases the Unreleased one onto the new tag', () => {
    // A version with no link definition renders as literal brackets, so the
    // release people are looking for is the one that is not a link.
    const { contents } = release(sample(ENTRIES));

    expect(contents).toContain(
      `[3.1.3]: ${REPO}/compare/Release_v3.1.2...Release_v3.1.3`
    );
    expect(contents).toContain(`[Unreleased]: ${REPO}/compare/Release_v3.1.3...HEAD`);
    expect(contents).not.toContain(`[Unreleased]: ${REPO}/compare/Release_v3.1.0...HEAD`);
  });

  it('compares from the previous version’s own tag, whatever it is called', () => {
    const source = sample(ENTRIES).replace(
      `[3.1.2]: ${REPO}/compare/Release_v3.1.1...Release_v3.1.2`,
      `[3.1.2]: ${REPO}/compare/Release_v3.1.1...v3.1.2-final`
    );

    expect(release(source).contents).toContain(
      `[3.1.3]: ${REPO}/compare/v3.1.2-final...Release_v3.1.3`
    );
  });

  it('learns the repository URL from the links already in the file', () => {
    // So a fork gets its own links without anyone editing a constant here.
    const forked = sample(ENTRIES).replaceAll(REPO, 'https://github.com/someone/else');

    expect(release(forked).contents).toContain(
      '[3.1.3]: https://github.com/someone/else/compare/Release_v3.1.2...Release_v3.1.3'
    );
  });

  it('does nothing on a second run', () => {
    // `release:upload` is re-run whenever an asset upload fails. A second run
    // must not append a duplicate section.
    const once = release(sample(ENTRIES));
    const twice = release(once.contents);

    expect(twice.changed).toBe(false);
    expect(twice.contents).toBe(once.contents);
    expect(twice.reason).toMatch(/already/i);
  });

  it('does nothing when Unreleased holds only its guidance comment', () => {
    const result = release(sample('\n'));

    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/no entries/i);
  });

  it('does nothing when there is no Unreleased heading to close', () => {
    const result = release('# Changelog\n\n## [3.1.2] - 2026-08-20\n\n- Old.\n');

    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/Unreleased/);
  });

  it('links a first release to its tag, having nothing to compare against', () => {
    const first = `# Changelog

## [Unreleased]
${ENTRIES}
[Unreleased]: ${REPO}/compare/Releases...HEAD
`;

    expect(release(first, '1.0.0').contents).toContain(
      `[1.0.0]: ${REPO}/releases/tag/Release_v1.0.0`
    );
  });

  it('still moves the entries when there are no links to learn from', () => {
    // The entries are the part that matters; links stay whatever they were.
    const noLinks = `# Changelog

## [Unreleased]
${ENTRIES}
## [3.1.2] - 2026-08-20

- Old.
`;
    const result = release(noLinks);

    expect(result.changed).toBe(true);
    expect(result.contents).toContain('## [3.1.3] - 2026-08-21');
    expect(result.contents).not.toContain('[3.1.3]: ');
  });
});

describe('reading what the file already says', () => {
  it('finds the repository URL from a compare link or a tag link', () => {
    expect(changelog.repoUrlFromLinks(`[Unreleased]: ${REPO}/compare/a...HEAD`)).toBe(REPO);
    expect(changelog.repoUrlFromLinks(`[1.0.0]: ${REPO}/releases/tag/Releases`)).toBe(REPO);
    expect(changelog.repoUrlFromLinks('# Changelog\n\nNo links here.')).toBeNull();
  });

  it('reads the tag a version links to', () => {
    expect(changelog.tagForVersion(sample(ENTRIES), '3.1.2')).toBe('Release_v3.1.2');
    expect(changelog.tagForVersion(sample(ENTRIES), '9.9.9')).toBeNull();
  });
});

describe('today', () => {
  it('writes the local date the way the changelog does', () => {
    // Local, not UTC: the date beside a release should be the day the person
    // publishing it thinks it is.
    expect(changelog.today(new Date(2026, 7, 3))).toBe('2026-08-03');
    expect(changelog.today(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
