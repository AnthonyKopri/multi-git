// The History panel: the commit graph and the commit detail drawer.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { asSelect } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { el, fragment, icon, setHidden } from '../../dom/create';
import { getState, update } from '../../state/store';
import { statusLabel } from '../../ui/format';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { createLayoutState, layoutCommits, type GraphLayoutState } from './graph-layout';
import { appendRows, buildEmptyState, buildLoadMoreSentinel } from './graph-render';
import { loadCommitFileDiff } from '../diff';
import type { CommitDetails } from '../../../shared/git-types';

/** Commits fetched per page. */
export const GRAPH_PAGE_SIZE = 200;

let ui: Elements;
let refreshAll: () => Promise<void> = async () => {};
let switchToDiffTab: () => void = () => {};

/** Lane state carried across pages, so a new page continues the graph. */
let layout: GraphLayoutState = createLayoutState();
let sentinel: HTMLElement | null = null;
let observer: IntersectionObserver | null = null;
let drawerCommit: CommitDetails | null = null;

export function initHistory(
  elements: Elements,
  hooks: { refreshAll: () => Promise<void>; showDiffTab: () => void }
): void {
  ui = elements;
  refreshAll = hooks.refreshAll;
  switchToDiffTab = hooks.showDiffTab;
}

function detachSentinel(): void {
  observer?.disconnect();
  observer = null;
  sentinel?.remove();
  sentinel = null;
}

/**
 * Watches a sentinel at the end of the list instead of listening to scroll.
 * A scroll handler ran on every event and measured scrollHeight each time,
 * forcing layout; the observer fires only when the end actually comes near.
 */
function attachSentinel(): void {
  detachSentinel();

  if (!getState().hasMoreCommits) {
    return;
  }

  sentinel = buildLoadMoreSentinel();
  ui.commitHistoryList.appendChild(sentinel);

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMoreCommits();
      }
    },
    { root: ui.commitHistoryList, rootMargin: '200px' }
  );
  observer.observe(sentinel);
}

/** Loads the first page, replacing whatever was there. */
export async function refreshCommitHistory(): Promise<void> {
  detachSentinel();
  layout = createLayoutState();

  try {
    const data = await api.getLog(GRAPH_PAGE_SIZE, 0, true);

    update({
      commits: data.commits,
      commitHashes: new Set(data.commits.map((commit) => commit.hash)),
      hasMoreCommits: data.hasMore
    });

    ui.commitHistoryList.replaceChildren();

    if (data.commits.length === 0) {
      ui.commitHistoryList.appendChild(buildEmptyState());
      return;
    }

    const rows = layoutCommits(data.commits, layout);
    appendRows(ui.commitHistoryList, rows, layout.maxLanes);
    attachSentinel();
  } catch (error) {
    if (!isStale(error)) {
      update({ commits: [], commitHashes: new Set(), hasMoreCommits: false });
      ui.commitHistoryList.replaceChildren(buildEmptyState());
    }
  }
}

/** Appends the next page. Only the new commits are laid out and built. */
export async function loadMoreCommits(): Promise<void> {
  const state = getState();
  if (state.loadingCommits || !state.hasMoreCommits || !state.activeRepo) {
    return;
  }

  update({ loadingCommits: true });

  try {
    const data = await api.getLog(GRAPH_PAGE_SIZE, state.commits.length, true);

    // A concurrent refresh can overlap a page, so drop anything already shown.
    const hashes = getState().commitHashes;
    const fresh = data.commits.filter((commit) => !hashes.has(commit.hash));
    for (const commit of fresh) {
      hashes.add(commit.hash);
    }

    update({
      commits: [...getState().commits, ...fresh],
      commitHashes: hashes,
      hasMoreCommits: data.hasMore
    });

    detachSentinel();
    if (fresh.length > 0) {
      appendRows(ui.commitHistoryList, layoutCommits(fresh, layout), layout.maxLanes);
    }
    attachSentinel();
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Failed to load more commits: ${errorMessage(error)}`, 'error');
    }
  } finally {
    update({ loadingCommits: false });
  }
}

// ---------- commit detail drawer ----------

export function closeCommitDrawer(): void {
  drawerCommit = null;
  setHidden(ui.commitDetailsDrawer, true);
}

export async function showCommitDetails(commitHash: string): Promise<void> {
  // Blame reports uncommitted lines as an all-zero hash; there is nothing to
  // show for those.
  if (!commitHash || commitHash.startsWith('00000000') || commitHash === 'unknown') {
    return;
  }

  logToTerminal(`Fetching details for commit: ${commitHash.substring(0, 8)}...`);

  try {
    const data = await api.getCommitDetails(commitHash);
    drawerCommit = data.commit;

    ui.drawerHash.textContent = data.commit.hash.substring(0, 8);
    ui.drawerHash.title = data.commit.hash;
    ui.drawerMsg.textContent = data.commit.message;
    ui.drawerAuthor.textContent = data.commit.author;
    ui.drawerDate.textContent = data.commit.date;
    ui.drawerFilesHeading.textContent = 'Files Changed';

    ui.drawerFilesList.replaceChildren(
      fragment(
        data.files.map((file) => {
          const status = statusLabel(file.status);

          const actions = el('span', {
            children: [
              el('button', {
                className: 'btn btn-icon btn-sm file-history-btn',
                title: `Show commit history of ${file.path}`,
                data: { action: 'file-history', path: file.path },
                children: [icon('history', 14)]
              }),
              el('span', {
                className: `status-indicator ${status.className}`,
                text: status.char,
                title: status.title
              })
            ]
          });
          actions.style.display = 'flex';
          actions.style.alignItems = 'center';
          actions.style.gap = '4px';
          actions.style.flexShrink = '0';

          return el('li', {
            className: 'changed-file-item',
            data: { action: 'file-diff', path: file.path, hash: data.commit.hash },
            children: [
              el('span', { className: 'changed-file-path', text: file.path, title: file.path }),
              actions
            ]
          });
        })
      )
    );

    setHidden(ui.commitDetailsDrawer, false);
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Error showing commit details: ${errorMessage(error)}`, 'error');
    }
  }
}

export async function showCommitFileDiff(hash: string, filePath: string): Promise<void> {
  switchToDiffTab();
  await loadCommitFileDiff(hash, filePath);
}

/** Per-file history, rendered into the drawer's file list. */
export async function showFileHistory(filePath: string): Promise<void> {
  ui.drawerFilesHeading.textContent = `History of ${filePath}`;
  logToTerminal(`git log --follow -- ${filePath}`, 'cmd');

  try {
    const { commits } = await api.getFileHistory(filePath);

    ui.drawerFilesList.replaceChildren(
      commits.length === 0
        ? el('li', { className: 'empty-state', text: 'No history for this file' })
        : fragment(
            commits.map((commit) =>
              el('li', {
                className: 'changed-file-item',
                title: `${commit.author} — ${commit.date}`,
                data: { action: 'open-commit', hash: commit.hash },
                children: [
                  el('span', { className: 'changed-file-path', text: commit.message }),
                  el('span', { className: 'commit-hash-badge', text: commit.hash.substring(0, 8) })
                ]
              })
            )
          )
    );
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Failed to load file history: ${errorMessage(error)}`, 'error');
    }
  }
}

// ---------- drawer actions ----------

/**
 * Cherry-pick and revert answer 200 with success:false when git reports
 * conflicts, because a conflict is a state the UI drives rather than a failed
 * request.
 */
async function runHistoryAction(
  run: () => Promise<{ success: boolean; conflict?: boolean; error?: string }>,
  command: string,
  successMessage: string
): Promise<void> {
  logToTerminal(command, 'cmd');

  try {
    const result = await run();

    if (result.success) {
      logToTerminal(successMessage, 'success');
      showToast(successMessage, 'success');
    } else if (result.conflict) {
      logToTerminal(result.error ?? 'Conflicts', 'error');
      showToast('The operation hit conflicts — resolve them in the staging area.', 'warn', 7000);
    } else {
      logToTerminal(result.error ?? 'Operation failed', 'error');
      showToast(result.error ?? 'Operation failed', 'error', 7000);
      return;
    }

    closeCommitDrawer();
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Operation failed.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  }
}

export async function drawerCherryPick(): Promise<void> {
  if (!drawerCommit) {
    return;
  }

  const short = drawerCommit.hash.substring(0, 8);
  const { confirmed } = await confirmDialog(
    `Apply commit ${short} ("${drawerCommit.message}") onto the current branch?`,
    { title: 'Cherry-pick commit', confirmLabel: 'Cherry-pick' }
  );
  if (!confirmed) {
    return;
  }

  const hash = drawerCommit.hash;
  await runHistoryAction(
    () => api.cherryPick(hash),
    `git cherry-pick ${short}`,
    `Commit ${short} cherry-picked.`
  );
}

export async function drawerRevert(): Promise<void> {
  if (!drawerCommit) {
    return;
  }

  const short = drawerCommit.hash.substring(0, 8);
  const { confirmed } = await confirmDialog(
    `Create a new commit that undoes ${short} ("${drawerCommit.message}")?`,
    { title: 'Revert commit', confirmLabel: 'Revert' }
  );
  if (!confirmed) {
    return;
  }

  const hash = drawerCommit.hash;
  await runHistoryAction(
    () => api.revert(hash),
    `git revert --no-edit ${short}`,
    `Commit ${short} reverted.`
  );
}

const RESET_EXPLANATIONS: Record<'soft' | 'mixed' | 'hard', string> = {
  soft: 'later changes stay staged',
  mixed: 'later changes stay in your working tree, unstaged',
  hard: 'ALL later commits and changes are discarded'
};

export async function drawerReset(): Promise<void> {
  if (!drawerCommit) {
    return;
  }

  const mode = asSelect(ui.drawerResetMode).value as 'soft' | 'mixed' | 'hard';
  const short = drawerCommit.hash.substring(0, 8);

  const { confirmed } = await confirmDialog(
    `Reset the current branch to ${short} (--${mode})? After this, ${RESET_EXPLANATIONS[mode]}. A checkpoint is saved so you can undo.`,
    { title: `Reset (${mode})`, confirmLabel: 'Reset', danger: mode === 'hard' }
  );
  if (!confirmed) {
    return;
  }

  const hash = drawerCommit.hash;
  await runHistoryAction(
    async () => {
      await api.reset(hash, mode);
      return { success: true };
    },
    `git reset --${mode} ${short}`,
    `Branch reset to ${short} (${mode}).`
  );
}

export async function drawerCreateTag(): Promise<void> {
  if (!drawerCommit) {
    return;
  }

  const short = drawerCommit.hash.substring(0, 8);
  const name = await promptDialog({
    title: 'Create Tag',
    label: `Tag name for commit ${short} (e.g. v1.2.0)`,
    type: 'text'
  });
  if (!name) {
    return;
  }

  logToTerminal(`git tag ${name} ${short}`, 'cmd');

  try {
    await api.createTag(name, drawerCommit.hash);
    showToast(`Tag ${name} created.`, 'success');
    await refreshAll();
  } catch (error) {
    if (!isStale(error)) {
      const message = errorMessage(error, 'Could not create the tag.');
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  }
}

export async function drawerCopySha(): Promise<void> {
  if (!drawerCommit) {
    return;
  }

  try {
    await navigator.clipboard.writeText(drawerCommit.hash);
    showToast('Full SHA copied.', 'success', 2500);
  } catch {
    showToast('Could not copy to the clipboard.', 'error');
  }
}
