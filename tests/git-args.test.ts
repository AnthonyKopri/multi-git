import { describe, expect, it } from 'vitest';

import {
  InvalidGitArgumentError,
  commitish,
  githubRepoName,
  pathArg,
  pathArgs,
  refArg
} from '../src/server/git/args';

describe('refArg', () => {
  it('accepts ordinary branch and tag names', () => {
    expect(refArg('main')).toBe('main');
    expect(refArg('feature/add-login')).toBe('feature/add-login');
    expect(refArg('release-1.0.6')).toBe('release-1.0.6');
    expect(refArg('origin/main')).toBe('origin/main');
    expect(refArg('v1.2.3')).toBe('v1.2.3');
  });

  it('rejects a leading hyphen, which git would parse as an option', () => {
    // The attack this exists for: a ref named like a flag.
    expect(() => refArg('--upload-pack=touch /tmp/pwned')).toThrow(InvalidGitArgumentError);
    expect(() => refArg('-x')).toThrow(InvalidGitArgumentError);
    expect(() => refArg('--help')).toThrow(InvalidGitArgumentError);
  });

  it('rejects sequences git reserves', () => {
    expect(() => refArg('a..b')).toThrow(InvalidGitArgumentError);
    expect(() => refArg('main@{upstream}')).toThrow(InvalidGitArgumentError);
    expect(() => refArg('back\\slash')).toThrow(InvalidGitArgumentError);
  });

  it('rejects characters git does not allow in a ref', () => {
    for (const ref of ['has space', 'tilde~1', 'caret^1', 'colon:name', 'question?', 'star*', 'bracket[0]']) {
      expect(() => refArg(ref), ref).toThrow(InvalidGitArgumentError);
    }
  });

  it('rejects malformed leading and trailing forms', () => {
    for (const ref of ['/leading', 'trailing/', 'trailing.', 'branch.lock']) {
      expect(() => refArg(ref), ref).toThrow(InvalidGitArgumentError);
    }
  });

  it('rejects control characters', () => {
    expect(() => refArg(`line${String.fromCharCode(10)}injected`)).toThrow(InvalidGitArgumentError);
    expect(() => refArg(`nul${String.fromCharCode(0)}`)).toThrow(InvalidGitArgumentError);
  });

  it('rejects absent or non-string values', () => {
    for (const value of ['', '   ', null, undefined, 42, {}]) {
      expect(() => refArg(value), String(value)).toThrow(InvalidGitArgumentError);
    }
  });

  it('reports a 400 status so the error middleware answers correctly', () => {
    try {
      refArg('-x');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as InvalidGitArgumentError).statusCode).toBe(400);
    }
  });
});

describe('commitish', () => {
  it('accepts abbreviated and full object names', () => {
    expect(commitish('abc1234')).toBe('abc1234');
    expect(commitish('35909c2fd6262104fbdcd6b3812bcc15ea2e767b')).toBe(
      '35909c2fd6262104fbdcd6b3812bcc15ea2e767b'
    );
  });

  it('falls back to ref validation for names', () => {
    expect(commitish('main')).toBe('main');
    expect(commitish('v1.0.6')).toBe('v1.0.6');
  });

  it('rejects option-shaped values', () => {
    // `git show --output=<path>` writes a file, so this must never get through.
    expect(() => commitish('--output=/tmp/pwned')).toThrow(InvalidGitArgumentError);
    expect(() => commitish('-n')).toThrow(InvalidGitArgumentError);
  });

  it('rejects a too-short hex string that is not a valid ref either', () => {
    expect(() => commitish('a..b')).toThrow(InvalidGitArgumentError);
  });
});

describe('pathArg', () => {
  it('accepts ordinary repository paths, including odd but legal names', () => {
    expect(pathArg('src/app.ts')).toBe('src/app.ts');
    expect(pathArg('name with spaces.txt')).toBe('name with spaces.txt');
    expect(pathArg('café.txt')).toBe('café.txt');
    expect(pathArg('weird~^:?*[].txt')).toBe('weird~^:?*[].txt');
  });

  it('accepts a leading hyphen, because pathArgs adds the -- separator', () => {
    // A file really can be named "-x"; the separator is what makes it safe.
    expect(pathArg('-x')).toBe('-x');
  });

  it('rejects control characters', () => {
    expect(() => pathArg(`a${String.fromCharCode(10)}b`)).toThrow(InvalidGitArgumentError);
  });

  it('rejects empty values', () => {
    expect(() => pathArg('')).toThrow(InvalidGitArgumentError);
    expect(() => pathArg(null)).toThrow(InvalidGitArgumentError);
  });
});

describe('pathArgs', () => {
  it('prefixes the pathspec with the -- separator', () => {
    expect(pathArgs(['README.md'])).toEqual(['--', 'README.md']);
    expect(pathArgs(['a.txt', 'b.txt'])).toEqual(['--', 'a.txt', 'b.txt']);
  });

  it('makes an option-shaped filename safe to pass', () => {
    // Without "--", `git add -x` is an unknown option; with it, it is a path.
    expect(pathArgs(['-x'])).toEqual(['--', '-x']);
    expect(pathArgs(['--all'])).toEqual(['--', '--all']);
  });

  it('accepts a bare string as a single path', () => {
    expect(pathArgs('README.md')).toEqual(['--', 'README.md']);
  });

  it('rejects an empty list', () => {
    expect(() => pathArgs([])).toThrow(InvalidGitArgumentError);
  });

  it('rejects the whole list when any entry is invalid', () => {
    expect(() => pathArgs(['ok.txt', `bad${String.fromCharCode(0)}`])).toThrow(
      InvalidGitArgumentError
    );
  });
});

describe('githubRepoName', () => {
  it('accepts ordinary repository names', () => {
    expect(githubRepoName('multi-git')).toBe('multi-git');
    expect(githubRepoName('my_project.v2')).toBe('my_project.v2');
    expect(githubRepoName('1password-clone')).toBe('1password-clone');
  });

  it('rejects a leading hyphen', () => {
    // The regression this guards: a folder named "-x" would produce
    // `gh repo create -x --private ...`, feeding a flag to the CLI that holds
    // the user's GitHub credentials.
    expect(() => githubRepoName('-x')).toThrow(InvalidGitArgumentError);
    expect(() => githubRepoName('--confirm')).toThrow(InvalidGitArgumentError);
  });

  it('rejects characters GitHub does not allow', () => {
    for (const name of ['has space', 'slash/name', 'quote"name', 'semi;colon']) {
      expect(() => githubRepoName(name), name).toThrow(InvalidGitArgumentError);
    }
  });

  it('rejects names longer than 100 characters', () => {
    expect(() => githubRepoName('a'.repeat(101))).toThrow(InvalidGitArgumentError);
    expect(githubRepoName('a'.repeat(100))).toHaveLength(100);
  });

  it('rejects empty values', () => {
    expect(() => githubRepoName('')).toThrow(InvalidGitArgumentError);
    expect(() => githubRepoName(undefined)).toThrow(InvalidGitArgumentError);
  });
});
