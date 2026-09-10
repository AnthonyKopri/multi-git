// Keeps Multi-Git's managed block in ~/.ssh/config current.
//
// Two kinds of entry, written by two different things, which is the point of
// this module:
//
//   * The catch-all `Host github.com` is the machine-wide default account. It
//     is written *only* from an explicit choice of default account. It used to
//     be rewritten by whichever repository happened to be open — every profile
//     switch called this with that repository's key — so "the default account"
//     silently became whichever one you looked at last, and a push from any
//     unpinned folder went out as that account.
//
//   * `Host github.com-<label>` aliases, one per profile, are regenerated
//     whenever the profiles change. They name no default and are inert until a
//     remote URL uses one, which this app never writes for you.
import { applyManagedBlock } from './config-block';
import type { SshHostsMap } from './config-block';
import { aliasHostsFor, canonicalHost } from './host-alias';
import { isSshConfigManagementEnabled, readConfig, writeConfig } from '../config/store';
import { isValidSshConfigHost } from '../config/validate';
import { reportServerProblem } from '../logs';
import type { AppConfig, SshProfile } from '../../shared/config-types';

/** Always aliased, so a machine that has only ever seen GitHub still gets them. */
const IMPLIED_HOST = 'github.com';

export interface SshConfigSyncResult {
  /** Set when the user turned config management off. */
  skipped?: boolean;
  updated?: boolean;
  host?: string;
  warning?: string | null;
  error?: string;
}

/**
 * The profile the catch-all entries name.
 *
 * Falls back to inferring it from the entries already on disk, because before
 * this existed there was no recorded choice — only whatever the last profile
 * switch happened to write. Inferring keeps a machine behaving exactly as it
 * did until the user makes a deliberate choice, rather than silently changing
 * which account is default at upgrade time.
 */
export function resolveDefaultAccount(config: AppConfig): SshProfile | null {
  const byId = config.defaultAccountProfileId
    ? config.sshProfiles.find((profile) => profile.id === config.defaultAccountProfileId)
    : undefined;

  if (byId) {
    return byId;
  }

  const existing = Object.values(config.sshConfigHosts ?? {})[0];
  if (!existing) {
    return null;
  }

  return config.sshProfiles.find((profile) => profile.privateKeyPath === existing) ?? null;
}

/** Every host the block should carry entries for. */
function hostsFor(config: AppConfig, extra: string | null): string[] {
  const hosts = new Set<string>([IMPLIED_HOST, ...Object.keys(config.sshConfigHosts ?? {})]);

  if (extra !== null) {
    hosts.add(extra);
  }

  return [...hosts];
}

/**
 * Rewrites the whole block from `defaults` plus the aliases those hosts imply.
 *
 * Regenerated rather than edited in place, so a host that is no longer relevant
 * disappears instead of accumulating.
 */
function rebuild(
  config: AppConfig,
  defaults: SshHostsMap,
  hosts: readonly string[]
): { updated: boolean; warning: string | null } {
  const profiles = config.sshProfiles;

  const aliases: SshHostsMap = {};
  for (const host of hosts) {
    Object.assign(aliases, aliasHostsFor(host, profiles));
  }

  const result = applyManagedBlock({ defaults, aliases }, (host) =>
    canonicalHost(host, profiles) ?? host
  );

  return { updated: result.changed, warning: result.warning };
}

/**
 * Refreshes the alias entries, optionally recording a newly-seen host.
 *
 * Deliberately does **not** touch the catch-all. This is what a repository
 * being opened or a profile being selected calls, and neither of those is a
 * statement about what the whole machine should default to.
 */
export function syncSshAliases(host: string | null = null): SshConfigSyncResult {
  const config = readConfig();

  if (!isSshConfigManagementEnabled(config)) {
    return { skipped: true };
  }

  let canonical: string | null = null;

  if (host !== null) {
    // The host comes from a repository's origin URL, and a repository is not
    // trusted input — cloning someone else's is this app's normal workflow. It
    // is written verbatim into ~/.ssh/config, so a value carrying a newline
    // would append directives to the file that decides which key authenticates
    // where.
    if (!isValidSshConfigHost(host)) {
      return { error: `Refusing to write an unusable host name to ~/.ssh/config: ${host}` };
    }
    canonical = canonicalHost(host, config.sshProfiles) ?? host;
  }

  const defaults = { ...(config.sshConfigHosts ?? {}) };

  // A host seen for the first time inherits the existing default account, if
  // there is one. Without a default it gets aliases only, and no account is
  // privileged for it by accident.
  const fallback = resolveDefaultAccount(config);
  if (canonical !== null && defaults[canonical] === undefined && fallback) {
    defaults[canonical] = fallback.privateKeyPath;
  }

  try {
    const result = rebuild(config, defaults, hostsFor(config, canonical));

    config.sshConfigHosts = defaults;
    writeConfig(config);

    return {
      updated: result.updated,
      ...(host !== null ? { host } : {}),
      warning: result.warning
    };
  } catch (error) {
    reportServerProblem(`Could not update ~/.ssh/config: ${(error as Error).message}`);
    return { error: `Could not update ~/.ssh/config: ${(error as Error).message}` };
  }
}

/**
 * Makes one profile the account every unpinned repository falls back to.
 *
 * The only writer of the catch-all entries. Pass null to remove them, which
 * leaves the aliases in place and no account privileged for any host.
 */
export function setDefaultAccount(profileId: string | null): SshConfigSyncResult {
  const config = readConfig();

  if (!isSshConfigManagementEnabled(config)) {
    return { skipped: true };
  }

  const profile = profileId
    ? (config.sshProfiles.find((entry) => entry.id === profileId) ?? null)
    : null;

  if (profileId && !profile) {
    return { error: 'Selected account profile was not found.' };
  }

  const hosts = hostsFor(config, null);
  const defaults: SshHostsMap = {};

  if (profile) {
    for (const host of hosts) {
      defaults[host] = profile.privateKeyPath;
    }
  }

  try {
    const result = rebuild(config, defaults, hosts);

    config.defaultAccountProfileId = profile ? profile.id : '';
    config.sshConfigHosts = defaults;
    writeConfig(config);

    return { updated: result.updated, warning: result.warning };
  } catch (error) {
    reportServerProblem(`Could not update ~/.ssh/config: ${(error as Error).message}`);
    return { error: `Could not update ~/.ssh/config: ${(error as Error).message}` };
  }
}

/**
 * True when more than one profile could serve the same host.
 *
 * The condition worth telling the user about: whichever account is default,
 * every tool that does not read a repository's own pin authenticates as it, for
 * every repository.
 */
export function hasCompetingAccounts(config: AppConfig = readConfig()): boolean {
  const keyPaths = new Set(
    config.sshProfiles.map((profile) => profile.privateKeyPath).filter((keyPath) => keyPath !== '')
  );

  return keyPaths.size > 1;
}
