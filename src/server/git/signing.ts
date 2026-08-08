// Reading signatures, and configuring what this repository signs with.
//
// The care in here is almost all about one thing: not saying more than git
// knows. `git log --pretty=%G?` answers `N` both for a commit that was never
// signed and for a signed commit this repository has no way to verify — an
// SSH signature with no allowed-signers file produces exactly that, and
// reporting it as "unsigned" would be a claim about someone else's work that
// is simply false. So an `N` is checked against the commit object itself, and
// a signature that is present but uncheckable is reported as unknown with the
// reason attached.
import fs from 'node:fs';

import { commitish, refArg } from './args';
import { runGitCommand, tryGitCommand } from './run';
import { runProcess } from '../process/run';
import type {
  SignatureInfo,
  SignatureKind,
  SigningConfig,
  SigningDiagnostic,
  SigningMode
} from '../../shared/signing-types';

const SIGNATURE_FORMAT = ['%G?', '%GS', '%GK', '%GF', '%GT'].join('\x1f');

/** `ssh-keygen -Y sign` arrived in OpenSSH 8.2. */
const MIN_SSH_KEYGEN = { major: 8, minor: 2 };

function emptyToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  // Git prints the literal word for a trust level that does not apply.
  return trimmed === '' || trimmed === 'undefined' ? null : trimmed;
}

/**
 * An SSH key fingerprint is `SHA256:…`; a GPG key is hex. Git does not say
 * which it used, so the shape of the key it reports is the only signal.
 */
function kindFromKey(key: string | null, fingerprint: string | null): SignatureKind {
  const candidate = key ?? fingerprint;
  if (candidate === null) {
    return 'unknown';
  }
  if (candidate.startsWith('SHA256:') || candidate.startsWith('ssh-') || candidate.includes('@openssh')) {
    return 'ssh';
  }
  return /^[0-9A-Fa-f]{8,}$/.test(candidate.replace(/\s/g, '')) ? 'gpg' : 'unknown';
}

interface RawSignature {
  code: string;
  signer: string | null;
  key: string | null;
  fingerprint: string | null;
  trust: string | null;
}

function parseRaw(line: string): RawSignature {
  const [code, signer, key, fingerprint, trust] = line.split('\x1f');
  return {
    code: (code ?? 'N').trim(),
    signer: emptyToNull(signer),
    key: emptyToNull(key),
    fingerprint: emptyToNull(fingerprint),
    trust: emptyToNull(trust)
  };
}

/** True when the commit object carries a signature header. */
async function hasSignatureHeader(repoPath: string, oid: string): Promise<boolean> {
  const result = await tryGitCommand(repoPath, ['cat-file', 'commit', oid]);
  if (result === null) {
    return false;
  }

  // Headers end at the first blank line; the message below could contain
  // anything, including a line that looks like a header.
  for (const line of result.stdout.split('\n')) {
    if (line.trim() === '') {
      return false;
    }
    if (line.startsWith('gpgsig ') || line.startsWith('gpgsig-sha256 ')) {
      return true;
    }
  }

  return false;
}

const UNKNOWN_REASONS: Record<string, string> = {
  U: 'The signature is good, but the key is not trusted here.',
  X: 'The signature is good, but the key has expired.',
  Y: 'The signature is good, but it was made by an expired key.',
  E: 'The signature could not be checked — the key is missing, or the signing tool is not installed.'
};

function statusFor(raw: RawSignature, signedButUncheckable: boolean): SignatureInfo {
  const base = {
    kind: kindFromKey(raw.key, raw.fingerprint),
    signer: raw.signer,
    key: raw.key,
    fingerprint: raw.fingerprint,
    trust: raw.trust
  };

  switch (raw.code) {
    case 'G':
      return { ...base, status: 'good', reason: null };
    case 'B':
      return { ...base, status: 'bad', reason: 'The signature does not match the commit.' };
    case 'R':
      return { ...base, status: 'bad', reason: 'The signing key has been revoked.' };
    case 'U':
    case 'X':
    case 'Y':
    case 'E':
      return { ...base, status: 'unknown', reason: UNKNOWN_REASONS[raw.code] ?? null };
    default:
      // The important case. Git says "no signature" when it cannot verify an
      // SSH signature at all, so the object itself has the last word.
      return signedButUncheckable
        ? {
            ...base,
            kind: base.kind === 'unknown' ? 'ssh' : base.kind,
            status: 'unknown',
            reason:
              'This commit is signed, but this repository cannot check it. Set gpg.ssh.allowedSignersFile to verify SSH signatures.'
          }
        : { ...base, status: 'unsigned', reason: null };
  }
}

export async function readCommitSignature(
  repoPath: string,
  rawOid: unknown
): Promise<SignatureInfo> {
  const oid = commitish(rawOid, 'Commit');

  const result = await tryGitCommand(repoPath, [
    'log',
    '-1',
    `--pretty=format:${SIGNATURE_FORMAT}`,
    oid
  ]);

  const raw = parseRaw(result?.stdout ?? '');
  const uncheckable = raw.code === 'N' && (await hasSignatureHeader(repoPath, oid));

  return statusFor(raw, uncheckable);
}

export async function readTagSignature(repoPath: string, rawTag: unknown): Promise<SignatureInfo> {
  const tag = refArg(rawTag, 'Tag name');

  // An annotated tag's signature lives on the tag object, so `git tag -v` is
  // the only thing that reads it. It exits non-zero for anything but a good
  // signature, which is a state rather than a failure.
  const verified = await tryGitCommand(repoPath, ['tag', '-v', tag]);
  const output = verified?.stderr ?? '';

  const contents = await tryGitCommand(repoPath, [
    'for-each-ref',
    `refs/tags/${tag}`,
    '--format=%(contents:signature)'
  ]);
  const signed = (contents?.stdout ?? '').trim() !== '';

  if (!signed) {
    return {
      kind: 'unknown',
      status: 'unsigned',
      signer: null,
      key: null,
      fingerprint: null,
      trust: null,
      reason: null
    };
  }

  const kind: SignatureKind = /ssh|principal/i.test(output) ? 'ssh' : 'gpg';

  if (verified !== null && /Good signature/i.test(output)) {
    return {
      kind,
      status: 'good',
      signer: /Good signature from "?([^"\n]+)"?/i.exec(output)?.[1]?.trim() ?? null,
      key: null,
      fingerprint: null,
      trust: null,
      reason: null
    };
  }

  if (/BAD signature/i.test(output)) {
    return {
      kind,
      status: 'bad',
      signer: null,
      key: null,
      fingerprint: null,
      trust: null,
      reason: 'The signature does not match the tag.'
    };
  }

  return {
    kind,
    status: 'unknown',
    signer: null,
    key: null,
    fingerprint: null,
    trust: null,
    reason:
      'This tag is signed, but this repository cannot check it. The signing key or an allowed-signers file may be missing.'
  };
}

async function configValue(
  repoPath: string,
  key: string,
  scope: 'local' | 'any'
): Promise<string | null> {
  const args = ['config', '--get'];
  if (scope === 'local') {
    args.push('--local');
  }
  args.push(key);

  const result = await tryGitCommand(repoPath, args);
  return result === null ? null : (result.stdout.trim() || null);
}

function isTrue(value: string | null): boolean {
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

export async function readSigningConfig(repoPath: string): Promise<SigningConfig> {
  const [format, key, commitSign, tagSign, allowedSigners, localFormat, localKey, localCommitSign] =
    await Promise.all([
      configValue(repoPath, 'gpg.format', 'any'),
      configValue(repoPath, 'user.signingkey', 'any'),
      configValue(repoPath, 'commit.gpgsign', 'any'),
      configValue(repoPath, 'tag.gpgsign', 'any'),
      configValue(repoPath, 'gpg.ssh.allowedsignersfile', 'any'),
      configValue(repoPath, 'gpg.format', 'local'),
      configValue(repoPath, 'user.signingkey', 'local'),
      configValue(repoPath, 'commit.gpgsign', 'local')
    ]);

  const signsCommits = isTrue(commitSign);
  const isRepoLevel = localFormat !== null || localKey !== null || localCommitSign !== null;

  let mode: SigningMode;
  if (localCommitSign !== null && !isTrue(localCommitSign) && localKey === null) {
    mode = 'off';
  } else if (key === null && !signsCommits) {
    mode = 'system';
  } else {
    mode = format === 'ssh' ? 'ssh' : format === 'openpgp' || format === null ? 'gpg' : 'system';
  }

  return {
    mode,
    signCommitsByDefault: signsCommits,
    signTagsByDefault: isTrue(tagSign),
    signingKey: key,
    allowedSignersFile: allowedSigners,
    isRepoLevel
  };
}

async function unsetLocal(repoPath: string, key: string): Promise<void> {
  // Exit 5 means "not set", which is the desired end state either way.
  await tryGitCommand(repoPath, ['config', '--local', '--unset-all', key]);
}

export interface WriteSigningInput {
  mode: SigningMode;
  signingKey?: string | null;
  signCommitsByDefault?: boolean;
  signTagsByDefault?: boolean;
  allowedSignersFile?: string | null;
}

export async function writeSigningConfig(
  repoPath: string,
  input: WriteSigningInput
): Promise<SigningConfig> {
  if (input.mode === 'system') {
    // Remove this repository's opinion entirely and let the global config
    // decide, which is what "System" means everywhere else in this app.
    for (const key of ['gpg.format', 'user.signingkey', 'commit.gpgsign', 'tag.gpgsign']) {
      await unsetLocal(repoPath, key);
    }
    return readSigningConfig(repoPath);
  }

  if (input.mode === 'off') {
    await unsetLocal(repoPath, 'user.signingkey');
    await runGitCommand(repoPath, ['config', '--local', 'commit.gpgsign', 'false']);
    await runGitCommand(repoPath, ['config', '--local', 'tag.gpgsign', 'false']);
    return readSigningConfig(repoPath);
  }

  await runGitCommand(repoPath, [
    'config',
    '--local',
    'gpg.format',
    input.mode === 'ssh' ? 'ssh' : 'openpgp'
  ]);

  if (typeof input.signingKey === 'string' && input.signingKey !== '') {
    await runGitCommand(repoPath, ['config', '--local', 'user.signingkey', input.signingKey]);
  } else if (input.signingKey === null) {
    await unsetLocal(repoPath, 'user.signingkey');
  }

  await runGitCommand(repoPath, [
    'config',
    '--local',
    'commit.gpgsign',
    input.signCommitsByDefault === true ? 'true' : 'false'
  ]);
  await runGitCommand(repoPath, [
    'config',
    '--local',
    'tag.gpgsign',
    input.signTagsByDefault === true ? 'true' : 'false'
  ]);

  if (typeof input.allowedSignersFile === 'string' && input.allowedSignersFile !== '') {
    await runGitCommand(repoPath, [
      'config',
      '--local',
      'gpg.ssh.allowedsignersfile',
      input.allowedSignersFile
    ]);
  } else if (input.allowedSignersFile === null) {
    await unsetLocal(repoPath, 'gpg.ssh.allowedsignersfile');
  }

  return readSigningConfig(repoPath);
}

async function toolVersion(command: string, args: readonly string[]): Promise<string | null> {
  const result = await runProcess(command, args, { timeoutMs: 10_000 });
  if (result.spawnError || result.timedOut) {
    return null;
  }
  // ssh-keygen prints its version on stderr.
  return `${result.stdout}${result.stderr}`.trim() || null;
}

function sshKeygenTooOld(version: string): boolean {
  const match = /OpenSSH_(\d+)\.(\d+)/i.exec(version);
  if (!match) {
    return false;
  }

  const major = Number.parseInt(match[1] as string, 10);
  const minor = Number.parseInt(match[2] as string, 10);
  return major < MIN_SSH_KEYGEN.major || (major === MIN_SSH_KEYGEN.major && minor < MIN_SSH_KEYGEN.minor);
}

/**
 * What would stop signing, or stop verification, before it is attempted.
 *
 * Everything here is phrased as something the user can act on: the whole point
 * is that a failed signature says why rather than reporting git's exit code.
 */
export async function signingDiagnostics(
  config: SigningConfig
): Promise<{ diagnostics: SigningDiagnostic[]; gpgVersion: string | null }> {
  const diagnostics: SigningDiagnostic[] = [];
  let gpgVersion: string | null = null;

  if (config.mode === 'gpg' || (config.mode === 'system' && config.signCommitsByDefault)) {
    gpgVersion = await toolVersion('gpg', ['--version']);
    if (gpgVersion === null) {
      diagnostics.push({
        code: 'gpg-missing',
        message: 'GPG is not installed, or not on the PATH this application inherited.',
        blocksSigning: true
      });
    }
  }

  if (config.mode === 'ssh') {
    const version = await toolVersion('ssh-keygen', ['-V']);
    if (version === null) {
      diagnostics.push({
        code: 'ssh-keygen-missing',
        message: 'ssh-keygen is not available, so SSH signing cannot work.',
        blocksSigning: true
      });
    } else if (sshKeygenTooOld(version)) {
      diagnostics.push({
        code: 'ssh-keygen-too-old',
        message: `SSH signing needs OpenSSH ${MIN_SSH_KEYGEN.major}.${MIN_SSH_KEYGEN.minor} or newer.`,
        blocksSigning: true
      });
    }

    if (config.allowedSignersFile === null) {
      diagnostics.push({
        code: 'no-allowed-signers',
        message:
          'No allowed-signers file is configured, so signatures can be made but not verified — signed commits will read as unverifiable.',
        blocksSigning: false
      });
    } else if (!fs.existsSync(config.allowedSignersFile)) {
      diagnostics.push({
        code: 'no-allowed-signers',
        message: `The allowed-signers file ${config.allowedSignersFile} does not exist.`,
        blocksSigning: false
      });
    }
  }

  if (config.mode !== 'system' && config.mode !== 'off') {
    if (config.signingKey === null) {
      diagnostics.push({
        code: 'no-signing-key',
        message: 'No signing key is configured for this repository.',
        blocksSigning: true
      });
    } else if (config.mode === 'ssh') {
      // An SSH signing key is a path; a GPG one is an identifier, so only the
      // SSH case is something the filesystem can be asked about.
      if (!fs.existsSync(config.signingKey)) {
        diagnostics.push({
          code: 'signing-key-missing',
          message: `The signing key ${config.signingKey} does not exist.`,
          blocksSigning: true
        });
      } else {
        try {
          fs.accessSync(config.signingKey, fs.constants.R_OK);
        } catch {
          diagnostics.push({
            code: 'signing-key-unreadable',
            message: `The signing key ${config.signingKey} cannot be read.`,
            blocksSigning: true
          });
        }
      }
    }
  }

  return { diagnostics, gpgVersion };
}

/**
 * Turns a failed signing attempt into something worth reading.
 *
 * Git's own message for a failed signature is usually one line about the
 * gpg process, which says nothing about what to do.
 */
export function explainSigningFailure(stderr: string): string | null {
  const text = stderr.toLowerCase();

  // The message SSH signing actually produces when the key path is wrong.
  // Git's own wording is "Couldn't load public key <path>", which says what
  // happened but nothing about the fact that no commit was made.
  if (/could ?n[o']?t load public key|could not load public key/.test(text)) {
    return 'Signing failed: the configured signing key could not be read, so no commit was made and your changes are still staged. Check the key path in the signing settings.';
  }
  if (text.includes('gpg failed to sign')) {
    return 'Signing failed. The commit was not made and your changes are still staged. Check that the signing key exists and that gpg can use it — a key with a passphrase needs an agent that can ask for it.';
  }
  if (text.includes('user.signingkey') || text.includes('no signing key')) {
    return 'No usable signing key is configured for this repository. Set one in the signing settings.';
  }
  if (text.includes('ssh-keygen') || text.includes('failed to sign the data')) {
    return 'SSH signing failed. Check that the key path is right and that ssh-keygen is new enough for signing (OpenSSH 8.2 or later).';
  }

  return null;
}
