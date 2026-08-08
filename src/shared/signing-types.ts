// Commit and tag signatures.
//
// The status vocabulary is deliberately small and deliberately includes
// `unknown`. Git's own `%G?` collapses several different situations into one
// letter, and two of them must never be shown as the same thing: a commit with
// no signature, and a commit whose signature this repository is not configured
// to check. Reporting the second as the first would tell the user something
// untrue about someone else's work.

export type SignatureKind = 'ssh' | 'gpg' | 'unknown';

export type SignatureStatus =
  /** Verified against a key this repository trusts. */
  | 'good'
  /** Verified, and it does not match. */
  | 'bad'
  /**
   * There is a signature, and whether it is good cannot be established here —
   * an untrusted or expired key, a missing allowed-signers file, or no tool.
   */
  | 'unknown'
  /** The object carries no signature at all. */
  | 'unsigned';

export interface SignatureInfo {
  kind: SignatureKind;
  status: SignatureStatus;
  /** Who git says signed it, when it can say. */
  signer: string | null;
  /** The key used, in whatever form git reports it. */
  key: string | null;
  fingerprint: string | null;
  /** Git's trust level for a GPG key: undefined, never, marginal, full, ultimate. */
  trust: string | null;
  /** Why the status is what it is, when that is not self-evident. */
  reason: string | null;
}

export type SigningMode =
  /** No repository-level configuration; whatever the global config says. */
  | 'system'
  | 'gpg'
  | 'ssh'
  /** Explicitly off for this repository, whatever the global config says. */
  | 'off';

export interface SigningConfig {
  mode: SigningMode;
  /** Signs every commit without being asked. */
  signCommitsByDefault: boolean;
  signTagsByDefault: boolean;
  /** A GPG key id, or the path to an SSH key. */
  signingKey: string | null;
  /** Where SSH signature verification reads its trusted keys from. */
  allowedSignersFile: string | null;
  /** True when these came from this repository rather than the global config. */
  isRepoLevel: boolean;
}

export interface SigningDiagnostic {
  /** Machine-readable so the UI can offer the right fix. */
  code:
    | 'gpg-missing'
    | 'ssh-keygen-missing'
    | 'ssh-keygen-too-old'
    | 'signing-key-missing'
    | 'signing-key-unreadable'
    | 'no-signing-key'
    | 'no-allowed-signers';
  message: string;
  /** False for things that only affect verification, not signing. */
  blocksSigning: boolean;
}

export interface SigningStatusResponse {
  success: true;
  config: SigningConfig;
  diagnostics: SigningDiagnostic[];
  /** SSH profiles whose public key could be used as a signing key. */
  sshSigningCandidates: { profileId: string; label: string; publicKeyPath: string }[];
  gpgAvailable: boolean;
  gpgVersion: string | null;
}
