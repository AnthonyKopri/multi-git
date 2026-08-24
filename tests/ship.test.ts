// The release driver's argument and answer handling.
//
// The steps themselves spawn the documented commands and are exercised by
// running them; what is worth pinning here is the two places a wrong reading
// would do something the user did not ask for — a misparsed flag, and a
// mistyped answer at a prompt.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface ShipOptions {
  bump: string | null;
  tag: string | null;
  repo: string | null;
  yes: boolean;
  dryRun: boolean;
  publish: boolean;
  changelog: boolean;
  help: boolean;
}

interface AskerLike {
  rl: { close: () => void } | null;
  close(): void;
}

interface ShipApi {
  parseArgs(argv: string[]): ShipOptions;
  answerToAction(answer: unknown): 'run' | 'skip' | 'quit' | 'unclear';
  requiredMacAssetNames(version: string): string[];
  requiredReleaseAssetNames(version: string): string[];
  remoteTagCommit(output: string | null, tag: string): string | null;
  githubRepoFromRemote(remoteUrl: string | null): string | null;
  releaseCreateArgs(tag: string, version: string, branch: string, repo: string | null): string[];
  ensureReleaseTagAtHead(
    input: {
      tag: string;
      shipping: string;
      dryRun?: boolean;
      would?: (command: string) => void;
    },
    operations: {
      readGit: (...args: string[]) => Promise<string | null>;
      captureGit: (...args: string[]) => Promise<string>;
      git: (...args: string[]) => Promise<unknown>;
    }
  ): Promise<string>;
  packageFilesNeedCommit(check?: (file: string) => Promise<boolean>): Promise<boolean>;
  releaseDraftStatus(
    tag: string,
    repo: string | null,
    read?: (command: string, args: string[]) => Promise<string | null>
  ): Promise<boolean | null>;
  isReleaseCommitAtHead(
    shipping: string,
    read?: (...args: string[]) => Promise<string | null>
  ): Promise<boolean>;
  releaseResumeDecision(input: {
    packageDirty: boolean;
    changelogDirty: boolean;
    tagCommit: string | null;
    draftStatus: boolean | null;
    releaseCommit?: boolean;
  }): { resume: boolean; reason: string | null };
  effectiveReleaseBump(requested: string | null, resume: boolean): string | null;
  Asker: new (options: { yes: boolean }) => AskerLike;
}

const require = createRequire(import.meta.url);
const ship = require('../scripts/ship.js') as ShipApi;

describe('parseArgs', () => {
  it('asks about everything when told nothing', () => {
    expect(ship.parseArgs([])).toEqual({
      bump: null,
      tag: null,
      repo: null,
      yes: false,
      dryRun: false,
      // Publishing is what makes a release public, so it never happens
      // because a flag was left off.
      publish: false,
      changelog: true,
      help: false
    });
  });

  it('reads the flags in either form', () => {
    expect(ship.parseArgs(['--bump=minor', '-R', 'owner/repo', '--dry-run'])).toMatchObject({
      bump: 'minor',
      repo: 'owner/repo',
      dryRun: true
    });

    expect(ship.parseArgs(['--bump', 'patch', '--tag', 'Release_v9.9.9', '-y'])).toMatchObject({
      bump: 'patch',
      tag: 'Release_v9.9.9',
      yes: true
    });
  });

  it('accepts the upload step’s own flag, so it means the same thing here', () => {
    // Reaching for `--no-changelog` on the command that wraps the upload is
    // the obvious thing to do, and it used to stop the release with
    // "Unknown option".
    expect(ship.parseArgs(['--no-changelog']).changelog).toBe(false);
    expect(ship.parseArgs([]).changelog).toBe(true);
  });

  it('refuses an unknown flag rather than ignoring it', () => {
    // A typo in a release command should stop the release, not run one that
    // silently means something else.
    expect(() => ship.parseArgs(['--publsh'])).toThrow('Unknown option');
    // And says where the list is, rather than leaving it to be guessed.
    expect(() => ship.parseArgs(['--publsh'])).toThrow('--help');
  });

  it('refuses a flag whose value was swallowed by the next flag', () => {
    expect(() => ship.parseArgs(['--bump', '--yes'])).toThrow('--bump requires a value');
  });
});

describe('cross-platform publish guard', () => {
  it('requires both native DMGs, portable ZIPs, and the Mac checksum manifest', () => {
    expect(ship.requiredMacAssetNames('4.1.0')).toEqual([
      'Multi-Git-Client-macOS-4.1.0-arm64.dmg',
      'Multi-Git-Client-macOS-4.1.0-arm64.zip',
      'Multi-Git-Client-macOS-4.1.0-x64.dmg',
      'Multi-Git-Client-macOS-4.1.0-x64.zip',
      'SHA256SUMS-macOS.txt'
    ]);
  });

  it('also requires both Windows packages and manifest at the irreversible boundary', () => {
    expect(ship.requiredReleaseAssetNames('4.1.0')).toEqual([
      'Multi-Git-Client-Setup-4.1.0.exe',
      'Multi-Git-Client-Portable-4.1.0.exe',
      'SHA256SUMS.txt',
      'Multi-Git-Client-macOS-4.1.0-arm64.dmg',
      'Multi-Git-Client-macOS-4.1.0-arm64.zip',
      'Multi-Git-Client-macOS-4.1.0-x64.dmg',
      'Multi-Git-Client-macOS-4.1.0-x64.zip',
      'SHA256SUMS-macOS.txt'
    ]);
  });
});

describe('pinning every native package to one release tag', () => {
  const tag = 'Release_v4.1.0';
  const ref = `refs/tags/${tag}`;
  const head = 'b'.repeat(40);
  const ancestor = 'a'.repeat(40);

  function fakeTagRepository(options: {
    local?: string | null;
    remote?: string | null;
    head?: string;
    version?: string;
    ancestor?: boolean;
    annotated?: boolean;
    networkError?: boolean;
    changedSource?: string[];
    diffError?: boolean;
  } = {}) {
    let local = options.local ?? null;
    let remote = options.remote ?? null;
    const currentHead = options.head ?? head;
    const writes: string[][] = [];
    const remoteOutput = () => {
      if (remote === null) return '';
      return options.annotated
        ? `${'c'.repeat(40)}\t${ref}\n${remote}\t${ref}^{}\n`
        : `${remote}\t${ref}\n`;
    };
    const operations = {
      readGit: async (...args: string[]): Promise<string | null> => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return `${currentHead}\n`;
        if (args[0] === 'rev-parse' && args[1] === '--verify') return local && `${local}\n`;
        if (args[0] === 'show') {
          return JSON.stringify({ version: options.version ?? '4.1.0' });
        }
        if (args[0] === 'merge-base') return options.ancestor === false ? null : '';
        if (args[0] === 'diff') {
          return options.diffError ? null : `${(options.changedSource ?? []).join('\n')}`;
        }
        throw new Error(`Unexpected readGit call: ${args.join(' ')}`);
      },
      captureGit: async (...args: string[]): Promise<string> => {
        if (options.networkError) throw new Error('network unavailable');
        if (args[0] === 'ls-remote') return remoteOutput();
        throw new Error(`Unexpected captureGit call: ${args.join(' ')}`);
      },
      git: async (...args: string[]): Promise<void> => {
        writes.push(args);
        if (args[0] === 'tag') local = currentHead;
        if (args[0] === 'fetch') local = remote;
        if (args[0] === 'push') remote = local;
      }
    };
    return { operations, writes };
  }

  it('creates and non-force pushes a missing tag at the exact HEAD', async () => {
    const { operations, writes } = fakeTagRepository();

    await expect(ship.ensureReleaseTagAtHead({ tag, shipping: '4.1.0' }, operations)).resolves.toBe(
      head
    );
    expect(writes).toEqual([
      ['tag', '--', tag, head],
      ['push', 'origin', `${ref}:${ref}`]
    ]);
  });

  it('accepts an annotated tag at an ancestor after the changelog commit', async () => {
    const { operations, writes } = fakeTagRepository({
      local: ancestor,
      remote: ancestor,
      annotated: true
    });

    await expect(ship.ensureReleaseTagAtHead({ tag, shipping: '4.1.0' }, operations)).resolves.toBe(
      ancestor
    );
    expect(writes).toEqual([]);
  });

  it('rejects an ancestor tag when application source changed after it', async () => {
    const { operations } = fakeTagRepository({
      local: ancestor,
      remote: ancestor,
      changedSource: ['src/main/main.ts']
    });

    await expect(
      ship.ensureReleaseTagAtHead({ tag, shipping: '4.1.0' }, operations)
    ).rejects.toThrow(/only CHANGELOG[.]md may change/);
  });

  it('fetches the exact remote tag when a retry has no local tag', async () => {
    const { operations, writes } = fakeTagRepository({ remote: ancestor });

    await ship.ensureReleaseTagAtHead({ tag, shipping: '4.1.0' }, operations);

    expect(writes).toEqual([['fetch', '--no-tags', 'origin', `${ref}:${ref}`]]);
  });

  it('resumes a prior failed push without recreating the local tag', async () => {
    const { operations, writes } = fakeTagRepository({ local: ancestor });

    await ship.ensureReleaseTagAtHead({ tag, shipping: '4.1.0' }, operations);

    expect(writes).toEqual([['push', 'origin', `${ref}:${ref}`]]);
  });

  it('fails closed on a wrong version, nonancestor, split tag, or network error', async () => {
    const wrongVersion = fakeTagRepository({ version: '4.0.0' });
    await expect(
      ship.ensureReleaseTagAtHead({ tag, shipping: '4.1.0' }, wrongVersion.operations)
    ).rejects.toThrow(/version 4\.0\.0/);

    const unrelated = fakeTagRepository({ local: ancestor, remote: ancestor, ancestor: false });
    await expect(
      ship.ensureReleaseTagAtHead({ tag, shipping: '4.1.0' }, unrelated.operations)
    ).rejects.toThrow(/not an ancestor/);

    const split = fakeTagRepository({ local: ancestor, remote: head });
    await expect(
      ship.ensureReleaseTagAtHead({ tag, shipping: '4.1.0' }, split.operations)
    ).rejects.toThrow(/differs locally/);

    const offline = fakeTagRepository({ networkError: true });
    await expect(
      ship.ensureReleaseTagAtHead({ tag, shipping: '4.1.0' }, offline.operations)
    ).rejects.toThrow('network unavailable');
  });

  it('keeps dry-run discovery read-only and prints exact commands', async () => {
    const { operations, writes } = fakeTagRepository();
    const commands: string[] = [];

    await ship.ensureReleaseTagAtHead(
      { tag, shipping: '4.1.0', dryRun: true, would: (command) => commands.push(command) },
      operations
    );

    expect(writes).toEqual([]);
    expect(commands).toEqual([
      `git tag ${tag} ${head}`,
      `git push origin ${ref}:${ref}`
    ]);
  });

  it('requires an existing tag when creating the draft release', () => {
    const args = ship.releaseCreateArgs(tag, '4.1.0', 'main', 'AnthonyKopri/multi-git');
    expect(args).toContain('--verify-tag');
    expect(args).not.toContain('--target');
    expect(args.slice(-2)).toEqual(['--repo', 'AnthonyKopri/multi-git']);
  });

  it('recognizes the canonical repository in SSH and HTTPS remotes', () => {
    expect(ship.githubRepoFromRemote('git@github.com:AnthonyKopri/multi-git.git')).toBe(
      'AnthonyKopri/multi-git'
    );
    expect(ship.githubRepoFromRemote('https://github.com/AnthonyKopri/multi-git.git')).toBe(
      'AnthonyKopri/multi-git'
    );
    expect(ship.githubRepoFromRemote('git@example.com:owner/repo.git')).toBeNull();
  });
});

describe('resuming an interrupted release', () => {
  it('does not strand a lockfile-only version change', async () => {
    const checked: string[] = [];
    const dirty = await ship.packageFilesNeedCommit(async (file) => {
      checked.push(file);
      return file.endsWith('package-lock.json');
    });

    expect(dirty).toBe(true);
    expect(checked).toHaveLength(2);
    expect(checked[1]).toMatch(/package-lock[.]json$/);
  });

  it('turns an automatic patch bump into bump none for resumable state', () => {
    const uncommitted = ship.releaseResumeDecision({
      packageDirty: true,
      changelogDirty: false,
      tagCommit: null,
      draftStatus: null
    });
    const draft = ship.releaseResumeDecision({
      packageDirty: false,
      changelogDirty: false,
      tagCommit: 'a'.repeat(40),
      draftStatus: true
    });
    const pushedVersion = ship.releaseResumeDecision({
      packageDirty: false,
      changelogDirty: false,
      tagCommit: null,
      draftStatus: null,
      releaseCommit: true
    });

    expect(uncommitted.resume).toBe(true);
    expect(draft.resume).toBe(true);
    expect(pushedVersion.resume).toBe(true);
    expect(ship.effectiveReleaseBump('patch', uncommitted.resume)).toBe('none');
    expect(ship.effectiveReleaseBump('patch', draft.resume)).toBe('none');
    expect(ship.effectiveReleaseBump('patch', pushedVersion.resume)).toBe('none');
  });

  it('recognizes only the package-only version commit made by Step 2', async () => {
    const read = async (...args: string[]) => {
      if (args[0] === 'log') return 'chore: release 4.1.0\n';
      if (args[0] === 'diff-tree') return 'package.json\npackage-lock.json\n';
      return null;
    };
    await expect(ship.isReleaseCommitAtHead('4.1.0', read)).resolves.toBe(true);

    await expect(
      ship.isReleaseCommitAtHead('4.1.0', async (...args) =>
        args[0] === 'log'
          ? 'chore: release 4.1.0\n'
          : 'package.json\nsrc/main/main.ts\n'
      )
    ).resolves.toBe(false);
    await expect(
      ship.isReleaseCommitAtHead('4.1.0', async () => 'chore: something else\n')
    ).resolves.toBe(false);
  });

  it('allows the next bump only after the current tagged release is published', () => {
    const decision = ship.releaseResumeDecision({
      packageDirty: false,
      changelogDirty: false,
      tagCommit: 'a'.repeat(40),
      draftStatus: false
    });

    expect(decision.resume).toBe(false);
    expect(ship.effectiveReleaseBump('patch', decision.resume)).toBe('patch');
  });

  it('rejects package changes after tagging and orphaned changelog residue', () => {
    expect(() =>
      ship.releaseResumeDecision({
        packageDirty: true,
        changelogDirty: false,
        tagCommit: 'a'.repeat(40),
        draftStatus: true
      })
    ).toThrow(/package-lock[.]json is dirty after/);

    expect(() =>
      ship.releaseResumeDecision({
        packageDirty: false,
        changelogDirty: true,
        tagCommit: null,
        draftStatus: null
      })
    ).toThrow(/no current draft\/tag/);
  });

  it('reads the draft state from the requested repository and fails closed on malformed JSON', async () => {
    const seen: [string, string[]][] = [];
    await expect(
      ship.releaseDraftStatus('Release_v4.1.0', 'owner/repo', async (command, args) => {
        seen.push([command, args]);
        return '{"isDraft":true}';
      })
    ).resolves.toBe(true);
    expect(seen[0]).toEqual([
      'gh',
      ['release', 'view', 'Release_v4.1.0', '--json', 'isDraft', '--repo', 'owner/repo']
    ]);

    await expect(
      ship.releaseDraftStatus('Release_v4.1.0', null, async () => '{}')
    ).rejects.toThrow(/draft state/);
    await expect(
      ship.releaseDraftStatus('Release_v4.1.0', null, async () => null)
    ).resolves.toBeNull();
  });
});

describe('answerToAction', () => {
  it('treats a bare Enter as yes, because the prompt says [Y]', () => {
    expect(ship.answerToAction('')).toBe('run');
    expect(ship.answerToAction('y')).toBe('run');
    expect(ship.answerToAction('YES')).toBe('run');
  });

  it('reads a skip and a refusal the same way', () => {
    // Both mean "not this step", and neither means "stop everything".
    expect(ship.answerToAction('s')).toBe('skip');
    expect(ship.answerToAction('n')).toBe('skip');
    expect(ship.answerToAction('no')).toBe('skip');
  });

  it('reads a quit', () => {
    expect(ship.answerToAction('q')).toBe('quit');
    expect(ship.answerToAction('abort')).toBe('quit');
  });

  it('calls anything else unclear rather than guessing', () => {
    // "yeah" is not yes here. Guessing at a release step is how something
    // gets published that nobody meant to publish.
    expect(ship.answerToAction('yeah')).toBe('unclear');
    expect(ship.answerToAction('maybe')).toBe('unclear');
    expect(ship.answerToAction(undefined)).toBe('unclear');
  });

  it('ignores surrounding whitespace and case', () => {
    expect(ship.answerToAction('  Q  ')).toBe('quit');
    expect(ship.answerToAction(' Skip ')).toBe('skip');
  });
});

describe('the prompt across a step that owns the terminal', () => {
  it('forgets a closed interface, so a later step can ask again', () => {
    // Step 1 closes this so `release.js` can own the terminal for its own
    // questions. Leaving the closed interface in place made every step after
    // it throw "readline was closed" — after the build had already succeeded,
    // which is the worst possible moment to lose the ability to ask.
    const asker = new ship.Asker({ yes: false });
    let closed = 0;
    asker.rl = { close: () => { closed += 1; } };

    asker.close();

    expect(closed).toBe(1);
    expect(asker.rl).toBeNull();
  });

  it('can be closed twice without complaining', () => {
    // The steps close it on the way out of several branches, and main() closes
    // it again in its finally.
    const asker = new ship.Asker({ yes: false });
    let closed = 0;
    asker.rl = { close: () => { closed += 1; } };

    asker.close();
    asker.close();

    expect(closed).toBe(1);
  });
});
