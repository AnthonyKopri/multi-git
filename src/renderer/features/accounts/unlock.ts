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
//
// "Declining is remembered" is scoped tightly, and the scope is the point.
// Pressing Push is not a background refresh: the user has just asked for the
// thing the key is for, and the honest response to "your key is locked" at that
// moment is to ask, not to remember that they said no to a different question
// twenty minutes ago and let the push fail. So an explicit sync always asks,
// and the memory only suppresses the prompts nobody asked for — window
// restore, and launching an external agent.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { getState } from '../../state/store';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { agentState, loadSelectedKey, refreshAgent } from './agent';
import { unlockVault } from './index';
import type { SshAgentState } from '../../../shared/ssh-agent-types';

/** Why the key is being made ready. Only used to word the dialog. */
export type UnlockReason = 'startup' | 'fetch' | 'pull' | 'push' | 'agent-launch' | 'manual';

/** Profiles the user declined to unlock. Cleared when the page reloads. */
const declined = new Set<string>();

/**
 * Reasons that came from the user pressing something.
 *
 * These always ask. The rest — a window restoring, a tool being launched —
 * happen on their own schedule and honour an earlier refusal.
 */
const EXPLICIT_REASONS: ReadonlySet<UnlockReason> = new Set<UnlockReason>([
  'fetch',
  'pull',
  'push',
  'manual'
]);

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

  const explicit = options.force === true || EXPLICIT_REASONS.has(options.reason);

  if (declined.has(activeProfileId) && !explicit) {
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
  // that is missing. Those need the repair button, so this says so and offers
  // it — the previous silent `return false` left a push cancelled by a toast
  // that named a key, for a problem that was never about the key.
  if (state && state.availability !== 'ready') {
    return explicit ? reportAgentUnavailable(state, options.reason) : false;
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

  // A key file that has been moved, or a repair that needs administrator
  // rights. Not something a passphrase prompt would fix — but on an explicit
  // push it is still the answer to a question the user just asked, so it is
  // put in front of them rather than left in the Terminal Log.
  if (attempt.error) {
    logToTerminal(`SSH agent: ${attempt.error}`, 'error');
  }

  if (explicit) {
    const { confirmed } = await confirmDialog(
      [
        reasonSentence(options.reason),
        attempt.error ?? 'The key could not be loaded into the SSH agent.',
        'Multi-Git can still try on its own, using the key file directly. If the key needs a passphrase that is not saved, that attempt will fail.'
      ]
        .filter((line) => line !== '')
        .join('\n\n'),
      {
        title: `"${profile.label}" could not be loaded`,
        confirmLabel: continueLabel(options.reason)
      }
    );

    return confirmed;
  }

  return false;
}

/**
 * The agent itself is the problem, not the key.
 *
 * Answers true to let the sync run anyway, and that is not a shrug: in-app Git
 * still authenticates through the per-command `GIT_SSH_COMMAND -i <key>`
 * fallback, with a saved passphrase supplied over AskPass where there is one.
 * A stopped agent degrades terminals and external tools, not this one, so
 * refusing to push would be inventing a failure the user does not have.
 */
async function reportAgentUnavailable(
  state: SshAgentState,
  reason: UnlockReason
): Promise<boolean> {
  const context = reasonSentence(reason);
  const repairable =
    state.platform === 'win32' &&
    (state.availability === 'stopped' || state.availability === 'disabled');

  const { confirmed } = await confirmDialog(
    [
      context,
      state.diagnostic ?? 'No SSH agent is reachable on this machine.',
      repairable
        ? 'Repair and start, in the SSH key menu, will enable and start the service.'
        : '',
      'Multi-Git can still authenticate this operation on its own. Anything you run outside the app — a terminal, an external coding agent — will not be able to until the agent is working.'
    ]
      .filter((line) => line !== '')
      .join('\n\n'),
    {
      title: 'The SSH agent is not available',
      confirmLabel: continueLabel(reason)
    }
  );

  return confirmed;
}

/** The confirm button's words: the action the user pressed, where there was one. */
function continueLabel(reason: UnlockReason): string {
  if (reason === 'fetch' || reason === 'pull' || reason === 'push') {
    return `${reason.charAt(0).toUpperCase()}${reason.slice(1)} anyway`;
  }
  return 'Continue anyway';
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
async function offerToRemember(
  profileLabel: string,
  passphrase: string,
  /** Defaults to the active profile, which is whose passphrase was asked for. */
  targetProfileId?: string
): Promise<void> {
  const { vaultStatus, activeProfileId, activeRepo, sshProfiles } = getState();

  const profileId = targetProfileId ?? activeProfileId;
  // A repository is named only when this is the repository's own profile.
  // Saving a passphrase must never be the thing that repoints an unrelated
  // repository at a different identity.
  const repoPath = targetProfileId === undefined ? activeRepo : null;

  const profile = sshProfiles.find((candidate) => candidate.id === profileId);
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
    await api.loadSshAgentKey(repoPath, profileId, { passphrase, savePassphrase: true });
    showToast('Passphrase saved in the vault.', 'success');
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not save the passphrase.'), 'warn', 6000);
    }
  }
}

/**
 * Asks for the passphrase of each named profile, in turn.
 *
 * Used after a bulk agent load, for the keys the server could not supply a
 * passphrase for. Every load here passes a null repository path on purpose:
 * loading a key is a machine-level act, and routing the *current* repository to
 * whichever profile happened to be third in this list would be a silent change
 * of identity nobody asked for.
 *
 * Cancelling one moves on to the next rather than abandoning the rest, and is
 * not recorded as a refusal — the user opened this deliberately.
 */
export async function promptForProfiles(profileIds: readonly string[]): Promise<void> {
  const { sshProfiles } = getState();

  for (const profileId of profileIds) {
    const profile = sshProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      continue;
    }

    const passphrase = await promptDialog({
      title: `Unlock "${profile.label}"`,
      label: 'Passphrase for this key',
      type: 'password'
    });

    if (passphrase === null || passphrase === '') {
      continue;
    }

    try {
      const result = await api.loadSshAgentKey(null, profileId, { passphrase });

      if (!result.success) {
        showToast(
          result.code === 'PASSPHRASE_REJECTED'
            ? `That passphrase was not accepted for "${profile.label}".`
            : (result.error ?? `"${profile.label}" could not be loaded.`),
          'error',
          6000
        );
        continue;
      }

      showToast(`"${profile.label}" is loaded in the SSH agent.`, 'success');
      await offerToRemember(profile.label, passphrase, profileId);
    } catch (error) {
      if (!isStale(error)) {
        showToast(errorMessage(error, `Could not load "${profile.label}".`), 'error', 6000);
      }
    }
  }

  await refreshAgent();
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
