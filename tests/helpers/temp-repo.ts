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

export function writeFile(repo: string, relativePath: string, contents: string): void {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
}

/** An initialised repository with an identity configured and no commits. */
export function createEmptyRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-itest-')));
  created.push(repo);

  git(repo, 'init', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Test User');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');

  return repo;
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
