// Brings a brand-new repository to the point where it can actually be pushed.
//
// `git init` on its own leaves a repository nobody can publish: HEAD points at
// an unborn branch that git still names `master` unless the machine says
// otherwise, and there is no commit for a refspec to name, so `git push -u
// origin main` answers "src refspec main does not match any". That is why a
// repository created by the wizard used to need the four commands GitHub
// prints on an empty repository page typed in by hand.
//
// Each step reports rather than throws where the failure is survivable: a
// missing commit identity must not undo the repository that now exists on
// disk, and neither must an unreachable remote.
import { refArg } from './args';
import { GitError, runGitCommand, tryGitCommand } from './run';

/**
 * What a new repository's branch is called when the machine has no opinion.
 *
 * Git's own fallback is still `master`, and it only warns about it. GitHub has
 * named new repositories `main` since 2020, so following git's fallback means
 * the first push goes to a branch the remote does not expect.
 */
export const FALLBACK_INITIAL_BRANCH = 'main';

/**
 * The branch a new repository should start on.
 *
 * Only `--global` is consulted, and that is the whole point. Git for Windows
 * writes `init.defaultBranch = master` into its *system* configuration at
 * install time, so a merged read finds `master` on a machine whose owner never
 * chose anything — which is exactly how a repository ends up on a branch its
 * brand-new GitHub remote does not have. The global file is the one the user
 * actually edits, so a name found there is a decision and is honoured.
 */
export async function resolveInitialBranch(cwd: string): Promise<string> {
  const configured = await tryGitCommand(cwd, [
    'config',
    '--global',
    '--get',
    'init.defaultBranch'
  ]);
  const name = configured?.stdout.trim() ?? '';

  if (!name) {
    return FALLBACK_INITIAL_BRANCH;
  }

  try {
    return refArg(name, 'init.defaultBranch');
  } catch {
    // A configured name git would reject anyway; the fallback is kinder than
    // failing to create the repository at all.
    return FALLBACK_INITIAL_BRANCH;
  }
}

/**
 * Initialises the repository with HEAD already pointing at `branch`.
 *
 * `git init -b` would say the same thing in one command, but it needs Git
 * 2.28. Writing HEAD directly works on every version and is exactly what
 * `git branch -M <branch>` does once a commit exists.
 */
export async function initRepository(repoPath: string, branch: string): Promise<void> {
  await runGitCommand(repoPath, ['init']);
  await runGitCommand(repoPath, ['symbolic-ref', 'HEAD', `refs/heads/${refArg(branch, 'Branch name')}`]);
}

export interface CommitAuthor {
  name: string;
  email: string;
}

export type InitialCommitResult = { committed: true } | { committed: false; reason: string };

/**
 * Stages everything the .gitignore lets through and makes the first commit.
 *
 * Templates are written before this runs, so an ignored folder the user
 * already had — `node_modules`, `dist` — stays out of the commit it would
 * otherwise dominate.
 */
export async function createInitialCommit(
  repoPath: string,
  options: { message: string; author?: CommitAuthor | null }
): Promise<InitialCommitResult> {
  const { author } = options;

  if (author?.name && author.email) {
    // Local scope only: the wizard knows which account this repository belongs
    // to, and writing that here is what lets the commit succeed on a machine
    // with no global identity at all.
    await runGitCommand(repoPath, ['config', 'user.name', author.name]);
    await runGitCommand(repoPath, ['config', 'user.email', author.email]);
  }

  await runGitCommand(repoPath, ['add', '-A']);

  const staged = await runGitCommand(repoPath, ['diff', '--cached', '--name-only']);
  if (staged.stdout.trim() === '') {
    return {
      committed: false,
      reason:
        'There was nothing to commit, so the branch has no first commit yet. Add a file, commit it, then Publish.'
    };
  }

  try {
    await runGitCommand(repoPath, ['commit', '-m', options.message]);
    return { committed: true };
  } catch (error) {
    // Almost always an unset user.name / user.email. Git's own wording says
    // more than anything this could invent.
    const detail = error instanceof GitError ? error.displayMessage : (error as Error).message;
    return {
      committed: false,
      reason: `Could not create the first commit: ${detail.split('\n')[0] ?? detail}`
    };
  }
}
