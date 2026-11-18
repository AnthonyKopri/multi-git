// What the New Repository dialog's account picker starts on, and what it says
// about the choice. Pure, so it can be tested without a page.
import type { ClientSshProfile } from '../../../shared/config-types';

/**
 * The account a new repository starts with.
 *
 * The default account comes first, because that is exactly what it is for:
 * the account new folders should use. Then whichever account this window is
 * using, which is usually the account the user is working as right now. Then
 * System SSH. A remembered id that no longer names a profile is skipped.
 */
export function initialAccountChoice(
  profiles: readonly ClientSshProfile[],
  defaultAccountProfileId: string,
  activeProfileId: string
): string {
  for (const id of [defaultAccountProfileId, activeProfileId]) {
    if (id && profiles.some((profile) => profile.id === id)) {
      return id;
    }
  }
  return '';
}

/** One sentence under the picker: what this choice will do. */
export function describeAccountChoice(profile: ClientSshProfile | null): string {
  if (!profile) {
    return 'Uses whatever SSH key and Git identity this computer already has set up.';
  }

  const author = profile.userEmail
    ? `Commits are made as ${profile.userName || profile.label} <${profile.userEmail}>`
    : 'Commits use your global Git name and email, since this account has none of its own';

  return `${author}, and pushes use the "${profile.label}" key.`;
}
