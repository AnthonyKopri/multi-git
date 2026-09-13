// Preparing a release: the version bump and its changelog section, together.
//
// Both halves are exercised against text rather than the real files, since
// writing is only applyVersion() and a writeFileSync of what plan() returns.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface PrepareApi {
  parseArgs(argv: string[]): { bump: string | null; dryRun: boolean; help: boolean };
  plan(input: { current: string; spec: string; changelog: string }): {
    version: string;
    tag: string;
    changelog: { changed: boolean; contents: string; reason: string };
  };
}

const require = createRequire(import.meta.url);
const prepare = require('../scripts/prepare-release.js') as PrepareApi;

const CHANGELOG = `# Changelog

## [Unreleased]

<!--
Add changes here under the headings Added, Changed, Deprecated, Removed, Fixed,
or Security. Remove empty headings when preparing a release.
-->

### Added

- **A macOS download.**

## [4.1.4] - 2026-09-12

### Changed

- **A stash row now has room for the stash.**

[Unreleased]: https://github.com/owner/repo/compare/Release_v4.1.4...HEAD
[4.1.4]: https://github.com/owner/repo/compare/Release_v4.1.3...Release_v4.1.4
`;

describe('parseArgs', () => {
  it('insists on being told which version', () => {
    // Guessing "patch" would prepare a release nobody chose.
    expect(() => prepare.parseArgs([])).toThrow('--bump');
    expect(prepare.parseArgs(['--help']).help).toBe(true);
  });

  it('reads the bump in either form', () => {
    expect(prepare.parseArgs(['--bump', 'minor'])).toEqual({ bump: 'minor', dryRun: false, help: false });
    expect(prepare.parseArgs(['--bump=5.0.0', '--dry-run'])).toEqual({ bump: '5.0.0', dryRun: true, help: false });
  });

  it('refuses unknown flags and a swallowed value', () => {
    expect(() => prepare.parseArgs(['--bmup', 'minor'])).toThrow('Unknown option');
    expect(() => prepare.parseArgs(['--bump', '--dry-run'])).toThrow('--bump requires a value');
  });
});

describe('plan', () => {
  it('names the version and the tag the Release workflow will create', () => {
    const result = prepare.plan({ current: '4.1.4', spec: 'major', changelog: CHANGELOG });

    expect(result.version).toBe('5.0.0');
    expect(result.tag).toBe('Release_v5.0.0');
  });

  it('gives the version its changelog section, linked to the tag to come', () => {
    const { changelog } = prepare.plan({ current: '4.1.4', spec: 'minor', changelog: CHANGELOG });

    expect(changelog.changed).toBe(true);
    expect(changelog.contents).toMatch(/^## \[4\.2\.0\] - \d{4}-\d{2}-\d{2}$/m);
    // The entry moved out from under Unreleased, which keeps its guidance.
    expect(changelog.contents.indexOf('**A macOS download.**')).toBeGreaterThan(
      changelog.contents.indexOf('## [4.2.0]')
    );
    expect(changelog.contents).toContain(
      '[4.2.0]: https://github.com/owner/repo/compare/Release_v4.1.4...Release_v4.2.0'
    );
    expect(changelog.contents).toContain(
      '[Unreleased]: https://github.com/owner/repo/compare/Release_v4.2.0...HEAD'
    );
  });

  it('refuses to prepare the version that is already current', () => {
    expect(() => prepare.plan({ current: '4.1.4', spec: '4.1.4', changelog: CHANGELOG })).toThrow(
      'already 4.1.4'
    );
    expect(() => prepare.plan({ current: '4.1.4', spec: 'none', changelog: CHANGELOG })).toThrow(
      'already 4.1.4'
    );
  });

  it('still bumps when there is nothing to move, and says why the changelog was left', () => {
    const empty = CHANGELOG.replace('### Added\n\n- **A macOS download.**\n\n', '');
    const result = prepare.plan({ current: '4.1.4', spec: 'patch', changelog: empty });

    expect(result.version).toBe('4.1.5');
    expect(result.changelog.changed).toBe(false);
    expect(result.changelog.reason).toContain('no entries');
  });
});
