'use strict';

// Closes the Unreleased section when a release is published.
//
// The changelog says it follows Keep a Changelog, and the part that gets
// forgotten by hand is the bookkeeping rather than the prose: entries stay
// under Unreleased after the release that shipped them, the `[Unreleased]`
// compare link keeps pointing at a tag two releases back, and a version that
// has no link definition renders as literal `[3.1.2]` brackets. All three had
// already drifted before this existed.
//
// Everything here is a pure string transform so the release script can be
// tested without a git repository, a network, or a real changelog.

const UNRELEASED_HEADING = '## [Unreleased]';
const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** Today, as the person running the release would write it. */
function today(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The repository URL the existing link definitions point at.
 *
 * Read from the file rather than configured, so a fork gets its own links
 * without anyone remembering to change a constant here.
 */
function repoUrlFromLinks(source) {
  const match = /^\[[^\]]+\]:\s*(https?:\/\/\S+?)\/(?:compare|releases)\//m.exec(source);
  return match ? match[1] : null;
}

/** The tag a version's existing link points at, for use as a compare base. */
function tagForVersion(source, version) {
  const escaped = version.replace(/[.]/g, '\\.');
  const match = new RegExp(`^\\[${escaped}\\]:\\s*\\S*?\\.\\.\\.(\\S+)\\s*$`, 'm').exec(source);
  return match ? match[1] : null;
}

/** True when a body holds something other than blank lines and guidance comments. */
function hasEntries(body) {
  return body.replace(HTML_COMMENT, '').trim() !== '';
}

/**
 * Moves the Unreleased entries under a heading for `version`.
 *
 * Reports instead of throwing for every condition a second run would produce —
 * an already-recorded version, an empty Unreleased section — because
 * `release:upload` is re-run whenever an asset upload fails, and the second run
 * must not append a duplicate section or fail the release over one.
 *
 * @returns {{changed: boolean, contents: string, reason: string}}
 */
function releaseChangelog(source, options) {
  const { version, tag, date = today() } = options;

  const unchanged = (reason) => ({ changed: false, contents: source, reason });

  const lines = source.split('\n');
  const unreleasedAt = lines.findIndex((line) => line.trim() === UNRELEASED_HEADING);
  if (unreleasedAt === -1) {
    return unchanged(`no "${UNRELEASED_HEADING}" heading was found`);
  }

  // The first version heading below Unreleased is the previous release, and
  // the end of the section being moved.
  let previousAt = -1;
  for (let index = unreleasedAt + 1; index < lines.length; index += 1) {
    if (VERSION_HEADING.test(lines[index])) {
      previousAt = index;
      break;
    }
  }

  const body = lines.slice(unreleasedAt + 1, previousAt === -1 ? lines.length : previousAt);
  const previousVersion = previousAt === -1 ? null : VERSION_HEADING.exec(lines[previousAt])[1];

  if (previousVersion === version) {
    return unchanged(`${version} is already the newest entry`);
  }
  if (new RegExp(`^## \\[${version.replace(/[.]/g, '\\.')}\\]`, 'm').test(source)) {
    return unchanged(`${version} already has a section`);
  }
  if (!hasEntries(body.join('\n'))) {
    return unchanged('the Unreleased section has no entries to move');
  }

  // The guidance comment describes how to fill Unreleased in, so it belongs to
  // the heading, not to the entries being moved out from under it.
  const guidance = body.join('\n').match(HTML_COMMENT) ?? [];
  const moved = body.join('\n').replace(HTML_COMMENT, '').trim();

  const rebuilt = [
    UNRELEASED_HEADING,
    '',
    ...(guidance.length > 0 ? [guidance.join('\n'), ''] : []),
    `## [${version}] - ${date}`,
    '',
    moved,
    ''
  ];

  const contents = [
    ...lines.slice(0, unreleasedAt),
    ...rebuilt,
    ...(previousAt === -1 ? [] : lines.slice(previousAt))
  ].join('\n');

  return {
    changed: true,
    contents: withLinks(contents, { version, tag, previousVersion, source }),
    reason: `moved the Unreleased entries under ${version}`
  };
}

/**
 * Adds the version's link definition and re-bases the Unreleased one.
 *
 * A missing definition is not cosmetic: the heading renders as literal
 * brackets, so the version people are looking for is the one that is not a
 * link.
 */
function withLinks(contents, { version, tag, previousVersion, source }) {
  const repoUrl = repoUrlFromLinks(source);
  if (!repoUrl) {
    // Nothing to pattern-match against. The entries still moved, which is the
    // part that matters; links stay whatever they were.
    return contents;
  }

  const previousTag = previousVersion
    ? (tagForVersion(source, previousVersion) ?? `Release_v${previousVersion}`)
    : null;

  const definition = previousTag
    ? `[${version}]: ${repoUrl}/compare/${previousTag}...${tag}`
    : `[${version}]: ${repoUrl}/releases/tag/${tag}`;

  const unreleasedLink = new RegExp(`^\\[Unreleased\\]:.*$`, 'm');

  if (unreleasedLink.test(contents)) {
    return contents.replace(
      unreleasedLink,
      `[Unreleased]: ${repoUrl}/compare/${tag}...HEAD\n${definition}`
    );
  }

  // No Unreleased link to anchor to; put the new definition above the first
  // definition there is, which is the newest.
  return contents.replace(/^\[[^\]]+\]:.*$/m, (first) => `${definition}\n${first}`);
}

module.exports = {
  UNRELEASED_HEADING,
  today,
  repoUrlFromLinks,
  tagForVersion,
  releaseChangelog
};
