// Getting the selected key usable, and asking for what that takes.
//
// Before this existed the app only ever *mentioned* a locked key: a line in
// the Terminal Log when a window opened, and a toast before a push saying to
// unlock it somewhere else. Both are true and neither helps at the moment the
// user is looking at a push that is about to fail.
//
// "Locked" is two different states and they need two different questions:
//
//   * VAULT_LOCKED — the passphrase is saved, but the vault holding it needs
//     its master key. Ask for the master key.
//   * PASSPHRASE_REQUIRED — the key is passphrase-protected and nothing is
//     saved for it. Ask for the key's own passphrase, and offer to remember it.
//
// Three rules keep this from becoming a nuisance. It never opens during a
// background refresh; declining is remembered for the session; and the state is
// re-read immediately before asking, because the vault and the agent belong to
// the whole application while windows do not — once one window unlocks, every
// other window should notice rather than ask again.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { getState } from '../../state/store';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { agentState, loadSelectedKey, refreshAgent } from './agent';
import { unlockVault } from './index';

/** Why the key is being made ready. Only used to word the dialog. */
export type UnlockReason = 'startup' | 'fetch' | 'pull' | 'push' | 'agent-launch' | 'manual';

/** Profiles the user declined to unlock. Cleared when the page reloads. */
const declined = new Set<string>();

/** The dialog in flight, so two callers share one prompt rather than stacking. */
let inFlight: Promise<boolean> | null = null;

function reasonSentence(reason: UnlockReason): string {
  switch (reason) {
    case 'push':
      return 'Pushing needs this key.';
    case 'pull':
      return 'Pulling needs this key.';
    case 'fetch':
      return 'Fetching needs this key.';
    case 'agent-launch':
      return 'A tool launched here will need this key to push.';
    case 'startup':
      return 'This repository is set to use it.';
    default:
      return '';
  }
}

/**
 * Makes the selected key usable, asking for whatever that needs.
 *
 * Returns true when the key is loaded, or when there is nothing to load —
 * the System profile means "use whatever this machine already does", so it is
 * ready by definition. Returns false when the user declined or the key could
 * not be loaded, and the caller decides whether that is fatal.
 */
export function ensureKeyUsable(options: { reason: UnlockReason; force?: boolean }): Promise<boolean> {
  if (inFlight) {
    return inFlight;
  }

  inFlight = run(options).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

async function run(options: { reason: UnlockReason; force?: boolean }): Promise<boolean> {
  const { activeProfileId, sshProfiles } = getState();

  if (!activeProfileId) {
    return true;
  }

  const profile = sshProfiles.find((candidate) => candidate.id === activeProfileId);
  if (!profile) {
    return true;
  }

  if (declined.has(activeProfileId) && options.force !== true) {
    return false;
  }

  // Re-read rather than trusting what the panel last drew: another window may
  // have unlocked the vault, or the key may have been removed with `ssh-add -d`
  // in a terminal since.
  await refreshAgent();
  const state = agentState();

  if (state?.selectedKeyLoaded) {
    return true;
  }

  // Nothing typed here can start a service that is stopped or install an agent
  // that is missing. Those have their own button, and asking for a passphrase
  // first would be asking for something that cannot help.
  if (state && state.availability !== 'ready') {
    return false;
  }

  const attempt = await api.loadSshAgentKey(getState().activeRepo, activeProfileId);
  if (attempt.success) {
    return true;
  }

  if (attempt.code === 'VAULT_LOCKED') {
    return unlockThroughVault(options.reason);
  }

  if (attempt.code === 'PASSPHRASE_REQUIRED' || attempt.code === 'PASSPHRASE_REJECTED') {
    return askForPassphrase(profile.label, options.reason);
  }

  // A key file that has been moved or a repair that needs administrator
  // rights. Reported, but not something a passphrase prompt would fix.
  if (attempt.error) {
    logToTerminal(`SSH agent: ${attempt.error}`, 'error');
  }
  return false;
}

/** The saved-passphrase case: the vault is what is locked, not the key. */
async function unlockThroughVault(reason: UnlockReason): Promise<boolean> {
  const context = reasonSentence(reason);
  showToast(
    context
      ? `${context} Unlock the passphrase vault to continue.`
      : 'Unlock the passphrase vault to continue.',
    'info',
    4000
  );

  if (!(await unlockVault())) {
    // Cancelling is a choice. It is remembered so the next refresh, focus or
    // push does not ask again unprompted.
    declined.add(getState().activeProfileId);
    return false;
  }

  await refreshAgent();
  return agentState()?.selectedKeyLoaded === true;
}

/** The unsaved-passphrase case: ask for the key's own passphrase. */
async function askForPassphrase(profileLabel: string, reason: UnlockReason): Promise<boolean> {
  const { activeProfileId, activeRepo } = getState();

  const context = reasonSentence(reason);
  const passphrase = await promptDialog({
    title: `Unlock "${profileLabel}"`,
    label: context ? `${context} Passphrase for this key` : 'Passphrase for this key',
    type: 'password'
  });

  if (passphrase === null || passphrase === '') {
    declined.add(activeProfileId);
    return false;
  }

  try {
    const result = await api.loadSshAgentKey(activeRepo, activeProfileId, { passphrase });

    if (!result.success) {
      showToast(
        result.code === 'PASSPHRASE_REJECTED'
          ? 'That passphrase was not accepted for this key.'
          : (result.error ?? 'The key could not be loaded.'),
        'error',
        6000
      );
      // Not recorded as a refusal: getting it wrong is not the same as saying
      // no, and the next attempt should be able to ask again.
      return false;
    }

    await refreshAgent();
    showToast(`"${profileLabel}" is loaded in the SSH agent.`, 'success');

    await offerToRemember(profileLabel, passphrase);
    return true;
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not load the key.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 6000);
    }
    return false;
  }
}

/**
 * Offers to keep the passphrase, once it is known to be correct.
 *
 * Asked afterwards rather than as a checkbox on the prompt, so a passphrase is
 * never stored before it has actually loaded a key — a saved wrong value would
 * fail silently on every future launch, which is worse than not saving one.
 *
 * Only offered when the vault is open. A locked vault cannot receive it, and
 * asking would be offering something that will not happen.
 */
async function offerToRemember(profileLabel: string, passphrase: string): Promise<void> {
  const { vaultStatus, activeProfileId, activeRepo, sshProfiles } = getState();

  const profile = sshProfiles.find((candidate) => candidate.id === activeProfileId);
  if (!vaultStatus.unlocked || profile?.hasSavedPassword) {
    return;
  }

  const { confirmed } = await confirmDialog(
    `Save the passphrase for "${profileLabel}" in the vault, so Multi-Git can load this key without asking again?\n\nIt is encrypted with your vault master key and never leaves this machine.`,
    { title: 'Remember this passphrase', confirmLabel: 'Save it' }
  );

  if (!confirmed) {
    return;
  }

  try {
    await api.loadSshAgentKey(activeRepo, activeProfileId, { passphrase, savePassphrase: true });
    showToast('Passphrase saved in the vault.', 'success');
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not save the passphrase.'), 'warn', 6000);
    }
  }
}

/**
 * The Unlock button in the accounts dropdown.
 *
 * Explicit, so it ignores an earlier refusal — pressing a button that says
 * Unlock and having nothing happen would be the worst possible answer.
 */
export async function unlockSelectedKey(): Promise<void> {
  declined.delete(getState().activeProfileId);

  if (await ensureKeyUsable({ reason: 'manual', force: true })) {
    await loadSelectedKey(getState().activeProfileId);
  }
}
