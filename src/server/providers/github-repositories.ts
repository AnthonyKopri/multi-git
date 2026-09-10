import { runGh, ghErrorMessage } from './github';
import type { ExecutableRunner } from '../process/runner';
import { HttpError } from '../middleware/error-handler';
import type { HostedRepository, RepositoryBrowserResponse } from '../../shared/repository-browser-types';

/** Bounded list of repositories owned by the signed-in user or a named owner. */
export async function browseGithubRepositories(
  owner: unknown = '', runner?: ExecutableRunner
): Promise<RepositoryBrowserResponse> {
  if (typeof owner !== 'string' || (owner !== '' && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(owner))) {
    throw new HttpError('Enter a GitHub user or organization name.', 400);
  }
  const limit = 100;
  const result = await runGh([
    'repo', 'list', ...(owner ? [owner] : []), '--limit', String(limit),
    '--json', 'nameWithOwner,description,url,sshUrl,isPrivate,isArchived'
  ], { ...(runner ? { runner } : {}) });
  if (!result.ok) {
    throw new HttpError(result.missing
      ? 'GitHub CLI (gh) was not found. Install it and run gh auth login, or paste a repository URL.'
      : /gh auth login|GH_TOKEN/i.test(result.stderr)
        ? 'GitHub CLI is not signed in. Run gh auth login, then try again, or paste a repository URL.'
        : ghErrorMessage(result, 'Could not list repositories. Run gh auth login or paste a repository URL.'), 400);
  }
  let rows: unknown;
  try { rows = JSON.parse(result.stdout); } catch { throw new HttpError('GitHub CLI returned invalid repository data.', 502); }
  if (!Array.isArray(rows) || !rows.every((row: Partial<HostedRepository> | null) => row &&
    typeof row.nameWithOwner === 'string' && typeof row.url === 'string' &&
    typeof row.sshUrl === 'string' && typeof row.isPrivate === 'boolean' && typeof row.isArchived === 'boolean')) {
    throw new HttpError('GitHub CLI returned invalid repository data.', 502);
  }
  const repositories = rows.map((row: HostedRepository) => ({
    nameWithOwner: row.nameWithOwner, description: typeof row.description === 'string' ? row.description : '',
    url: row.url, sshUrl: row.sshUrl, isPrivate: row.isPrivate, isArchived: row.isArchived
  }));
  return { success: true, repositories, limit, atLimit: repositories.length >= limit };
}
