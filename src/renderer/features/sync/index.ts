// Fetch, pull, push, and the origin protocol toggle.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { getState } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { setButtonBusy } from '../../ui/busy';
import { activeProfile } from '../accounts';
import { getAccountMismatch } from '../accounts/identity';
import { refreshOrigin } from '../repo';
import type { SyncResponse } from '../../../shared/api-types';

export type SyncAction = 'fetch' | 'pull' | 'push';

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};

export function initSync(elements: Elements, onChanged: () => Promise<void>): void {
  ui = elements;
  refreshAll = onChanged;
}

function buttonFor(action: SyncAction): HTMLElement {
  if (action === 'push') {
    return ui.btnPush;
  }
  return action === 'pull' ? ui.btnPull : ui.btnFetch;
}

/** Rejections that a force-with-lease retry can resolve. */
function isNonFastForward(message: string): boolean {
  return /non-fast-forward|fetch first|\[rejected\]|stale info/i.test(message);
}

function titleCase(action: SyncAction): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

/**
 * Warns when pushing with an account that contradicts an auto-select rule.
 * Returns false when the user backs out.
 */
async function confirmAccountForPush(): Promise<boolean> {
  const mismatch = getAccountMismatch();
  if (mismatch?.type !== 'account') {
    return true;
  }

  const { confirmed } = await confirmDialog(
    `Your auto-select rules map this remote to account "${mismatch.ruleProfile.label}", but you're pushing with "${mismatch.profile?.label ?? 'System SSH'}". Push anyway?`,
    { title: 'Account mismatch', confirmLabel: 'Push Anyway', danger: true }
  );

  return confirmed;
}

function logSyncOutcome(action: SyncAction, data: SyncResponse): void {
  if (data.stderr) {
    // git writes progress to stderr, so this is usually not an error.
    logToTerminal(data.stderr, 'info');
  }
  if (data.stdout) {
    logToTerminal(data.stdout, 'success');
  }
  if (data.usedAskpass) {
    const forProfile = data.profileLabel ? ` for profile "${data.profileLabel}"` : '';
    logToTerminal(`Saved passphrase was used automatically${forProfile}.`, 'success');
  }

  logToTerminal(`${action.toUpperCase()} action complete.`, 'success');
}

export async function performSync(
  action: SyncAction,
  options: { force?: boolean } = {}
): Promise<void> {
  const profile = activeProfile();

  if (action === 'push' && !options.force && !(await confirmAccountForPush())) {
    return;
  }

  if (profile) {
    logToTerminal(`Using SSH profile: ${profile.label} (${profile.privateKeyPath})`, 'info');
    if (profile.hasSavedPassword && !getState().vaultStatus.unlocked) {
      showToast(
        'This profile has a saved passphrase, but the vault is locked. Unlock it in the SSH key menu first.',
        'warn',
        6000
      );
    }
  } else {
    logToTerminal('Using system default SSH configuration', 'info');
  }

  const flags = `${action === 'fetch' ? ' --prune' : ''}${options.force ? ' --force-with-lease' : ''}`;
  const prefix = profile ? `GIT_SSH_COMMAND="ssh -i ${profile.privateKeyPath}..." ` : '';
  logToTerminal(`${prefix}git ${action}${flags} origin`, 'cmd');

  const button = buttonFor(action);
  setButtonBusy(button, true);

  try {
    const input = {
      ...(profile ? { profileId: profile.id, sshKeyPath: profile.privateKeyPath } : {}),
      ...(options.force ? { force: true } : {})
    };

    const data =
      action === 'push'
        ? await api.push(input)
        : action === 'pull'
          ? await api.pull(input)
          : await api.fetchRemote(input);

    logSyncOutcome(action, data);
    showToast(
      `${titleCase(action)} completed${profile ? ` with key "${profile.label}"` : ''}.`,
      'success'
    );

    await refreshAll();
  } catch (error) {
    if (isStale(error)) {
      return;
    }

    const message = errorMessage(error, `${titleCase(action)} failed.`);
    logToTerminal(message, 'error');

    // A rejected push is usually recoverable, and force-with-lease is the
    // safe form: it only overwrites if the remote still matches what we last
    // fetched, so a colleague's push is never silently lost.
    if (action === 'push' && !options.force && isNonFastForward(message)) {
      setButtonBusy(button, false);

      const { confirmed } = await confirmDialog(
        'The remote has commits your branch does not (the push was rejected). Force-push with lease overwrites the remote branch, but only if it still matches what you last fetched.',
        { title: 'Push rejected', confirmLabel: 'Force Push (with lease)', danger: true }
      );

      if (confirmed) {
        await performSync('push', { force: true });
      }
      return;
    }

    showToast(`${titleCase(action)} failed: ${message}`, 'error', 9000);
  } finally {
    setButtonBusy(button, false);
  }
}

export async function toggleRemoteProtocol(): Promise<void> {
  const origin = getState().origin;
  if (!origin?.canToggle) {
    return;
  }

  const target = origin.protocol === 'ssh' ? 'HTTPS' : 'SSH';
  const { confirmed } = await confirmDialog(
    `Change the origin remote from\n${origin.remoteUrl}\nto\n${origin.suggestedUrl}`,
    { title: `Switch origin to ${target}?`, confirmLabel: `Switch to ${target}` }
  );
  if (!confirmed) {
    return;
  }

  const button = ui.btnRemoteProtocol as HTMLButtonElement;
  button.disabled = true;

  try {
    const data = await api.toggleOriginProtocol();
    logToTerminal(`git remote set-url origin ${data.remoteUrl}`, 'cmd');
    logToTerminal(`Origin switched to ${target}: ${data.remoteUrl}`, 'success');
    showToast(`Origin remote switched to ${target}.`, 'success');
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Failed to switch origin remote protocol.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  } finally {
    button.disabled = false;
    await refreshOrigin();
  }
}
