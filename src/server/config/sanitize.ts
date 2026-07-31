// Shapes the on-disk config into what the client is allowed to see.
//
// The client never receives a passphrase, only whether one is stored, so the
// UI can show the vault indicator without the secret leaving the server.
import { storedPassphraseIds, getVaultStatus } from '../vault/vault';
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
      manageSshConfig: !config.settings || config.settings.manageSshConfig !== false
    }
  };
}
