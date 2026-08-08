// Stashing part of the working tree.
//
// Git can stash whole paths on its own — `git stash push -- <paths>` — and
// that path is used whenever it will do, because git's own bookkeeping for the
// index and the working tree is the bookkeeping we want.
//
// It has no equivalent for "stash these hunks". This builds one out of
// plumbing, reusing the patch machinery from precision staging:
//
//   1. write-tree            remember the index exactly as it stands
//   2. read-tree HEAD        clear it
//   3. apply --cached        put only the selected changes in it
//   4. write-tree            that tree is what the stash should contain
//   5. commit-tree x2        build the two commits a stash is made of
//   6. stash store           publish it — from here nothing can be lost
//   7. read-tree             put the original index back
//   8. apply --reverse       take the selected changes out of the worktree
//
// Step 6 is deliberately before step 8. Once the stash exists the work is
// safe, so a failure while tidying up costs the user nothing.
import { pathArgs } from './args';
import { runGitCommand, tryGitCommand } from './run';
import { buildSelectedPatch, PatchSelectionError } from './patch-build';
import { readFileDiff } from './precision-staging';
import type { PatchSelection } from '../../shared/diff-types';

export interface FileSelection extends PatchSelection {
  filePath: string;
}

export interface SelectiveStashInput {
  message?: string;
  /** Whole paths to stash. Ignored when `selections` is given. */
  files?: readonly string[];
  /** Hunk or line level selections. Takes precedence over `files`. */
  selections?: readonly FileSelection[];
  includeUntracked?: boolean;
  /** Leaves the staged changes in the index as well as in the stash. */
  keepIndex?: boolean;
}

export interface StashResult {
  /** True when the partial path was used rather than `git stash push`. */
  partial: boolean;
  message: string;
  filesStashed: number;
  stdout: string;
  stderr: string;
}

async function currentBranchName(repoPath: string): Promise<string> {
  const result = await tryGitCommand(repoPath, ['symbolic-ref', '--short', 'HEAD']);
  return result?.stdout.trim() || 'detached HEAD';
}

/** `On main: message`, which is the shape `git stash list` renders. */
function stashSubject(branch: string, message: string): string {
  return message === '' ? `On ${branch}: partial stash` : `On ${branch}: ${message}`;
}

/** The plain path: git decides what moves and this only chooses the pathspec. */
async function stashWholePaths(
  repoPath: string,
  input: SelectiveStashInput
): Promise<StashResult> {
  const args = ['stash', 'push'];

  if (input.includeUntracked) {
    args.push('-u');
  }
  if (input.keepIndex) {
    args.push('--keep-index');
  }
  if (typeof input.message === 'string' && input.message !== '') {
    // -m takes the message as a value, so it is never read as an option.
    args.push('-m', input.message);
  }

  const files = input.files ?? [];
  if (files.length > 0) {
    args.push(...pathArgs(files));
  }

  const { stdout, stderr } = await runGitCommand(repoPath, args);
  return {
    partial: false,
    message: input.message ?? '',
    filesStashed: files.length,
    stdout,
    stderr
  };
}

/**
 * Builds the combined patch for every selection.
 *
 * Read before anything is mutated, so a selection that has gone stale fails
 * while the repository is still untouched.
 */
async function buildCombinedPatch(
  repoPath: string,
  selections: readonly FileSelection[]
): Promise<{ forward: string; reverse: string; fileCount: number }> {
  const forwardParts: string[] = [];
  const reverseParts: string[] = [];

  for (const selection of selections) {
    const { file, untracked } = await readFileDiff(repoPath, selection.filePath, 'working-tree', {
      force: true
    });

    if (untracked) {
      throw new PatchSelectionError(
        `${selection.filePath} is not tracked yet, so only the whole file can be stashed.`
      );
    }
    if (!file) {
      throw new PatchSelectionError(
        `${selection.filePath} has no unstaged changes left to stash. Reload and try again.`,
        409
      );
    }

    const patchSelection: PatchSelection = {
      ...(selection.hunkIds ? { hunkIds: selection.hunkIds } : {}),
      ...(selection.lineIds ? { lineIds: selection.lineIds } : {})
    };

    // Two patches, because the two applies go in opposite directions and the
    // direction decides what happens to the lines that were *not* selected.
    // Forward, an unselected addition is dropped; reversed, it has to survive
    // as context, because the working tree still contains it.
    forwardParts.push(buildSelectedPatch(file, patchSelection, false).text);
    reverseParts.push(buildSelectedPatch(file, patchSelection, true).text);
  }

  if (forwardParts.length === 0) {
    throw new PatchSelectionError('Select at least one change to stash.');
  }

  return {
    forward: forwardParts.join(''),
    reverse: reverseParts.join(''),
    fileCount: selections.length
  };
}

/** Stashes exactly the selected hunks and lines, leaving everything else. */
async function stashSelection(
  repoPath: string,
  selections: readonly FileSelection[],
  message: string
): Promise<StashResult> {
  const { forward, reverse, fileCount } = await buildCombinedPatch(repoPath, selections);

  const branch = await currentBranchName(repoPath);
  const subject = stashSubject(branch, message);

  const originalIndex = (await runGitCommand(repoPath, ['write-tree'])).stdout.trim();
  const head = (await runGitCommand(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();

  let selectedTree: string;
  try {
    await runGitCommand(repoPath, ['read-tree', 'HEAD']);
    await runGitCommand(repoPath, ['apply', '--cached', '--whitespace=nowarn'], null, {
      input: forward
    });
    selectedTree = (await runGitCommand(repoPath, ['write-tree'])).stdout.trim();
  } catch (error) {
    // Nothing has been published yet, so putting the index back leaves the
    // repository exactly as it was found.
    await tryGitCommand(repoPath, ['read-tree', originalIndex]);
    throw error;
  }

  // A stash is a commit whose first parent is HEAD and whose second parent
  // holds the index at the time. Building both by hand is what lets the
  // worktree commit hold a subset rather than everything.
  const indexCommit = (
    await runGitCommand(repoPath, ['commit-tree', originalIndex, '-p', head, '-m', `index on ${branch}`])
  ).stdout.trim();

  const stashCommit = (
    await runGitCommand(repoPath, [
      'commit-tree',
      selectedTree,
      '-p',
      head,
      '-p',
      indexCommit,
      '-m',
      subject
    ])
  ).stdout.trim();

  // Past this line the work exists in the object store and on refs/stash, so
  // any later failure is untidiness rather than loss.
  await runGitCommand(repoPath, ['stash', 'store', '-m', subject, stashCommit]);

  await runGitCommand(repoPath, ['read-tree', originalIndex]);
  const removal = await runGitCommand(repoPath, ['apply', '--reverse', '--whitespace=nowarn'], null, {
    input: reverse
  });

  return {
    partial: true,
    message,
    filesStashed: fileCount,
    stdout: removal.stdout,
    stderr: removal.stderr
  };
}

/** Entry point. Chooses the plain path unless hunk selections were given. */
export async function createStash(
  repoPath: string,
  input: SelectiveStashInput
): Promise<StashResult> {
  const selections = input.selections ?? [];

  if (selections.length === 0) {
    return stashWholePaths(repoPath, input);
  }

  return stashSelection(repoPath, selections, input.message ?? '');
}
