// The terminal edition keeping up with the desktop app.
//
// The desktop build carries a copy of the terminal edition. Once the user has
// enabled it, every desktop update brings a newer copy along, and until now
// that copy sat unused until someone pressed "Update" in Settings or ran
// `multi-git update`. So after the app starts, the installed copy is brought up
// to the bundled one, the same way the Settings button does it.
//
// Only an installation the user already chose is touched. Nothing is
// installed for someone who never enabled it or chose to skip it, a damaged
// installation is left for Repair (which says what is wrong), and a newer
// installed copy is never replaced by an older bundled one: activatePayload
// refuses that on its own as well. A terminal session that is running keeps
// the version it started with, since each version has its own folder.
import type { TerminalInstallationStatus } from '../../shared/terminal-types';

export type FollowDecision =
  | { follow: true; from: string; to: string }
  | { follow: false; reason: 'turned-off' | 'not-installed' | 'unavailable' | 'damaged' | 'up-to-date' };

/** Whether the installed terminal edition should be brought up to the bundled one. */
export function followDecision(status: TerminalInstallationStatus, enabled: boolean): FollowDecision {
  if (!enabled) {
    return { follow: false, reason: 'turned-off' };
  }
  if (status.bundledVersion === null) {
    return { follow: false, reason: 'unavailable' };
  }
  if (status.installedVersion === null) {
    return { follow: false, reason: 'not-installed' };
  }
  if (status.state === 'damaged') {
    return { follow: false, reason: 'damaged' };
  }
  if (!status.canUpgrade) {
    return { follow: false, reason: 'up-to-date' };
  }
  return { follow: true, from: status.installedVersion, to: status.bundledVersion };
}
