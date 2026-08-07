// Validating and generating SSH key pairs through ssh-keygen.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runExternalCommand } from '../external/run';

export type SshKeyType = 'ed25519' | 'rsa';

export interface KeyValidation {
  valid: boolean;
  message: string;
}

/**
 * Checks that a private key is readable and that the passphrase, if any, is
 * correct, by asking ssh-keygen to print the matching public key.
 *
 * Passing an empty passphrase to a protected key fails, which is how the UI
 * distinguishes "needs a passphrase" from "invalid".
 */
export async function validateSshKeyPair(
  privateKeyPath: string,
  passphrase = ''
): Promise<KeyValidation> {
  const result = await runExternalCommand(
    'ssh-keygen',
    ['-y', '-f', privateKeyPath, '-P', passphrase],
    { timeoutMs: 15_000 }
  );

  if (result.error) {
    return {
      valid: false,
      message: result.stderr.includes('timed out')
        ? 'SSH key validation timed out'
        : `ssh-keygen execution error: ${result.error}`
    };
  }

  if (result.ok) {
    return { valid: true, message: 'SSH key and passphrase are valid' };
  }

  return {
    valid: false,
    message: result.stderr.trim() || result.stdout.trim() || 'SSH key validation failed'
  };
}

export interface GenerateKeyOptions {
  privateKeyPath: string;
  keyType?: SshKeyType;
  passphrase?: string;
  comment?: string;
}

export async function generateSshKeyPair(
  options: GenerateKeyOptions
): Promise<{ stdout: string; stderr: string }> {
  const { privateKeyPath, keyType = 'ed25519', passphrase = '', comment = '' } = options;

  const args = ['-t', keyType, '-f', privateKeyPath, '-N', passphrase];
  if (keyType === 'rsa') {
    // ed25519 has a fixed size; RSA below 4096 is not worth generating today.
    args.push('-b', '4096');
  }
  if (comment) {
    args.push('-C', comment);
  }

  const result = await runExternalCommand('ssh-keygen', args, { timeoutMs: 30_000 });

  if (result.error) {
    throw new Error(
      result.error.includes('timed out')
        ? 'SSH key generation timed out'
        : `ssh-keygen execution error: ${result.error}`
    );
  }

  if (!result.ok) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || 'SSH key generation failed'
    );
  }

  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Expands a leading `~` and resolves to an absolute path.
 *
 * Only a *leading* tilde. This previously replaced every `~` anywhere in the
 * string, which corrupts any path that legitimately contains one — and on
 * Windows that is not exotic: 8.3 short names look like `C:\Users\RUNNER~1\…`
 * or `C:\PROGRA~1\…`, and a key stored under one had its path rewritten into
 * nonsense before it ever reached ssh. The failure then surfaced as "the
 * private key file was not found", which points at the wrong thing entirely.
 *
 * A tilde anywhere else is an ordinary filename character, which is exactly
 * how a shell treats it.
 */
export function normalizeSshPath(targetPath: string | null | undefined): string {
  if (!targetPath || typeof targetPath !== 'string') {
    return '';
  }

  // `~`, `~/…` or `~\…` — but not `~user`, which this does not support and
  // must not mangle either.
  const expanded = /^~(?=$|[\\/])/.test(targetPath)
    ? path.join(os.homedir(), targetPath.slice(1))
    : targetPath;

  return path.resolve(expanded);
}

export function sshDirectory(): string {
  return path.join(os.homedir(), '.ssh');
}

/** Turns a profile label into a filename-safe stem. */
export function sanitizeLabelForKeyName(label: string | null | undefined): string {
  return String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

/** Appends a counter until neither the key nor its .pub file exists. */
export function buildUniqueKeyBaseName(sshDir: string, requestedBaseName: string): string {
  let candidate = requestedBaseName;
  let index = 1;

  while (
    fs.existsSync(path.join(sshDir, candidate)) ||
    fs.existsSync(path.join(sshDir, `${candidate}.pub`))
  ) {
    index += 1;
    candidate = `${requestedBaseName}_${index}`;
  }

  return candidate;
}

/**
 * True when `keyPath` is a private key this app may read a public key beside.
 *
 * Closes an arbitrary-file-read: /api/config/ssh/public accepted any path from
 * the client and returned `<path>.pub`, so a request could probe for and read
 * any file on disk whose name ended in .pub. Reads are now limited to keys
 * belonging to a registered profile or living under ~/.ssh.
 */
export function isPermittedKeyPath(keyPath: string, registeredKeyPaths: readonly string[]): boolean {
  const resolved = path.resolve(keyPath);

  if (registeredKeyPaths.some((registered) => path.resolve(registered) === resolved)) {
    return true;
  }

  const sshDir = sshDirectory();
  const relative = path.relative(sshDir, resolved);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
