// Showing a repository's current account setup before overwriting it.
//
// Applying a profile writes two things into `.git/config` — the SSH pin and the
// commit identity — and until now it wrote them with no idea what was already
// there. Three situations that produced:
//
//   * A repository already pinned to the other account changed silently, and
//     the only evidence was a push that went out as somebody else.
//   * A `core.sshCommand` written by hand was skipped, correctly, but with
//     nothing said — so the account did not change and nothing explained why.
//   * A local `user.email` set deliberately was replaced without being shown.
//
// None of them is worth a dialog on a repository that has nothing configured
// yet, which is most of them. The server decides whether anything would
// actually be overwritten; this only describes what is there.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { confirmDialog } from '../../ui/dialogs';
import { logToTerminal } from '../../ui/log';
import type { ClientSshProfile } from '../../../shared/config-types';
import type { RepoAccountSetup } from '../../../shared/ssh-agent-types';

/** One line per thing that is currently set, and nothing for what is not. */
export function describeSetup(setup: RepoAccountSetup): string {
  const lines: string[] = [];

  if (setup.pinOrigin === 'multi-git') {
    lines.push(`• Account: ${setup.pinProfileLabel ?? setup.pinKeyPath ?? 'unknown'}`);
  } else if (setup.pinOrigin === 'user') {
    lines.push('• Account: a custom SSH command you set by hand (Multi-Git will leave it alone)');
  } else {
    lines.push('• Account: none set — uses your default account');
  }

  if (setup.localEmail) {
    lines.push(`• Author: ${setup.localName ?? ''} <${setup.localEmail}> (set on this repository)`);
  } else if (setup.effectiveEmail) {
    lines.push(
      `• Author: ${setup.effectiveName ?? ''} <${setup.effectiveEmail}> (inherited from your global Git config)`
    );
  } else {
    lines.push('• Author: not configured');
  }

  if (setup.originOwner) {
    lines.push(`• Remote belongs to: ${setup.originOwner}`);
  }

  return lines.join('\n');
}

export interface ProfileChangeDecision {
  confirmed: boolean;
  /**
   * Whether to leave the commit identity as it is, or null when the question
   * was never put — nothing was overwritten, or there was no local identity to
   * keep.
   */
  keepIdentity: boolean | null;
}

/**
 * Asks before changing a repository that is already configured.
 *
 * Confirms the whole change rather than the authentication half of it. The
 * previous dialog asked only about the commit identity and applied the key
 * either way, so dismissing it left the repository authenticating as one
 * account and committing as another with nothing to reconcile them.
 */
export async function confirmProfileChange(
  repoPath: string,
  profile: ClientSshProfile
): Promise<ProfileChangeDecision> {
  const proceed: ProfileChangeDecision = { confirmed: true, keepIdentity: null };

  let setup: RepoAccountSetup;
  let overwrites: boolean;

  try {
    const response = await api.getRepoAccountSetup(repoPath, profile.id);
    setup = response.setup;
    overwrites = response.wouldOverwrite;
  } catch (error) {
    // Reading the current state is not worth blocking a profile switch over.
    // The switch itself still reports whatever it could not do.
    if (!isStale(error)) {
      logToTerminal(`Could not read this repository's account setup: ${errorMessage(error)}`, 'error');
    }
    return proceed;
  }

  if (!overwrites) {
    return proceed;
  }

  // A hand-written pin is the one case where confirming does not give the user
  // what they asked for, so it says so rather than implying otherwise.
  const consequence =
    setup.pinOrigin === 'user'
      ? '\n\nMulti-Git will not replace a custom SSH command. The commit identity will be updated, but this repository will keep authenticating however that command says.'
      : '';

  // Offered only when there is a deliberate local identity to keep. An
  // inherited global one is not a choice anybody made about this repository.
  const identityIsDeliberate = setup.localEmail !== null;

  const { confirmed, checked } = await confirmDialog(
    `This repository is currently set up as:\n\n${describeSetup(setup)}\n\nChange it to "${profile.label}"?${consequence}`,
    {
      title: 'Change this repository’s account?',
      confirmLabel: setup.pinOrigin === 'user' ? 'Update Identity Only' : 'Change Account',
      ...(identityIsDeliberate
        ? { checkboxLabel: `Keep the current commit identity (${setup.localEmail})` }
        : {})
    }
  );

  return { confirmed, keepIdentity: identityIsDeliberate ? checked : null };
}
