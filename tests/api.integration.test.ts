// Drives the real Express app against real Git repositories in temp folders.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { clearRepoPathCache } from '../src/server/middleware/repo-path';
import {
  cleanupRepos,
  createEmptyRepo,
  createRepoWithHistory,
  git,
  writeFile
} from './helpers/temp-repo';

const app: Express = createApp();

/** Every request needs a Host the localhost guard accepts. */
function api(repo?: string) {
  const agent = request(app);
  return {
    get: (url: string) => {
      const req = agent.get(url).set('Host', '127.0.0.1');
      return repo ? req.set('x-repo-path', repo) : req;
    },
    post: (url: string) => {
      const req = agent.post(url).set('Host', '127.0.0.1');
      return repo ? req.set('x-repo-path', repo) : req;
    },
    delete: (url: string) => {
      const req = agent.delete(url).set('Host', '127.0.0.1');
      return repo ? req.set('x-repo-path', repo) : req;
    }
  };
}

beforeEach(() => {
  clearRepoPathCache();
});

afterAll(() => {
  cleanupRepos();
});

describe('the localhost guard', () => {
  it('rejects a cross-site Origin', async () => {
    await api()
      .get('/api/config')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('allows a same-origin request', async () => {
    await api().get('/api/config').set('Origin', 'http://localhost:3000').expect(200);
  });

  it('sets a Content-Security-Policy that forbids inline script', async () => {
    const response = await api().get('/api/config').expect(200);
    const csp = response.headers['content-security-policy'] ?? '';

    const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) =>
      part.startsWith('script-src')
    );

    // script-src is the directive that matters: it is what stops a crafted
    // branch name or commit message from becoming code execution in a page
    // that can drive this API. style-src does allow 'unsafe-inline', which is
    // a deliberate concession for the static style attributes in index.html.
    expect(scriptSrc).toBe("script-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('does not serve any page with an inline script the policy would block', async () => {
    for (const page of ['/index.html', '/logs.html']) {
      const { text } = await api().get(page).expect(200);

      // An inline <script> would silently stop working under script-src 'self'.
      expect(text, `${page} contains an inline script`).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    }
  });
});

describe('application identity', () => {
  it('serves the running version so the page title can show it', async () => {
    const { body } = await api().get('/api/app-info').expect(200);

    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.title).toBe(`${body.name} v${body.version}`);
  });

  it('needs no repository, so the title is right before one is opened', async () => {
    // No x-repo-path header at all.
    await api().get('/api/app-info').expect(200);
  });
});

describe('the x-repo-path guard', () => {
  it('rejects a missing header', async () => {
    await api().get('/api/git/status').expect(400);
  });

  it('rejects a folder that is not a repository', async () => {
    const notARepo = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'multi-git-plain-'));
    try {
      await api(notARepo).get('/api/git/status').expect(400);
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it('reports a folder that no longer exists as gone', async () => {
    await api(path.join(require('node:os').tmpdir(), 'multi-git-absent')).get('/api/git/status').expect(404);
  });
});

describe('status and history', () => {
  it('reports a clean repository', async () => {
    const repo = createRepoWithHistory();
    const { body } = await api(repo).get('/api/git/status').expect(200);

    expect(body).toMatchObject({ success: true, branch: 'main', isMerging: false, isRebasing: false });
    expect(body.staged).toEqual([]);
    expect(body.unstaged).toEqual([]);
  });

  it('separates staged, unstaged, and untracked files', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'README.md', '# Changed\n');
    writeFile(repo, 'new.txt', 'brand new\n');
    git(repo, 'add', 'README.md');
    writeFile(repo, 'src/app.txt', 'alpha\nmodified\n');

    const { body } = await api(repo).get('/api/git/status').expect(200);

    expect(body.staged.map((f: { path: string }) => f.path)).toEqual(['README.md']);
    expect(body.unstaged.map((f: { path: string }) => f.path).sort()).toEqual([
      'new.txt',
      'src/app.txt'
    ]);
  });

  it('reports a repository with no commits', async () => {
    const repo = createEmptyRepo();
    const { body } = await api(repo).get('/api/git/status').expect(200);

    expect(body.noCommits).toBe(true);
  });

  it('pages the commit log', async () => {
    const repo = createRepoWithHistory();

    const first = await api(repo).get('/api/git/log?limit=1&all=1').expect(200);
    expect(first.body.commits).toHaveLength(1);
    expect(first.body.hasMore).toBe(true);

    const all = await api(repo).get('/api/git/log?limit=10&all=1').expect(200);
    expect(all.body.commits).toHaveLength(2);
    expect(all.body.hasMore).toBe(false);
    expect(all.body.commits[0].message).toBe('feat: add app');
  });

  it('returns an empty log for a repository with no commits', async () => {
    const repo = createEmptyRepo();
    const { body } = await api(repo).get('/api/git/log?limit=10').expect(200);

    expect(body).toEqual({ success: true, commits: [], hasMore: false });
  });
});

describe('staging and committing', () => {
  it('stages, unstages, and commits a file', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'notes.txt', 'hello\n');

    await api(repo).post('/api/git/stage').send({ files: ['notes.txt'] }).expect(200);
    let status = await api(repo).get('/api/git/status').expect(200);
    expect(status.body.staged.map((f: { path: string }) => f.path)).toEqual(['notes.txt']);

    await api(repo).post('/api/git/unstage').send({ files: ['notes.txt'] }).expect(200);
    status = await api(repo).get('/api/git/status').expect(200);
    expect(status.body.staged).toEqual([]);

    await api(repo).post('/api/git/stage').send({ files: ['notes.txt'] }).expect(200);
    await api(repo).post('/api/git/commit').send({ message: 'feat: add notes' }).expect(200);

    const log = await api(repo).get('/api/git/log?limit=1').expect(200);
    expect(log.body.commits[0].message).toBe('feat: add notes');
  });

  it('unstages everything when given the "." sentinel', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'a.txt', 'a\n');
    writeFile(repo, 'b.txt', 'b\n');
    await api(repo).post('/api/git/stage').send({ files: ['a.txt', 'b.txt'] }).expect(200);

    await api(repo).post('/api/git/unstage').send({ files: ['.'] }).expect(200);

    const { body } = await api(repo).get('/api/git/status').expect(200);
    expect(body.staged).toEqual([]);
  });

  it('rejects a commit with no message', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/commit').send({ message: '' }).expect(400);
  });

  it('returns the last commit message for amend prefill', async () => {
    const repo = createRepoWithHistory();
    const { body } = await api(repo).get('/api/git/last-commit-message').expect(200);

    expect(body.message).toBe('feat: add app');
  });

  it('undoes the last commit, keeping the changes staged', async () => {
    const repo = createRepoWithHistory();

    await api(repo).post('/api/git/undo-commit').expect(200);

    const status = await api(repo).get('/api/git/status').expect(200);
    expect(status.body.staged.map((f: { path: string }) => f.path)).toEqual(['src/app.txt']);

    const log = await api(repo).get('/api/git/log?limit=5').expect(200);
    expect(log.body.commits).toHaveLength(1);
  });
});

describe('argument injection regressions', () => {
  it('stages a file literally named "-x"', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, '-x', 'option shaped filename\n');

    // Without the "--" separator git parses this as an unknown option.
    await api(repo).post('/api/git/stage').send({ files: ['-x'] }).expect(200);

    const { body } = await api(repo).get('/api/git/status').expect(200);
    expect(body.staged.map((f: { path: string }) => f.path)).toContain('-x');
  });

  it('refuses a branch name that would be read as a git option', async () => {
    const repo = createRepoWithHistory();

    const { body } = await api(repo)
      .post('/api/git/checkout')
      .send({ branch: '--upload-pack=touch /tmp/pwned' })
      .expect(400);

    expect(body.error).toMatch(/may not start with/i);
  });

  it('refuses a commit-ish that would make git write a file', async () => {
    const repo = createRepoWithHistory();
    const target = path.join(repo, 'injected.txt');

    // `git show --output=<path>` writes that file. This must never run.
    await api(repo).get(`/api/git/commit/details?hash=--output=${target}`).expect(400);

    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses an option-shaped tag name', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/tag').send({ name: '--delete' }).expect(400);
  });

  it('blames a file literally named "-x"', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, '-x', 'line one\n');
    git(repo, 'add', '--', '-x');
    git(repo, 'commit', '-m', 'add option-shaped file');

    const { body } = await api(repo).get('/api/git/file/blame?path=-x').expect(200);
    expect(body.blame[0].content).toBe('line one');
  });
});

describe('path containment', () => {
  it('refuses to read outside the repository', async () => {
    const repo = createRepoWithHistory();

    await api(repo).get('/api/git/file/content?path=../../../etc/passwd').expect(403);
    await api(repo).get('/api/git/file/content?path=/etc/passwd').expect(403);
  });

  it('reads a file inside the repository', async () => {
    const repo = createRepoWithHistory();
    const { body } = await api(repo).get('/api/git/file/content?path=README.md').expect(200);

    expect(body.content).toContain('# Title');
  });

  it('reports a binary file instead of returning mangled text', async () => {
    const repo = createRepoWithHistory();
    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]));

    const { body } = await api(repo).get('/api/git/file/content?path=blob.bin').expect(200);
    expect(body.binary).toBe(true);
    expect(body.content).toBe('');
  });
});

describe('diffs', () => {
  it('diffs a modified tracked file', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'src/app.txt', 'alpha\nBRAVO\ncharlie\n');

    const { body } = await api(repo).get('/api/git/diff?path=src/app.txt').expect(200);

    const types = body.diff.map((line: { type: string }) => line.type);
    expect(types).toContain('deletion');
    expect(types).toContain('addition');
  });

  it('presents an untracked file as all additions', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'fresh.txt', 'one\ntwo\n');

    const { body } = await api(repo)
      .get('/api/git/diff?path=fresh.txt&untracked=true')
      .expect(200);

    expect(body.diff.every((line: { type: string }) => line.type === 'addition')).toBe(true);
    expect(body.diff[0]).toMatchObject({ content: 'one', newLine: 1 });
  });
});

describe('branches', () => {
  it('creates, lists, checks out, and deletes a branch', async () => {
    const repo = createRepoWithHistory();

    await api(repo).post('/api/git/create-branch').send({ branchName: 'feature/x' }).expect(200);

    let branches = await api(repo).get('/api/git/branches').expect(200);
    expect(branches.body.local).toContain('feature/x');

    await api(repo).post('/api/git/checkout').send({ branch: 'main' }).expect(200);

    await api(repo).post('/api/git/delete-branch').send({ branch: 'feature/x' }).expect(200);

    branches = await api(repo).get('/api/git/branches').expect(200);
    expect(branches.body.local).not.toContain('feature/x');
  });

  it('reports an unmerged branch so the UI can offer force delete', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'checkout', '-b', 'unmerged');
    writeFile(repo, 'extra.txt', 'work\n');
    git(repo, 'add', 'extra.txt');
    git(repo, 'commit', '-m', 'wip');
    git(repo, 'checkout', 'main');

    const { body } = await api(repo).post('/api/git/delete-branch').send({ branch: 'unmerged' }).expect(500);

    expect(body.notFullyMerged).toBe(true);
  });
});

describe('merge conflicts', () => {
  /** Builds two branches that both change the same line. */
  function makeConflict(repo: string): void {
    writeFile(repo, 'conflict.txt', 'original\n');
    git(repo, 'add', 'conflict.txt');
    git(repo, 'commit', '-m', 'add conflict file');

    git(repo, 'checkout', '-b', 'theirs');
    writeFile(repo, 'conflict.txt', 'their version\n');
    git(repo, 'add', 'conflict.txt');
    git(repo, 'commit', '-m', 'their change');

    git(repo, 'checkout', 'main');
    writeFile(repo, 'conflict.txt', 'our version\n');
    git(repo, 'add', 'conflict.txt');
    git(repo, 'commit', '-m', 'our change');
  }

  it('runs merge, resolve, and continue end to end', async () => {
    const repo = createRepoWithHistory();
    makeConflict(repo);

    const merge = await api(repo).post('/api/git/merge').send({ branch: 'theirs' }).expect(200);
    expect(merge.body).toMatchObject({ success: false, conflict: true });

    const status = await api(repo).get('/api/git/status').expect(200);
    expect(status.body.isMerging).toBe(true);
    expect(status.body.conflicts.map((c: { path: string }) => c.path)).toEqual(['conflict.txt']);

    const file = await api(repo).get('/api/git/conflict/file?path=conflict.txt').expect(200);
    const conflictBlock = file.body.blocks.find((b: { type: string }) => b.type === 'conflict');
    expect(conflictBlock).toMatchObject({ ours: 'our version', theirs: 'their version' });

    await api(repo)
      .post('/api/git/conflict/resolve')
      .send({ filePath: 'conflict.txt', resolvedContent: 'merged version\n' })
      .expect(200);

    await api(repo).post('/api/git/conflict/continue').send({ type: 'merge' }).expect(200);

    const after = await api(repo).get('/api/git/status').expect(200);
    expect(after.body.isMerging).toBe(false);
    expect(after.body.conflicts).toEqual([]);
    expect(fs.readFileSync(path.join(repo, 'conflict.txt'), 'utf8')).toBe('merged version\n');
  });

  it('aborts a conflicted merge', async () => {
    const repo = createRepoWithHistory();
    makeConflict(repo);

    await api(repo).post('/api/git/merge').send({ branch: 'theirs' }).expect(200);
    await api(repo).post('/api/git/abort').send({ type: 'merge' }).expect(200);

    const { body } = await api(repo).get('/api/git/status').expect(200);
    expect(body.isMerging).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'conflict.txt'), 'utf8')).toBe('our version\n');
  });
});

describe('stashes', () => {
  it('pushes, lists, applies, and drops a stash', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'src/app.txt', 'alpha\nstashed\n');

    await api(repo).post('/api/git/stash').send({ message: 'wip' }).expect(200);

    let list = await api(repo).get('/api/git/stash').expect(200);
    expect(list.body.stashes).toHaveLength(1);
    expect(list.body.stashes[0].ref).toBe('stash@{0}');

    const clean = await api(repo).get('/api/git/status').expect(200);
    expect(clean.body.unstaged).toEqual([]);

    await api(repo).post('/api/git/stash/apply').send({ ref: 'stash@{0}', pop: true }).expect(200);

    list = await api(repo).get('/api/git/stash').expect(200);
    expect(list.body.stashes).toHaveLength(0);
    expect(fs.readFileSync(path.join(repo, 'src/app.txt'), 'utf8')).toContain('stashed');
  });

  it('rejects a malformed stash reference', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/stash/drop').send({ ref: '--all' }).expect(400);
  });
});

describe('tags', () => {
  it('creates, lists, and deletes a tag', async () => {
    const repo = createRepoWithHistory();

    await api(repo).post('/api/git/tag').send({ name: 'v1.0.0' }).expect(200);

    let tags = await api(repo).get('/api/git/tags').expect(200);
    expect(tags.body.tags.map((t: { name: string }) => t.name)).toContain('v1.0.0');

    await api(repo).delete('/api/git/tag').send({ name: 'v1.0.0' }).expect(200);

    tags = await api(repo).get('/api/git/tags').expect(200);
    expect(tags.body.tags).toHaveLength(0);
  });
});

describe('safety net', () => {
  it('restores a discarded file from the trash', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'src/app.txt', 'alpha\nabout to be lost\n');

    await api(repo).post('/api/git/discard').send({ filePath: 'src/app.txt' }).expect(200);
    expect(fs.readFileSync(path.join(repo, 'src/app.txt'), 'utf8')).not.toContain('about to be lost');

    const trash = await api(repo).get('/api/git/trash').expect(200);
    const entry = trash.body.entries.find((e: { path: string }) => e.path === 'src/app.txt');
    expect(entry).toBeTruthy();

    await api(repo).post('/api/git/trash/restore').send({ id: entry.id }).expect(200);
    expect(fs.readFileSync(path.join(repo, 'src/app.txt'), 'utf8')).toContain('about to be lost');
  });

  it('checkpoints a merge and undoes it', async () => {
    const repo = createRepoWithHistory();
    git(repo, 'checkout', '-b', 'side');
    writeFile(repo, 'side.txt', 'side work\n');
    git(repo, 'add', 'side.txt');
    git(repo, 'commit', '-m', 'side commit');
    git(repo, 'checkout', 'main');

    const headBefore = git(repo, 'rev-parse', 'HEAD').trim();
    await api(repo).post('/api/git/merge').send({ branch: 'side' }).expect(200);
    expect(git(repo, 'rev-parse', 'HEAD').trim()).not.toBe(headBefore);

    const checkpoints = await api(repo).get('/api/git/checkpoints').expect(200);
    expect(checkpoints.body.checkpoints.length).toBeGreaterThan(0);

    await api(repo)
      .post('/api/git/undo-operation')
      .send({ checkpointId: checkpoints.body.checkpoints[0].id })
      .expect(200);

    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(headBefore);
  });
});

describe('ignore', () => {
  it('adds an exact rule for an untracked file', async () => {
    const repo = createRepoWithHistory();
    writeFile(repo, 'debug.log', 'noise\n');

    const { body } = await api(repo).post('/api/git/ignore').send({ filePath: 'debug.log' }).expect(200);
    expect(body.rule).toBe('/debug.log');

    const status = await api(repo).get('/api/git/status').expect(200);
    const paths = status.body.unstaged.map((f: { path: string }) => f.path);
    expect(paths).not.toContain('debug.log');
    expect(paths).toContain('.gitignore');
  });

  it('refuses to ignore a tracked file', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/ignore').send({ filePath: 'README.md' }).expect(400);
  });
});

describe('the new repository wizard', () => {
  /**
   * Runs `body` with git's global and system configuration emptied.
   *
   * The wizard reads `init.defaultBranch` to decide what to call the first
   * branch, so a developer who has set that would otherwise get a different
   * answer from these assertions than CI does.
   */
  async function withPristineGitConfig<T>(body: () => Promise<T>): Promise<T> {
    const empty = path.join(require('node:os').tmpdir(), 'multi-git-empty-gitconfig');
    const previous = {
      global: process.env['GIT_CONFIG_GLOBAL'],
      system: process.env['GIT_CONFIG_SYSTEM']
    };

    fs.writeFileSync(empty, '', 'utf8');
    process.env['GIT_CONFIG_GLOBAL'] = empty;
    process.env['GIT_CONFIG_SYSTEM'] = empty;

    try {
      return await body();
    } finally {
      for (const [key, value] of [
        ['GIT_CONFIG_GLOBAL', previous.global],
        ['GIT_CONFIG_SYSTEM', previous.system]
      ] as const) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  it('reports what is already in the target folder', async () => {
    const repo = createRepoWithHistory();
    const { body } = await api().post('/api/git/new-repo/preflight').send({ repoPath: repo }).expect(200);

    expect(body).toMatchObject({ folderExists: true, isDirectory: true, isGitRepo: true });
  });

  it('creates a repository with a license and a .gitignore', async () => {
    const parent = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'multi-git-wizard-'));
    const target = path.join(parent, 'brand-new');

    try {
      const { body } = await api()
        .post('/api/git/new-repo')
        .send({
          repoPath: target,
          visibility: 'private',
          licenseId: 'mit',
          licenseYear: '2026',
          licenseHolder: 'Test Holder',
          gitignoreId: 'node'
        })
        .expect(200);

      expect(body.success).toBe(true);
      expect(body.licenseFile).toBe('LICENSE');
      expect(body.gitignoreWritten).toBe(true);

      expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
      const license = fs.readFileSync(path.join(target, 'LICENSE'), 'utf8');
      expect(license).toContain('Test Holder');
      expect(license).toContain('2026');
      expect(license).not.toContain('[fullname]');
      expect(fs.readFileSync(path.join(target, '.gitignore'), 'utf8')).toContain('node_modules');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('keeps an existing LICENSE unless replacement is confirmed', async () => {
    const parent = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'multi-git-wizard-'));
    const target = path.join(parent, 'has-license');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'LICENSE'), 'MY OWN LICENSE\n', 'utf8');

    try {
      const { body } = await api()
        .post('/api/git/new-repo')
        .send({ repoPath: target, licenseId: 'mit', licenseHolder: 'Test', licenseYear: '2026' })
        .expect(200);

      expect(body.warnings.join(' ')).toMatch(/Kept the existing LICENSE/);
      expect(fs.readFileSync(path.join(target, 'LICENSE'), 'utf8')).toBe('MY OWN LICENSE\n');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('leaves a new repository committed on main, ready to be pushed', async () => {
    // The whole point: `git init` alone leaves an unborn branch that git still
    // calls master, and no commit for a refspec to name, so the first push is
    // rejected. Everything here is what the user used to type by hand.
    const parent = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'multi-git-wizard-'));
    const target = path.join(parent, 'ready-to-push');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'notes.txt'), 'already here\n', 'utf8');

    try {
      const body = await withPristineGitConfig(async () =>
        (
          await api()
            .post('/api/git/new-repo')
            .send({
              repoPath: target,
              licenseId: 'none',
              gitignoreId: 'none',
              authorName: 'Test User',
              authorEmail: 'test@example.com'
            })
            .expect(200)
        ).body
      );

      expect(body).toMatchObject({ branch: 'main', initialCommit: true, pushed: false });
      expect(git(target, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
      expect(git(target, 'log', '--oneline').trim()).toContain('Initial commit');

      // The file that was already in the folder is in that commit.
      expect(git(target, 'ls-tree', '--name-only', 'HEAD').split('\n')).toContain('notes.txt');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('commits the license and .gitignore it wrote, and nothing the .gitignore excludes', async () => {
    const parent = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'multi-git-wizard-'));
    const target = path.join(parent, 'with-templates');
    fs.mkdirSync(path.join(target, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(target, 'node_modules', 'dep.js'), 'noise\n', 'utf8');
    fs.writeFileSync(path.join(target, 'index.js'), 'console.log(1);\n', 'utf8');

    try {
      await api()
        .post('/api/git/new-repo')
        .send({
          repoPath: target,
          licenseId: 'mit',
          licenseYear: '2026',
          licenseHolder: 'Test Holder',
          gitignoreId: 'node',
          authorName: 'Test User',
          authorEmail: 'test@example.com'
        })
        .expect(200);

      const tracked = git(target, 'ls-files').split('\n').map((line) => line.trim());

      expect(tracked).toContain('LICENSE');
      expect(tracked).toContain('.gitignore');
      expect(tracked).toContain('index.js');
      // The template is written before anything is staged, so the folder it
      // ignores never reaches the commit it would otherwise dominate.
      expect(tracked).not.toContain('node_modules/dep.js');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('says so when an empty folder leaves nothing to commit', async () => {
    const parent = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'multi-git-wizard-'));
    const target = path.join(parent, 'nothing-here');

    try {
      const body = await withPristineGitConfig(async () =>
        (
          await api()
            .post('/api/git/new-repo')
            .send({ repoPath: target, licenseId: 'none', gitignoreId: 'none' })
            .expect(200)
        ).body
      );

      expect(body.initialCommit).toBe(false);
      expect(body.warnings.join(' ')).toMatch(/nothing to commit/i);
      // Still a repository on main, so a commit made later publishes cleanly.
      expect(body.branch).toBe('main');
      expect(git(target, 'symbolic-ref', 'HEAD').trim()).toBe('refs/heads/main');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('refuses to re-initialise an existing repository', async () => {
    const repo = createRepoWithHistory();
    await api().post('/api/git/new-repo').send({ repoPath: repo }).expect(400);
  });

  it('rejects an unknown license id', async () => {
    const parent = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'multi-git-wizard-'));
    try {
      await api()
        .post('/api/git/new-repo')
        .send({ repoPath: path.join(parent, 'x'), licenseId: 'not-real' })
        .expect(400);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('the repository identity', () => {
  it('reads and writes the per-repository author', async () => {
    const repo = createRepoWithHistory();

    await api(repo)
      .post('/api/git/identity')
      .send({ name: 'New Name', email: 'new@example.com' })
      .expect(200);

    const { body } = await api(repo).get('/api/git/identity').expect(200);
    expect(body).toMatchObject({ name: 'New Name', email: 'new@example.com', isLocal: true });
  });

  it('rejects an incomplete identity', async () => {
    const repo = createRepoWithHistory();
    await api(repo).post('/api/git/identity').send({ name: 'Only Name' }).expect(400);
  });
});
