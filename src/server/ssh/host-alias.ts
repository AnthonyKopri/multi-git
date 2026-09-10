// Per-profile `Host` aliases for ~/.ssh/config.
//
// A single `Host github.com` entry can only name one key, so on a machine with
// two accounts one of them is the default and the other is second class. An
// alias gives each profile an entry of its own:
//
//   Host github.com-familiara
//     HostName github.com
//     IdentityFile ".../id_ed25519_familiara"
//     IdentitiesOnly yes
//
// Nothing uses an alias unless a remote URL names one, and this app never
// rewrites a remote URL — a non-standard origin is visible to everyone who
// works in the repository, and `gh` does not resolve one. They exist so the
// user has a per-account address to paste when they want one, and so the
// catch-all entry is no longer the only way to reach a second account.
//
// Because a user may still paste one by hand, `canonicalHost` exists to turn an
// alias back into the real host wherever the app reasons about where a
// repository lives.
import { readConfig } from '../config/store';
import { sanitizeLabelForKeyName } from './keys';
import type { SshProfile } from '../../shared/config-types';

/** The alias for one profile on one host, or null when the label is unusable. */
export function aliasFor(host: string, label: string): string | null {
  const token = sanitizeLabelForKeyName(label);
  return token === '' ? null : `${host}-${token}`;
}

/**
 * The real host an alias points at.
 *
 * Recognised against the configured profiles rather than by guessing at the
 * shape: `github.com-familiara` and a genuine host called `internal-git` are
 * indistinguishable without knowing the labels.
 */
export function canonicalHost(
  host: string | null | undefined,
  profiles?: readonly SshProfile[]
): string | null {
  // An empty host is the same answer as no host; callers branch on null and an
  // empty string would slip past that check into a config file.
  if (!host) {
    return null;
  }

  const known = profiles ?? readConfig().sshProfiles;

  for (const profile of known) {
    const token = sanitizeLabelForKeyName(profile.label);
    if (token !== '' && host.endsWith(`-${token}`)) {
      return host.slice(0, -(token.length + 1));
    }
  }

  return host;
}

/** Alias entries for every profile on `host`, as a host-to-key-path map. */
export function aliasHostsFor(
  host: string,
  profiles: readonly SshProfile[]
): Record<string, string> {
  const hosts: Record<string, string> = {};

  for (const profile of profiles) {
    const alias = aliasFor(host, profile.label);
    if (alias !== null && profile.privateKeyPath) {
      hosts[alias] = profile.privateKeyPath;
    }
  }

  return hosts;
}
