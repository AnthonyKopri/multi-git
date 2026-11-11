// Auto-pull that pulls: a quiet fetch in the background while it is switched on.
//
// The setting used to do nothing until Fetch was pressed, because a fetch was
// the only thing that ever asked "is this branch behind?". Someone who turned
// auto-pull on and then waited saw nothing happen, correctly concluded it was
// broken, and went back to pressing Pull.
//
// So while auto-pull is on, the open repository is fetched without being asked:
// shortly after it opens, when the window comes back into view, and every few
// minutes while it stays there. The pull decision itself is unchanged and still
// made by the server under the repository lock; this only supplies the fetch.
//
// Two rules keep it from being a nuisance:
//
//   * It never asks for anything. A key that would need a passphrase typed
//     means no background fetch, not a dialog nobody was expecting; the server
//     is told the fetch is quiet, so a credential helper stays silent too.
//   * It says what it did. A pull that happened on its own is announced, and so
//     is one that is being held back, once, with the reason.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { getState, subscribeTo } from '../../state/store';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { activeProfile } from '../accounts';
import { agentState } from '../accounts/agent';
import { INTERVAL_MS, MIN_GAP_MS, quietFetchBlocker } from './quiet-fetch';
import type { QuietFetchInput } from './quiet-fetch';

/** How long after a repository opens before its first background fetch. */
const OPEN_DELAY_MS = 4000;
/** How often the clock is looked at. */
const TICK_MS = 30_000;

let refreshAll: () => Promise<void> = async () => {};
let isSyncing: () => boolean = () => false;

const lastFetchAt = new Map<string, number>();
let running = false;
/** The last "holding back" notice shown, so the same one is not repeated. */
let lastNotice = '';
let openTimer: number | null = null;

export function initBackgroundFetch(hooks: {
  refreshAll: () => Promise<void>;
  isSyncing: () => boolean;
}): void {
  refreshAll = hooks.refreshAll;
  isSyncing = hooks.isSyncing;

  // A repository being opened, or the switch being turned on, is when someone
  // most expects it to act. A short pause first lets the status arrive.
  subscribeTo(['activeRepo', 'autoPull'], () => {
    if (openTimer !== null) {
      window.clearTimeout(openTimer);
    }
    openTimer = window.setTimeout(() => void quietFetch(0), OPEN_DELAY_MS);
  });

  window.addEventListener('focus', () => void quietFetch(MIN_GAP_MS));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void quietFetch(MIN_GAP_MS);
    }
  });
  window.setInterval(() => void quietFetch(INTERVAL_MS), TICK_MS);
}

function profileReadiness(): QuietFetchInput['profile'] {
  const profile = activeProfile();
  if (!profile) {
    return { selected: false, usableWithoutPrompt: true };
  }

  const agent = agentState();
  const inAgent = agent?.availability === 'ready' && agent.selectedKeyLoaded;
  const inVault = Boolean(profile.hasSavedPassword) && getState().vaultStatus.unlocked;

  return { selected: true, usableWithoutPrompt: inAgent || inVault };
}

async function quietFetch(minGap: number): Promise<void> {
  const { activeRepo, autoPull, status } = getState();
  const repo = activeRepo ?? '';

  if (
    running ||
    quietFetchBlocker({
      autoPull,
      activeRepo,
      status,
      visible: document.visibilityState === 'visible',
      syncing: isSyncing(),
      profile: profileReadiness(),
      sinceLast: Date.now() - (lastFetchAt.get(repo) ?? 0),
      minGap
    }) !== null
  ) {
    return;
  }

  running = true;
  lastFetchAt.set(repo, Date.now());

  try {
    const profile = activeProfile();
    const data = await api.fetchRemote({
      ...(profile ? { profileId: profile.id, sshKeyPath: profile.privateKeyPath } : {}),
      quiet: true
    });

    if (data.autoPull?.state === 'pulled') {
      lastNotice = '';
      logToTerminal(`Auto-pull: fast-forwarded to ${data.autoPull.target}.`, 'success');
      showToast(`Auto-pull brought in the latest commits from ${data.autoPull.target}.`, 'success', 6000);
      await refreshAll();
      return;
    }

    if (data.autoPull?.state === 'blocked') {
      // The new commits are fetched either way, so the counts on screen should
      // say so even though nothing was pulled.
      await refreshAll();

      const notice = `${repo}\n${data.autoPull.reason}`;
      if (notice !== lastNotice) {
        lastNotice = notice;
        logToTerminal(`Auto-pull is holding back: ${data.autoPull.reason}`, 'info');
        showToast(
          `New commits are waiting, but auto-pull is holding back. ${data.autoPull.reason} Press Pull when you are ready.`,
          'info',
          9000
        );
      }
      return;
    }

    lastNotice = '';
    // A fetch reports what it updated on stderr. Nothing there, nothing new.
    if ((data.stderr ?? '').trim() !== '') {
      await refreshAll();
    }
  } catch (error) {
    if (!isStale(error)) {
      // Offline, or the remote is gone. Worth a line in the log, not a toast:
      // nobody pressed anything.
      logToTerminal(`Background fetch skipped: ${errorMessage(error, 'the remote could not be reached.')}`, 'info');
    }
  } finally {
    running = false;
  }
}
