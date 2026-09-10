// The SSH Profile Manager modal: add, generate, edit, test, and delete keys.
import * as api from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { asInput, asSelect } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { getState, update } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { closeAllDropdowns } from '../../ui/dropdown';
import { withButtonBusy } from '../../ui/busy';
import { attachPasswordReveal, maskPasswordField } from '../../ui/password-reveal';
import {
  applyConfigSnapshot,
  loadConfig,
  refreshVaultStatus,
  setActiveProfile
} from '../accounts';
import { forgetVerifiedAccounts } from '../sync';
import type { ClientSshProfile } from '../../../shared/config-types';
import type { GenerateKeyResponse } from '../../../shared/api-types';

let ui: Elements;

export function initSshManager(elements: Elements): void {
  ui = elements;

  attachPasswordReveal(ui.sshPassphrase, ui.btnSshPassphraseReveal);
  attachPasswordReveal(ui.sshGeneratePassphrase, ui.btnSshGeneratePassphraseReveal);
  attachPasswordReveal(ui.vaultMasterKey, ui.btnVaultMasterKeyReveal);
  attachPasswordReveal(ui.vaultMasterKeyConfirm, ui.btnVaultMasterKeyConfirmReveal);
}

type Tone = 'info' | 'error' | 'success' | 'warn';

function setGenerateFeedback(message: string, tone: Tone = 'info'): void {
  if (!message) {
    ui.sshGenerateFeedback.className = 'inline-feedback hidden';
    ui.sshGenerateFeedback.textContent = '';
    return;
  }

  ui.sshGenerateFeedback.className = `inline-feedback ${tone}`;
  ui.sshGenerateFeedback.textContent = message;
}

function resetProfileForm(): void {
  asInput(ui.sshProfileId).value = '';
  asInput(ui.sshLabel).value = '';
  asInput(ui.sshKeyPath).value = '';
  asInput(ui.sshUserName).value = '';
  asInput(ui.sshUserEmail).value = '';
  asInput(ui.sshPassphrase).value = '';
  asInput(ui.sshKeepPassword).checked = false;
  maskPasswordField(ui.sshPassphrase, ui.btnSshPassphraseReveal);
}

export function hideKeyForms(): void {
  setHidden(ui.sshExistingKeySection, true);
  setHidden(ui.sshGenerateSection, true);
  ui.btnShowAddKey.setAttribute('aria-expanded', 'false');
  ui.btnShowGenerateKey.setAttribute('aria-expanded', 'false');
  ui.sshExistingKeyHeading.textContent = 'Add an Existing Key';
  resetProfileForm();
}

export function showKeyForm(type: 'existing' | 'generate'): void {
  const showExisting = type === 'existing';
  const section = showExisting ? ui.sshExistingKeySection : ui.sshGenerateSection;

  setHidden(ui.sshExistingKeySection, !showExisting);
  setHidden(ui.sshGenerateSection, showExisting);
  ui.btnShowAddKey.setAttribute('aria-expanded', String(showExisting));
  ui.btnShowGenerateKey.setAttribute('aria-expanded', String(!showExisting));

  const firstField = section.querySelector<HTMLElement>('input:not([type="hidden"]), select');
  if (firstField) {
    // The section is hidden when focus() is called, so defer past the reflow.
    setTimeout(() => firstField.focus(), 30);
  }
}

function clearGeneratedResult(): void {
  setHidden(ui.sshGeneratedResult, true);
  ui.sshGeneratedPrivate.textContent = '';
  ui.sshGeneratedPublic.textContent = '';
}

function renderGeneratedResult(data: GenerateKeyResponse): void {
  ui.sshGeneratedPrivate.textContent = data.privateKeyPath;
  ui.sshGeneratedPublic.textContent = data.publicKey;
  setHidden(ui.sshGeneratedResult, false);
}

export function openSshModal(options: { showForm?: 'existing' | 'generate' } = {}): void {
  resetProfileForm();

  asInput(ui.sshGenerateLabel).value = '';
  asInput(ui.sshGenerateKeyName).value = '';
  asSelect(ui.sshGenerateKeyType).value = 'ed25519';
  asInput(ui.sshGenerateUserName).value = '';
  asInput(ui.sshGenerateUserEmail).value = '';
  asInput(ui.sshGeneratePassphrase).value = '';
  asInput(ui.sshGenerateKeepPassword).checked = false;
  asInput(ui.ruleMatchInput).value = '';
  maskPasswordField(ui.sshGeneratePassphrase, ui.btnSshGeneratePassphraseReveal);

  clearGeneratedResult();
  setGenerateFeedback('');
  hideKeyForms();
  closeAllDropdowns();

  setHidden(ui.sshModal, false);
  void refreshVaultStatus();

  if (options.showForm) {
    showKeyForm(options.showForm);
  }
}

/** Opens straight to the generator when no key exists yet. */
export function openSshManagerForSetup(): void {
  openSshModal(getState().sshProfiles.length === 0 ? { showForm: 'generate' } : {});
}

export function loadProfileIntoForm(profile: ClientSshProfile): void {
  asInput(ui.sshProfileId).value = profile.id;
  asInput(ui.sshLabel).value = profile.label;
  asInput(ui.sshKeyPath).value = profile.privateKeyPath;
  asInput(ui.sshUserName).value = profile.userName ?? '';
  asInput(ui.sshUserEmail).value = profile.userEmail ?? '';
  // Never prefill a passphrase; the stored one is not readable from here.
  asInput(ui.sshPassphrase).value = '';
  asInput(ui.sshKeepPassword).checked = Boolean(profile.hasSavedPassword);

  ui.sshExistingKeyHeading.textContent = 'Edit SSH Key Profile';
  showKeyForm('existing');
}

/** Shared guard for the two places a passphrase can be saved. */
function vaultBlocksSaving(keepPassword: boolean, passphrase: string): string | null {
  if (!keepPassword) {
    return null;
  }

  const { vaultStatus } = getState();
  if (!vaultStatus.unlocked) {
    return vaultStatus.hasVault
      ? 'Unlock the vault before saving a passphrase.'
      : 'Set up and unlock the vault before saving a passphrase.';
  }
  if (!passphrase) {
    return 'Passphrase is required when Keep Password is enabled.';
  }

  return null;
}

export async function saveSshProfile(): Promise<void> {
  const id = asInput(ui.sshProfileId).value;
  const label = asInput(ui.sshLabel).value.trim();
  const privateKeyPath = asInput(ui.sshKeyPath).value.trim();
  const passphrase = asInput(ui.sshPassphrase).value;
  const keepPassword = asInput(ui.sshKeepPassword).checked;

  if (!label || !privateKeyPath) {
    showToast('Profile name and private key path are required.', 'warn');
    return;
  }

  const blocked = vaultBlocksSaving(keepPassword, passphrase);
  if (blocked) {
    showToast(blocked, 'warn');
    return;
  }

  try {
    const { config } = await api.saveSshProfile({
      ...(id ? { id } : {}),
      label,
      privateKeyPath,
      userName: asInput(ui.sshUserName).value.trim(),
      userEmail: asInput(ui.sshUserEmail).value.trim(),
      keepPassword,
      passphrase
    });

    applyConfigSnapshot(config);
    // The push guard caches which account a profile authenticates as. Saving
    // one can change the key it points at while keeping its id, so anything
    // remembered about it describes a profile that no longer exists.
    forgetVerifiedAccounts();
    hideKeyForms();
    showToast(id ? 'Profile updated.' : 'Profile saved.', 'success');
  } catch (error) {
    showToast(errorMessage(error, 'Failed to save the profile.'), 'error', 7000);
  }
}

export async function deleteSshProfile(id: string, label: string): Promise<void> {
  const { confirmed } = await confirmDialog(
    `Delete the profile "${label}"? The key file itself stays on disk; only Multi-Git forgets it.`,
    { title: 'Delete SSH profile', confirmLabel: 'Delete', danger: true }
  );
  if (!confirmed) {
    return;
  }

  try {
    const { config } = await api.deleteSshProfile(id);
    applyConfigSnapshot(config);
    // A recreated profile can reuse this id, so what was verified about the
    // deleted one must not be inherited by whatever takes its place.
    forgetVerifiedAccounts();
    showToast(`Deleted profile "${label}".`, 'success');
  } catch (error) {
    showToast(errorMessage(error, 'Failed to delete the profile.'), 'error');
  }
}

export async function testSshProfile(profileId: string, label: string): Promise<void> {
  try {
    const result = await api.testSshKey({ profileId });
    const suffix = result.usedSavedPassword ? ' (saved passphrase used)' : '';

    logToTerminal(`SSH key test for "${label}": ${result.message}`, result.success ? 'success' : 'error');
    showToast(`${label}: ${result.message}${suffix}`, result.success ? 'success' : 'error', 6000);
  } catch (error) {
    showToast(errorMessage(error, 'Key test failed.'), 'error', 6000);
  }
}

/** Tests the key currently typed into the add/edit form. */
export async function testSshForm(): Promise<void> {
  const privateKeyPath = asInput(ui.sshKeyPath).value.trim();
  if (!privateKeyPath) {
    showToast('Enter a private key path first.', 'warn');
    return;
  }

  await withButtonBusy(ui.btnTestSshForm, async () => {
    try {
      const result = await api.testSshKey({
        privateKeyPath,
        passphrase: asInput(ui.sshPassphrase).value
      });
      showToast(result.message, result.success ? 'success' : 'error', 6000);
    } catch (error) {
      showToast(errorMessage(error, 'Key test failed.'), 'error', 6000);
    }
  });
}

export async function generateSshKeyAndProfile(): Promise<void> {
  const label = asInput(ui.sshGenerateLabel).value.trim();
  const passphrase = asInput(ui.sshGeneratePassphrase).value;
  const keepPassword = asInput(ui.sshGenerateKeepPassword).checked;

  if (!label) {
    setGenerateFeedback('Profile name is required to generate a key.', 'error');
    return;
  }

  const blocked = vaultBlocksSaving(keepPassword, passphrase);
  if (blocked) {
    setGenerateFeedback(blocked, 'error');
    return;
  }

  update({ generatingSshKey: true });
  setGenerateFeedback('Generating SSH key and registering profile...', 'info');

  try {
    await withButtonBusy(ui.btnGenerateSsh, async () => {
      const repoPath = getState().activeRepo;
      const data = await api.generateSshKey({
        label,
        keyType: asSelect(ui.sshGenerateKeyType).value as 'ed25519' | 'rsa',
        keyName: asInput(ui.sshGenerateKeyName).value.trim(),
        userName: asInput(ui.sshGenerateUserName).value.trim(),
        userEmail: asInput(ui.sshGenerateUserEmail).value.trim(),
        passphrase,
        keepPassword,
        ...(repoPath ? { repoPath } : {})
      });

      logToTerminal(`SSH key created and profile "${label}" registered.`, 'success');
      showToast(`SSH key created and profile "${label}" registered.`, 'success');

      if (data.sshConfigUpdated) {
        logToTerminal(`~/.ssh/config updated: ${data.sshConfigHost} now uses the new key.`, 'success');
      }
      if (data.sshConfigWarning) {
        logToTerminal(data.sshConfigWarning, 'error');
      }

      renderGeneratedResult(data);
      asInput(ui.sshGeneratePassphrase).value = '';
      asInput(ui.sshGenerateKeepPassword).checked = false;

      applyConfigSnapshot(data.config);
      if (!getState().sshProfiles.some((profile) => profile.id === data.profileId)) {
        // The response should already carry the new profile; reload if not.
        await loadConfig();
      }

      setGenerateFeedback(
        `Key created successfully. Profile "${label}" is now available in Registered Profiles.`,
        'success'
      );

      // Make the new key active for the current repository.
      if (data.profileId && getState().activeRepo) {
        await setActiveProfile(data.profileId, { silent: true });
      }
    });
  } catch (error) {
    const message = errorMessage(error, 'SSH key generation failed.');
    logToTerminal(message, 'error');
    setGenerateFeedback(message, 'error');
    showToast(message, 'error', 7000);
  } finally {
    update({ generatingSshKey: false });
  }
}

// ---------- clipboard and file-manager helpers ----------

async function copyToClipboard(text: string, description: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${description} copied.`, 'success', 2500);
  } catch {
    showToast('Could not copy to the clipboard.', 'error');
  }
}

export async function copyProfilePublicKey(profile: ClientSshProfile): Promise<void> {
  try {
    const { publicKey } = await api.getPublicKey({ profileId: profile.id });
    await copyToClipboard(publicKey, 'Public key');
  } catch (error) {
    showToast(errorMessage(error, 'Could not read the public key.'), 'error', 6000);
  }
}

export async function copyProfilePublicKeyPath(profile: ClientSshProfile): Promise<void> {
  try {
    const { publicKeyPath } = await api.getPublicKey({ profileId: profile.id });
    await copyToClipboard(publicKeyPath, 'Public key path');
  } catch (error) {
    showToast(errorMessage(error, 'Could not read the public key.'), 'error', 6000);
  }
}

export async function openProfileKeyFolder(profile: ClientSshProfile): Promise<void> {
  try {
    await api.openKeyLocation(profile.privateKeyPath);
  } catch (error) {
    showToast(errorMessage(error, 'Could not open the key folder.'), 'error', 6000);
  }
}

export async function copyGeneratedValue(kind: 'private' | 'public' | 'key'): Promise<void> {
  const privatePath = ui.sshGeneratedPrivate.textContent ?? '';
  const publicKey = ui.sshGeneratedPublic.textContent ?? '';

  if (kind === 'private') {
    await copyToClipboard(privatePath, 'Private key path');
    return;
  }
  if (kind === 'public') {
    await copyToClipboard(`${privatePath}.pub`, 'Public key path');
    return;
  }

  await copyToClipboard(publicKey, 'Public key');
}

export async function openGeneratedLocation(): Promise<void> {
  const privatePath = ui.sshGeneratedPrivate.textContent ?? '';
  if (!privatePath) {
    return;
  }

  try {
    await api.openKeyLocation(privatePath);
  } catch (error) {
    showToast(errorMessage(error, 'Could not open the key folder.'), 'error', 6000);
  }
}

// ---------- vault setup ----------

function setVaultSetupFeedback(message: string, tone: Tone = 'error'): void {
  if (!message) {
    ui.vaultSetupFeedback.className = 'inline-feedback hidden';
    ui.vaultSetupFeedback.textContent = '';
    return;
  }

  ui.vaultSetupFeedback.className = `inline-feedback ${tone}`;
  ui.vaultSetupFeedback.textContent = message;
}

export function openVaultSetupModal(): void {
  asInput(ui.vaultMasterKey).value = '';
  asInput(ui.vaultMasterKeyConfirm).value = '';
  maskPasswordField(ui.vaultMasterKey, ui.btnVaultMasterKeyReveal);
  maskPasswordField(ui.vaultMasterKeyConfirm, ui.btnVaultMasterKeyConfirmReveal);
  setVaultSetupFeedback('');
  setHidden(ui.vaultSetupModal, false);
  setTimeout(() => asInput(ui.vaultMasterKey).focus(), 30);
}

export function closeVaultSetupModal(): void {
  setHidden(ui.vaultSetupModal, true);
}

export async function setupVault(): Promise<void> {
  const masterKey = asInput(ui.vaultMasterKey).value;
  const confirmKey = asInput(ui.vaultMasterKeyConfirm).value;

  if (!masterKey) {
    setVaultSetupFeedback('Choose a master key.');
    return;
  }
  if (masterKey !== confirmKey) {
    setVaultSetupFeedback('The two master keys do not match.');
    return;
  }

  try {
    // Creating and unlocking a vault are the same call: the first unlock with
    // a new key initialises it.
    await api.unlockVault(masterKey);
    await refreshVaultStatus();

    closeVaultSetupModal();
    showToast('Vault created and unlocked for this session.', 'success');
    logToTerminal(
      'Passphrase vault created. The master key is not stored and cannot be recovered.',
      'success'
    );
  } catch (error) {
    setVaultSetupFeedback(errorMessage(error, 'Could not set up the vault.'));
  }
}

/**
 * Asks the host which account this key actually authenticates as.
 *
 * The one check the local configuration cannot do for itself. A pin can name
 * exactly the right key and still authenticate as another account, because
 * ~/.ssh/config names a key for the same host and the agent decides which is
 * offered first — and the error that comes back, `Repository not found`, does
 * not mention accounts at all.
 */
export async function verifyProfileAccount(profile: ClientSshProfile): Promise<void> {
  const { activeRepo } = getState();

  try {
    const { host, check } = await api.verifySshAccount(profile.id, activeRepo ?? '');

    const tone = check.mismatch ? 'error' : check.ok ? 'success' : 'error';
    logToTerminal(`${host} — ${profile.label}: ${check.message}`, tone);
    showToast(check.message, tone === 'success' ? 'success' : 'error', 8000);
  } catch (error) {
    showToast(errorMessage(error, 'Could not verify the account.'), 'error', 6000);
  }
}

/**
 * Makes one profile the account repositories with none of their own fall back to.
 *
 * Machine-wide, and therefore always an explicit action. This used to happen
 * as a side effect of selecting a profile in any repository, which meant the
 * default quietly became whichever repository was opened last.
 */
export async function makeDefaultAccount(profile: ClientSshProfile): Promise<void> {
  // The star is a toggle, so clicking the filled one clears the default and
  // leaves no account privileged rather than doing nothing.
  if (getState().defaultAccountProfileId === profile.id) {
    await clearDefaultAccount(profile);
    return;
  }

  const identity = profile.userEmail
    ? `

Optionally also set your global Git identity to ${profile.userName || profile.label} <${profile.userEmail}>, so new repositories are authored as this account.`
    : `

"${profile.label}" has no commit email, so the global Git identity will be left as it is.`;

  const { confirmed, checked } = await confirmDialog(
    `Repositories with no account of their own — plus terminals and external tools — will authenticate as "${profile.label}" on hosts Multi-Git manages.${identity}`,
    {
      title: 'Make this the default account?',
      confirmLabel: 'Make Default',
      ...(profile.userEmail
        ? { checkboxLabel: 'Also set my global Git identity', checkboxChecked: true }
        : {})
    }
  );

  if (!confirmed) {
    return;
  }

  try {
    const result = await api.setDefaultAccount(profile.id, Boolean(profile.userEmail) && checked);
    applyConfigSnapshot(result.config);

    if (result.warning) {
      logToTerminal(result.warning, 'error');
    }

    logToTerminal(
      `Default account is now "${profile.label}"${result.identityApplied ? ' (global Git identity updated)' : ''}.`,
      'success'
    );
    showToast(`Default account: ${profile.label}`, 'success');
  } catch (error) {
    showToast(errorMessage(error, 'Failed to set the default account.'), 'error');
  }
}

/**
 * Leaves no account as the machine-wide fallback.
 *
 * Worth confirming rather than toggling silently: with no default, anything
 * that does not read a repository's own setting — a terminal, an external tool —
 * is back to whatever ~/.ssh/config and the agent decide between them.
 */
async function clearDefaultAccount(profile: ClientSshProfile): Promise<void> {
  const { confirmed } = await confirmDialog(
    `"${profile.label}" will stop being the account that repositories with none of their own fall back to. Nothing else becomes the default in its place.`,
    { title: 'Clear the default account?', confirmLabel: 'Clear Default' }
  );

  if (!confirmed) {
    return;
  }

  try {
    const result = await api.setDefaultAccount(null, false);
    applyConfigSnapshot(result.config);

    logToTerminal('No account is set as the default any more.', 'info');
    showToast('Default account cleared.', 'info');
  } catch (error) {
    showToast(errorMessage(error, 'Failed to clear the default account.'), 'error');
  }
}
