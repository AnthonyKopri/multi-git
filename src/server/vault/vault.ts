// The SSH passphrase vault: ~/.multi-git-client-secrets.json.
//
// The master key is never written anywhere. Unlocking derives a key from it
// and holds that key in memory for the process lifetime; locking discards it.
// Everything on disk is ciphertext.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeJsonAtomic } from '../fs/atomic';
import {
  VAULT_CHECK_VALUE,
  decryptWithVaultKey,
  deriveVaultKey,
  encryptWithVaultKey,
  generateSalt
} from './crypto';
import type { EncryptedPayload } from './crypto';
import type { VaultStatus } from '../../shared/config-types';

export const SECRETS_FILE = path.join(os.homedir(), '.multi-git-client-secrets.json');

interface VaultFile {
  version: number;
  salt: string;
  /** Sealed sentinel used to tell a correct master key from a wrong one. */
  check: EncryptedPayload;
  passphrases: Record<string, EncryptedPayload>;
}

/** Derived key for the current session. Null means locked. */
let vaultKey: Buffer | null = null;

function readVaultFile(): VaultFile | null {
  try {
    if (!fs.existsSync(SECRETS_FILE)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) as Partial<VaultFile>;
    return {
      version: parsed.version ?? 1,
      salt: parsed.salt ?? '',
      check: parsed.check as EncryptedPayload,
      passphrases:
        typeof parsed.passphrases === 'object' && parsed.passphrases !== null
          ? parsed.passphrases
          : {}
    };
  } catch (error) {
    console.error('Error reading secrets file:', error);
    return null;
  }
}

function writeVaultFile(vault: VaultFile): void {
  // 0o600: the file is ciphertext, but there is no reason for it to be
  // readable by other local users.
  writeJsonAtomic(SECRETS_FILE, vault, { mode: 0o600 });
}

export function getVaultStatus(): VaultStatus {
  return { hasVault: fs.existsSync(SECRETS_FILE), unlocked: vaultKey !== null };
}

export function isUnlocked(): boolean {
  return vaultKey !== null;
}

export function lockVault(): void {
  vaultKey = null;
}

function initializeVault(masterKey: string): void {
  const salt = generateSalt();
  const derived = deriveVaultKey(masterKey, salt);

  writeVaultFile({
    version: 1,
    salt,
    check: encryptWithVaultKey(VAULT_CHECK_VALUE, derived),
    passphrases: {}
  });

  vaultKey = derived;
}

/**
 * Unlocks the vault, creating it on first use. Throws on a wrong master key.
 */
export function unlockVault(masterKey: string): void {
  const vault = readVaultFile();

  if (!vault) {
    initializeVault(masterKey);
    return;
  }

  if (!vault.salt || !vault.check) {
    throw new Error('Vault file is corrupted');
  }

  const candidate = deriveVaultKey(masterKey, vault.salt);

  // AES-GCM authentication is what rejects a wrong key: decryption throws
  // rather than returning plausible-looking garbage.
  let check: string;
  try {
    check = decryptWithVaultKey(vault.check, candidate);
  } catch {
    throw new Error('Invalid master key');
  }

  if (check !== VAULT_CHECK_VALUE) {
    throw new Error('Invalid master key');
  }

  vaultKey = candidate;
}

export function setStoredPassphrase(profileId: string, passphrase: string): void {
  if (!vaultKey) {
    throw new Error('Vault is locked');
  }

  const vault = readVaultFile();
  if (!vault) {
    throw new Error('Vault has not been set up');
  }

  vault.passphrases[profileId] = encryptWithVaultKey(passphrase, vaultKey);
  writeVaultFile(vault);
}

export function removeStoredPassphrase(profileId: string): void {
  const vault = readVaultFile();
  if (!vault?.passphrases[profileId]) {
    return;
  }

  delete vault.passphrases[profileId];
  writeVaultFile(vault);
}

/** The decrypted passphrase, or null when locked, absent, or undecryptable. */
export function getStoredPassphrase(profileId: string): string | null {
  if (!vaultKey) {
    return null;
  }

  const sealed = readVaultFile()?.passphrases[profileId];
  if (!sealed) {
    return null;
  }

  try {
    return decryptWithVaultKey(sealed, vaultKey);
  } catch {
    return null;
  }
}

/** Whether a passphrase exists for this profile. Works while locked. */
export function hasStoredPassphrase(profileId: string): boolean {
  return Boolean(readVaultFile()?.passphrases[profileId]);
}

export function storedPassphraseIds(): Set<string> {
  return new Set(Object.keys(readVaultFile()?.passphrases ?? {}));
}
