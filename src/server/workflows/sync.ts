// The fetch workflow: a fetch, then the auto-pull decision, in one place.
//
// The decision used to be made in the renderer, after the fetch returned. With
// the desktop, the terminal UI and agents sharing one backend, that meant
// whichever client pressed Fetch decided, and two clients could each decide to
// pull. Here it is made once, under the repository lock, against the status
// read after the fetch, so nothing can change between the check and the pull.
import { readStatus } from '../git/read-status';
import { withRepoLock } from '../git/lock';
import { readConfig } from '../config/store';
import { runSyncOperationWithProfile } from '../ssh/profiles';
import type { SyncOutcome } from '../ssh/profiles';
import { ensureAgentForRepo } from '../ssh/agent-session';
import { shouldAutoPull, autoPullBlockedReason } from '../../shared/auto-pull';
import type { AutoPullOutcome } from '../../shared/api-types';
import { operations } from '../operations/registry';

export interface FetchWorkflowResult extends SyncOutcome {
  autoPull: AutoPullOutcome;
}

export interface FetchWorkflowOptions {
  /**
   * Set for a fetch nobody pressed a button for.
   *
   * Such a fetch must never put a window on screen, so the credential helper is
   * told not to ask: with nothing saved it fails, quietly, where a fetch the
   * user started would be right to open a sign-in.
   */
  quiet?: boolean;
}

/** Git options that stop a credential helper from prompting. */
export const QUIET_FETCH_OPTIONS: readonly string[] = ['-c', 'credential.interactive=never'];

export async function fetchWithAutoPull(
  repoPath: string,
  profileId?: string,
  sshKeyPath?: string,
  options: FetchWorkflowOptions = {}
): Promise<FetchWorkflowResult> {
  const operation = operations.begin({ kind: 'git.fetch', repoPath, message: 'Fetching origin' });
  operation.start();

  try {
    const result = await withRepoLock(repoPath, async (): Promise<FetchWorkflowResult> => {
      await ensureAgentForRepo(repoPath, profileId);
      // --prune drops remote-tracking refs whose branches were deleted upstream.
      const fetched = await runSyncOperationWithProfile(
        repoPath,
        [...(options.quiet ? QUIET_FETCH_OPTIONS : []), 'fetch', '--prune', 'origin'],
        profileId,
        sshKeyPath,
        { signal: operation.signal }
      );

      if (readConfig().settings?.autoPull !== true) {
        return { ...fetched, autoPull: { state: 'off' } };
      }

      const status = await readStatus(repoPath);
      if (status.behind <= 0) {
        return { ...fetched, autoPull: { state: 'current' } };
      }
      if (!shouldAutoPull(status)) {
        return {
          ...fetched,
          autoPull: { state: 'blocked', reason: autoPullBlockedReason(status) ?? '' }
        };
      }

      operation.update({ message: `Fast-forwarding to ${status.tracking}` });

      // The upstream that was just fetched, and only ever a fast-forward: a
      // plain `git pull` could merge or rebase depending on configuration.
      const pulled = await runSyncOperationWithProfile(
        repoPath,
        ['merge', '--ff-only', status.tracking],
        profileId,
        sshKeyPath,
        { signal: operation.signal }
      );

      return {
        ...fetched,
        autoPull: { state: 'pulled', target: status.tracking, stdout: pulled.stdout, stderr: pulled.stderr }
      };
    });

    operation.succeed();
    return result;
  } catch (error) {
    operation.fail(
      operation.cancelled
        ? 'Cancelled. Remote-tracking refs may already have been updated.'
        : error instanceof Error
          ? error.message
          : 'Failed'
    );
    throw error;
  }
}
