// Asks the remote who just authenticated, instead of assuming.
//
// The failure this exists to catch is silent by construction: a pin can be
// syntactically perfect, `ssh-add -l` can show the right key unlocked, and the
// connection can still authenticate as a different account — because
// `IdentitiesOnly=yes` admits the configuration's identities alongside `-i`,
// and the agent's ordering decides which one the server accepts first. GitHub
// then answers `ERROR: Repository not found.`, which names the wrong problem
// entirely and sends people looking for a repository they think they deleted.
//
// One round trip settles it. GitHub greets by name:
//
//   ssh -F NUL -i <familiara> -o IdentitiesOnly=yes -T git@github.com
//   -> Hi akopri-familiara! You've successfully authenticated, ...
//
// The arguments come from ./command.ts, the same builder that writes the pin,
// so this reports what a push will actually do rather than an approximation.
import { buildSshArgs } from './command';
import { ownerFromRemote } from '../git/remote';
import { CommandTimeoutError, executableRunner } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';
import type { SshIdentityCheck, SshVerifyFailure } from '../../shared/ssh-agent-types';

/** Long enough for a slow link, short enough not to hold up a push. */
const VERIFY_TIMEOUT_MS = 15_000;

/** `ssh -T` against a git host exits non-zero by design; 255 is a refusal. */
const EXPECTED_EXIT_CODES = [1, 255];

/**
 * The account name out of a host's greeting.
 *
 * Only the hosts whose greeting actually names one. Anything else is reported
 * as authenticated-with-no-name rather than guessed at, because a wrong name
 * here would produce a mismatch warning about nothing.
 */
export function parseGreetedAccount(output: string): string | null {
  return (
    /\bHi ([^!\s]+)!/.exec(output)?.[1] ??
    /Welcome to GitLab, @([^!\s]+)!/.exec(output)?.[1] ??
    /logged in as ([^\s.]+)\./.exec(output)?.[1] ??
    null
  );
}

/** What went wrong, from what ssh said about it. */
export function classifyFailure(output: string): SshVerifyFailure {
  if (/permission denied|no supported authentication|publickey/i.test(output)) {
    return 'refused';
  }
  if (/passphrase|host key verification|no such identity|batch mode/i.test(output)) {
    return 'prompted';
  }
  return 'unparsed';
}

export interface VerifyOptions {
  host: string;
  privateKeyPath?: string | undefined;
  isolateConfig?: boolean | undefined;
  /** The account the remote URL implies, when there is one. */
  expectedAccount?: string | null | undefined;
  runner?: ExecutableRunner | undefined;
}

/**
 * Connects once and reports the account the host greeted.
 *
 * `BatchMode=yes` is what makes this safe to call automatically: without it a
 * key whose passphrase is not in the agent would sit waiting on a prompt that
 * no one is watching, for the full timeout, on every repository open.
 */
export async function verifySshAccount(options: VerifyOptions): Promise<SshIdentityCheck> {
  const runner = options.runner ?? executableRunner;
  const expected = options.expectedAccount ?? null;

  const { binary, args } = buildSshArgs({
    ...(options.privateKeyPath ? { privateKeyPath: options.privateKeyPath } : {}),
    ...(options.isolateConfig !== undefined ? { isolateConfig: options.isolateConfig } : {})
  });

  const failure = (reason: SshVerifyFailure, message: string): SshIdentityCheck => ({
    ok: false,
    account: null,
    expected,
    mismatch: false,
    reason,
    message
  });

  try {
    const result = await runner.run(
      binary,
      [...args, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', `git@${options.host}`],
      { timeoutMs: VERIFY_TIMEOUT_MS, allowNonZero: EXPECTED_EXIT_CODES }
    );

    // The greeting is on stderr, but hosts differ and it costs nothing to look
    // at both.
    const output = `${result.stderr}\n${result.stdout}`;
    const account = parseGreetedAccount(output);

    if (account === null) {
      const reason = classifyFailure(output);
      return failure(
        reason,
        reason === 'refused'
          ? `${options.host} rejected this key. It may not be added to the account.`
          : output.trim().split('\n')[0]?.trim() ||
              `${options.host} did not say which account authenticated.`
      );
    }

    const mismatch = expected !== null && account.toLowerCase() !== expected.toLowerCase();

    return {
      ok: true,
      account,
      expected,
      mismatch,
      message: mismatch
        ? `This key authenticates as ${account}, but the remote belongs to ${expected}.`
        : `Authenticated as ${account}.`
    };
  } catch (error) {
    if (error instanceof CommandTimeoutError) {
      return failure('timeout', `${options.host} did not answer within 15 seconds.`);
    }

    // A spawn failure means no ssh binary at all, which is the one problem
    // openssh-path.ts cannot solve for itself.
    return failure('no-binary', error instanceof Error ? error.message : 'ssh could not be run.');
  }
}

/** What GitHub says when the authenticated account cannot see the repository. */
const REPO_NOT_FOUND = /(?:ERROR|remote):\s*Repository not found/i;

/**
 * A better sentence for `ERROR: Repository not found.`
 *
 * The message is accurate from the server's point of view and misleading from
 * the user's: the repository exists, they are simply authenticated as an account
 * that cannot see it. Taken at face value it sends people looking for a
 * repository they think they deleted.
 */
export function wrongAccountHint(
  stderr: string,
  options: { profileLabel: string | null; originRemoteUrl: string }
): string | null {
  if (!REPO_NOT_FOUND.test(stderr)) {
    return null;
  }

  const owner = ownerFromRemote(options.originRemoteUrl);
  if (!owner) {
    return null;
  }

  const account = options.profileLabel ? ` as "${options.profileLabel}"` : '';

  return (
    `${owner} did not recognise this repository for the account you authenticated${account}. ` +
    'That usually means the key in use belongs to a different account rather than that the repository is missing. ' +
    'Verify the account for this repository to see which one the host actually sees.'
  );
}
