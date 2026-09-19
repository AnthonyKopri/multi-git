import fs from 'node:fs';
import path from 'node:path';
import { runGitCommand } from './run';
import { parsePorcelainStatus } from './status';
import type { StatusResponse } from '../../shared/api-types';

/** Resolves Git's directory rather than assuming .git is a directory (worktrees). */
export async function readStatus(repoPath: string): Promise<StatusResponse> {
  const [status, directory] = await Promise.all([
    runGitCommand(repoPath, ['status', '--porcelain', '-b']),
    runGitCommand(repoPath, ['rev-parse', '--absolute-git-dir'])
  ]);
  const gitDir = directory.stdout.trim();
  return { success: true, ...parsePorcelainStatus(status.stdout),
    isMerging: fs.existsSync(path.join(gitDir, 'MERGE_HEAD')),
    isRebasing: fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply')) };
}
