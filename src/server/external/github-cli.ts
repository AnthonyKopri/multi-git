// Talks to the GitHub CLI.
//
// `gh` is the only way this app can create a remote repository: Multi-Git
// holds no API token anywhere, and gh already has the user's own credentials.
// That also means gh is a high-value target for argument injection, which is
// why the repository name goes through githubRepoName().
import path from 'node:path';

import { runExternalCommand } from './run';
import { githubRepoName } from '../git/args';
import { runGitCommand } from '../git/run';
import { getToggledRemoteUrl, isLikelyHttpRemote } from '../git/remote';
import { getOriginRemoteUrl } from '../ssh/profiles';

export interface GithubCliStatus {
  available: boolean;
  authenticated: boolean;
  account: string | null;
  version: string | null;
}

export type RepoVisibility = 'private' | 'public';

export interface CreatedRepository {
  name: string;
  visibility: RepoVisibility;
  account: string | null;
  remoteUrl: string;
  htmlUrl: string | null;
  convertedToSsh: boolean;
}

/**
 * Detection is cached: the wizard asks on every open, and two `gh`
 * invocations with 15s and 20s timeouts blocked the dialog each time. The TTL
 * is short enough that signing in with `gh auth login` is picked up quickly.
 */
const STATUS_TTL_MS = 60_000;
let cachedStatus: { value: GithubCliStatus; at: number } | null = null;

export function invalidateGithubCliCache(): void {
  cachedStatus = null;
}

export async function detectGithubCli(forceRefresh = false): Promise<GithubCliStatus> {
  if (!forceRefresh && cachedStatus && Date.now() - cachedStatus.at < STATUS_TTL_MS) {
    return cachedStatus.value;
  }

  const version = await runExternalCommand('gh', ['--version'], { timeoutMs: 15_000 });

  let value: GithubCliStatus;
  if (!version.ok) {
    value = { available: false, authenticated: false, account: null, version: null };
  } else {
    const auth = await runExternalCommand('gh', ['auth', 'status'], {
      timeoutMs: 20_000,
      envOverrides: { NO_COLOR: '1' }
    });

    // gh has moved this output between stdout and stderr across versions.
    const accountMatch = `${auth.stdout}\n${auth.stderr}`.match(/account\s+([A-Za-z0-9-]+)/i);

    value = {
      available: true,
      authenticated: auth.ok,
      account: auth.ok ? (accountMatch?.[1] ?? null) : null,
      version: (version.stdout.split('\n')[0] ?? '').trim()
    };
  }

  cachedStatus = { value, at: Date.now() };
  return value;
}

export interface CreateRepositoryOptions {
  repoPath: string;
  visibility: RepoVisibility;
  useSshRemote: boolean;
}

/**
 * Creates the GitHub repository and wires up origin.
 *
 * Never throws: a remote failure must not invalidate the local repository
 * that already exists on disk. Callers surface `error` as a warning.
 */
export async function createGithubRepository(
  options: CreateRepositoryOptions
): Promise<CreatedRepository | { error: string }> {
  const { repoPath, visibility, useSshRemote } = options;

  let name: string;
  try {
    // The folder name becomes the repository name and lands in gh's argv.
    // Without this, a folder called "-x" would be parsed as a flag.
    name = githubRepoName(path.basename(repoPath));
  } catch (error) {
    return {
      error: `${(error as Error).message} No remote was created; rename the folder or add the remote by hand.`
    };
  }

  const cli = await detectGithubCli();
  if (!cli.available) {
    return { error: 'GitHub CLI (gh) was not found on PATH, so the repository stayed local only.' };
  }
  if (!cli.authenticated) {
    return {
      error: 'GitHub CLI is installed but not signed in. Run "gh auth login", then create the remote.'
    };
  }

  const created = await runExternalCommand(
    'gh',
    ['repo', 'create', name, `--${visibility}`, '--source', repoPath, '--remote', 'origin'],
    {
      cwd: repoPath,
      timeoutMs: 120_000,
      envOverrides: { NO_COLOR: '1', GH_PROMPT_DISABLED: '1' }
    }
  );

  if (!created.ok) {
    const detail = (created.stderr || created.error || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();

    return {
      error: `Could not create the GitHub repository${detail ? `: ${detail}` : '.'} The local repository is ready.`
    };
  }

  // gh follows its own git_protocol setting, which defaults to https. This
  // app authenticates with SSH keys, so line the remote up with that.
  let remoteUrl = await getOriginRemoteUrl(repoPath);
  let convertedToSsh = false;

  if (useSshRemote && isLikelyHttpRemote(remoteUrl)) {
    const sshUrl = getToggledRemoteUrl(remoteUrl);
    if (sshUrl) {
      try {
        await runGitCommand(repoPath, ['remote', 'set-url', 'origin', sshUrl]);
        remoteUrl = sshUrl;
        convertedToSsh = true;
      } catch {
        // Keeping the https remote is harmless; the header toggle can switch it.
      }
    }
  }

  const htmlUrl =
    created.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//i.test(line))
      .pop() ?? null;

  return { name, visibility, account: cli.account, remoteUrl, htmlUrl, convertedToSsh };
}
