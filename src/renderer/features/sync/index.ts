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
import { unlockSelectedKey } from '../accounts/unlock';
import { refreshOrigin } from '../repo';
import { pushButtonState } from './push-button';
import { autoPullBlockedReason, shouldAutoPull } from './auto-pull';
import type { SyncResponse } from '../../../shared/api-types';
import { describePullStrategy } from '../../../shared/pull-strategy';

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

/**
 * Repositories whose account the host has already confirmed this session.
 *
 * Only agreement is cached. A mismatch has to keep asking, because the whole
 * failure mode is that nothing else in the app can tell the difference.
 */
const verifiedAccounts = new Set<string>();

/**
 * Asks the host who this key authenticates as, and blocks a push that would go
 * out as the wrong account.
 *
 * The check the local configuration cannot do for itself: a pin can name
 * exactly the right key and still authenticate as another account, because the
 * managed block names a key for the same host and the agent decides which is
 * offered first. GitHub then answers `ERROR: Repository not found.`, which
 * sends people looking for a repository that was never missing.
 */
async function confirmVerifiedAccount(): Promise<boolean> {
  const { activeRepo, activeProfileId } = getState();

  // Nothing pinned means nothing to check against: the identity is whatever
  // the machine already does, which is the user's own arrangement.
  if (!activeRepo || !activeProfileId) {
    return true;
  }

  const cacheKey = `${activeRepo}::${activeProfileId}`;
  if (verifiedAccounts.has(cacheKey)) {
    return true;
  }

  let check;
  try {
    ({ check } = await api.verifySshAccount(activeProfileId, activeRepo));
  } catch (error) {
    // A push must not be blocked because the check itself could not run.
    if (!isStale(error)) {
      logToTerminal(`Could not verify which account this key uses: ${errorMessage(error)}`, 'error');
    }
    return true;
  }

  if (!check.mismatch) {
    if (check.ok) {
      verifiedAccounts.add(cacheKey);
      logToTerminal(check.message, 'success');
    }
    return true;
  }

  logToTerminal(check.message, 'error');

  const { confirmed } = await confirmDialog(
    `${check.message}\n\nPushing now would appear to come from ${check.account}. Push anyway?`,
    { title: 'Wrong account', confirmLabel: 'Push Anyway', danger: true }
  );

  return confirmed;
}

/** Forgets a cached result, so the next push re-asks the host. */
export function forgetVerifiedAccounts(): void {
  verifiedAccounts.clear();
}

/**
 * Confirms a pull whose outcome is not obvious.
 *
 * Only when it is not obvious: a fast-forward is the safest thing git does and
 * asking about it every time would train people to click through the dialog
 * that matters. What matters is the diverged case, where `pull.rebase` and
 * `pull.ff` decide between a merge commit, a replay of your commits, and a flat
 * refusal -- configuration this application never read and never showed, so
 * pressing Pull could do any of three things to your history without saying
 * which.
 */
async function confirmPullStrategy(): Promise<boolean> {
  const { status } = getState();
  const target = status?.tracking;

  // Nothing tracked means nothing to reason about; the server will report what
  // it finds.
  if (!target || !status) {
    return true;
  }

  let preflight;
  try {
    preflight = (await api.integrationPreflight('pull', target)).preflight;
  } catch (error) {
    if (isStale(error)) {
      return false;
    }
    // Not knowing is not a reason to block a pull the user asked for.
    return true;
  }

  const strategy = preflight.strategy;

  // The two outcomes where nothing of yours can be disturbed.
  if (strategy === undefined || strategy === 'fast-forward' || strategy === 'up-to-date') {
    return true;
  }

  if (strategy === 'ff-only-blocked') {
    // git will refuse. Better said now than reported afterwards as a failure.
    showToast(describePullStrategy(strategy, preflight.incoming.length, preflight.outgoing.length), 'warn', 9000);
    return false;
  }

  const lines = [
    describePullStrategy(strategy, preflight.incoming.length, preflight.outgoing.length)
  ];

  if (preflight.incoming.length > 0) {
    lines.push(
      preflight.incoming
        .slice(0, 5)
        .map((commit) => `  • ${commit.subject}`)
        .join('\n') +
        (preflight.incoming.length > 5 ? `\n  • …and ${preflight.incoming.length - 5} more` : '')
    );
  }

  if (preflight.recoveryPoint) {
    lines.push('A recovery point is recorded first, so this can be undone from Safety Net.');
  }

  lines.push(...preflight.warnings.map((warning) => `Note: ${warning}`));

  const { confirmed } = await confirmDialog(lines.join('\n\n'), {
    title: strategy === 'rebase' ? 'Pull will rebase your commits' : 'Pull will create a merge commit',
    confirmLabel: 'Pull',
    danger: strategy === 'rebase'
  });

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

/**
 * What git said, where the user is looking.
 *
 * The outcome used to be a toast reading "Push completed" while git's own
 * summary -- what moved, and by how much -- went to a log window you had to
 * know to open. That summary is the informative half, and it belongs in front
 * of the person who pressed the button.
 */
function syncSummary(action: SyncAction, data: SyncResponse): string {
  // git reports a push on stderr and a pull on stdout, so both are candidates.
  const reported = `${data.stderr ?? ''}\n${data.stdout ?? ''}`;

  const interesting = reported
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== '' &&
        // Progress counters and the remote's own chatter are noise here. The
        // Terminal panel has all of it for anyone who wants the detail.
        !/^(remote:|Receiving|Resolving|Counting|Compressing|Writing|Enumerating|Total|delta)/i.test(
          line
        )
    );

  // The lines git uses to say what actually changed.
  const summary = interesting.find((line) =>
    /Already up to date|Fast-forward|files? changed|->|new branch/i.test(line)
  );

  return summary ?? `${titleCase(action)} completed.`;
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

  // Deliberately not skipped for a force push. A force push as the wrong
  // account is the worst version of this mistake, not one to wave through.
  if (action === 'push' && !(await confirmVerifiedAccount())) {
    return;
  }

  // Only where the outcome is not obvious. A fast-forward is the safest thing
  // git does, and asking about it every time would train people to click
  // through the dialog that matters.
  if (action === 'pull' && !(await confirmPullStrategy())) {
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
      // The remedy is offered rather than described. Naming a menu the user
      // then has to go and find is work the application can do for them, and
      // the button leads straight back to the operation they pressed.
      showToast(
        `${label} cancelled — "${profile.label}" is not unlocked.`,
        'warn',
        9000,
        {
          label: 'Unlock',
          run: () => {
            // Only retried once the key is actually usable. Going straight back
            // into the sync after a failed unlock would put the same prompt in
            // front of the user again, which reads as the button not working.
            void unlockSelectedKey().then(
              (unlocked) => (unlocked ? performSync(action, options) : undefined)
            );
          }
        }
      );
      return;
    }
  } else {
    logToTerminal('Using system default SSH configuration', 'info');
  }

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
    // git's own words rather than a generic acknowledgement: "Fast-forward" and
    // "3 files changed" are what the user actually wanted to know.
    showToast(syncSummary(action, data), 'success', 6000);

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
