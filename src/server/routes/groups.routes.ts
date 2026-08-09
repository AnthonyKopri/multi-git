// Repository groups, and fetching a whole group at once.
//
// Not repository-scoped: a group is about several repositories, and the whole
// point is to act on them without opening each one first. Members are held as
// canonical identities, so a group survives a repository being reopened from a
// junction, a different casing, or a path the user retyped.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

import { readConfig, writeConfig } from '../config/store';
import { sanitizeConfigForClient } from '../config/sanitize';
import { canonicalRepoKey } from '../config/repo-identity';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import { operations } from '../operations/registry';
import { runGitCommand } from '../git/run';
import { ensureAgentForRepo } from '../ssh/agent-session';
import type { RepoGroup } from '../../shared/config-types';

export const groupsRouter: Router = Router();

/** Repositories fetched at once. Enough to be quick, few enough to stay polite. */
const FETCH_CONCURRENCY = 4;

function groups(): RepoGroup[] {
  return readConfig().repoGroups ?? [];
}

function requireGroup(id: unknown): RepoGroup {
  const group = groups().find((candidate) => candidate.id === String(id));
  if (!group) {
    throw new HttpError('That group no longer exists.', 404);
  }
  return group;
}

/**
 * Maps a group's canonical members back to paths that can be used.
 *
 * A canonical key is lower-cased on Windows and is not a path to show a user,
 * so the display spelling is recovered from the recent-repositories list. A
 * member that has never been opened, or whose folder is gone, is reported as
 * missing rather than silently skipped.
 */
function resolveMembers(group: RepoGroup): { repoPath: string; missing: boolean }[] {
  const byKey = new Map(readConfig().recentRepos.map((repo) => [canonicalRepoKey(repo), repo]));

  return group.repos.map((key) => {
    const known = byKey.get(key);
    const repoPath = known ?? key;
    return { repoPath, missing: !known || !fs.existsSync(repoPath) };
  });
}

groupsRouter.get(
  '/api/repo-groups',
  asyncRoute(async (_req, res) => {
    res.json({
      success: true,
      groups: groups().map((group) => ({ ...group, members: resolveMembers(group) }))
    });
  })
);

groupsRouter.post(
  '/api/repo-groups',
  asyncRoute(async (req, res) => {
    const { id, label, color, icon, repos, order } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof label !== 'string' || label.trim() === '') {
      throw new HttpError('A group needs a name.', 400);
    }

    const config = readConfig();
    const existing = [...(config.repoGroups ?? [])];

    const group: RepoGroup = {
      id: typeof id === 'string' && id.trim() !== '' ? id : randomUUID(),
      label: label.trim(),
      order: typeof order === 'number' ? order : existing.length,
      repos: Array.isArray(repos)
        ? [...new Set(repos.filter((repo): repo is string => typeof repo === 'string').map(canonicalRepoKey))].filter(
            (key) => key !== ''
          )
        : [],
      ...(typeof color === 'string' ? { color } : {}),
      ...(typeof icon === 'string' ? { icon } : {})
    };

    const index = existing.findIndex((candidate) => candidate.id === group.id);
    if (index === -1) {
      existing.push(group);
    } else {
      existing[index] = group;
    }

    config.repoGroups = existing;
    writeConfig(config);

    // Round-tripped through validation, so the client is told what was
    // actually stored rather than what it asked for.
    res.json({ success: true, config: sanitizeConfigForClient(readConfig()) });
  })
);

groupsRouter.delete(
  '/api/repo-groups',
  asyncRoute(async (req, res) => {
    const { id } = (req.body ?? {}) as { id?: unknown };

    const config = readConfig();
    const remaining = (config.repoGroups ?? []).filter((group) => group.id !== String(id));

    if (remaining.length === (config.repoGroups ?? []).length) {
      throw new HttpError('That group no longer exists.', 404);
    }

    config.repoGroups = remaining;
    writeConfig(config);

    res.json({ success: true, config: sanitizeConfigForClient(readConfig()) });
  })
);

export interface GroupFetchOutcome {
  repoPath: string;
  ok: boolean;
  message: string;
}

/**
 * Fetches every repository in a group.
 *
 * Registered as an operation so the request can be cancelled: cancelling flips
 * the signal, the runner kills the git process tree, and the repositories that
 * had not started are simply never started. Each result is reported on its own
 * — a group where one remote is unreachable should still have fetched the
 * other five.
 */
groupsRouter.post(
  '/api/repo-groups/fetch',
  asyncRoute(async (req, res) => {
    const { id } = (req.body ?? {}) as { id?: unknown };
    const group = requireGroup(id);
    const members = resolveMembers(group);

    const operation = operations.begin({
      kind: 'group-fetch',
      message: `Fetching ${members.length} repositor${members.length === 1 ? 'y' : 'ies'}`,
      total: members.length
    });
    operation.start();

    const results: GroupFetchOutcome[] = new Array(members.length);
    let next = 0;
    let completed = 0;

    async function worker(): Promise<void> {
      while (next < members.length) {
        const index = next;
        next += 1;

        const member = members[index] as { repoPath: string; missing: boolean };

        if (operation.cancelled) {
          results[index] = { repoPath: member.repoPath, ok: false, message: 'Cancelled' };
          continue;
        }

        if (member.missing) {
          results[index] = {
            repoPath: member.repoPath,
            ok: false,
            message: 'Folder not found — reopen it in Multi-Git to refresh its location.'
          };
          continue;
        }

        try {
          // The same identity preparation every network operation does.
          await ensureAgentForRepo(member.repoPath);
          await runGitCommand(member.repoPath, ['fetch', '--all', '--prune'], null, {
            signal: operation.signal
          });
          results[index] = { repoPath: member.repoPath, ok: true, message: 'Fetched' };
        } catch (error) {
          results[index] = {
            repoPath: member.repoPath,
            ok: false,
            message: error instanceof Error ? error.message : 'Fetch failed'
          };
        }

        completed += 1;
        operation.update({ completed });
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, members.length) }, () => worker())
    );

    if (operation.cancelled) {
      // `succeed` on a cancelled operation would overwrite the state the user
      // asked for; the registry already holds `cancelled`.
      res.json({ success: true, cancelled: true, operationId: operation.id, results });
      return;
    }

    operation.succeed();
    res.json({ success: true, cancelled: false, operationId: operation.id, results });
  })
);
