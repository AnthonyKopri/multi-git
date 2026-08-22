// Assembles the Express application.
//
// Middleware order matters and is deliberate:
//   1. localhostOnly   rejects anything not from this machine, before any
//                      body is parsed or any handler runs
//   2. securityHeaders applies to static assets as well as API responses
//   3. body parsers    with a small default limit
//   4. static assets
//   5. routers
//   6. errorHandler    last, so it sees everything the routers throw
import express from 'express';
import type { Express } from 'express';

import { staticDir } from './app-root';
import { localhostOnly, securityHeaders } from './middleware/security';
import { errorHandler } from './middleware/error-handler';

import { appInfoRouter } from './routes/app-info.routes';
import { logsRouter } from './routes/logs.routes';
import { operationsRouter } from './routes/operations.routes';
import { configRouter } from './routes/config.routes';
import { sshRouter } from './routes/ssh.routes';
import { sshAgentRouter } from './routes/ssh-agent.routes';
import { statusRouter } from './routes/status.routes';
import { stagingRouter } from './routes/staging.routes';
import { branchesRouter } from './routes/branches.routes';
import { diffRouter } from './routes/diff.routes';
import { searchRouter } from './routes/search.routes';
import { branchAdminRouter } from './routes/branch-admin.routes';
import { rebaseRouter } from './routes/rebase.routes';
import { signingRouter } from './routes/signing.routes';
import { conflictsRouter } from './routes/conflicts.routes';
import { cloneRouter, syncRouter } from './routes/sync.routes';
import { historyRouter } from './routes/history.routes';
import { stashRouter } from './routes/stash.routes';
import { tagsRouter } from './routes/tags.routes';
import { filesRouter, folderRouter } from './routes/files.routes';
import { safetyNetRouter } from './routes/safety-net.routes';
import { recoveryRouter } from './routes/recovery.routes';
import { pullRequestsRouter } from './routes/pull-requests.routes';
import { newRepoRouter } from './routes/new-repo.routes';
import { worktreesRouter } from './routes/worktrees.routes';
import { maintenanceRouter } from './routes/maintenance.routes';
import { groupsRouter } from './routes/groups.routes';
import { agentsRouter } from './routes/agents.routes';
import { remotesRouter } from './routes/remotes.routes';
import { submodulesRouter } from './routes/submodules.routes';
import { lfsRouter } from './routes/lfs.routes';
import { patchesRouter } from './routes/patches.routes';
import { bisectRouter } from './routes/bisect.routes';
import { notesRouter } from './routes/notes.routes';
import { toolsRouter } from './routes/tools.routes';

/**
 * Default body limit.
 *
 * The previous global limit was 50mb, which every route inherited whether or
 * not it had any reason to accept a large body.
 */
const DEFAULT_BODY_LIMIT = '1mb';

/** Conflict resolution legitimately carries the whole file being resolved. */
const CONFLICT_BODY_LIMIT = '25mb';

export function createApp(): Express {
  const app = express();

  app.use(localhostOnly);
  app.use(securityHeaders);

  app.use('/api/git/conflict/resolve', express.json({ limit: CONFLICT_BODY_LIMIT }));
  app.use(express.json({ limit: DEFAULT_BODY_LIMIT }));

  app.use(express.static(staticDir()));

  // Routes that do not target an existing repository come first, so their
  // paths are not caught by a router that requires the x-repo-path header.
  app.use(appInfoRouter);
  app.use(logsRouter);
  app.use(operationsRouter);
  app.use(configRouter);
  app.use(sshRouter);
  app.use(sshAgentRouter);
  app.use(newRepoRouter);
  app.use(folderRouter);
  app.use(cloneRouter);
  app.use(groupsRouter);
  app.use(agentsRouter);
  app.use(toolsRouter);

  // Repository-scoped routers.
  app.use(statusRouter);
  app.use(stagingRouter);
  app.use(diffRouter);
  app.use(branchesRouter);
  app.use(branchAdminRouter);
  app.use(searchRouter);
  app.use(rebaseRouter);
  app.use(signingRouter);
  app.use(conflictsRouter);
  app.use(syncRouter);
  app.use(historyRouter);
  app.use(stashRouter);
  app.use(tagsRouter);
  app.use(filesRouter);
  app.use(safetyNetRouter);
  app.use(recoveryRouter);
  app.use(pullRequestsRouter);
  app.use(worktreesRouter);
  app.use(maintenanceRouter);
  app.use(remotesRouter);
  app.use(submodulesRouter);
  app.use(lfsRouter);
  app.use(patchesRouter);
  app.use(bisectRouter);
  app.use(notesRouter);

  app.use(errorHandler);

  return app;
}
