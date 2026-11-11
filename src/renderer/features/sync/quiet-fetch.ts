// When a fetch nobody asked for is allowed to happen.
//
// Kept apart from background.ts so the rule can be read, and tested, without
// the timers and network calls that act on it.
import type { StatusResponse } from '../../../shared/api-types';

/** The least time between two background fetches of one repository. */
export const MIN_GAP_MS = 2 * 60_000;
/** How often an open, visible repository is fetched. */
export const INTERVAL_MS = 5 * 60_000;

export interface QuietFetchInput {
  autoPull: boolean;
  activeRepo: string | null;
  status: Pick<StatusResponse, 'tracking'> | null;
  visible: boolean;
  /** A fetch, pull or push the user started is still running. */
  syncing: boolean;
  /** Whether a profile is selected, and if so whether its key needs no typing. */
  profile: { selected: boolean; usableWithoutPrompt: boolean };
  /** Milliseconds since this repository was last fetched in the background. */
  sinceLast: number;
  /** The gap this trigger requires. */
  minGap: number;
}

/**
 * Why a background fetch should not happen right now, or null when it should.
 *
 * Pure, because every one of these is a way for an unrequested network call to
 * surprise someone, and the list is worth being able to test line by line.
 */
export function quietFetchBlocker(input: QuietFetchInput): string | null {
  if (!input.autoPull) {
    return 'off';
  }
  if (!input.activeRepo) {
    return 'no-repo';
  }
  // Nothing to compare against, so a fetch could never lead to a pull.
  if (!input.status || input.status.tracking === '') {
    return 'no-upstream';
  }
  if (!input.visible) {
    return 'hidden';
  }
  if (input.syncing) {
    return 'busy';
  }
  if (input.profile.selected && !input.profile.usableWithoutPrompt) {
    return 'locked';
  }
  if (input.sinceLast < input.minGap) {
    return 'recent';
  }
  return null;
}
