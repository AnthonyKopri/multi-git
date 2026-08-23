// What the Terminal Log records.
//
// The log used to be written by the renderer from intent, which produced lines
// that read like git commands without being any: `git add a b c` when the real
// invocation was something else, a key path elided to `...`, and no sign of the
// `-c core.longpaths=true` a Windows rebase actually carries. None of it could
// be copied and run, which for a log whose whole purpose is showing what the
// application did to your repository is the only thing that matters.
//
// So the assertions here are about fidelity: the recorded argv is the argv, and
// running it would reproduce what happened.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runGitCommand, tryGitCommand } from '../src/server/git/run';
import { clearLogBuffer, logBuffer } from '../src/server/logs';
import { gitCommandKind, gitSubcommand, processCommandKind } from '../src/server/git/command-kind';
import { cleanupRepos, createRepoWithHistory, writeFile } from './helpers/temp-repo';

let repo: string;

beforeEach(() => {
  repo = createRepoWithHistory();
  clearLogBuffer();
});

afterEach(() => clearLogBuffer());
afterAll(() => cleanupRepos());

/** Command entries only, in the order they were recorded. */
const commands = () => logBuffer().filter((entry) => entry.command !== undefined);

describe('classifying a git invocation', () => {
  it('reads the subcommand past the configuration git carries', () => {
    // A Windows rebase really runs as `-c core.longpaths=true rebase -i <base>`,
    // so anything keying off args[0] sees `-c` and not the subcommand.
    expect(gitSubcommand(['-c', 'core.longpaths=true', 'rebase', '-i', 'HEAD~3'])).toBe('rebase');
    expect(gitSubcommand(['-C', '/somewhere', 'status'])).toBe('status');
    expect(gitSubcommand(['status', '--porcelain'])).toBe('status');
    expect(gitSubcommand(['--version'])).toBeNull();
  });

  it('calls the questions reads', () => {
    for (const args of [
      ['status', '--porcelain'],
      ['rev-parse', 'HEAD'],
      ['log', '--oneline'],
      ['diff', '--cached'],
      ['for-each-ref', 'refs/heads'],
      ['config', '--get', 'user.email'],
      ['branch', '--list'],
      ['stash', 'list'],
      ['worktree', 'list'],
      ['remote', '-v']
    ]) {
      expect(gitCommandKind(args), args.join(' ')).toBe('read');
    }
  });

  it('calls everything else an action', () => {
    for (const args of [
      ['commit', '-m', 'x'],
      ['push', 'origin', 'main'],
      ['-c', 'core.longpaths=true', 'rebase', '-i', 'HEAD~3'],
      ['config', '--local', 'user.email', 'a@b.c'],
      ['branch', '-d', 'gone'],
      ['stash', 'drop'],
      ['worktree', 'remove', '/tmp/x'],
      ['remote', 'add', 'origin', 'git@example.com:a/b.git']
    ]) {
      expect(gitCommandKind(args), args.join(' ')).toBe('write');
    }
  });

  it('names the tools that are not git without their extension', () => {
    // programName strips `.exe`, so a table keyed with one never matches. The
    // agent-status poll runs these on a timer, and getting this wrong put four
    // lines of service probing at the top of an otherwise empty log.
    expect(processCommandKind('sc.exe', ['query', 'ssh-agent'])).toBe('read');
    expect(processCommandKind('sc.exe', ['config', 'ssh-agent', 'start=auto'])).toBe('write');

    // Absolute paths, which is what the OpenSSH resolver hands over.
    expect(processCommandKind('C:\\Windows\\System32\\OpenSSH\\ssh-add.exe', ['-l'])).toBe('read');
    expect(processCommandKind('/usr/bin/ssh-add', ['-l'])).toBe('read');
    expect(processCommandKind('ssh-add', ['C:/keys/id_ed25519'])).toBe('write');
  });

  it('looks past `lfs` to the subcommand that decides', () => {
    expect(processCommandKind('git', ['lfs', 'ls-files'])).toBe('read');
    expect(processCommandKind('git', ['lfs', 'track', '*.psd'])).toBe('write');
  });

  it('treats a subcommand it does not know as an action', () => {
    // Failing this way round is deliberate: a log that occasionally shows a
    // harmless read is fine, one that silently omits something that changed the
    // repository is not.
    expect(gitCommandKind(['some-future-subcommand'])).toBe('write');
  });
});

describe('what gets recorded', () => {
  it('records the argument vector that actually ran', async () => {
    await runGitCommand(repo, ['status', '--porcelain']);

    const entry = commands().at(-1);
    expect(entry?.command?.argv).toEqual(['git', 'status', '--porcelain']);
    expect(entry?.command?.cwd).toBe(repo);
  });

  it('records configuration the application adds, which the old log hid', async () => {
    // The renderer never knew about this, so its reconstruction could not show
    // it. Anyone debugging a long-path failure needs to see it.
    await runGitCommand(repo, ['-c', 'core.longpaths=true', 'status', '--porcelain']);

    expect(commands().at(-1)?.command?.argv).toEqual([
      'git',
      '-c',
      'core.longpaths=true',
      'status',
      '--porcelain'
    ]);
  });

  it('attributes every command to its repository', async () => {
    const other = createRepoWithHistory();

    await runGitCommand(repo, ['status', '--porcelain']);
    await runGitCommand(other, ['status', '--porcelain']);

    const [first, second] = commands().slice(-2);
    expect(first?.repoPath).toBe(repo);
    expect(second?.repoPath).toBe(other);
    expect(first?.repoPath).not.toBe(second?.repoPath);
  });

  it('records the exit code and marks a failure as one', async () => {
    // tryGitCommand swallows the rejection; the log should not swallow the
    // command, because a command that failed is the one you most want to see.
    await tryGitCommand(repo, ['rev-parse', '--verify', 'refs/heads/no-such-branch']);

    const entry = commands().at(-1);
    expect(entry?.command?.exitCode).not.toBe(0);
    expect(entry?.type).toBe('error');
  });

  it('times what it ran', async () => {
    await runGitCommand(repo, ['status', '--porcelain']);

    expect(commands().at(-1)?.command?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('classifies a real write as one', async () => {
    writeFile(repo, 'note.txt', 'contents\n');
    await runGitCommand(repo, ['add', 'note.txt']);

    expect(commands().at(-1)?.command?.kind).toBe('write');
  });

  it('does not repeat the environment the user already had', async () => {
    // Only what this application set is worth showing back; the inherited
    // environment is the user's own.
    await runGitCommand(repo, ['status', '--porcelain']);

    expect(commands().at(-1)?.command?.env).toBeUndefined();
  });

  it('shows the key it pinned, which is the whole point of the profile feature', async () => {
    await tryGitCommand(repo, ['status', '--porcelain']);
    clearLogBuffer();

    await runGitCommand(repo, ['status', '--porcelain'], 'C:/keys/id_ed25519');

    const env = commands().at(-1)?.command?.env;
    expect(env?.['GIT_SSH_COMMAND']).toContain('id_ed25519');
  });
});
