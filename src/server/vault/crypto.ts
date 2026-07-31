// Encryption primitives for the SSH passphrase vault.
//
// The master key is never stored. It derives a 256-bit key with scrypt over a
// random per-vault salt, and each secret is sealed with AES-256-GCM under a
// fresh IV. The authentication tag is what makes a wrong master key fail
// loudly at decryption instead of returning garbage.
import crypto from 'node:crypto';

const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM standard nonce length
const SALT_LENGTH = 16;

export interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

export function generateSalt(): string {
  return crypto.randomBytes(SALT_LENGTH).toString('hex');
}

export function deriveVaultKey(masterKey: string, saltHex: string): Buffer {
  return crypto.scryptSync(masterKey, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
}

export function encryptWithVaultKey(text: string, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);

  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: encrypted.toString('hex')
  };
}

/** Throws when the key is wrong or the payload has been tampered with. */
export function decryptWithVaultKey(payload: EncryptedPayload, key: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'hex')),
    decipher.final()
  ]).toString('utf8');
}

/** Sentinel plaintext used to verify a master key before trusting it. */
export const VAULT_CHECK_VALUE = 'multi-git-vault-check';
