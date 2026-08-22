// Shapes the on-disk config into what the client is allowed to see.
//
// The client never receives a passphrase, only whether one is stored, so the
// UI can show the vault indicator without the secret leaving the server.
import { storedPassphraseIds, getVaultStatus } from '../vault/vault';
import { DEFAULT_STALE_RULES } from '../../shared/maintenance-types';
import type { AppConfig, ClientConfig } from '../../shared/config-types';

export function sanitizeConfigForClient(config: AppConfig): ClientConfig {
  const savedPassphraseIds = storedPassphraseIds();

  return {
    recentRepos: config.recentRepos,
    sshProfiles: config.sshProfiles.map((profile) => ({
      ...profile,
      hasSavedPassword: savedPassphraseIds.has(profile.id)
    })),
    accountRules: config.accountRules,
    repoSettings: config.repoSettings,
    vaultStatus: getVaultStatus(),
    settings: {
      manageSshConfig: !config.settings || config.settings.manageSshConfig !== false,
      // Restoring is the default; the setting exists to turn it off.
      restoreWindowsOnStartup: config.settings?.restoreWindowsOnStartup !== false,
      // Prompt text is the most sensitive part of a launch, so keeping it is
      // opt-in and the client is told which way round it currently is.
      storeAgentPrompts: config.settings?.storeAgentPrompts === true,
      // Checking is the default; like the two above, the setting exists to
      // turn it off rather than to turn it on.
      checkForUpdates: config.settings?.checkForUpdates !== false,
      // Off unless it was turned on, and it has to survive a restart: the
      // toolbar chip reads its state back from here, and while this was
      // missing the setting persisted on disk while the chip reverted to off
      // on every launch — so nothing pulled automatically however the file
      // read.
      autoPull: config.settings?.autoPull === true,
      ...(config.settings?.recoveryRetentionDays !== undefined
        ? { recoveryRetentionDays: config.settings.recoveryRetentionDays }
        : {}),
      ...(config.settings?.worktreeParentDir !== undefined
        ? { worktreeParentDir: config.settings.worktreeParentDir }
        : {}),
      // Always sent, with the defaults filled in: the Maintenance tab draws a
      // form from this, and a form with nothing in it would read as "no rules".
      staleRules: { ...DEFAULT_STALE_RULES, ...(config.settings?.staleRules ?? {}) }
    },
    repoGroups: config.repoGroups ?? [],
    externalAgents: config.externalAgents ?? [],
    agentLaunches: config.agentLaunches ?? [],
    externalTools: config.externalTools ?? [],
    toolsConfirmed: config.toolsConfirmed ?? {},
    bisectCommands: config.bisectCommands ?? [],
    // Absent means not installed. The client uses this to decide whether the
    // Explorer setting offers Install or Remove, so guessing would offer to
    // remove entries that were never written.
    shellIntegration: { contextMenuInstalled: config.shellIntegration?.contextMenuInstalled === true },
    lfs: { autoDownloadPreviews: config.lfs?.autoDownloadPreviews === true }
  };
}
