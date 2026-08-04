// Keeps Multi-Git's managed block in ~/.ssh/config pointing at the active key,
// so external tools (Git Bash, plain git, IDEs) authenticate the same way the
// app does.
import { applyManagedBlock } from './config-block';
import { isSshConfigManagementEnabled, readConfig, writeConfig } from '../config/store';
import { isValidSshConfigHost } from '../config/validate';

export interface SshConfigSyncResult {
  /** Set when the user turned config management off. */
  skipped?: boolean;
  updated?: boolean;
  host?: string;
  warning?: string | null;
  error?: string;
}

/**
 * Points `host` at `keyPath`, or drops the host entry when keyPath is null.
 *
 * config.sshConfigHosts is the source of truth; the block is regenerated from
 * it every time rather than being edited in place.
 */
export function syncSshConfigForHost(host: string, keyPath: string | null): SshConfigSyncResult {
  // The host is derived from the repository's origin URL, and a repository is
  // not trusted input — cloning someone else's is this app's normal workflow.
  // It is written verbatim into ~/.ssh/config, so a value carrying a newline
  // would append directives to the file that decides which key authenticates
  // where.
  if (!isValidSshConfigHost(host)) {
    return { error: `Refusing to write an unusable host name to ~/.ssh/config: ${host}` };
  }

  const config = readConfig();

  if (!isSshConfigManagementEnabled(config)) {
    return { skipped: true };
  }

  const hosts = { ...(config.sshConfigHosts ?? {}) };
  if (keyPath) {
    hosts[host] = keyPath;
  } else {
    delete hosts[host];
  }

  try {
    const result = applyManagedBlock(hosts);
    config.sshConfigHosts = hosts;
    writeConfig(config);
    return { updated: result.changed, host, warning: result.warning };
  } catch (error) {
    console.error('Failed to update ~/.ssh/config:', error);
    return { error: `Could not update ~/.ssh/config: ${(error as Error).message}` };
  }
}
