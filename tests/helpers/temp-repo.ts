// Creates throwaway Git repositories for the integration tests.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created: string[] = [];

/** Runs git synchronously in `cwd`, throwing with git's own message on failure. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Keep the developer's own config and hooks out of the fixtures.
      GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'multi-git-test-gitconfig'),
      GIT_CONFIG_SYSTEM: path.join(os.tmpdir(), 'multi-git-test-gitconfig'),
      GIT_TERMINAL_PROMPT: '0'
    }
  });
}

/**
 * A throwaway directory under a path spelled the way git will spell it.
 *
 * `realpathSync.native` rather than `realpathSync`, because on Windows the
 * plain form leaves an 8.3 short name alone. GitHub's Windows runners have a
 * `TEMP` of `C:\Users\RUNNER~1\…`, so a fixture built with the plain form
 * compares short paths against the long ones git prints back, and every
 * assertion about a worktree path fails there and nowhere else. `.native` is
 * also what `canonicalRepoKey` uses, so fixtures and the product agree.
 */
function realTempDir(prefix: string): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function writeFile(repo: string, relativePath: string, contents: string): void {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
}

/** Applies the identity and hygiene settings every fixture repository needs. */
function configureRepo(repo: string): void {
  git(repo, 'init', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Test User');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
}

/** An initialised repository with an identity configured and no commits. */
export function createEmptyRepo(): string {
  const repo = realTempDir('multi-git-itest-');
  created.push(repo);

  configureRepo(repo);

  return repo;
}

/**
 * An empty repository in a folder with the exact name given.
 *
 * `mkdtemp` appends random characters, so it cannot produce a folder called
 * `中文` on its own. The name is the point for the transport tests: it is what
 * has to survive the trip through an HTTP header.
 */
export function createEmptyRepoNamed(folderName: string): string {
  const parent = realTempDir('multi-git-named-');
  created.push(parent);

  const repo = path.join(parent, folderName);
  fs.mkdirSync(repo);
  configureRepo(repo);

  return repo;
}

/** A temporary folder that is not a repository. Cleaned up with the rest. */
export function createTempDir(prefix = 'multi-git-tmp-'): string {
  const directory = realTempDir(prefix);
  created.push(directory);
  return directory;
}

/** A repository with two commits and a known file. */
export function createRepoWithHistory(): string {
  const repo = createEmptyRepo();

  writeFile(repo, 'README.md', '# Title\n\nfirst line\nsecond line\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-m', 'docs: add readme');

  writeFile(repo, 'src/app.txt', 'alpha\nbravo\ncharlie\n');
  git(repo, 'add', 'src/app.txt');
  git(repo, 'commit', '-m', 'feat: add app');

  return repo;
}

/** Removes every repository created during the run. */
export function cleanupRepos(): void {
  while (created.length > 0) {
    const repo = created.pop();
    if (repo) {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
}
