// Moves an on-disk configuration forward, one version at a time.
//
// Every migration here runs against a real user's file: their SSH profiles,
// their account rules, their recent repositories. Three rules follow from
// that, and each is enforced by the tests in tests/config-migrations.test.ts:
//
//   * Idempotent. Running the chain twice must produce the same document, so
//     a crash between migrating and writing cannot corrupt anything.
//
//   * Additive. A migration reshapes what it understands and leaves the rest
//     alone. Nothing is deleted because this build has no use for it.
//
//   * Covered from every previous version. A fixture for each version the
//     project has shipped is run through the whole chain, because the version
//     that breaks is always the one nobody still has installed.
//
// A document from a *newer* build is not migrated at all. Downgrading is
// something users do; losing a section written by the version they are going
// back to is not something they should have to expect.
import { canonicalRepoKey } from './repo-identity';

/** Bump this, and add a migration, whenever the persisted shape changes. */
export const CURRENT_CONFIG_VERSION = 1;

/** A configuration document mid-migration, before it is validated. */
type RawConfig = Record<string, unknown>;

export interface ConfigMigration {
  /** The version this migration produces. */
  readonly to: number;
  /** One line, used in the log when it runs. */
  readonly describe: string;
  migrate(config: RawConfig): RawConfig;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const MIGRATIONS: readonly ConfigMigration[] = [
  {
    to: 1,
    describe: 'key repository settings by canonical repository identity',
    migrate(config) {
      const previous = asRecord(config['repoSettings']);
      const rekeyed: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(previous)) {
        const canonical = canonicalRepoKey(key);
        if (canonical === '') {
          continue;
        }

        // Two spellings of one repository — a junction and its target, or two
        // casings on NTFS — collapse here. Merging rather than replacing keeps
        // whichever settings each spelling had recorded.
        rekeyed[canonical] = { ...asRecord(rekeyed[canonical]), ...asRecord(value) };
      }

      return { ...config, repoSettings: rekeyed };
    }
  }
];

export interface MigrationOutcome {
  config: RawConfig;
  fromVersion: number;
  toVersion: number;
  /** Descriptions of the migrations that ran, in order. Empty when none did. */
  applied: string[];
  /** True when the file came from a build newer than this one. */
  fromFuture: boolean;
}

function readVersion(config: RawConfig): number {
  const raw = config['configVersion'];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/**
 * Runs every migration between the document's version and the current one.
 *
 * Returns the document unchanged, with `fromFuture` set, when it was written
 * by a newer build.
 */
export function migrateConfig(raw: unknown): MigrationOutcome {
  const config = { ...asRecord(raw) };
  const fromVersion = readVersion(config);

  if (fromVersion > CURRENT_CONFIG_VERSION) {
    return {
      config,
      fromVersion,
      toVersion: fromVersion,
      applied: [],
      fromFuture: true
    };
  }

  const applied: string[] = [];
  let current = config;

  for (const migration of MIGRATIONS) {
    if (migration.to <= fromVersion) {
      continue;
    }

    current = migration.migrate(current);
    current['configVersion'] = migration.to;
    applied.push(`v${migration.to}: ${migration.describe}`);
  }

  current['configVersion'] = Math.max(readVersion(current), CURRENT_CONFIG_VERSION);

  return {
    config: current,
    fromVersion,
    toVersion: CURRENT_CONFIG_VERSION,
    applied,
    fromFuture: false
  };
}
