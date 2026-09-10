// Which account this repository should be using, and which one it really is.
//
// The two are different questions and only the first was ever answerable from
// the app. A profile called "familiara" selected on a repository owned by
// akopri-familiara looks correct from every angle, and can still authenticate
// as the other account — because ~/.ssh/config names a key for the same host
// and the agent decides which is offered first. So:
//
//   Should use  akopri-familiara   <- the remote says so
//   Using       familiara -> AnthonyKopri   <- the host says so
//
// "Should use" is derived from the remote's owner, because that is already
// stated in every repository and cannot go stale. It is overridable for the
// case where the owner is not an account anybody signs in as: an organisation
// repository, or a fork.
//
// "Using" is the account the host greeted, remembered per profile after the
// first check, so the comparison costs nothing on every later repository.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { getState } from '../../state/store';
import { promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import type { RepoAccountSetup } from '../../../shared/ssh-agent-types';

let ui: Elements;

/** The last setup read for the open repository. Cheap: local git reads only. */
let setup: RepoAccountSetup | null = null;

export function initRepoAccount(elements: Elements): void {
  ui = elements;
}

/** Re-reads the repository's account setup and redraws. Never throws. */
export async function refreshRepoAccount(): Promise<void> {
  const { activeRepo, activeProfileId } = getState();

  if (!activeRepo) {
    setup = null;
    renderRepoAccount();
    return;
  }

  try {
    setup = (await api.getRepoAccountSetup(activeRepo, activeProfileId)).setup;
  } catch (error) {
    if (!isStale(error)) {
      setup = null;
    }
  }

  renderRepoAccount();
}

/**
 * Redraws from what is already known.
 *
 * Deliberately no network: the account a key authenticates as was remembered
 * the first time it was checked, so the warning is instant and works offline.
 */
export function renderRepoAccount(): void {
  if (!ui) {
    return;
  }

  const { activeRepo, activeProfileId, sshProfiles } = getState();
  const profile = activeProfileId
    ? (sshProfiles.find((entry) => entry.id === activeProfileId) ?? null)
    : null;

  setHidden(ui.repoAccountBlock, !activeRepo || setup === null);
  if (!activeRepo || setup === null) {
    return;
  }

  const intended = setup.intendedAccount;
  ui.repoIntendedAccount.textContent = intended ?? 'unknown';
  ui.repoIntendedAccount.title = setup.intendedIsOverride
    ? 'You set this. Clear it to go back to using the remote’s owner.'
    : setup.originRemoteUrl
      ? `From the remote: ${setup.originRemoteUrl}`
      : 'This repository has no remote to derive it from.';

  const verified = profile?.verifiedAccount ?? null;
  ui.repoUsingAccount.textContent = profile
    ? verified
      ? `${profile.label} → ${verified}`
      : `${profile.label} → not checked yet`
    : 'default account';

  // The note carries the whole message, so nothing depends on colour alone.
  const mismatch =
    intended !== null && verified !== null && verified.toLowerCase() !== intended.toLowerCase();

  ui.repoUsingAccount.classList.toggle('repo-account-bad', mismatch);
  ui.repoUsingAccount.classList.toggle('repo-account-good', Boolean(verified) && !mismatch);

  if (mismatch) {
    ui.repoAccountNote.textContent = `This key authenticates as ${verified}, but this repository belongs to ${intended}. Pushing would come from the wrong account.`;
    setHidden(ui.repoAccountNote, false);
  } else {
    setHidden(ui.repoAccountNote, true);
  }
}

/** Lets the user say which account owns this repository, or go back to derived. */
export async function changeIntendedAccount(): Promise<void> {
  const { activeRepo } = getState();
  if (!activeRepo || setup === null) {
    return;
  }

  // The current value goes in the label rather than prefilled, because the
  // prompt has no way to seed a field and an empty box is what clears the
  // override anyway.
  const current = setup.intendedIsOverride ? ` (currently ${setup.intendedAccount})` : '';

  const answer = await promptDialog({
    title: 'Which account owns this repository?',
    label: `Account name${current} — leave empty to use the remote’s owner`
  });

  if (answer === null) {
    return;
  }

  try {
    await api.setIntendedAccount(activeRepo, answer.trim());
    await refreshRepoAccount();

    showToast(
      answer.trim() === ''
        ? 'Back to using the remote’s owner.'
        : `This repository belongs to ${answer.trim()}.`,
      'success'
    );
  } catch (error) {
    showToast(errorMessage(error, 'Could not save that.'), 'error');
  }
}

/** Asks the host who the selected key authenticates as, and remembers it. */
export async function checkAccountNow(): Promise<void> {
  const { activeRepo, activeProfileId } = getState();

  if (!activeRepo || !activeProfileId) {
    showToast('Select an account first.', 'warn');
    return;
  }

  try {
    const { check, config } = await api.verifySshAccount(activeProfileId, activeRepo);

    // The response carries the profile's newly-remembered account, so the block
    // can redraw from state without another round trip.
    const { applyConfigSnapshot } = await import('./index');
    applyConfigSnapshot(config);
    await refreshRepoAccount();

    logToTerminal(check.message, check.mismatch || !check.ok ? 'error' : 'success');
    showToast(check.message, check.mismatch || !check.ok ? 'error' : 'success', 7000);
  } catch (error) {
    showToast(errorMessage(error, 'Could not check the account.'), 'error');
  }
}
