// Turning an update state into the words and controls that describe it.
//
// Pure, and separate from the wiring for the same reason features/diff and
// features/conflicts split theirs out: the mapping from phase to label is the
// part with cases worth testing, and it needs no DOM to check.

import type { UpdateState } from '../../../shared/update-types';

/** What clicking the primary button should do in this phase. */
export type PrimaryIntent = 'download' | 'install' | 'check' | 'none';

/**
 * Whether the navbar shows the icon.
 *
 * Only once there is a release to talk about: a failed or rate-limited check
 * leaves nothing for the user to act on, and an icon they cannot explain is
 * worse than no icon.
 */
export function showsIcon(state: UpdateState): boolean {
  if (!state.supported || !state.latest) {
    return false;
  }
  return (
    state.phase === 'available' ||
    state.phase === 'downloading' ||
    state.phase === 'ready' ||
    state.phase === 'installing' ||
    state.phase === 'error'
  );
}

export function iconTitle(state: UpdateState): string {
  if (state.phase === 'ready') {
    return `Version ${state.latest?.version ?? ''} is ready to install`;
  }
  if (state.phase === 'downloading') {
    return `Downloading version ${state.latest?.version ?? ''}`;
  }
  if (state.phase === 'error') {
    return 'The update did not finish';
  }
  return `Version ${state.latest?.version ?? ''} is available`;
}

/** Progress belongs on the badge only while there is progress to report. */
export function badgeText(state: UpdateState): string {
  return state.phase === 'downloading' ? `${state.percent ?? 0}%` : '';
}

export function headline(state: UpdateState): string {
  switch (state.phase) {
    case 'downloading':
      return 'Downloading update';
    case 'ready':
      return 'Update ready to install';
    case 'installing':
      return 'Installing update';
    case 'error':
      return 'Update did not finish';
    default:
      return 'Update available';
  }
}

/** What actually happens on this machine, spelled out before it happens. */
function installSentence(state: UpdateState): string {
  if (state.installKind === 'portable') {
    return 'The new version will be saved next to this one and opened. Your current file stays where it is.';
  }
  return 'It installs in the background, then Multi-Git restarts on the new version.';
}

export function bodyText(state: UpdateState): string {
  if (state.phase === 'error') {
    return state.message ?? 'Something went wrong while updating.';
  }

  const version = state.latest?.version ?? '';

  if (state.phase === 'downloading') {
    return `Getting version ${version}. It is checked against the release checksum before anything runs.`;
  }
  if (state.phase === 'ready') {
    return state.installKind === 'portable'
      ? `Version ${version} is downloaded and verified. Opening it will close this window.`
      : `Version ${version} is downloaded and verified. Installing will close Multi-Git and reopen it.`;
  }
  if (state.phase === 'installing') {
    return 'Starting the installer…';
  }

  return `Version ${version} is available. You are on ${state.currentVersion}. ${installSentence(state)}`;
}

export function primaryLabel(state: UpdateState): string {
  switch (state.phase) {
    case 'downloading':
      return `Downloading… ${state.percent ?? 0}%`;
    case 'ready':
      return state.installKind === 'portable' ? 'Open new version' : 'Restart & install';
    case 'installing':
      return 'Starting…';
    case 'error':
      return 'Try again';
    default:
      return 'Download & install';
  }
}

export function primaryIntent(state: UpdateState): PrimaryIntent {
  switch (state.phase) {
    case 'available':
      return 'download';
    case 'ready':
      return 'install';
    // A failure can come from either step, and the check is the cheap one that
    // re-resolves the release before any of it is attempted again.
    case 'error':
      return 'check';
    default:
      return 'none';
  }
}

export function primaryDisabled(state: UpdateState): boolean {
  return state.phase === 'downloading' || state.phase === 'installing';
}

/** Skipping only makes sense before the work has started. */
export function showsSkip(state: UpdateState): boolean {
  return state.phase === 'available';
}
