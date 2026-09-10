// The one place an `ssh` command line is built, and the one place a value is
// recognised as ours.
//
// ./openssh-path.ts already settles *which* ssh runs. This settles what it is
// told, and in particular the option that turns out to matter more than it
// looks:
//
// `IdentitiesOnly=yes` does not mean "only the key given with -i". It means
// "only identities named in the configuration **and** on the command line". So
// with a managed `Host github.com` block naming key A, a repository pinned to
// key B offers *both*, and the agent's ordering decides which one the server
// accepts. Verified with `ssh -G` on a machine with two accounts:
//
//   -i B -o IdentitiesOnly=yes            -> identityfile B, identityfile A
//   -F NUL -i B -o IdentitiesOnly=yes     -> identityfile B
//
// and end to end, against the account that owns neither:
//
//   ssh -i B -o IdentitiesOnly=yes -T git@github.com        -> Hi <account A>!
//   ssh -F NUL -i B -o IdentitiesOnly=yes -T git@github.com -> Hi <account B>!
//
// So the pin bypasses the user configuration and carries everything it needs
// itself. That also drops any legitimate user directives for the host — a
// ProxyJump, or Port 443 for ssh.github.com — which is why it is a setting
// rather than unconditional.
import path from 'node:path';

import { normalizeSshPath } from './keys';
import { opensshBinary, sshCommandPrefix } from './openssh-path';

/**
 * The null device to point `-F` at.
 *
 * `-F none` is understood by OpenSSH 8.7 and later and would avoid the platform
 * split, but Ubuntu 20.04 still ships 8.2 and would treat `none` as a filename.
 */
export function nullConfigPath(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

/** Quoted and slash-normalised, because git hands this string to a shell. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '/')}"`;
}

export interface SshCommandOptions {
  /** Omitted for the no-profile case, which must still reach the agent. */
  privateKeyPath?: string | undefined;
  /** Bypass ~/.ssh/config so `-i` is genuinely the only identity. */
  isolateConfig?: boolean | undefined;
  /** Stops ssh retrying a passphrase the askpass bridge already answered. */
  singlePasswordPrompt?: boolean | undefined;
}

export interface ResolvedSshCommand {
  /** Unquoted, for a runner that spawns without a shell. */
  binary: string;
  args: string[];
}

/**
 * The binary and options a pin would use, as separate values.
 *
 * Exposed alongside the string form so that verifying an identity and using it
 * cannot drift apart: ./verify.ts spawns exactly these arguments, so what it
 * reports is what a push will actually do rather than an approximation that
 * happens to agree today.
 */
export function buildSshArgs(options: SshCommandOptions = {}): ResolvedSshCommand {
  const keyPath = options.privateKeyPath ? normalizeSshPath(options.privateKeyPath) : '';
  const args: string[] = [];

  if (keyPath) {
    // Only meaningful alongside -i: with no identity of its own, a command that
    // bypassed the configuration would have nothing left to offer.
    if (options.isolateConfig !== false) {
      args.push('-F', nullConfigPath());
    }
    args.push('-i', keyPath);
    args.push('-o', 'IdentitiesOnly=yes');
  }

  args.push('-o', 'StrictHostKeyChecking=accept-new');

  if (options.singlePasswordPrompt) {
    args.push('-o', 'NumberOfPasswordPrompts=1');
  }

  return { binary: opensshBinary('ssh'), args };
}

/** Builds the command git runs for ssh. */
export function buildSshCommandLine(options: SshCommandOptions = {}): string {
  const { args } = buildSshArgs(options);

  // Only the key path is quoted; nothing else here can contain a space, and
  // sshCommandPrefix has already quoted the binary. git hands this whole string
  // to a shell, so a key under `C:\Users\Jane Doe\.ssh` would otherwise arrive
  // as two arguments.
  const quoted = args.map((arg, index) => (args[index - 1] === '-i' ? quote(arg) : arg));

  return [sshCommandPrefix(), ...quoted].join(' ');
}

/** The leading word of a command line, unwrapped if it was quoted. */
function firstToken(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end < 0 ? null : trimmed.slice(1, end);
  }

  return /^(\S+)/.exec(trimmed)?.[1] ?? null;
}

/** Options that mean the user is doing something this app never does. */
const USER_AUTHORED = /(?:^|\s)-J(?:\s|$)|ProxyJump|ProxyCommand/i;

/**
 * True when a configured value looks like one of ours.
 *
 * Used to avoid clobbering a `core.sshCommand` the user set by hand for their
 * own reasons — a jump host, a custom binary, extra options.
 *
 * Deliberately structural rather than a prefix test. The predicate this
 * replaces was `value.startsWith('ssh -i "')`, which stops matching the moment
 * the builder names the binary by absolute path — and a value that is no longer
 * recognised is never rewritten, so every repository pinned by an older build
 * would have been left on the broken form forever. This accepts both shapes, so
 * the next profile apply migrates a repository in place.
 */
export function isMultiGitSshCommand(value: string | null): boolean {
  if (value === null || value.trim() === '') {
    return false;
  }

  if (USER_AUTHORED.test(value)) {
    return false;
  }

  // The key is always quoted by every version of the builder; a hand-written
  // value such as `ssh -J bastion -i /k` is not.
  if (!value.includes('-i "') || !value.includes('IdentitiesOnly=yes')) {
    return false;
  }

  const binary = firstToken(value);
  if (binary === null) {
    return false;
  }

  const name = path.basename(binary.replace(/\\/g, '/')).toLowerCase();
  if (name !== 'ssh' && name !== 'ssh.exe') {
    return false;
  }

  // A `-F` pointing anywhere but the null device is the user's own choice of
  // configuration file, and not something to overwrite.
  const configFile = /(?:^|\s)-F\s+(\S+)/.exec(value)?.[1];
  return configFile === undefined || configFile === 'NUL' || configFile === '/dev/null';
}
