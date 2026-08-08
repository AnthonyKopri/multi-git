import { Router } from 'express';

import { refArg } from '../git/args';
import { withRepoLock } from '../git/lock';
import { runGitCommand, tryGitCommand } from '../git/run';
import { unquoteGitPath } from '../git/status';
import { parseStructuredDiff } from '../git/structured-diff';
import { createStash } from '../git/selective-stash';
import type { FileSelection } from '../git/selective-stash';
import { captureCheckpoint } from '../safety-net/checkpoints';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';

export const stashRouter: Router = Router();

stashRouter.use(requireRepoPath);

/** `stash@{N}` is the only shape git accepts, and the only one this allows. */
function stashRef(value: unknown): string {
  if (typeof value !== 'string' || !/^stash@\{\d+\}$/.test(value)) {
    throw new HttpError('A valid stash reference (stash@{n}) is required', 400);
  }
  return value;
}

function stringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new HttpError(`${label} must be an array of strings.`, 400);
  }
  return value as string[];
}

/** Validates the hunk and line selections a partial stash carries. */
function parseSelections(value: unknown): FileSelection[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new HttpError('selections must be an array.', 400);
  }

  return value.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    if (typeof record['filePath'] !== 'string' || record['filePath'] === '') {
      throw new HttpError('Every selection needs a filePath.', 400);
    }

    const selection: FileSelection = { filePath: record['filePath'] };
    const hunkIds = stringList(record['hunkIds'], 'hunkIds');
    if (hunkIds) {
      selection.hunkIds = hunkIds;
    }
    const lineIds = stringList(record['lineIds'], 'lineIds');
    if (lineIds) {
      selection.lineIds = lineIds;
    }

    return selection;
  });
}

stashRouter.get(
  '/api/git/stash',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    // Fails when there is no stash ref yet, which is the normal empty state.
    const result = await tryGitCommand(repoPath, [
      'stash',
      'list',
      '--format=%gd\x1f%s\x1f%cr\x1f%H\x1f%cI'
    ]);

    const stashes = (result?.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ref, message, date, oid, isoDate] = line.split('\x1f');
        return {
          ref: ref ?? '',
          message: message ?? '',
          date: date ?? '',
          oid: oid ?? '',
          isoDate: isoDate ?? ''
        };
      });

    res.json({ success: true, stashes });
  })
);

/**
 * Finds stashes by message or by a path they touch.
 *
 * The message is the cheap half. The path half needs each stash's file list,
 * which is one `stash show` per stash — bounded by how many stashes there are,
 * and only paid for when a query is given.
 */
stashRouter.get(
  '/api/git/stash/search',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const query = typeof req.query['query'] === 'string' ? req.query['query'].trim() : '';

    const listed = await tryGitCommand(repoPath, [
      'stash',
      'list',
      '--format=%gd\x1f%s\x1f%cr\x1f%H'
    ]);

    const all = (listed?.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ref, message, date, oid] = line.split('\x1f');
        return { ref: ref ?? '', message: message ?? '', date: date ?? '', oid: oid ?? '' };
      });

    if (query === '') {
      res.json({
        success: true,
        query,
        stashes: all.map((stash) => ({ ...stash, matchedFiles: [] }))
      });
      return;
    }

    const needle = query.toLowerCase();
    const matches: ((typeof all)[number] & { matchedFiles: string[] })[] = [];

    for (const stash of all) {
      const files = await tryGitCommand(repoPath, [
        'stash',
        'show',
        '--name-only',
        '--format=',
        stash.ref
      ]);

      const matchedFiles = (files?.stdout ?? '')
        .split('\n')
        .map((line) => unquoteGitPath(line))
        .filter((file) => file !== '' && file.toLowerCase().includes(needle));

      if (stash.message.toLowerCase().includes(needle) || matchedFiles.length > 0) {
        matches.push({ ...stash, matchedFiles });
      }
    }

    res.json({ success: true, query, stashes: matches });
  })
);

stashRouter.post(
  '/api/git/stash',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as {
      message?: unknown;
      includeUntracked?: unknown;
      keepIndex?: unknown;
      files?: unknown;
      selections?: unknown;
    };

    const input: Parameters<typeof createStash>[1] = {
      includeUntracked: body.includeUntracked === true,
      keepIndex: body.keepIndex === true
    };

    if (typeof body.message === 'string') {
      input.message = body.message;
    }
    const files = stringList(body.files, 'files');
    if (files) {
      input.files = files;
    }
    const selections = parseSelections(body.selections);
    if (selections && selections.length > 0) {
      input.selections = selections;
    }

    const result = await withRepoLock(repoPath, () => createStash(repoPath, input));
    res.json({ success: true, ...result });
  })
);

/**
 * What a stash holds, without applying it.
 *
 * `stash@{n}^!` limits the diff to the stash commit against its first parent,
 * which is the working-tree change the stash was made from.
 */
stashRouter.get(
  '/api/git/stash/show',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const safeRef = stashRef(req.query['ref']);

    const nameStatus = await runGitCommand(repoPath, [
      'stash',
      'show',
      '--name-status',
      '--format=',
      safeRef
    ]);

    const files = nameStatus.stdout
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

    const patch = await runGitCommand(repoPath, [
      'stash',
      'show',
      '-p',
      '--no-color',
      '--no-ext-diff',
      safeRef
    ]);

    res.json({ success: true, ref: safeRef, files, diff: parseStructuredDiff(patch.stdout) });
  })
);

stashRouter.post(
  '/api/git/stash/apply',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { ref, pop, restoreIndex } = (req.body ?? {}) as {
      ref?: unknown;
      pop?: unknown;
      restoreIndex?: unknown;
    };

    const safeRef = stashRef(ref);
    const args = ['stash', pop ? 'pop' : 'apply'];

    // --index puts back what was staged when the stash was made, rather than
    // dropping the whole thing into the working tree unstaged.
    if (restoreIndex) {
      args.push('--index');
    }
    args.push(safeRef);

    const { stdout, stderr } = await withRepoLock(repoPath, () => runGitCommand(repoPath, args));
    res.json({ success: true, stdout, stderr });
  })
);

/**
 * Starts a branch at the commit the stash was made from and applies it there.
 *
 * The way out when a stash no longer applies to the current branch: git checks
 * it out where it was made, where it always applies.
 */
stashRouter.post(
  '/api/git/stash/branch',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { ref, branchName } = (req.body ?? {}) as { ref?: unknown; branchName?: unknown };

    const safeRef = stashRef(ref);
    const safeBranch = refArg(branchName, 'Branch name');

    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['stash', 'branch', safeBranch, safeRef])
    );

    res.json({ success: true, branch: safeBranch, stdout, stderr });
  })
);

stashRouter.post(
  '/api/git/stash/drop',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const safeRef = stashRef((req.body as { ref?: unknown })?.ref);

    // A dropped stash leaves no reflog trail of its own, so its commit is the
    // one thing worth recording: `git stash store` or `git branch` can bring
    // it back for as long as git keeps unreachable objects.
    const resolved = await tryGitCommand(repoPath, ['rev-parse', safeRef]);
    const stashOid = resolved?.stdout.trim();

    await captureCheckpoint(repoPath, `Drop ${safeRef}`, {
      operation: 'stash-drop',
      ...(stashOid ? { stashRef: stashOid } : {})
    });

    const { stdout, stderr } = await withRepoLock(repoPath, () =>
      runGitCommand(repoPath, ['stash', 'drop', safeRef])
    );

    res.json({ success: true, stdout, stderr, droppedCommit: stashOid ?? null });
  })
);
