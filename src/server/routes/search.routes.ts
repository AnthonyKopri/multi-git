// Finding things: commits by any of the fields they carry, and the difference
// between two refs.
//
// Both are read-only and both are paginated, because "search a large history"
// and "freeze the UI for eight seconds" are the same operation if the result
// set is not bounded.
import { Router } from 'express';

import { commitish, pathArg, refArg } from '../git/args';
import { runGitCommand, tryGitCommand } from '../git/run';
import { unquoteGitPath } from '../git/status';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import type { Commit, CommitFile } from '../../shared/git-types';

export const searchRouter: Router = Router();

searchRouter.use(requireRepoPath);

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const COMMIT_FORMAT = '%H\x1f%P\x1f%an\x1f%ae\x1f%aI\x1f%cr\x1f%s\x1f%D';

function parseCommits(stdout: string): Commit[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, parents, author, , , relative, subject, refs] = line.split('\x1f');
      return {
        hash: hash ?? '',
        parents: (parents ?? '').split(' ').filter(Boolean),
        author: author ?? '',
        date: relative ?? '',
        message: subject ?? '',
        refs: (refs ?? '')
          .split(', ')
          .map((entry) => entry.trim())
          .filter(Boolean)
      };
    });
}

function boundedInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

/**
 * A date filter git will accept.
 *
 * Git's date parser is generous — "2 weeks ago" works — so this only rejects
 * the characters that would let a value be read as something other than a
 * date, and leaves the parsing to git.
 */
function dateArg(value: unknown, label: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('-') || /[\r\n\0]/.test(trimmed)) {
    throw new HttpError(`${label} is not a usable date.`, 400);
  }
  return trimmed;
}

/** A free-text term. Passed to git as a value, never spliced into a command. */
function textArg(value: unknown, label: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  if (/[\r\n\0]/.test(value)) {
    throw new HttpError(`${label} may not contain line breaks.`, 400);
  }
  return value;
}

function commaList(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const HEX_PREFIX = /^[0-9a-fA-F]{4,40}$/;

/**
 * Searches history.
 *
 * Every filter is optional and they combine, so an empty query with a path is
 * "what touched this file" and an empty query with a date range is "what
 * happened last week".
 */
searchRouter.get(
  '/api/git/search/commits',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const query = req.query;

    const term = textArg(query['query'], 'Search term');
    const author = textArg(query['author'], 'Author');
    const since = dateArg(query['since'], 'Start date');
    const until = dateArg(query['until'], 'End date');
    const limit = boundedInt(query['limit'], DEFAULT_LIMIT, MAX_LIMIT);
    const skip = boundedInt(query['skip'], 0, 1_000_000);

    const refs = commaList(query['refs']).map((ref) => refArg(ref, 'Ref'));
    const paths = commaList(query['paths']).map((entry) => pathArg(entry, 'Path'));

    const args = ['log', `--pretty=format:${COMMIT_FORMAT}`, '-n', String(limit + 1)];
    if (skip > 0) {
      args.push('--skip', String(skip));
    }

    // Ask for one more than the page so "there is more" needs no second query.
    if (refs.length > 0) {
      args.push(...refs);
    } else {
      args.push('--all');
    }

    if (term !== null) {
      // --grep covers the subject and the body; -i makes it case-insensitive,
      // which is what anyone typing into a search box expects.
      args.push(`--grep=${term}`, '--regexp-ignore-case');
    }
    if (author !== null) {
      args.push(`--author=${author}`, '--regexp-ignore-case');
    }
    if (since !== null) {
      args.push(`--since=${since}`);
    }
    if (until !== null) {
      args.push(`--until=${until}`);
    }
    if (paths.length > 0) {
      args.push('--', ...paths);
    }

    // A history search in a repository with no commits is empty, not an error.
    const result = await tryGitCommand(repoPath, args);
    const found = parseCommits(result?.stdout ?? '');

    // A term that looks like an object name is probably one. Resolving it
    // directly finds the commit whose message never mentions its own hash.
    let byHash: Commit[] = [];
    if (term !== null && HEX_PREFIX.test(term) && !found.some((commit) => commit.hash.startsWith(term))) {
      const direct = await tryGitCommand(repoPath, [
        'log',
        '-1',
        `--pretty=format:${COMMIT_FORMAT}`,
        term
      ]);
      byHash = parseCommits(direct?.stdout ?? '');
    }

    const page = [...byHash, ...found].slice(0, limit);

    res.json({
      success: true,
      commits: page,
      hasMore: found.length > limit,
      skip,
      limit
    });
  })
);

/** Everything one ref has that another does not, in both directions. */
searchRouter.get(
  '/api/git/compare',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const base = commitish(req.query['base'], 'Base ref');
    const head = commitish(req.query['head'], 'Head ref');
    const limit = boundedInt(req.query['limit'], DEFAULT_LIMIT, MAX_LIMIT);

    // Three dots: counted from the merge base, which is what "ahead" and
    // "behind" mean to anyone reading them.
    const counts = await tryGitCommand(repoPath, [
      'rev-list',
      '--left-right',
      '--count',
      `${base}...${head}`
    ]);

    if (counts === null) {
      throw new HttpError(
        `Could not compare ${base} with ${head}. One of them may not exist in this repository.`,
        404
      );
    }

    const [behindText, aheadText] = counts.stdout.trim().split(/\s+/);

    const [aheadCommits, behindCommits, changed, mergeBase] = await Promise.all([
      tryGitCommand(repoPath, [
        'log',
        `--pretty=format:${COMMIT_FORMAT}`,
        '-n',
        String(limit),
        `${base}..${head}`
      ]),
      tryGitCommand(repoPath, [
        'log',
        `--pretty=format:${COMMIT_FORMAT}`,
        '-n',
        String(limit),
        `${head}..${base}`
      ]),
      tryGitCommand(repoPath, ['diff', '--name-status', `${base}...${head}`]),
      tryGitCommand(repoPath, ['merge-base', base, head])
    ]);

    const files: CommitFile[] = (changed?.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        return {
          status: (parts[0] ?? '')[0] ?? 'M',
          path: unquoteGitPath(parts.length > 2 ? (parts[2] ?? '') : (parts[1] ?? ''))
        };
      });

    res.json({
      success: true,
      base,
      head,
      ahead: Number.parseInt(aheadText ?? '0', 10) || 0,
      behind: Number.parseInt(behindText ?? '0', 10) || 0,
      mergeBase: mergeBase?.stdout.trim() ?? null,
      aheadCommits: parseCommits(aheadCommits?.stdout ?? ''),
      behindCommits: parseCommits(behindCommits?.stdout ?? ''),
      files
    });
  })
);

/** The patch between two refs, for the comparison view's diff pane. */
searchRouter.get(
  '/api/git/compare/diff',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const base = commitish(req.query['base'], 'Base ref');
    const head = commitish(req.query['head'], 'Head ref');
    const filePath = pathArg(req.query['path']);

    const { stdout } = await runGitCommand(repoPath, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      `${base}...${head}`,
      '--',
      filePath
    ]);

    res.json({ success: true, patch: stdout });
  })
);
