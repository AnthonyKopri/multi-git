// Whether a merge or a rebase is stopped part-way in a work tree.
//
// Git records both in the work tree's own git directory: MERGE_HEAD for a
// merge, rebase-merge/ or rebase-apply/ for a rebase. In an ordinary repository
// that directory is `<work tree>/.git`. In a linked worktree or a submodule,
// `.git` is a file naming the real one (`gitdir: …/.git/worktrees/<name>`), so
// looking under `<work tree>/.git` finds nothing there. That is how a merge
// stopped on a conflict in a linked worktree went unreported: no MERGE badge,
// and the recovery journal was pruned as though nothing were in progress.
import fs from 'node:fs';
import path from 'node:path';

import { tryGitCommand } from './run';

/**
 * The work tree's own git directory.
 *
 * The ordinary layout answers without a process, as it always has. Only where
 * `.git` is not a directory is git asked, with the same `rev-parse` the rebase
 * and recovery code use. Should that fail, the answer is what it was before
 * this existed, so nothing that worked can stop working.
 */
export async function workTreeGitDir(repoPath: string): Promise<string> {
  const marker = path.join(repoPath, '.git');

  try {
    if (fs.statSync(marker).isDirectory()) {
      return marker;
    }
  } catch {
    // Not there to stat. Git can still say where the directory is.
  }

  const result = await tryGitCommand(repoPath, ['rev-parse', '--absolute-git-dir']);
  return result?.stdout.trim() || marker;
}

export interface OperationState {
  isMerging: boolean;
  isRebasing: boolean;
}

/** Whether a merge or a rebase is stopped part-way in this work tree. */
export async function readOperationState(repoPath: string): Promise<OperationState> {
  const gitDir = await workTreeGitDir(repoPath);

  return {
    isMerging: fs.existsSync(path.join(gitDir, 'MERGE_HEAD')),
    isRebasing:
      fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
      fs.existsSync(path.join(gitDir, 'rebase-apply'))
  };
}

/**
 * Whether either is in progress.
 *
 * The guard in front of undo, restore and reset: each of those moves HEAD, and
 * doing that under a stopped merge or rebase leaves a state the conflict view
 * cannot describe.
 */
export async function isOperationInProgress(repoPath: string): Promise<boolean> {
  const { isMerging, isRebasing } = await readOperationState(repoPath);
  return isMerging || isRebasing;
}
