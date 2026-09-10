// Signing diagnostics, without a single real binary.
//
// These used to be reachable only through the HTTP route, which meant the only
// way to exercise them was to have `gpg` and `ssh-keygen` installed and to
// accept whatever the machine did. On a cold Windows runner that is not a
// constant: `gpg --version` starts `gpg-agent`, and the suite's 30s ceiling was
// blown by a test that asserts nothing about gpg at all.
//
// So `signingDiagnostics` takes a runner, the same seam ssh/verify.ts takes,
// and every case below scripts the answer instead of asking the host for one.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { signingDiagnostics } from '../src/server/git/signing';
import type { SigningConfig } from '../src/shared/signing-types';
import { FakeRunner, command } from './helpers/fake-runner';

function config(overrides: Partial<SigningConfig> = {}): SigningConfig {
  return {
    mode: 'system',
    signCommitsByDefault: false,
    signTagsByDefault: false,
    signingKey: null,
    allowedSignersFile: null,
    isRepoLevel: false,
    ...overrides
  };
}

/** The codes reported, which is what the panel actually renders. */
function codesOf(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((entry) => entry.code);
}

describe('signingDiagnostics', () => {
  it('asks gpg for its version in gpg mode, and says so when it is absent', async () => {
    const runner = new FakeRunner().on(command('gpg'), { spawnError: true });

    const { diagnostics, gpgVersion } = await signingDiagnostics(
      config({ mode: 'gpg', signingKey: 'DEADBEEF' }),
      { runner }
    );

    expect(gpgVersion).toBeNull();
    expect(codesOf(diagnostics)).toContain('gpg-missing');
    expect(runner.callsTo('gpg')[0]?.args).toEqual(['--version']);
  });

  it('reports the version gpg printed rather than a diagnostic', async () => {
    const runner = new FakeRunner().on(command('gpg'), {
      stdout: 'gpg (GnuPG) 2.4.5\nlibgcrypt 1.10.3\n'
    });

    const { diagnostics, gpgVersion } = await signingDiagnostics(
      config({ mode: 'gpg', signingKey: 'DEADBEEF' }),
      { runner }
    );

    expect(gpgVersion).toContain('gpg (GnuPG) 2.4.5');
    expect(codesOf(diagnostics)).not.toContain('gpg-missing');
  });

  it('does not go near gpg for a mode that cannot use it', async () => {
    const runner = new FakeRunner();

    await signingDiagnostics(config({ mode: 'off' }), { runner });

    expect(runner.calls).toEqual([]);
  });

  it('checks gpg for system mode only when it would sign by default', async () => {
    const quiet = new FakeRunner();
    await signingDiagnostics(config({ mode: 'system' }), { runner: quiet });
    expect(quiet.callsTo('gpg')).toEqual([]);

    const signing = new FakeRunner().on(command('gpg'), { stdout: 'gpg (GnuPG) 2.4.5' });
    await signingDiagnostics(
      config({ mode: 'system', signCommitsByDefault: true }),
      { runner: signing }
    );
    expect(signing.callsTo('gpg')).toHaveLength(1);
  });

  it('reads the version out of an ssh-keygen that exits non-zero', async () => {
    // `ssh-keygen -V` is not a version flag; it prints its banner on stderr and
    // exits non-zero. That still tells us the version, and treating the exit
    // code as "missing" would report SSH signing as impossible on every
    // machine that has it.
    const runner = new FakeRunner().on(command('ssh-keygen'), {
      stderr: 'unknown option -- V\nusage: ssh-keygen [-q] ... OpenSSH_9.6p1, LibreSSL 3.3.6',
      exitCode: 255
    });

    const { diagnostics } = await signingDiagnostics(
      config({ mode: 'ssh', signingKey: null }),
      { runner }
    );

    expect(codesOf(diagnostics)).not.toContain('ssh-keygen-missing');
    expect(codesOf(diagnostics)).not.toContain('ssh-keygen-too-old');
  });

  it('blocks SSH signing on an OpenSSH older than 8.2', async () => {
    const runner = new FakeRunner().on(command('ssh-keygen'), {
      stderr: 'OpenSSH_7.9p1, LibreSSL 2.7.3',
      exitCode: 255
    });

    const { diagnostics } = await signingDiagnostics(
      config({ mode: 'ssh', signingKey: null }),
      { runner }
    );

    expect(codesOf(diagnostics)).toContain('ssh-keygen-too-old');
  });

  it('reports ssh-keygen missing when it cannot be started at all', async () => {
    const runner = new FakeRunner().on(command('ssh-keygen'), { spawnError: true });

    const { diagnostics } = await signingDiagnostics(
      config({ mode: 'ssh', signingKey: null }),
      { runner }
    );

    expect(codesOf(diagnostics)).toContain('ssh-keygen-missing');
  });

  it('warns that SSH signatures cannot be verified without an allowed-signers file', async () => {
    const runner = new FakeRunner().on(command('ssh-keygen'), {
      stderr: 'OpenSSH_9.6p1',
      exitCode: 255
    });

    const { diagnostics } = await signingDiagnostics(
      config({ mode: 'ssh', signingKey: null, allowedSignersFile: null }),
      { runner }
    );

    const warning = diagnostics.find((entry) => entry.code === 'no-allowed-signers');
    expect(warning).toBeDefined();
    // Signing still works; only verification does not.
    expect(warning?.blocksSigning).toBe(false);
  });

  it('reports an SSH signing key that is not on disk', async () => {
    const runner = new FakeRunner().on(command('ssh-keygen'), {
      stderr: 'OpenSSH_9.6p1',
      exitCode: 255
    });
    const missing = path.join(os.tmpdir(), 'multi-git-no-such-key-xyz.pub');

    const { diagnostics } = await signingDiagnostics(
      config({ mode: 'ssh', signingKey: missing }),
      { runner }
    );

    expect(codesOf(diagnostics)).toContain('signing-key-missing');
  });

  it('accepts an SSH signing key that exists', async () => {
    const runner = new FakeRunner().on(command('ssh-keygen'), {
      stderr: 'OpenSSH_9.6p1',
      exitCode: 255
    });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-signing-'));
    const key = path.join(directory, 'id_ed25519.pub');
    fs.writeFileSync(key, 'ssh-ed25519 AAAA test');

    try {
      const { diagnostics } = await signingDiagnostics(
        config({ mode: 'ssh', signingKey: key, allowedSignersFile: key }),
        { runner }
      );

      expect(codesOf(diagnostics)).not.toContain('signing-key-missing');
      expect(codesOf(diagnostics)).not.toContain('signing-key-unreadable');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports a mode with no signing key configured', async () => {
    const runner = new FakeRunner().on(command('gpg'), { stdout: 'gpg (GnuPG) 2.4.5' });

    const { diagnostics } = await signingDiagnostics(
      config({ mode: 'gpg', signingKey: null }),
      { runner }
    );

    expect(codesOf(diagnostics)).toContain('no-signing-key');
  });

  it('bounds how long a wedged tool can hold the panel up', async () => {
    // The reason the runner is injected rather than the process spawned
    // directly: a timeout has to be something the caller states, not something
    // the host decides.
    const runner = new FakeRunner().on(command('gpg'), { stdout: 'gpg (GnuPG) 2.4.5' });

    await signingDiagnostics(config({ mode: 'gpg', signingKey: 'DEADBEEF' }), { runner });

    expect(runner.callsTo('gpg')[0]?.options.timeoutMs).toBe(10_000);
  });
});
