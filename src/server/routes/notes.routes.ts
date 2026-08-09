// Git notes over HTTP.
//
// Writing a note does not rewrite history — the note lives in its own ref — so
// none of this is destructive in the way a rebase or a reset is, and none of it
// captures a recovery point. Removing one loses the text, which git's own
// reflog on the notes ref already covers.
import { Router } from 'express';

import { requireRepoPath } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { withRepoLock } from '../git/lock';
import { ensureAgentForRepo } from '../ssh/agent-session';
import { operations } from '../operations/registry';
import {
  DEFAULT_NOTES_REF,
  commitsWithNotes,
  listNotesRefs,
  readNote,
  removeNote,
  syncNotes,
  writeNote
} from '../git/notes';

export const notesRouter: Router = Router();

notesRouter.use('/api/notes', requireRepoPath);

function notesRef(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function requiredCommit(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError('Which commit?', 400);
  }
  return value;
}

notesRouter.get(
  '/api/notes/refs',
  asyncRoute(async (req, res) => {
    res.json({
      success: true,
      refs: await listNotesRefs(req.repoPath as string),
      defaultRef: DEFAULT_NOTES_REF
    });
  })
);

/**
 * Which commits carry a note.
 *
 * One call for the whole ref, which is what lets the history list mark rows
 * without a git process per row.
 */
notesRouter.get(
  '/api/notes/index',
  asyncRoute(async (req, res) => {
    const commits = await commitsWithNotes(req.repoPath as string, notesRef(req.query['ref']));
    res.json({ success: true, commits: [...commits] });
  })
);

notesRouter.get(
  '/api/notes',
  asyncRoute(async (req, res) => {
    const note = await readNote(
      req.repoPath as string,
      requiredCommit(req.query['commit']),
      notesRef(req.query['ref'])
    );

    res.json({ success: true, note });
  })
);

notesRouter.post(
  '/api/notes',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const commit = requiredCommit(body['commit']);
    const message = typeof body['message'] === 'string' ? body['message'] : '';

    const note = await withRepoLock(repoPath, () =>
      writeNote(repoPath, commit, message, notesRef(body['ref']))
    );

    res.json({ success: true, note });
  })
);

notesRouter.delete(
  '/api/notes',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    await withRepoLock(repoPath, () =>
      removeNote(repoPath, requiredCommit(body['commit']), notesRef(body['ref']))
    );

    res.json({ success: true });
  })
);

/**
 * Fetches or pushes a notes ref.
 *
 * Separate from ordinary fetch and push because notes refs are outside the
 * default refspec: they do not travel with a normal push, and a user who
 * assumes they do loses them.
 */
notesRouter.post(
  '/api/notes/sync',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const direction = body['direction'];

    if (direction !== 'fetch' && direction !== 'push') {
      throw new HttpError('Choose fetch or push.', 400);
    }

    const remote = typeof body['remote'] === 'string' && body['remote'] !== '' ? body['remote'] : 'origin';
    await ensureAgentForRepo(
      repoPath,
      typeof body['profileId'] === 'string' ? body['profileId'] : undefined
    );

    const operation = operations.begin({
      kind: `notes.${direction}`,
      repoPath,
      message: `${direction === 'fetch' ? 'Fetching' : 'Pushing'} notes to ${remote}`
    });
    operation.start();

    try {
      await syncNotes(repoPath, direction, remote, notesRef(body['ref']), {
        sshKeyPath: typeof body['sshKeyPath'] === 'string' ? body['sshKeyPath'] : null,
        signal: operation.signal
      });

      operation.succeed();
      res.json({ success: true });
    } catch (error) {
      operation.fail(error instanceof Error ? error.message : 'Could not sync notes');
      throw error;
    }
  })
);
