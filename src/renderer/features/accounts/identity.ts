// Account identity: the commit author that goes with an SSH profile.
//
// Authentication and authorship are separate in Git and stay separate here.
// The SSH key decides which remote account is used; user.name and user.email
// decide what is written into a commit. A profile can carry both, and this is
// where the second half is applied and checked.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { getState, ruleProfileFor, update } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import type { ClientSshProfile } from '../../../shared/config-types';

export interface Identity {
  name: string;
  email: string;
}

/** The identity a profile implies, or null when it carries no email. */
export function profileIdentity(profile: ClientSshProfile | null): Identity | null {
  if (!profile?.userEmail) {
    return null;
  }

  // The label is a reasonable author name when none was given explicitly.
  return { name: profile.userName || profile.label, email: profile.userEmail };
}

export async function refreshIdentity(): Promise<void> {
  if (!getState().activeRepo) {
    update({ identity: null });
    return;
  }

  try {
    update({ identity: await api.getIdentity() });
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Failed to read git identity: ${errorMessage(error)}`, 'error');
    }
  }
}

/** Writes the profile's identity into the repository's local git config. */
export async function applyProfileIdentity(
  profile: ClientSshProfile | null,
  options: { silent?: boolean } = {}
): Promise<boolean> {
  const identity = profileIdentity(profile);
  if (!identity || !getState().activeRepo) {
    return false;
  }

  try {
    await api.setIdentity(identity.name, identity.email);

    if (!options.silent) {
      showToast(`Commit identity set to ${identity.name} <${identity.email}>.`, 'success');
    }
    logToTerminal(
      `git config user.name "${identity.name}" && git config user.email "${identity.email}"`,
      'cmd'
    );

    await refreshIdentity();
    return true;
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Failed to apply account identity.'), 'error');
      logToTerminal(`Failed to apply account identity: ${errorMessage(error)}`, 'error');
    }
    return false;
  }
}

/**
 * After a manual account switch, offers to align the repository's author.
 *
 * Only asks when the two actually differ, so switching between profiles that
 * share an identity is silent.
 */
export async function maybeOfferIdentity(profile: ClientSshProfile | null): Promise<void> {
  const identity = profileIdentity(profile);
  const { activeRepo, identity: current } = getState();

  if (!identity || !activeRepo) {
    return;
  }
  if (current && current.email === identity.email && current.name === identity.name) {
    return;
  }

  const { confirmed } = await confirmDialog(
    `Also set this repository's commit identity to ${identity.name} <${identity.email}>?`,
    { title: 'Apply account identity', confirmLabel: 'Set Identity' }
  );

  if (confirmed) {
    await applyProfileIdentity(profile);
  }
}

export type AccountMismatch =
  | { type: 'identity'; profile: ClientSshProfile | null; expected: Identity; actual: Identity }
  | { type: 'account'; profile: ClientSshProfile | null; ruleProfile: ClientSshProfile };

/**
 * Detects committing or pushing with the wrong authorship for the active
 * account, or with an account that contradicts an auto-select rule.
 *
 * Returns null when everything lines up. This is a warning, never a block:
 * the user may genuinely mean it.
 */
export function getAccountMismatch(): AccountMismatch | null {
  const state = getState();
  const profile = state.activeProfileId
    ? (state.sshProfiles.find((p) => p.id === state.activeProfileId) ?? null)
    : null;

  const expected = profileIdentity(profile);
  const current = state.identity;

  if (expected && current?.email && current.email !== expected.email) {
    return {
      type: 'identity',
      profile,
      expected,
      actual: { name: current.name, email: current.email }
    };
  }

  const ruleProfile = ruleProfileFor(state.origin?.remoteUrl ?? null);
  if (ruleProfile && ruleProfile.id !== state.activeProfileId) {
    return { type: 'account', profile, ruleProfile };
  }

  return null;
}

/**
 * Asks the user to confirm when an account or identity mismatch is detected.
 * Returns true when the operation should go ahead.
 */
export async function confirmDespiteMismatch(operation: string): Promise<boolean> {
  const mismatch = getAccountMismatch();
  if (!mismatch) {
    return true;
  }

  const message =
    mismatch.type === 'identity'
      ? `This repository commits as ${mismatch.actual.name} <${mismatch.actual.email}>, but the selected account is ${mismatch.expected.name} <${mismatch.expected.email}>.`
      : `An auto-select rule maps this remote to "${mismatch.ruleProfile.label}", but "${mismatch.profile?.label ?? 'System SSH'}" is selected.`;

  const { confirmed } = await confirmDialog(message, {
    title: `${operation} anyway?`,
    confirmLabel: `${operation} anyway`
  });

  return confirmed;
}
