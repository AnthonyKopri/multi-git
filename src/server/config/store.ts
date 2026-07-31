// Reads and writes ~/.multi-git-client-config.json.
//
// The previous implementation did existsSync + readFileSync + JSON.parse on
// every call, and several routes called it two to four times each. This caches
// the parsed object and revalidates against the file's mtime and size, so a
// config edited by hand outside the app is still picked up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeJsonAtomic } from '../fs/atomic';
import type { AppConfig } from '../../shared/config-types';

export const CONFIG_FILE = path.join(os.homedir(), '.multi-git-client-config.json');

/** Most recent repositories kept in the picker. */
export const MAX_RECENT_REPOS = 15;

function emptyConfig(): AppConfig {
  return { recentRepos: [], sshProfiles: [], accountRules: [], repoSettings: {} };
}

/**
 * Fills in every collection so callers can index them without guarding, which
 * is what the `config.x || []` sprinkled through the old routes was doing.
 */
function normalize(raw: unknown): AppConfig {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<AppConfig>;

  return {
    recentRepos: Array.isArray(source.recentRepos) ? source.recentRepos : [],
    sshProfiles: Array.isArray(source.sshProfiles) ? source.sshProfiles : [],
    accountRules: Array.isArray(source.accountRules) ? source.accountRules : [],
    repoSettings:
      typeof source.repoSettings === 'object' && source.repoSettings !== null
        ? source.repoSettings
        : {},
    ...(source.settings ? { settings: source.settings } : {}),
    ...(source.sshConfigHosts ? { sshConfigHosts: source.sshConfigHosts } : {})
  };
}

interface CacheEntry {
  config: AppConfig;
  mtimeMs: number;
  size: number;
}

let cache: CacheEntry | null = null;

function statOrNull(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

/**
 * The current configuration.
 *
 * The returned object is the cached instance. Callers that mutate it must
 * pass it back to `writeConfig`, which is the existing read-modify-write
 * pattern throughout the routes.
 */
export function readConfig(): AppConfig {
  const stats = statOrNull(CONFIG_FILE);

  if (!stats) {
    cache = null;
    return emptyConfig();
  }

  if (cache && cache.mtimeMs === stats.mtimeMs && cache.size === stats.size) {
    return cache.config;
  }

  try {
    const config = normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
    cache = { config, mtimeMs: stats.mtimeMs, size: stats.size };
    return config;
  } catch (error) {
    // A corrupt config must not take the app down; it starts empty instead.
    console.error('Error reading config:', error);
    cache = null;
    return emptyConfig();
  }
}

/** Persists the configuration atomically. Returns false on failure. */
export function writeConfig(config: AppConfig): boolean {
  try {
    writeJsonAtomic(CONFIG_FILE, config);

    const stats = statOrNull(CONFIG_FILE);
    cache = stats ? { config, mtimeMs: stats.mtimeMs, size: stats.size } : null;
    return true;
  } catch (error) {
    console.error('Error writing config:', error);
    cache = null;
    return false;
  }
}

/** Drops the cache. Tests use this after replacing the file behind our back. */
export function invalidateConfigCache(): void {
  cache = null;
}

export function isSshConfigManagementEnabled(config: AppConfig): boolean {
  return !config.settings || config.settings.manageSshConfig !== false;
}
