// Validates the configuration document at the boundary where it stops being
// trusted input.
//
// ~/.multi-git-client-config.json is an ordinary file in the user's home
// directory. It is hand-edited, synced between machines, restored from
// backups, and written by older builds. Nothing about it is guaranteed, and
// two of its sections are more than data:
//
//   * sshConfigHosts is rendered verbatim into ~/.ssh/config. A host
//     containing a newline would append arbitrary directives to the file that
//     decides which key authenticates where.
//
//   * sshProfiles carry private-key paths that later become process
//     arguments.
//
// The rule throughout is repair, never discard silently. A malformed entry is
// dropped and reported as an issue; everything valid around it survives,
// because the alternative is a user losing every SSH profile to one bad
// record.
import type { AccountRule, AppConfig, AppSettings, RepoSettings, SshProfile } from '../../shared/config-types';

import { canonicalRepoKey } from './repo-identity';

export interface ConfigIssue {
  /** Dotted location, such as `sshProfiles[2].privateKeyPath`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  config: AppConfig;
  issues: ConfigIssue[];
}

/**
 * Host names accepted into the managed ~/.ssh/config block.
 *
 * Deliberately narrower than what OpenSSH would parse: a DNS name or IP
 * literal, with the wildcards `Host` patterns legitimately use. No
 * whitespace, no newline, no quote, no comment character — the four things
 * that would let a value break out of the line it was written on.
 */
const SSH_HOST_PATTERN = /^[A-Za-z0-9._*?-]+(?::\d{1,5})?$/;

/** Environment variable names. POSIX plus the leading-underscore form. */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validateSshProfiles(raw: unknown, issues: ConfigIssue[]): SshProfile[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const profiles: SshProfile[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    const at = `sshProfiles[${index}]`;

    if (!isNonEmptyString(record['id'])) {
      issues.push({ path: at, message: 'dropped: missing id' });
      return;
    }
    if (!isNonEmptyString(record['privateKeyPath'])) {
      issues.push({ path: at, message: 'dropped: missing privateKeyPath' });
      return;
    }
    if (seen.has(record['id'])) {
      issues.push({ path: at, message: `dropped: duplicate id ${record['id']}` });
      return;
    }
    seen.add(record['id']);

    const profile: SshProfile = {
      id: record['id'],
      // A profile with no label is usable; an unnamed row in the UI is not.
      label: isNonEmptyString(record['label']) ? record['label'] : record['id'],
      privateKeyPath: record['privateKeyPath']
    };

    if (isNonEmptyString(record['userName'])) {
      profile.userName = record['userName'];
    }
    if (isNonEmptyString(record['userEmail'])) {
      profile.userEmail = record['userEmail'];
    }

    profiles.push(profile);
  });

  return profiles;
}

function validateAccountRules(raw: unknown, issues: ConfigIssue[]): AccountRule[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry, index) => {
    const record = asRecord(entry);
    const at = `accountRules[${index}]`;

    if (
      !isNonEmptyString(record['id']) ||
      !isNonEmptyString(record['match']) ||
      !isNonEmptyString(record['profileId'])
    ) {
      issues.push({ path: at, message: 'dropped: missing id, match, or profileId' });
      return [];
    }

    // Referential integrity is deliberately not enforced here. A rule naming a
    // profile that no longer exists is inert — `ruleProfileFor` finds nothing
    // and selects nothing — and dropping it would delete a record the user may
    // still want when they recreate the profile.
    return [{ id: record['id'], match: record['match'], profileId: record['profileId'] }];
  });
}

function validateRepoSettings(
  raw: unknown,
  issues: ConfigIssue[]
): Record<string, RepoSettings> {
  const source = asRecord(raw);
  const settings: Record<string, RepoSettings> = {};

  for (const [key, value] of Object.entries(source)) {
    const canonical = canonicalRepoKey(key);
    if (canonical === '') {
      issues.push({ path: `repoSettings[${key}]`, message: 'dropped: not a usable path' });
      continue;
    }

    const record = asRecord(value);
    const entry: RepoSettings = {};

    if (typeof record['warnBeforeDelete'] === 'boolean') {
      entry.warnBeforeDelete = record['warnBeforeDelete'];
    }

    // A later key wins, which is the same rule `Object.assign` would apply if
    // two spellings of one repository collapse onto the same canonical key.
    settings[canonical] = { ...settings[canonical], ...entry };
  }

  return settings;
}

/** Rejects a host that could break out of its line in ~/.ssh/config. */
export function isValidSshConfigHost(host: unknown): host is string {
  return typeof host === 'string' && host.length <= 253 && SSH_HOST_PATTERN.test(host);
}

function validateSshConfigHosts(
  raw: unknown,
  issues: ConfigIssue[]
): Record<string, string> | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const source = asRecord(raw);
  const hosts: Record<string, string> = {};

  for (const [host, keyPath] of Object.entries(source)) {
    if (!isValidSshConfigHost(host)) {
      issues.push({ path: `sshConfigHosts[${host}]`, message: 'dropped: unusable host name' });
      continue;
    }
    if (!isNonEmptyString(keyPath) || /[\r\n"]/.test(keyPath)) {
      // The path is written inside quotes, so a quote or newline in it would
      // end the IdentityFile directive early.
      issues.push({ path: `sshConfigHosts[${host}]`, message: 'dropped: unusable key path' });
      continue;
    }

    hosts[host] = keyPath;
  }

  return hosts;
}

function validateSettings(raw: unknown): Partial<AppSettings> | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const source = asRecord(raw);
  const settings: Partial<AppSettings> = {};

  if (typeof source['manageSshConfig'] === 'boolean') {
    settings.manageSshConfig = source['manageSshConfig'];
  }

  // A negative or fractional retention would produce expiry times nobody
  // asked for, so only a whole number of days counts.
  const retention = source['recoveryRetentionDays'];
  if (typeof retention === 'number' && Number.isInteger(retention) && retention >= 0) {
    settings.recoveryRetentionDays = retention;
  }

  return settings;
}

/** Top-level keys this build knows about. Anything else is passed through. */
const KNOWN_KEYS = new Set([
  'configVersion',
  'recentRepos',
  'sshProfiles',
  'accountRules',
  'repoSettings',
  'settings',
  'sshConfigHosts'
]);

/**
 * Validates and repairs a configuration document.
 *
 * Unknown top-level keys are preserved untouched. A newer build may have
 * written a section this one does not understand, and downgrading for an
 * afternoon must not throw that section away.
 */
export function validateAppConfig(raw: unknown): ValidationResult {
  const source = asRecord(raw);
  const issues: ConfigIssue[] = [];

  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!KNOWN_KEYS.has(key)) {
      passthrough[key] = value;
    }
  }

  const recentRepos = Array.isArray(source['recentRepos'])
    ? [...new Set(source['recentRepos'].filter(isNonEmptyString))]
    : [];

  const sshProfiles = validateSshProfiles(source['sshProfiles'], issues);
  const sshConfigHosts = validateSshConfigHosts(source['sshConfigHosts'], issues);
  const settings = validateSettings(source['settings']);

  const config: AppConfig = {
    ...passthrough,
    configVersion:
      typeof source['configVersion'] === 'number' && Number.isInteger(source['configVersion'])
        ? source['configVersion']
        : 0,
    recentRepos,
    sshProfiles,
    accountRules: validateAccountRules(source['accountRules'], issues),
    repoSettings: validateRepoSettings(source['repoSettings'], issues),
    ...(settings ? { settings } : {}),
    ...(sshConfigHosts ? { sshConfigHosts } : {})
  };

  return { config, issues };
}

/**
 * Filters environment overrides down to well-formed, non-hijacking keys.
 *
 * Every value here ends up in a child process's environment. The denied names
 * are the ones that make a process load code before it runs its own main:
 * setting any of them turns "run git" into "run whatever this points at".
 */
const DENIED_ENV_KEYS = new Set([
  'LD_PRELOAD',
  'LD_AUDIT',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE'
]);

export function sanitizeEnvOverrides(raw: unknown): NodeJS.ProcessEnv {
  const source = asRecord(raw);
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    if (!ENV_KEY_PATTERN.test(key) || DENIED_ENV_KEYS.has(key.toUpperCase())) {
      continue;
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      continue;
    }

    env[key] = value;
  }

  return env;
}
