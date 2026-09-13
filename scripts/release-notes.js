'use strict';

// Writes the body of a GitHub release from CHANGELOG.md.
//
// Run by the Release workflow just before it creates the draft, and runnable
// by hand to see what a release will say:
//
//   node scripts/release-notes.js
//   node scripts/release-notes.js --version 4.2.0 --intro notes/intro.md
//
// The notes are only a starting point. Everything in them is derived, so they
// can be edited on the release afterwards without anything here depending on
// what they say.
const fs = require('fs');
const path = require('path');

const { releaseTag, RELEASE_ASSETS, CHECKSUM_BASENAME, CHECKSUM_LABEL } = require('./release-assets');
const { versionAnchor, repoUrlFromLinks, tagForVersion } = require('./changelog');

const ROOT = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** Keep a Changelog's section names, as release notes introduce them. */
const NOTE_HEADINGS = Object.freeze({
  Added: "What's new",
  Changed: "What's changed",
  Deprecated: "What's deprecated",
  Removed: "What's been removed",
  Fixed: "What's fixed",
  Security: 'Security'
});

/** The body of one `## [version]` block, up to the next one. */
function changelogBody(source, version) {
  const escaped = version.replace(/[.]/g, '\\.');
  const heading =
    new RegExp(`^## \\[${escaped}\\][^\\n]*$`, 'm').exec(source) ??
    // `npm run release:prepare` gives the version its heading. A version that
    // was bumped without it still has its entries under Unreleased.
    new RegExp('^## \\[Unreleased\\][^\\n]*$', 'm').exec(source);

  if (!heading) {
    return '';
  }

  const rest = source.slice(heading.index + heading[0].length);
  // The next version, or -- for the oldest one, which has no version after it
  // -- the block of link definitions that closes the file.
  const end = /^## \[/m.exec(rest) ?? /^\[[^\]]+\]:\s*\S+$/m.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

/**
 * What this release ships, as `{ heading, body }` in the order written.
 *
 * The entries themselves rather than a link to them: a release people read in
 * their notifications should say what changed without a round trip, which is
 * what 4.1.0 and 4.1.1 did by hand.
 */
function changelogSections(source, version) {
  const body = changelogBody(source, version).replace(HTML_COMMENT, '');
  const found = [...body.matchAll(/^### (.+?)[ \t]*$/gm)];

  return found
    .map((match, index) => ({
      heading: NOTE_HEADINGS[match[1]] ?? match[1],
      body: body
        .slice(match.index + match[0].length, found[index + 1]?.index ?? undefined)
        .trim()
    }))
    .filter((section) => section.body !== '');
}

/** The downloads list, named from the same table the upload uses. */
function downloadsSection(version) {
  return [
    ...Object.values(RELEASE_ASSETS).map(
      (spec) => `- **${spec.label}:** \`${spec.basename(version)}\``
    ),
    `- **${CHECKSUM_LABEL}:** \`${CHECKSUM_BASENAME}\``
  ].join('\n');
}

/**
 * The version released before this one, from the changelog's own headings.
 *
 * When this version has no heading yet -- it was bumped without
 * `npm run release:prepare` -- the newest heading in the file is the previous
 * release.
 */
function previousVersion(source, version) {
  const versions = [...source.matchAll(/^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]/gm)].map(
    (match) => match[1]
  );
  const index = versions.indexOf(version);

  return (index === -1 ? versions[0] : versions[index + 1]) ?? null;
}

/** Markdown's own ways of saying "break here": two trailing spaces, or a `\`. */
const HARD_BREAK = /( {2,}|\\)$/;
const FENCE = /^\s*(?:```|~~~)/;
const LIST_ITEM = /^( *)([-*+]|\d+[.)])( +)/;
/** Lines that begin something of their own and must not be joined onto.  */
const BLOCK_START = /^ *(?:#{1,6} |>|\||-{3,} *$|_{3,} *$|\*{3,} *$)/;
/** A line this far past its block's prose is an indented code block. */
const CODE_INDENT = 4;

/**
 * Joins lines that a writer wrapped, because a release body is not rendered
 * the way the file it came from is.
 *
 * GitHub renders release notes with hard line breaks: every newline becomes a
 * `<br>`. CHANGELOG.md wraps its prose at 80 columns, so quoting an entry
 * verbatim published a paragraph broken mid-sentence at every wrap -- 13 of
 * them in the first 4.1.3 draft. That is also why 4.1.0, 4.1.1 and 4.1.2 were
 * written by hand with each bullet on one long line.
 *
 * Only continuations are joined. A heading, a list item, a blank line and a
 * table row each begin something; a fenced or indented code block means what
 * its line breaks say; and a line ending in Markdown's own hard break asked
 * for one.
 */
function unwrapSoftBreaks(text) {
  const out = [];
  let fenced = false;
  // Where the current block's prose starts, and where an indented code block
  // does. Null for neither, which is also what a blank line restores.
  let blockIndent = null;
  let codeIndent = null;

  // Split on either ending: the changelog is checked out CRLF on Windows, and
  // a `\r` left on the end of a line would be carried into the middle of the
  // line it was joined to, where GitHub renders it as the break this removes.
  for (const line of text.split(/\r?\n/)) {
    const indent = /^ */.exec(line)[0].length;

    if (FENCE.test(line)) {
      fenced = !fenced;
      out.push(line);
      blockIndent = null;
      codeIndent = null;
      continue;
    }

    if (fenced || line.trim() === '') {
      out.push(line);
      // A blank line ends a paragraph, but an indented code block may have one
      // in the middle of it, so that is deliberately not forgotten here.
      if (!fenced) blockIndent = null;
      continue;
    }

    if (codeIndent !== null && indent >= codeIndent) {
      out.push(line);
      continue;
    }
    codeIndent = null;

    const item = LIST_ITEM.exec(line);
    const starts = blockIndent === null;

    if (!item && indent >= (starts ? CODE_INDENT : blockIndent + CODE_INDENT)) {
      codeIndent = indent;
      out.push(line);
      continue;
    }

    const previous = out[out.length - 1];
    if (!starts && !item && !BLOCK_START.test(line) && previous && !HARD_BREAK.test(previous)) {
      out[out.length - 1] = `${previous.replace(/ +$/, '')} ${line.trim()}`;
      continue;
    }

    out.push(line);
    blockIndent = item ? item[1].length + item[2].length + item[3].length : indent;
  }

  return out.join('\n');
}

/**
 * The body of the release.
 *
 * Everything derivable is derived, so it names the right version, the right
 * anchor and the right comparison every time; the repository URL comes from
 * the changelog's own link definitions, so a fork links to itself.
 *
 * The two parts that cannot be derived are the opening line and the account of
 * what was verified. Those are the author's, supplied with `--intro` and
 * `--verification`, and left out rather than filled with something bland when
 * they are not.
 */
function releaseNotes({ version, branch, tag, source = '', intro = '', verification = '' }) {
  const repoUrl = repoUrlFromLinks(source);
  const sections = changelogSections(source, version);
  const blocks = [];

  if (intro.trim() !== '') {
    blocks.push(intro.trim());
  }

  for (const section of sections) {
    blocks.push(`## ${section.heading}\n\n${section.body}`);
  }

  if (sections.length === 0) {
    // Nothing to quote. Better a link than an empty release.
    blocks.push(
      `## What changed\n\nSee ${
        repoUrl
          ? `[the ${version} entry in the changelog](${repoUrl}/blob/${branch}/CHANGELOG.md#${versionAnchor(source, version)})`
          : 'CHANGELOG.md'
      }.`
    );
  }

  blocks.push(
    `## Downloads\n\n${downloadsSection(version)}\n\nThe portable app shares configuration with an installed copy.`
  );

  if (verification.trim() !== '') {
    blocks.push(`## Verification\n\n${verification.trim()}`);
  }

  if (repoUrl) {
    const previous = previousVersion(source, version);
    const previousTag = previous === null ? null : tagForVersion(source, previous);
    const links = [
      `[Full changelog](${repoUrl}/blob/${branch}/CHANGELOG.md#${versionAnchor(source, version)})`
    ];

    if (previousTag && tag) {
      links.push(`[All changes since ${previous}](${repoUrl}/compare/${previousTag}...${tag})`);
    }

    blocks.push(links.join(' · '));
  }

  // Applied to the whole body rather than only to what the changelog supplied:
  // an `--intro` or `--verification` file is prose somebody wrote in an editor,
  // and is wrapped as often as not.
  return unwrapSoftBreaks(blocks.join('\n\n'));
}

/** Reads a file given on the command line, so a missing one is the user's. */
function readNotesFile(file, what) {
  if (!file) {
    return '';
  }

  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Could not read the ${what} from ${file}: ${error.message}`);
  }
}

function parseArgs(argv) {
  const options = {
    version: null,
    tag: null,
    branch: 'main',
    intro: null,
    verification: null,
    out: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, null];
    const nextValue = () => {
      if (inlineValue !== null) return inlineValue;
      index += 1;
      if (index >= argv.length || argv[index].startsWith('-')) {
        throw new Error(`${flag} requires a value.`);
      }
      return argv[index];
    };

    if (flag === '--version') options.version = nextValue();
    else if (flag === '--tag') options.tag = nextValue();
    else if (flag === '--branch') options.branch = nextValue();
    else if (flag === '--intro') options.intro = nextValue();
    else if (flag === '--verification') options.verification = nextValue();
    else if (flag === '--out') options.out = nextValue();
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}. Run with --help for the list.`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/release-notes.js [options]

Writes the release notes for a version from CHANGELOG.md.

  --version <x.y.z>     version to write about (default: package.json)
  --tag <tag>           release tag (default: Release_v<version>)
  --branch <name>       branch the changelog links point at (default: main)
  --intro <file>        opening paragraph
  --verification <file> what was verified, for a Verification section
  --out <file>          write to a file instead of printing
  --help, -h            show this message
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const version = options.version ?? JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version;
  const notes = releaseNotes({
    version,
    branch: options.branch,
    tag: options.tag ?? releaseTag(version),
    source: fs.readFileSync(CHANGELOG, 'utf8'),
    intro: readNotesFile(options.intro, 'opening paragraph'),
    verification: readNotesFile(options.verification, 'verification notes')
  });

  if (options.out) {
    fs.writeFileSync(options.out, `${notes}\n`, 'utf8');
  } else {
    process.stdout.write(`${notes}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Could not write the release notes: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  changelogSections,
  downloadsSection,
  previousVersion,
  releaseNotes,
  unwrapSoftBreaks
};
