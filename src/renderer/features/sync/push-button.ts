// What the Push button should say right now.
//
// The first push of a branch is not the same action as the ones after it: it
// creates the branch on the remote and sets the upstream, which is why git
// needs `-u` for it and nothing after. Calling both "Push" hid that, and hid
// the far more common confusion behind it — a freshly created repository looks
// identical to a synced one until the push fails.
//
// Pure on purpose: the rule is worth testing without a DOM.
import type { OriginResponse, StatusResponse } from '../../../shared/api-types';

export type PushMode = 'push' | 'publish';

export interface PushButtonState {
  mode: PushMode;
  /** Empty in push mode, which stays the icon-only button it has always been. */
  label: string;
  icon: string;
  title: string;
  ariaLabel: string;
  disabled: boolean;
}

const PUSH: PushButtonState = {
  mode: 'push',
  label: '',
  icon: 'upload',
  title: 'Push',
  ariaLabel: 'Push',
  disabled: false
};

/**
 * Publish is offered only when all three hold: there is an origin to publish
 * to, the branch has no upstream yet, and HEAD is on a branch at all. A
 * detached HEAD has nothing to set an upstream for, and a repository with no
 * remote is not publishing anywhere.
 */
export function pushButtonState(
  status: StatusResponse | null,
  origin: OriginResponse | null
): PushButtonState {
  if (!status || !origin?.remoteUrl || status.detached || status.tracking !== '') {
    return PUSH;
  }

  // A branch with no commits has no refspec to push, so git would reject it.
  // Saying so on the button beats saying it in a failed operation.
  if (status.noCommits) {
    return {
      mode: 'publish',
      label: 'Publish',
      icon: 'cloud_upload',
      title: `Make the first commit before publishing ${status.branch} to origin`,
      ariaLabel: `Publish ${status.branch}`,
      disabled: true
    };
  }

  return {
    mode: 'publish',
    label: 'Publish',
    icon: 'cloud_upload',
    title: `Publish ${status.branch} to origin — it has no upstream branch yet`,
    ariaLabel: `Publish ${status.branch}`,
    disabled: false
  };
}
