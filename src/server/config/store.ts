// Reads and writes ~/.multi-git-client-config.json.
//
// The previous implementation did existsSync + readFileSync + JSON.parse on
// every call, and several routes called it two to four times each. This caches
// the parsed object and revalidates against the file's mtime and size, so a
// config edited by hand outside the app is still picked up.
//
// Reading also runs the file through the migration chain and the validator, in
// that order: migrations reshape what an older build wrote, then validation
// repairs whatever a hand edit or a partial sync left behind. A file that
// needed migrating is written back once, atomically, so the next process does
// not repeat the work.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeJsonAtomic } from '../fs/atomic';
import { CURRENT_CONFIG_VERSION, migrateConfig } from './migrations';
import { validateAppConfig } from './validate';
import type { AppConfig } from '../../shared/config-types';

export const CONFIG_FILE = path.join(os.homedir(), '.multi-git-client-config.json');

/** Most recent repositories kept in the picker. */
export const MAX_RECENT_REPOS = 15;

function emptyConfig(): AppConfig {
  return {
    configVersion: CURRENT_CONFIG_VERSION,
    recentRepos: [],
    sshProfiles: [],
    accountRules: [],
    repoSettings: {}
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
 * Migrates and validates one parsed document.
 *
 * Exported for the migration tests, which run fixtures from every shipped
 * version through exactly the path a real launch takes.
 */
export function prepareConfig(raw: unknown): { config: AppConfig; changed: boolean } {
  const outcome = migrateConfig(raw);

  if (outcome.fromFuture) {
    // Nothing this build understands well enough to rewrite. Read it as best
    // it can and never write it back, so the newer sections stay intact.
    console.warn(
      `Configuration was written by a newer version (v${outcome.fromVersion}); reading it without migrating.`
    );
  }

  for (const description of outcome.applied) {
    console.log(`Migrated configuration ${description}`);
  }

  const { config, issues } = validateAppConfig(outcome.config);

  for (const issue of issues) {
    console.warn(`Configuration issue at ${issue.path}: ${issue.message}`);
  }

  return {
    config,
    // Only a migration earns a write-back. Validation repairs stay in memory:
    // a dropped entry is one this build cannot use, not one the user agreed to
    // delete, and persisting the repair would destroy the record they need in
    // order to fix it by hand.
    changed: !outcome.fromFuture && outcome.applied.length > 0
  };
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

  let config: AppConfig;
  let changed: boolean;

  try {
    ({ config, changed } = prepareConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))));
  } catch (error) {
    // A corrupt config must not take the app down; it starts empty instead.
    // It is deliberately not overwritten — a user with an unparseable file
    // still has their profiles in it, and a backup can be recovered by hand.
    console.error('Error reading config:', error);
    cache = null;
    return emptyConfig();
  }

  if (changed) {
    writeConfig(config);
    return config;
  }

  cache = { config, mtimeMs: stats.mtimeMs, size: stats.size };
  return config;
}

/** Persists the configuration atomically. Returns false on failure. */
export function writeConfig(config: AppConfig): boolean {
  try {
    // Anything written by this build is at the current version by definition;
    // a document read from a newer build is never routed through here.
    config.configVersion = CURRENT_CONFIG_VERSION;
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
