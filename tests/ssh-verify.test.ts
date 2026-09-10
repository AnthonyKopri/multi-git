// Asking the host who authenticated, rather than assuming the pin worked.
//
// The case this exists for: a pin naming the familiara key, with
// IdentitiesOnly=yes set, authenticating as AnthonyKopri because the managed
// block named that key for the same host and the agent offered it first.
// Nothing in the local configuration was wrong to look at, and GitHub's reply
// was `ERROR: Repository not found.` — which names the wrong problem entirely.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  classifyFailure,
  parseGreetedAccount,
  verifySshAccount,
  wrongAccountHint
} from '../src/server/ssh/verify';
import { resetOpensshPathCache } from '../src/server/ssh/openssh-path';
import { FakeRunner } from './helpers/fake-runner';
import type { RecordedCall } from './helpers/fake-runner';

const GITHUB_OK = "Hi akopri-familiara! You've successfully authenticated, but GitHub does not provide shell access.";

let workspace: string;
let keyPath: string;

/** The verification call itself, as opposed to the binary lookup. */
function sshCall(runner: FakeRunner): RecordedCall | undefined {
  return runner.calls.find((call) => call.args.includes('-T'));
}

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-verify-')));
  keyPath = path.join(workspace, 'id_ed25519');
  fs.writeFileSync(keyPath, '');
  resetOpensshPathCache();
  // Keep the resolver off whatever OpenSSH the runner happens to have.
  vi.stubEnv('SystemRoot', workspace);
  vi.stubEnv('windir', workspace);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetOpensshPathCache();
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('parseGreetedAccount', () => {
  it('reads the account out of the hosts that name one', () => {
    expect(parseGreetedAccount(GITHUB_OK)).toBe('akopri-familiara');
    expect(parseGreetedAccount('Welcome to GitLab, @jane.doe!')).toBe('jane.doe');
  });

  it('answers null rather than guessing', () => {
    // A wrong name here would raise a mismatch warning about nothing, which is
    // worse than saying the host did not identify itself.
    expect(parseGreetedAccount('Linux build-box 6.1.0\n')).toBeNull();
    expect(parseGreetedAccount('')).toBeNull();
  });
});

describe('classifyFailure', () => {
  it('separates a rejected key from one that wanted typing', () => {
    expect(classifyFailure('git@github.com: Permission denied (publickey).')).toBe('refused');
    expect(classifyFailure("Enter passphrase for key '/home/j/.ssh/id_ed25519':")).toBe('prompted');
    expect(classifyFailure('Host key verification failed.')).toBe('prompted');
    expect(classifyFailure('something else entirely')).toBe('unparsed');
  });
});

describe('verifySshAccount', () => {
  it('reports the account the host greeted', async () => {
    const runner = new FakeRunner().otherwise({ stderr: GITHUB_OK, exitCode: 1 });

    const check = await verifySshAccount({ host: 'github.com', privateKeyPath: keyPath, runner });

    expect(check.ok).toBe(true);
    expect(check.account).toBe('akopri-familiara');
    expect(check.mismatch).toBe(false);
  });

  it('flags the account disagreeing with the remote owner', async () => {
    // The whole point: the connection succeeds, so nothing else in the app has
    // any reason to complain.
    const runner = new FakeRunner().otherwise({
      stderr: "Hi AnthonyKopri! You've successfully authenticated, but GitHub does not provide shell access.",
      exitCode: 1
    });

    const check = await verifySshAccount({
      host: 'github.com',
      privateKeyPath: keyPath,
      expectedAccount: 'akopri-familiara',
      runner
    });

    expect(check.ok).toBe(true);
    expect(check.mismatch).toBe(true);
    expect(check.message).toContain('AnthonyKopri');
    expect(check.message).toContain('akopri-familiara');
  });

  it('compares account names without regard to case', async () => {
    const runner = new FakeRunner().otherwise({ stderr: 'Hi AnthonyKopri!', exitCode: 1 });

    const check = await verifySshAccount({
      host: 'github.com',
      privateKeyPath: keyPath,
      expectedAccount: 'anthonykopri',
      runner
    });

    expect(check.mismatch).toBe(false);
  });

  it('never waits on a prompt', async () => {
    // Without BatchMode a key whose passphrase is not in the agent sits on a
    // prompt no one is watching, for the whole timeout, on every repo open.
    const runner = new FakeRunner().otherwise({ stderr: GITHUB_OK, exitCode: 1 });

    await verifySshAccount({ host: 'github.com', privateKeyPath: keyPath, runner });

    expect(sshCall(runner)?.args).toContain('BatchMode=yes');
  });

  it('asks with the same options the pin uses', async () => {
    // If these drifted, a green verification would say nothing about what a
    // push is actually going to do.
    const runner = new FakeRunner().otherwise({ stderr: GITHUB_OK, exitCode: 1 });

    await verifySshAccount({ host: 'github.com', privateKeyPath: keyPath, runner });
    const args = sshCall(runner)?.args ?? [];

    expect(args).toContain('IdentitiesOnly=yes');
    expect(args).toContain(process.platform === 'win32' ? 'NUL' : '/dev/null');
    expect(args).toContain(keyPath);
    expect(args).toContain('git@github.com');
  });

  it('reports a rejected key as refused rather than as a missing account', async () => {
    const runner = new FakeRunner().otherwise({
      stderr: 'git@github.com: Permission denied (publickey).',
      exitCode: 255
    });

    const check = await verifySshAccount({ host: 'github.com', privateKeyPath: keyPath, runner });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('refused');
  });

  it('survives having no ssh to run at all', async () => {
    const runner = new FakeRunner().otherwise({ spawnError: true });

    const check = await verifySshAccount({ host: 'github.com', privateKeyPath: keyPath, runner });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('no-binary');
  });
});

describe('wrongAccountHint', () => {
  it('explains a "repository not found" that is really a wrong account', () => {
    const hint = wrongAccountHint('ERROR: Repository not found.\nfatal: Could not read from remote', {
      profileLabel: 'familiara',
      originRemoteUrl: 'git@github.com:akopri-familiara/familiara-website-d1.git'
    });

    expect(hint).toContain('akopri-familiara');
    expect(hint).toContain('familiara');
  });

  it('stays quiet about failures that mean what they say', () => {
    expect(
      wrongAccountHint('fatal: the remote end hung up unexpectedly', {
        profileLabel: 'familiara',
        originRemoteUrl: 'git@github.com:owner/repo.git'
      })
    ).toBeNull();
  });

  it('says nothing when there is no owner to name', () => {
    expect(
      wrongAccountHint('ERROR: Repository not found.', {
        profileLabel: null,
        originRemoteUrl: ''
      })
    ).toBeNull();
  });
});
