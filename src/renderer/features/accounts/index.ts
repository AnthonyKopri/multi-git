// Account selection, the vault, and auto-select rules.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { asInput } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { getState, ruleProfileFor, update } from '../../state/store';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { applyProfileIdentity, maybeOfferIdentity } from './identity';
import { renderAccountRules, renderProfileUI } from './profile-ui';
import { renderProfileTable } from './profile-table';
import { renderOverlaySshStatus, renderVaultStatus } from './vault-ui';
import { initAgentPanel, loadSelectedKey, refreshAgent } from './agent';
import type { ClientConfig, ClientSshProfile } from '../../../shared/config-types';

let ui: Elements;

/** The per-repository key choice is remembered locally, not in the config. */
function storageKey(repoPath: string): string {
  return `ssh_key_${repoPath}`;
}

export function initAccounts(elements: Elements): void {
  ui = elements;
  initAgentPanel(elements);
  // Read once at startup, so the dropdown says something true before the user
  // touches anything.
  void refreshAgent();
}

/** Redraws every account-related surface from current state. */
export function renderAccounts(): void {
  const state = getState();

  renderProfileUI(ui, state);
  renderVaultStatus(ui, state.vaultStatus);
  renderAccountRules(ui, state);
  renderOverlaySshStatus(ui, state);
  renderProfileTable(ui.sshProfilesTableBody, state.sshProfiles);
  asInput(ui.sshManageConfigCheckbox).checked = state.manageSshConfig;
}

/** Applies a config payload from any endpoint that returns one. */
export function applyConfigSnapshot(config: ClientConfig): void {
  update({
    recentRepos: config.recentRepos,
    sshProfiles: config.sshProfiles,
    accountRules: config.accountRules,
    repoSettings: config.repoSettings,
    vaultStatus: config.vaultStatus,
    manageSshConfig: config.settings.manageSshConfig !== false,
    // Off unless it was turned on: nothing should start moving commits on its
    // own because the setting happened to be absent.
    autoPull: config.settings.autoPull === true
  });

  // A deleted profile must not stay selected.
  const state = getState();
  if (state.activeProfileId && !state.sshProfiles.some((p) => p.id === state.activeProfileId)) {
    void setActiveProfile('', { silent: true });
  }

  renderAccounts();
}

export async function loadConfig(): Promise<void> {
  try {
    applyConfigSnapshot(await api.getConfig());
  } catch (error) {
    logToTerminal(`Failed to load application configurations: ${errorMessage(error)}`, 'error');
  }
}

export function activeProfile(): ClientSshProfile | null {
  const { activeProfileId, sshProfiles } = getState();
  return activeProfileId ? (sshProfiles.find((p) => p.id === activeProfileId) ?? null) : null;
}

/** Keeps ~/.ssh/config pointing at whichever key is now active. */
async function applySshConfigForActiveProfile(): Promise<void> {
  const { activeRepo, activeProfileId, manageSshConfig } = getState();
  if (!activeRepo || !manageSshConfig) {
    return;
  }

  try {
    const result = await api.applySshConfig(activeProfileId, activeRepo);
    if (result.warning) {
      logToTerminal(result.warning, 'error');
    }
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not update ~/.ssh/config: ${errorMessage(error)}`, 'error');
    }
  }
}

export async function setActiveProfile(
  id: string,
  options: { silent?: boolean } = {}
): Promise<void> {
  update({ activeProfileId: id });

  const { activeRepo } = getState();
  if (activeRepo) {
    if (id) {
      localStorage.setItem(storageKey(activeRepo), id);
    } else {
      localStorage.removeItem(storageKey(activeRepo));
    }
  }

  renderAccounts();
  await applySshConfigForActiveProfile();

  // Get the key into the native agent, so terminals and external coding
  // agents in this repository authenticate as the same account.
  await loadSelectedKey(id);

  if (!options.silent) {
    const profile = activeProfile();
    const label = profile?.label ?? 'System SSH';
    logToTerminal(`Active SSH key for this repository: ${label}`);
    showToast(`SSH key: ${label}`, 'info', 2500);
    await maybeOfferIdentity(profile);
  }
}

/**
 * Restores the key choice for a repository being opened.
 *
 * Falls back to an auto-select rule when there is no saved choice, which is
 * what makes work and personal accounts switch by themselves.
 */
export async function restoreProfileForRepo(repoPath: string): Promise<void> {
  const { sshProfiles, accountRules, repoSettings, activeRepoKey } = getState();

  // Repository settings first: they are stored server-side, keyed by canonical
  // repository identity, so a second window and a reinstalled app agree about
  // which account this repository belongs to. localStorage is the fallback for
  // choices made before that existed.
  const stored = activeRepoKey ? repoSettings[activeRepoKey]?.sshProfileId : undefined;
  const cached = stored ?? localStorage.getItem(storageKey(repoPath));
  let profileId = '';

  if (cached) {
    // Older versions stored the key path rather than the profile id.
    profileId = sshProfiles.some((p) => p.id === cached)
      ? cached
      : (sshProfiles.find((p) => p.privateKeyPath === cached)?.id ?? '');
  }

  let autoSelected: ClientSshProfile | null = null;
  if (!profileId && accountRules.length > 0) {
    autoSelected = ruleProfileFor(getState().origin?.remoteUrl ?? null);
    if (autoSelected) {
      profileId = autoSelected.id;
    }
  }

  await setActiveProfile(profileId, { silent: true });

  if (autoSelected) {
    logToTerminal(`Auto-selected account "${autoSelected.label}" for this remote.`);
    showToast(`Auto-selected account "${autoSelected.label}" for this remote.`, 'info');
    // An account carries authorship too; align it without prompting, since
    // the user did not choose this explicitly.
    await applyProfileIdentity(autoSelected, { silent: true });
  }
}

// ---------- vault ----------

export async function refreshVaultStatus(): Promise<void> {
  try {
    const status = await api.getVaultStatus();
    update({ vaultStatus: { hasVault: status.hasVault, unlocked: status.unlocked } });
    renderAccounts();
  } catch {
    // The status is cosmetic; a failure here must not break the dropdown.
  }
}

/** Prompts for the master key and unlocks. Returns true on success. */
export async function unlockVault(): Promise<boolean> {
  const masterKey = await promptDialog({
    title: 'Unlock passphrase vault',
    label: 'Master key',
    type: 'password'
  });

  if (masterKey === null || masterKey === '') {
    return false;
  }

  try {
    const status = await api.unlockVault(masterKey);
    update({ vaultStatus: { hasVault: status.hasVault, unlocked: status.unlocked } });
    renderAccounts();

    // A stored passphrase may now be usable for the selected profile.
    const { activeProfileId } = getState();
    if (activeProfileId) {
      await loadSelectedKey(activeProfileId);
    } else {
      await refreshAgent();
    }

    // And for every other profile too. Unlocking the vault is the moment every
    // saved passphrase becomes available at once, so this is when the machine's
    // agent can hold the whole set — which is what makes the identities real
    // for terminals and external tools, not just for this window.
    //
    // Quiet on purpose: nothing here prompts, and a key that still needs a
    // passphrase typed is left for the Load all keys button rather than
    // interrupting an unlock the user asked for for another reason.
    const loadedElsewhere = await loadRemainingKeys();
    if (loadedElsewhere > 0) {
      logToTerminal(
        `Loaded ${loadedElsewhere} more key(s) into the SSH agent from the vault.`,
        'success'
      );
    }

    showToast('Vault unlocked for this session.', 'success');
    return true;
  } catch (error) {
    showToast(errorMessage(error, 'Failed to unlock the vault.'), 'error');
    return false;
  }
}

/**
 * Loads whatever the newly-open vault can now supply. Returns how many arrived.
 *
 * Failures are swallowed: this is an extra that runs after a successful unlock,
 * and an agent that cannot be reached must not turn "vault unlocked" into an
 * error message about something the user did not ask for.
 */
async function loadRemainingKeys(): Promise<number> {
  try {
    const result = await api.loadAllSshAgentKeys();
    await refreshAgent();
    return result.entries.filter((entry) => entry.outcome === 'loaded').length;
  } catch {
    return 0;
  }
}

export async function lockVault(): Promise<void> {
  try {
    const status = await api.lockVault();
    update({ vaultStatus: { hasVault: status.hasVault, unlocked: status.unlocked } });
    renderAccounts();

    // Locking removes the identities this session loaded, so the agent panel
    // is stale the moment the request returns.
    await refreshAgent();

    const unloaded = status.unloadedKeys ?? [];
    showToast(
      unloaded.length > 0
        ? `Vault locked. Removed ${unloaded.length} key(s) from the SSH agent.`
        : 'Vault locked.',
      'info'
    );
  } catch (error) {
    showToast(errorMessage(error, 'Failed to lock the vault.'), 'error');
  }
}

/** Unlocks on demand; setting up a vault is the same call with a new key. */
export async function ensureVaultUnlocked(): Promise<boolean> {
  return getState().vaultStatus.unlocked || unlockVault();
}

// ---------- auto-select rules ----------

export async function addAccountRule(): Promise<void> {
  const matchInput = asInput(ui.ruleMatchInput);
  const match = matchInput.value.trim();
  const profileId = (ui.ruleProfileSelect as HTMLSelectElement).value;

  if (!match) {
    showToast('Enter a remote URL fragment to match (e.g. github.com/your-org).', 'warn');
    return;
  }
  if (!profileId) {
    showToast('Create an account profile first.', 'warn');
    return;
  }

  try {
    const { config } = await api.addAccountRule(match, profileId);
    matchInput.value = '';
    showToast('Auto-select rule added.', 'success');
    applyConfigSnapshot(config);
  } catch (error) {
    showToast(errorMessage(error, 'Failed to add rule.'), 'error');
  }
}

export async function deleteAccountRule(id: string): Promise<void> {
  try {
    const { config } = await api.deleteAccountRule(id);
    showToast('Rule deleted.', 'success');
    applyConfigSnapshot(config);
  } catch (error) {
    showToast(errorMessage(error, 'Failed to delete rule.'), 'error');
  }
}

// ---------- ~/.ssh/config management toggle ----------

export async function onManageSshConfigChanged(enabled: boolean): Promise<void> {
  let removeManagedBlock = false;

  if (!enabled) {
    const { confirmed, checked } = await confirmDialog(
      'External tools such as Git Bash and your IDE will stop following the key selected here.',
      {
        title: 'Stop managing ~/.ssh/config?',
        confirmLabel: 'Turn Off',
        checkboxLabel: "Also remove Multi-Git's existing block from ~/.ssh/config",
        checkboxChecked: true
      }
    );

    if (!confirmed) {
      // Put the checkbox back; the user cancelled.
      asInput(ui.sshManageConfigCheckbox).checked = true;
      return;
    }
    removeManagedBlock = checked;
  }

  try {
    const { config, warning } = await api.saveAppSettings({
      manageSshConfig: enabled,
      removeManagedBlock
    });
    applyConfigSnapshot(config);

    if (warning) {
      showToast(warning, 'warn', 7000);
    }
    showToast(
      enabled ? 'Multi-Git will keep ~/.ssh/config in sync.' : 'Multi-Git no longer edits ~/.ssh/config.',
      'success'
    );

    if (enabled) {
      await applySshConfigForActiveProfile();
    }
  } catch (error) {
    showToast(errorMessage(error, 'Failed to save the setting.'), 'error');
    asInput(ui.sshManageConfigCheckbox).checked = !enabled;
  }
}

// ---------- startup health check ----------

let healthCheckDone = false;

/**
 * Reports keys that are missing or unreadable, once per session.
 *
 * A passphrase-protected key is healthy, just locked, so it is logged rather
 * than raised. Never blocks startup.
 */
export async function validateSshProfilesOnStartup(): Promise<void> {
  if (healthCheckDone || getState().sshProfiles.length === 0) {
    return;
  }
  healthCheckDone = true;

  try {
    const data = await api.validateAllSshKeys();
    if (data.unavailable) {
      return;
    }

    for (const result of data.results) {
      if (result.status === 'passphrase') {
        logToTerminal(`SSH key "${result.label}" is passphrase-protected.`);
      }
    }

    const problems = data.results.filter(
      (result) => result.status === 'missing' || result.status === 'invalid'
    );
    if (problems.length === 0) {
      return;
    }

    ui.sshHealthList.replaceChildren();
    for (const problem of problems) {
      logToTerminal(
        `SSH key problem — ${problem.label} (${problem.privateKeyPath}): ${problem.message}`,
        'error'
      );

      const item = document.createElement('li');
      const title = document.createElement('div');
      title.className = 'ssh-health-item-title';
      title.textContent = problem.label;

      const path = document.createElement('div');
      path.className = 'ssh-health-item-path';
      path.textContent = problem.privateKeyPath || '(no key path)';

      const reason = document.createElement('div');
      reason.className = 'ssh-health-item-reason';
      reason.textContent =
        problem.status === 'missing' ? 'Key file not found on disk.' : problem.message;

      item.append(title, path, reason);
      ui.sshHealthList.appendChild(item);
    }

    ui.sshHealthModal.classList.remove('hidden');
  } catch (error) {
    console.warn('SSH key startup validation failed:', error);
  }
}
