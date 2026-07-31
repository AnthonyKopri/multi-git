import { describe, expect, it } from 'vitest';

import {
  VAULT_CHECK_VALUE,
  decryptWithVaultKey,
  deriveVaultKey,
  encryptWithVaultKey,
  generateSalt
} from '../src/server/vault/crypto';

describe('vault crypto', () => {
  const salt = generateSalt();
  const key = deriveVaultKey('correct horse battery staple', salt);

  it('round-trips a passphrase', () => {
    const sealed = encryptWithVaultKey('my-ssh-passphrase', key);

    expect(decryptWithVaultKey(sealed, key)).toBe('my-ssh-passphrase');
  });

  it('round-trips unicode and empty values', () => {
    for (const secret of ['', 'pässwörd — ünicode 🔑', 'a'.repeat(4096)]) {
      expect(decryptWithVaultKey(encryptWithVaultKey(secret, key), key)).toBe(secret);
    }
  });

  it('derives a 256-bit key deterministically from master key and salt', () => {
    expect(key).toHaveLength(32);
    expect(deriveVaultKey('correct horse battery staple', salt)).toEqual(key);
  });

  it('derives different keys for different master keys and different salts', () => {
    expect(deriveVaultKey('other master key', salt)).not.toEqual(key);
    expect(deriveVaultKey('correct horse battery staple', generateSalt())).not.toEqual(key);
  });

  it('uses a fresh IV per encryption, so identical inputs differ on disk', () => {
    const first = encryptWithVaultKey('same secret', key);
    const second = encryptWithVaultKey('same secret', key);

    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
  });

  it('rejects the wrong master key instead of returning garbage', () => {
    const sealed = encryptWithVaultKey('my-ssh-passphrase', key);
    const wrongKey = deriveVaultKey('wrong master key', salt);

    expect(() => decryptWithVaultKey(sealed, wrongKey)).toThrow();
  });

  it('rejects tampered ciphertext, IV, and auth tag', () => {
    const sealed = encryptWithVaultKey('my-ssh-passphrase', key);

    const flip = (hex: string): string =>
      (Number.parseInt(hex.slice(0, 1), 16) ^ 1).toString(16) + hex.slice(1);

    expect(() => decryptWithVaultKey({ ...sealed, data: flip(sealed.data) }, key)).toThrow();
    expect(() => decryptWithVaultKey({ ...sealed, iv: flip(sealed.iv) }, key)).toThrow();
    expect(() => decryptWithVaultKey({ ...sealed, tag: flip(sealed.tag) }, key)).toThrow();
  });

  it('verifies a master key through the sentinel check value', () => {
    // This is how unlocking works: seal a known string at setup, and decrypt
    // it later to tell a correct master key from a wrong one.
    const check = encryptWithVaultKey(VAULT_CHECK_VALUE, key);

    expect(decryptWithVaultKey(check, key)).toBe(VAULT_CHECK_VALUE);
    expect(() => decryptWithVaultKey(check, deriveVaultKey('nope', salt))).toThrow();
  });

  it('produces a distinct random salt each time', () => {
    const salts = new Set(Array.from({ length: 16 }, () => generateSalt()));

    expect(salts.size).toBe(16);
    expect([...salts].every((value) => /^[0-9a-f]{32}$/.test(value))).toBe(true);
  });
});
