// Fetch, pull, push, and the origin protocol toggle.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { getState, subscribeTo, update } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { setButtonBusy } from '../../ui/busy';
import { activeProfile } from '../accounts';
import { ensureKeyUsable } from '../accounts/unlock';
import { getAccountMismatch } from '../accounts/identity';
import { refreshOrigin } from '../repo';
import { pushButtonState } from './push-button';
import { autoPullBlockedReason, shouldAutoPull } from './auto-pull';
import type { SyncResponse } from '../../../shared/api-types';

export type SyncAction = 'fetch' | 'pull' | 'push';

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};

export function initSync(elements: Elements, onChanged: () => Promise<void>): void {
  ui = elements;
  refreshAll = onChanged;

  // Push and Publish are the same button in two states, and which one it is
  // depends on the branch's upstream and on whether there is an origin at all.
  // Subscribing keeps both sources in one place rather than making every
  // caller that refreshes either remember to redraw the button.
  subscribeTo(['status', 'origin'], renderPushButton);
  renderPushButton();

  subscribeTo(['status', 'activeRepo', 'autoPull'], renderAutoPullChip);
  renderAutoPullChip();
}

/** Redraws the auto-pull toggle for the current setting and branch. */
export function renderAutoPullChip(): void {
  const button = ui.btnAutoPull as HTMLButtonElement;
  const { activeRepo, autoPull, status } = getState();

  setHidden(button, !activeRepo);
  if (!activeRepo) {
    return;
  }

  button.classList.toggle('chip-on', autoPull);
  button.setAttribute('aria-pressed', String(autoPull));

  if (!autoPull) {
    button.title =
      'Auto-pull is off. Turn it on to fast-forward automatically when a fetch finds this branch purely behind.';
    return;
  }

  // When it is on, the useful thing to say is whether it would act right now,
  // and if not, which condition is holding it back.
  const blocked = autoPullBlockedReason(status);
  button.title = blocked
    ? `Auto-pull is on, but would not act right now: ${blocked}`
    : 'Auto-pull is on. The next fetch will fast-forward this branch.';
}

/** Turns the setting on or off and remembers it. */
export async function toggleAutoPull(): Promise<void> {
  const next = !getState().autoPull;

  try {
    await api.saveAppSettings({ autoPull: next });
    update({ autoPull: next });

    logToTerminal(`Auto-pull ${next ? 'enabled' : 'disabled'}.`, 'info');
    showToast(
      next
        ? 'Auto-pull on: a fetch will fast-forward this branch when it is purely behind.'
        : 'Auto-pull off.',
      'info'
    );
  } catch (error) {
    const message = errorMessage(error, 'Could not save the auto-pull setting.');
    logToTerminal(message, 'error');
    showToast(message, 'error', 7000);
  }
}

/** Redraws the Push button as Push or Publish for the current branch. */
export function renderPushButton(): void {
  const button = ui.btnPush as HTMLButtonElement;

  // A busy button owns its own icon: setButtonBusy stashed the real one and
  // put a spinner in its place, and restoring it is that function's job.
  if (button.dataset['busy'] === 'true') {
    return;
  }

  const { status, origin } = getState();
  const next = pushButtonState(status, origin);

  button.classList.toggle('btn-publish', next.mode === 'publish');
  button.disabled = next.disabled;
  button.title = next.title;
  button.setAttribute('aria-label', next.ariaLabel);

  const icon = button.querySelector<HTMLElement>('.material-symbols-outlined');
  if (icon) {
    icon.textContent = next.icon;
  }

  ui.pushLabel.textContent = next.label;
  setHidden(ui.pushLabel, next.label === '');
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

  // "Publish failed" is what the user was told they were doing, so it is what
  // every message about this run says.
  const label =
    action === 'push' && pushButtonState(getState().status, getState().origin).mode === 'publish'
      ? 'Publish'
      : titleCase(action);

  if (action === 'push' && getState().status?.noCommits) {
    showToast(
      `Nothing to ${label.toLowerCase()} yet — this branch has no commits. Commit something first.`,
      'warn',
      7000
    );
    return;
  }

  if (action === 'push' && !options.force && !(await confirmAccountForPush())) {
    return;
  }

  if (profile) {
    logToTerminal(`Using SSH profile: ${profile.label} (${profile.privateKeyPath})`, 'info');

    // Ask for whatever the key needs before starting, rather than letting git
    // fail on an identity that was never loaded. Fetch and pull go through the
    // same check as push: they authenticate with the same key, and prompting
    // for only one of the three would be arbitrary.
    if (!(await ensureKeyUsable({ reason: action }))) {
      logToTerminal(`${label} cancelled: "${profile.label}" is not unlocked.`);
      showToast(
        `${label} cancelled — "${profile.label}" is not unlocked. Use Unlock in the SSH key menu when you are ready.`,
        'warn',
        7000
      );
      return;
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
      `${label} completed${profile ? ` with key "${profile.label}"` : ''}.`,
      'success'
    );

    await refreshAll();

    // A fetch is the moment the app learns the remote moved, so it is the only
    // place this is asked. A pull cannot trigger it again, so there is no loop.
    if (action === 'fetch' && getState().autoPull && shouldAutoPull(getState().status)) {
      logToTerminal('Auto-pull: this branch is purely behind, fast-forwarding.', 'info');
      await performSync('pull');
    }
  } catch (error) {
    if (isStale(error)) {
      return;
    }

    const message = errorMessage(error, `${label} failed.`);
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

    showToast(`${label} failed: ${message}`, 'error', 9000);
  } finally {
    setButtonBusy(button, false);
    // The state that decides Push versus Publish changed while the button was
    // busy, and a busy button ignores redraws. This is the one after it.
    renderPushButton();
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
