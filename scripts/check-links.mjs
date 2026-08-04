// Checks that every relative link in the project's Markdown actually resolves.
//
// The failure this catches is a renamed or moved file leaving a link behind
// that still looks right in a diff and 404s on GitHub. Table-of-contents
// anchors rot the same way: BUILDING.md and the roadmap both carry one, and a
// renamed heading breaks it silently.
//
// External URLs are not fetched. Network checks fail for reasons that have
// nothing to do with this repository — rate limits, sites that reject CI user
// agents, a host that is briefly down — and a check that fails at random
// stops being read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'dist-standalone',
  'coverage',
  'templates'
]);

/** `[text](target)`, with the optional `"title"` GitHub allows. */
const LINK_PATTERN = /\[[^\]\n]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** Setext and ATX headings, for anchor resolution. */
const ATX_HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*#*\s*$/;

function isExternal(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

function markdownFiles(directory) {
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        found.push(...markdownFiles(path.join(directory, entry.name)));
      }
      continue;
    }
    if (entry.name.toLowerCase().endsWith('.md')) {
      found.push(path.join(directory, entry.name));
    }
  }

  return found;
}

/**
 * Removes fenced and inline code before scanning.
 *
 * A shell example containing brackets and parentheses reads as a link to the
 * pattern above, and reporting it would train people to ignore this check.
 */
function withoutCode(markdown) {
  return markdown
    .replace(/^```[\s\S]*?^```/gm, '')
    .replace(/^~~~[\s\S]*?^~~~/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

/** GitHub's heading-to-anchor rule, as far as this project's headings need. */
function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    // Link syntax inside a heading contributes only its text.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

const anchorCache = new Map();

function anchorsIn(filePath) {
  const cached = anchorCache.get(filePath);
  if (cached) {
    return cached;
  }

  const anchors = new Set();
  const body = withoutCode(fs.readFileSync(filePath, 'utf8'));

  for (const line of body.split('\n')) {
    const heading = ATX_HEADING_PATTERN.exec(line);
    if (heading) {
      anchors.add(slugify(heading[1]));
    }
  }

  // Explicit `<a id="...">` and `id="..."` targets count too.
  for (const match of body.matchAll(/\bid="([^"]+)"/g)) {
    anchors.add(match[1].toLowerCase());
  }

  anchorCache.set(filePath, anchors);
  return anchors;
}

const problems = [];

for (const file of markdownFiles(ROOT)) {
  const relativeFile = path.relative(ROOT, file);
  const body = withoutCode(fs.readFileSync(file, 'utf8'));

  for (const match of body.matchAll(LINK_PATTERN)) {
    const target = match[1];

    if (isExternal(target)) {
      continue;
    }

    const [rawPath, fragment] = target.split('#');
    const decodedPath = decodeURIComponent(rawPath ?? '');
    const targetFile = decodedPath === '' ? file : path.resolve(path.dirname(file), decodedPath);

    if (!fs.existsSync(targetFile)) {
      problems.push(`${relativeFile}: link target does not exist: ${target}`);
      continue;
    }

    if (!fragment || !targetFile.toLowerCase().endsWith('.md')) {
      continue;
    }

    if (!anchorsIn(targetFile).has(decodeURIComponent(fragment).toLowerCase())) {
      problems.push(`${relativeFile}: no heading matches anchor: ${target}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Found ${problems.length} broken Markdown link(s):`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log('All relative Markdown links resolve.');
