import { runGitCommand } from './run';
import { parsePorcelainStatus } from './status';
import { readOperationState } from './operation-state';
import type { StatusResponse } from '../../shared/api-types';

/**
 * The working-tree status, with any merge or rebase stopped part-way.
 *
 * The one reading behind `GET /api/git/status` and the sync workflows, so the
 * header badge and the auto-pull decision cannot disagree about a worktree.
 */
export async function readStatus(repoPath: string): Promise<StatusResponse> {
  const [status, operation] = await Promise.all([
    runGitCommand(repoPath, ['status', '--porcelain', '-b']),
    readOperationState(repoPath)
  ]);

  return {
    success: true,
    ...parsePorcelainStatus(status.stdout),
    ...operation
  };
}
