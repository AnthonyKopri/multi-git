import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

import { runGitCommand, tryGitCommand } from '../git/run';
import { parsePorcelainStatus } from '../git/status';
import { requireRepoPath } from '../middleware/repo-path';
import { asyncRoute } from '../middleware/error-handler';
import type { Commit } from '../../shared/git-types';

export const statusRouter: Router = Router();

statusRouter.use(requireRepoPath);

/** True when a merge is paused mid-conflict. */
export function isMerging(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, '.git', 'MERGE_HEAD'));
}

/** True when a rebase is paused mid-conflict, in either backend. */
export function isRebasing(repoPath: string): boolean {
  return (
    fs.existsSync(path.join(repoPath, '.git', 'rebase-merge')) ||
    fs.existsSync(path.join(repoPath, '.git', 'rebase-apply'))
  );
}

statusRouter.get(
  '/api/git/status',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { stdout } = await runGitCommand(repoPath, ['status', '--porcelain', '-b']);

    res.json({
      success: true,
      ...parsePorcelainStatus(stdout),
      isMerging: isMerging(repoPath),
      isRebasing: isRebasing(repoPath)
    });
  })
);

statusRouter.get(
  '/api/git/log',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    const limit = Math.min(Math.max(Number.parseInt(String(req.query['limit']), 10) || 50, 1), 500);
    const skip = Math.max(Number.parseInt(String(req.query['skip']), 10) || 0, 0);
    const includeAll = req.query['all'] === '1';

    const args = ['log'];
    if (includeAll) {
      args.push('--all', '--topo-order');
    }
    args.push(
      // One extra row tells us whether another page exists.
      '-n',
      String(limit + 1),
      `--skip=${skip}`,
      // %x1f (unit separator) cannot appear in a commit message, unlike "|".
      '--pretty=format:%H\x1f%P\x1f%an\x1f%ad\x1f%s\x1f%D',
      '--date=relative'
    );

    // A repository with no commits makes `git log` fail; that is a normal
    // state for a freshly initialised repository, not an error.
    const result = await tryGitCommand(repoPath, args);
    if (!result) {
      res.json({ success: true, commits: [], hasMore: false });
      return;
    }

    const rows: Commit[] =
      result.stdout.trim() === ''
        ? []
        : result.stdout.split('\n').map((line) => {
            const [hash, parents, author, date, message, refs] = line.split('\x1f');
            return {
              hash: hash ?? '',
              parents: (parents ?? '').split(' ').map((p) => p.trim()).filter(Boolean),
              author: author ?? '',
              date: date ?? '',
              message: message ?? '',
              refs: (refs ?? '').split(',').map((r) => r.trim()).filter(Boolean)
            };
          });

    const hasMore = rows.length > limit;
    res.json({ success: true, commits: hasMore ? rows.slice(0, limit) : rows, hasMore });
  })
);

statusRouter.get(
  '/api/git/files',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    // Independent queries: run them together rather than back to back.
    const [tracked, untracked] = await Promise.all([
      runGitCommand(repoPath, ['ls-files']),
      runGitCommand(repoPath, ['ls-files', '--others', '--exclude-standard'])
    ]);

    const toList = (output: string): string[] =>
      output.split('\n').map((entry) => entry.trim()).filter(Boolean);

    res.json({
      success: true,
      tracked: toList(tracked.stdout),
      untracked: toList(untracked.stdout)
    });
  })
);

/** Reads one git config key. Unset keys make git exit non-zero, which is not an error here. */
async function readGitConfigValue(
  repoPath: string,
  key: string,
  scopeFlag?: string
): Promise<string> {
  const args = ['config'];
  if (scopeFlag) {
    args.push(scopeFlag);
  }
  args.push('--get', key);

  const result = await tryGitCommand(repoPath, args);
  return result?.stdout.trim() ?? '';
}

// Per-repository committer identity. The SSH key switches authentication;
// this switches authorship, and the two are independent.
statusRouter.get(
  '/api/git/identity',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;

    const [name, email, localName, localEmail] = await Promise.all([
      readGitConfigValue(repoPath, 'user.name'),
      readGitConfigValue(repoPath, 'user.email'),
      readGitConfigValue(repoPath, 'user.name', '--local'),
      readGitConfigValue(repoPath, 'user.email', '--local')
    ]);

    res.json({
      success: true,
      // Effective values, after global and system fall-back.
      name,
      email,
      isLocal: Boolean(localName || localEmail)
    });
  })
);

statusRouter.post(
  '/api/git/identity',
  asyncRoute(async (req, res) => {
    const repoPath = req.repoPath as string;
    const { name, email } = (req.body ?? {}) as { name?: unknown; email?: unknown };

    const safeName = typeof name === 'string' ? name.trim() : '';
    const safeEmail = typeof email === 'string' ? email.trim() : '';

    if (!safeName || !safeEmail) {
      res.status(400).json({ error: 'Both name and email are required' });
      return;
    }

    await runGitCommand(repoPath, ['config', 'user.name', safeName]);
    await runGitCommand(repoPath, ['config', 'user.email', safeEmail]);

    res.json({ success: true, name: safeName, email: safeEmail });
  })
);
