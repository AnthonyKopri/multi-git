// Finding out whether the tools this application needs are actually here.
//
// Multi-Git shells out to git for everything, so a machine without git gets a
// window with nothing behind it. That used to be discovered at the first click,
// as a raw spawn error from a failed process -- which tells a user nothing they
// can act on. Asking once, at the start, is both kinder and more honest.
//
// `gh` is the other half of the question and a different kind of answer: it is
// optional, it can be installed and still unusable because nobody has signed in,
// and the features that need it are a known, small list. So it is reported
// separately rather than folded into a single yes or no.
import { executableRunner } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';
import { checkGithubAvailability } from '../providers/github';
import { refreshPathFromRegistry } from '../os/windows-path';
import { findGitBash } from './shells';
import type { PrerequisiteReport, PrerequisiteState } from '../../shared/prerequisite-types';

/** Long enough for a cold start, short enough not to hold up a window. */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * The first line of a `--version`, which is where every one of these puts it.
 * Returns null when the tool could not be run at all.
 */
async function probeVersion(
  executable: string,
  runner: ExecutableRunner
): Promise<string | null> {
  try {
    const result = await runner.run(executable, ['--version'], {
      timeoutMs: PROBE_TIMEOUT_MS,
      allowNonZero: [1]
    });

    return result.exitCode === 0 ? (result.stdout.split('\n')[0] ?? '').trim() : null;
  } catch {
    // Not installed, or not on the PATH a desktop application inherits, which
    // for this purpose are the same answer.
    return null;
  }
}

/** Whether winget is here to install things with. */
export async function hasWinget(runner: ExecutableRunner = executableRunner): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  return (await probeVersion('winget', runner)) !== null;
}

export async function detectPrerequisites(
  runner: ExecutableRunner = executableRunner
): Promise<PrerequisiteReport> {
  // Before asking, catch up with anything installed since this process started.
  // An installer extends PATH in the registry and broadcasts a change that a
  // running application does not receive, so "Check again" would otherwise keep
  // reporting a tool as missing however many times it was pressed -- which is
  // exactly what happened after installing the GitHub CLI by hand.
  await refreshPathFromRegistry(runner);

  const [gitVersion, gitBash, github, canInstall] = await Promise.all([
    probeVersion('git', runner),
    Promise.resolve(findGitBash()),
    checkGithubAvailability(runner),
    hasWinget(runner)
  ]);

  const git: PrerequisiteState = {
    id: 'git',
    label: 'Git',
    installed: gitVersion !== null,
    ...(gitVersion === null ? {} : { version: gitVersion }),
    detail:
      gitVersion === null
        ? 'Required. Multi-Git runs Git for everything it does, so nothing works without it.'
        : 'Required, and present.'
  };

  // Git Bash ships inside Git for Windows, so it is a property of that install
  // rather than a separate thing to fetch -- which is worth saying, because
  // offering an "install" button for it would be offering the same download
  // twice.
  const bash: PrerequisiteState = {
    id: 'git-bash',
    label: 'Git Bash',
    installed: gitBash !== null,
    ...(gitBash === null ? {} : { path: gitBash }),
    detail:
      gitBash === null
        ? 'Comes with Git for Windows. Without it the Terminal panel cannot offer a Git Bash button.'
        : 'Opens from the Terminal panel, carrying this repository’s SSH key.'
  };

  const ghInstalled = github.reason !== 'not-installed';
  const gh: PrerequisiteState = {
    id: 'gh',
    label: 'GitHub CLI',
    installed: ghInstalled,
    signedIn: github.available,
    ...(github.version ? { version: github.version } : {}),
    detail: !ghInstalled
      ? 'Optional. Enables repository browsing, pull requests and publishing a new repository to GitHub. Cloning by URL works without it.'
      : github.available
        ? `Signed in${github.account ? ` as ${github.account}` : ''}.`
        : 'Installed, but nobody is signed in. Run "gh auth login" to finish.'
  };

  return {
    tools: [git, bash, gh],
    // Only git blocks. The rest degrade.
    blocked: !git.installed,
    canInstall
  };
}
