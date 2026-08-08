// Structured diffs and precision staging.
//
// Separate from staging.routes.ts, which owns the whole-file actions. These
// two endpoints are the pair the line-level UI drives: read the structure,
// then act on part of it.
import { Router } from 'express';

import { withRepoLock } from '../git/lock';
import { applySelection, readFileDiff, LARGE_DIFF_BYTES } from '../git/precision-staging';
import type { WhitespaceMode } from '../git/precision-staging';
import { compareBlobs } from '../git/blob';
import { toDisplayDiffFile } from '../git/encoding';
import { operations } from '../operations/registry';
import { saveToTrash } from '../safety-net/trash';
import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import type { DiffSource, PatchAction, PatchSelection } from '../../shared/diff-types';

export const diffRouter: Router = Router();

diffRouter.use(requireRepoPath);

const SOURCES: readonly DiffSource[] = ['working-tree', 'index'];
const ACTIONS: readonly PatchAction[] = ['stage', 'unstage', 'discard'];

function requireSource(value: unknown): DiffSource {
  // The default matches the diff a user sees first: their unstaged work.
  if (value === undefined || value === '') {
    return 'working-tree';
  }
  if (!SOURCES.includes(value as DiffSource)) {
    throw new HttpError(`Diff source must be one of: ${SOURCES.join(', ')}`, 400);
  }
  return value as DiffSource;
}

function requireAction(value: unknown): PatchAction {
  if (!ACTIONS.includes(value as PatchAction)) {
    throw new HttpError(`Action must be one of: ${ACTIONS.join(', ')}`, 400);
  }
  return value as PatchAction;
}

const WHITESPACE_MODES: readonly WhitespaceMode[] = ['show', 'ignore-change', 'ignore-all'];

function requireWhitespace(value: unknown): WhitespaceMode {
  if (value === undefined || value === '') {
    return 'show';
  }
  if (!WHITESPACE_MODES.includes(value as WhitespaceMode)) {
    throw new HttpError(`Whitespace must be one of: ${WHITESPACE_MODES.join(', ')}`, 400);
  }
  return value as WhitespaceMode;
}

/** Ids are opaque strings from a previous read; nothing else is accepted. */
function requireIdList(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new HttpError(`${label} must be an array of ids.`, 400);
  }
  return value as string[];
}

diffRouter.get(
  '/api/git/diff/structured',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const source = requireSource(req.query['source']);

    // Tracked so a diff of something enormous can be cancelled rather than
    // waited out. The panel that shows this is Phase 4's; the operation is
    // registered now so it has something to show.
    const result = await operations.run(
      { kind: 'diff', repoPath, message: `Reading the diff of ${String(req.query['path'] ?? '')}` },
      (handle) =>
        readFileDiff(repoPath, req.query['path'], source, {
          force: req.query['force'] === 'true',
          whitespace: requireWhitespace(req.query['whitespace']),
          signal: handle.signal
        })
    );

    if (result.tooLarge) {
      // Not an error: the client offers "load anyway", which comes back with
      // force=true rather than making the user guess why nothing appeared.
      res.json({
        success: true,
        file: null,
        source,
        untracked: result.untracked,
        tooLarge: true,
        sizeBytes: result.sizeBytes,
        limitBytes: LARGE_DIFF_BYTES
      });
      return;
    }

    res.json({
      success: true,
      // Decoded here and nowhere earlier: the model the patch is built from
      // has to stay byte-faithful, and only a person needs the text.
      file: result.file === null ? null : toDisplayDiffFile(result.file),
      source,
      untracked: result.untracked,
      tooLarge: false,
      sizeBytes: result.sizeBytes,
      limitBytes: LARGE_DIFF_BYTES
    });
  })
);

/**
 * Both versions of a file that a unified diff cannot show as text.
 *
 * An image comes back as a data URI for each side; anything else comes back as
 * sizes, which is the only thing worth saying about a binary that changed.
 */
diffRouter.get(
  '/api/git/diff/blobs',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const source = requireSource(req.query['source']);

    const comparison = await compareBlobs(repoPath, req.query['path'], source);
    res.json({ success: true, ...comparison });
  })
);

diffRouter.post(
  '/api/git/diff/apply-selection',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as {
      action?: unknown;
      filePath?: unknown;
      hunkIds?: unknown;
      lineIds?: unknown;
    };

    const action = requireAction(body.action);
    const selection: PatchSelection = {};

    const hunkIds = requireIdList(body.hunkIds, 'hunkIds');
    if (hunkIds) {
      selection.hunkIds = hunkIds;
    }
    const lineIds = requireIdList(body.lineIds, 'lineIds');
    if (lineIds) {
      selection.lineIds = lineIds;
    }

    if (action === 'discard' && typeof body.filePath === 'string') {
      // Snapshot before the working tree loses anything, exactly as the
      // whole-file discard does. Safety Net is what makes this reversible.
      saveToTrash(repoPath, body.filePath);
    }

    const result = await withRepoLock(repoPath, () =>
      applySelection(repoPath, { action, filePath: body.filePath, selection })
    );

    res.json({
      success: true,
      action,
      filePath: result.filePath,
      hunksApplied: result.hunksApplied,
      linesApplied: result.linesApplied
    });
  })
);
