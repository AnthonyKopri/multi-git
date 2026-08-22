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
import type {
  AccountRule,
  AgentLaunchRecord,
  AppConfig,
  AppSettings,
  BisectCommandDefinition,
  ExternalAgentDefinition,
  ExternalToolDefinition,
  ExternalToolKind,
  LfsSettings,
  RepoGroup,
  RepoSettings,
  ShellIntegrationState,
  SshProfile,
  WindowState
} from '../../shared/config-types';
import { EXTERNAL_TOOL_KINDS } from '../../shared/config-types';
import {
  DEFAULT_STALE_RULES,
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS
} from '../../shared/maintenance-types';
import type { StaleRules } from '../../shared/maintenance-types';

import { canonicalRepoKey } from './repo-identity';

/** Launch history entries kept. Old enough to be useful, bounded enough to read. */
export const MAX_AGENT_LAUNCHES = 50;

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

    // Written by the SSH agent session when a repository is bound to an
    // account. It used to be dropped here, which meant the binding survived
    // until the config file was next re-read and then quietly reverted to the
    // System profile.
    if (typeof record['sshProfileId'] === 'string') {
      entry.sshProfileId = record['sshProfileId'];
    }

    if (Array.isArray(record['pinnedBranches'])) {
      entry.pinnedBranches = [...new Set(record['pinnedBranches'].filter(isNonEmptyString))];
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

/**
 * Validates the user's definition of a stale branch.
 *
 * Every field falls back to the shipped default rather than dropping the whole
 * record: a hand-edited file with one bad day count should not silently revert
 * the three switches beside it. The day count is clamped rather than rejected
 * for the same reason — a rule of zero days would call every branch in the
 * repository abandoned.
 */
export function validateStaleRules(raw: unknown): StaleRules | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const source = asRecord(raw);
  const days = source['inactiveDays'];

  const inactiveDays =
    typeof days === 'number' && Number.isInteger(days)
      ? Math.min(Math.max(days, MIN_INACTIVE_DAYS), MAX_INACTIVE_DAYS)
      : DEFAULT_STALE_RULES.inactiveDays;

  const boolean = (key: string, fallback: boolean): boolean =>
    typeof source[key] === 'boolean' ? (source[key] as boolean) : fallback;

  return {
    inactiveDays,
    requireNoPullRequest: boolean('requireNoPullRequest', DEFAULT_STALE_RULES.requireNoPullRequest),
    requireUnpushed: boolean('requireUnpushed', DEFAULT_STALE_RULES.requireUnpushed),
    requireInactive: boolean('requireInactive', DEFAULT_STALE_RULES.requireInactive),
    match: source['match'] === 'any' ? 'any' : 'all'
  };
}

/**
 * Validates the app-wide settings block.
 *
 * Exported because `/api/config/settings` writes the same shape: a request is
 * no more trusted than the file, and a second copy of these rules in the route
 * would be a second place for them to drift.
 */
export function validateSettings(raw: unknown): Partial<AppSettings> | undefined {
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

  if (typeof source['restoreWindowsOnStartup'] === 'boolean') {
    settings.restoreWindowsOnStartup = source['restoreWindowsOnStartup'];
  }

  if (typeof source['storeAgentPrompts'] === 'boolean') {
    settings.storeAgentPrompts = source['storeAgentPrompts'];
  }

  if (typeof source['autoPull'] === 'boolean') {
    settings.autoPull = source['autoPull'];
  }

  if (typeof source['checkForUpdates'] === 'boolean') {
    settings.checkForUpdates = source['checkForUpdates'];
  }

  // Compared against a version parsed out of a release tag, so anything that is
  // not a plain version could only ever suppress nothing.
  const skipped = source['skippedUpdateVersion'];
  if (typeof skipped === 'string' && /^\d+\.\d+\.\d+$/.test(skipped)) {
    settings.skippedUpdateVersion = skipped;
  }

  // Becomes the default folder a worktree is created in, so it must be a plain
  // path: a newline or a null would be carried into a directory creation.
  const parentDir = source['worktreeParentDir'];
  if (isNonEmptyString(parentDir) && !/[\r\n\0]/.test(parentDir)) {
    settings.worktreeParentDir = parentDir;
  }

  const rules = validateStaleRules(source['staleRules']);
  if (rules !== undefined) {
    settings.staleRules = rules;
  }

  return settings;
}

function validateRepoGroups(raw: unknown, issues: ConfigIssue[]): RepoGroup[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return [];
  }

  const groups: RepoGroup[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    const at = `repoGroups[${index}]`;

    if (!isNonEmptyString(record['id']) || seen.has(record['id'])) {
      issues.push({ path: at, message: 'dropped: missing or duplicate id' });
      return;
    }
    seen.add(record['id']);

    const group: RepoGroup = {
      id: record['id'],
      label: isNonEmptyString(record['label']) ? record['label'] : record['id'],
      order: typeof record['order'] === 'number' && Number.isFinite(record['order']) ? record['order'] : groups.length,
      // Re-keyed rather than trusted: a group written before a repository was
      // opened from a different spelling would otherwise never match it.
      repos: Array.isArray(record['repos'])
        ? [...new Set(record['repos'].filter(isNonEmptyString).map(canonicalRepoKey))].filter(
            (key) => key !== ''
          )
        : []
    };

    // Colour and icon are rendered into the DOM. Restricted to a shape that
    // cannot carry a URL, a quote or a semicolon into an attribute.
    if (isNonEmptyString(record['color']) && /^#[0-9a-fA-F]{6}$/.test(record['color'])) {
      group.color = record['color'];
    }
    if (isNonEmptyString(record['icon']) && /^[a-z0-9_]{1,40}$/.test(record['icon'])) {
      group.icon = record['icon'];
    }

    groups.push(group);
  });

  return groups.sort((left, right) => left.order - right.order);
}

/**
 * Validates the definitions that decide what this application will spawn.
 *
 * The strictest validator in the file, and the reason is worth stating: every
 * field here becomes an argument vector handed to a child process. An
 * executable is a name or a path and never a command line, arguments stay
 * separate strings, and a terminal mode outside the three known ones would
 * reach a `switch` with no matching branch.
 */
function validateExternalAgents(
  raw: unknown,
  issues: ConfigIssue[]
): ExternalAgentDefinition[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return [];
  }

  const agents: ExternalAgentDefinition[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    const at = `externalAgents[${index}]`;

    if (!isNonEmptyString(record['id']) || seen.has(record['id'])) {
      issues.push({ path: at, message: 'dropped: missing or duplicate id' });
      return;
    }
    if (!isNonEmptyString(record['executable']) || record['executable'].includes('\0')) {
      issues.push({ path: at, message: 'dropped: missing or unusable executable' });
      return;
    }

    const terminal = record['terminal'];
    if (terminal !== 'direct' && terminal !== 'windows-terminal' && terminal !== 'powershell') {
      issues.push({ path: at, message: `dropped: unknown terminal mode ${String(terminal)}` });
      return;
    }

    // One bad argument invalidates the vector: dropping it silently would run
    // the tool with a different command than the user configured.
    const rawArgs = Array.isArray(record['args']) ? record['args'] : [];
    if (rawArgs.some((value) => typeof value !== 'string' || value.includes('\0'))) {
      issues.push({ path: at, message: 'dropped: arguments must all be text without null bytes' });
      return;
    }

    seen.add(record['id']);

    const agent: ExternalAgentDefinition = {
      id: record['id'],
      label: isNonEmptyString(record['label']) ? record['label'] : record['id'],
      executable: record['executable'],
      args: rawArgs as string[],
      terminal,
      enabled: record['enabled'] !== false
    };

    if (record['promptMode'] === 'none' || record['promptMode'] === 'argument') {
      agent.promptMode = record['promptMode'];
    }

    const env = sanitizeEnvOverrides(record['env']);
    if (Object.keys(env).length > 0) {
      agent.env = env as Record<string, string>;
    }

    agents.push(agent);
  });

  return agents;
}

/**
 * Placeholders an argument template may contain.
 *
 * A closed set on purpose. An unrecognised `{...}` is not passed through as
 * literal text: it means the definition was written against a grammar this
 * build does not have, and running it would hand the tool a brace-wrapped word
 * where a file path belonged.
 */
const TOOL_PLACEHOLDERS = new Set(['local', 'remote', 'base', 'merged', 'path', 'line', 'cwd']);

const PLACEHOLDER_PATTERN = /\{([^}]*)\}/g;

/** The placeholders in one template element that this build does not know. */
export function unknownPlaceholders(value: string): string[] {
  const unknown: string[] = [];

  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1] ?? '';
    if (!TOOL_PLACEHOLDERS.has(name)) {
      unknown.push(name);
    }
  }

  return unknown;
}

function isToolKind(value: unknown): value is ExternalToolKind {
  return EXTERNAL_TOOL_KINDS.includes(value as ExternalToolKind);
}

/**
 * Validates the diff, merge, editor, terminal and file-manager definitions.
 *
 * Held to the same standard as {@link validateExternalAgents}, for the same
 * reason: every field becomes an argument vector handed to a child process.
 * The one addition is the placeholder grammar, checked here rather than at
 * launch so a definition that could never expand correctly is rejected while
 * the user is looking at the form.
 */
function validateExternalTools(
  raw: unknown,
  issues: ConfigIssue[]
): ExternalToolDefinition[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return [];
  }

  const tools: ExternalToolDefinition[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    const at = `externalTools[${index}]`;

    if (!isNonEmptyString(record['id']) || seen.has(record['id'])) {
      issues.push({ path: at, message: 'dropped: missing or duplicate id' });
      return;
    }
    if (!isToolKind(record['kind'])) {
      issues.push({ path: at, message: `dropped: unknown tool kind ${String(record['kind'])}` });
      return;
    }
    if (!isNonEmptyString(record['executable']) || record['executable'].includes('\0')) {
      issues.push({ path: at, message: 'dropped: missing or unusable executable' });
      return;
    }

    const rawArgs = Array.isArray(record['args']) ? record['args'] : [];
    if (rawArgs.some((value) => typeof value !== 'string' || value.includes('\0'))) {
      issues.push({ path: at, message: 'dropped: arguments must all be text without null bytes' });
      return;
    }

    // One unusable element invalidates the whole vector. Keeping the rest would
    // run the tool with a different command than the definition describes.
    const unknown = (rawArgs as string[]).flatMap(unknownPlaceholders);
    if (unknown.length > 0) {
      issues.push({
        path: at,
        message: `dropped: unknown placeholder ${unknown.map((name) => `{${name}}`).join(', ')}`
      });
      return;
    }

    seen.add(record['id']);

    tools.push({
      id: record['id'],
      kind: record['kind'],
      label: isNonEmptyString(record['label']) ? record['label'] : record['id'],
      executable: record['executable'],
      args: rawArgs as string[],
      enabled: record['enabled'] !== false,
      ...(record['detected'] === true ? { detected: true } : {})
    });
  });

  return tools;
}

/**
 * Validates the commands a bisect run may execute.
 *
 * No placeholder grammar: a bisect command is run in the repository as-is, and
 * git decides which commit is checked out before it runs. There is nothing to
 * substitute, so accepting a substitution would only be a way to get a value
 * into an argv.
 */
function validateBisectCommands(
  raw: unknown,
  issues: ConfigIssue[]
): BisectCommandDefinition[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return [];
  }

  const commands: BisectCommandDefinition[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    const at = `bisectCommands[${index}]`;

    if (!isNonEmptyString(record['id']) || seen.has(record['id'])) {
      issues.push({ path: at, message: 'dropped: missing or duplicate id' });
      return;
    }
    if (!isNonEmptyString(record['executable']) || record['executable'].includes('\0')) {
      issues.push({ path: at, message: 'dropped: missing or unusable executable' });
      return;
    }

    const rawArgs = Array.isArray(record['args']) ? record['args'] : [];
    if (rawArgs.some((value) => typeof value !== 'string' || value.includes('\0'))) {
      issues.push({ path: at, message: 'dropped: arguments must all be text without null bytes' });
      return;
    }

    seen.add(record['id']);

    const skip = record['skipExitCode'];
    commands.push({
      id: record['id'],
      label: isNonEmptyString(record['label']) ? record['label'] : record['id'],
      executable: record['executable'],
      args: rawArgs as string[],
      ...(typeof skip === 'number' && Number.isInteger(skip) && skip >= 0 && skip <= 255
        ? { skipExitCode: skip }
        : {})
    });
  });

  return commands;
}

function validateToolsConfirmed(raw: unknown): Partial<Record<ExternalToolKind, boolean>> | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const source = asRecord(raw);
  const confirmed: Partial<Record<ExternalToolKind, boolean>> = {};

  for (const kind of EXTERNAL_TOOL_KINDS) {
    // Only an explicit true counts. Anything else means "ask", which is the
    // safe direction for a record of what the user has already agreed to.
    if (source[kind] === true) {
      confirmed[kind] = true;
    }
  }

  return confirmed;
}

function validateShellIntegration(raw: unknown): ShellIntegrationState | undefined {
  if (raw === undefined) {
    return undefined;
  }

  // Only an explicit true. A corrupt value must not convince the app that
  // registry entries exist — the uninstall path would then report success
  // having deleted nothing.
  return { contextMenuInstalled: asRecord(raw)['contextMenuInstalled'] === true };
}

function validateLfsSettings(raw: unknown): LfsSettings | undefined {
  if (raw === undefined) {
    return undefined;
  }

  return { autoDownloadPreviews: asRecord(raw)['autoDownloadPreviews'] === true };
}

function validateWindowState(raw: unknown): WindowState | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const source = asRecord(raw);
  const windows = Array.isArray(source['windows']) ? source['windows'] : [];

  return {
    windows: windows.flatMap((entry) => {
      const record = asRecord(entry);
      if (!isNonEmptyString(record['repoPath'])) {
        return [];
      }

      const window: WindowState['windows'][number] = { repoPath: record['repoPath'] };

      const bounds = asRecord(record['bounds']);
      const numbers = ['x', 'y', 'width', 'height'].map((key) => bounds[key]);
      if (numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        window.bounds = {
          x: bounds['x'] as number,
          y: bounds['y'] as number,
          width: bounds['width'] as number,
          height: bounds['height'] as number
        };
      }

      if (record['maximized'] === true) {
        window.maximized = true;
      }

      return [window];
    })
  };
}

function validateAgentLaunches(raw: unknown): AgentLaunchRecord[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .flatMap((entry) => {
      const record = asRecord(entry);
      if (!isNonEmptyString(record['at']) || !isNonEmptyString(record['worktreePath'])) {
        return [];
      }

      const launch: AgentLaunchRecord = {
        at: record['at'],
        agentId: isNonEmptyString(record['agentId']) ? record['agentId'] : '',
        agentLabel: isNonEmptyString(record['agentLabel']) ? record['agentLabel'] : '',
        worktreePath: record['worktreePath'],
        ok: record['ok'] === true,
        commandPreview: isNonEmptyString(record['commandPreview']) ? record['commandPreview'] : ''
      };

      if (typeof record['pid'] === 'number' && Number.isInteger(record['pid'])) {
        launch.pid = record['pid'];
      }
      if (isNonEmptyString(record['error'])) {
        launch.error = record['error'];
      }

      return [launch];
    })
    .slice(0, MAX_AGENT_LAUNCHES);
}

/** Top-level keys this build knows about. Anything else is passed through. */
const KNOWN_KEYS = new Set([
  'configVersion',
  'recentRepos',
  'sshProfiles',
  'accountRules',
  'repoSettings',
  'settings',
  'sshConfigHosts',
  'repoGroups',
  'externalAgents',
  'windowState',
  'agentLaunches',
  'externalTools',
  'toolsConfirmed',
  'bisectCommands',
  'shellIntegration',
  'lfs'
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
  const repoGroups = validateRepoGroups(source['repoGroups'], issues);
  const externalAgents = validateExternalAgents(source['externalAgents'], issues);
  const windowState = validateWindowState(source['windowState']);
  const agentLaunches = validateAgentLaunches(source['agentLaunches']);
  const externalTools = validateExternalTools(source['externalTools'], issues);
  const toolsConfirmed = validateToolsConfirmed(source['toolsConfirmed']);
  const bisectCommands = validateBisectCommands(source['bisectCommands'], issues);
  const shellIntegration = validateShellIntegration(source['shellIntegration']);
  const lfs = validateLfsSettings(source['lfs']);

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
    ...(sshConfigHosts ? { sshConfigHosts } : {}),
    ...(repoGroups ? { repoGroups } : {}),
    ...(externalAgents ? { externalAgents } : {}),
    ...(windowState ? { windowState } : {}),
    ...(agentLaunches ? { agentLaunches } : {}),
    ...(externalTools ? { externalTools } : {}),
    ...(toolsConfirmed ? { toolsConfirmed } : {}),
    ...(bisectCommands ? { bisectCommands } : {}),
    ...(shellIntegration ? { shellIntegration } : {}),
    ...(lfs ? { lfs } : {})
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
