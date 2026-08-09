// Repository groups, and fetching one in a single action.
//
// Progress is reported inline, per repository, rather than as one global busy
// flag. A group fetch where one remote is unreachable should say which one and
// still have fetched the rest — a single spinner that ends in "failed" is the
// behaviour this replaces.
import * as api from '../../api/endpoints';
import type { ClientRepoGroup, GroupFetchOutcome } from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { el, fragment, icon, setHidden } from '../../dom/create';
import { getState } from '../../state/store';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { repoBaseName } from '../../ui/format';
import { openRepository } from '../repo';
import { cancelOperation, subscribeToOperations } from '../../api/operations';
import { isTerminalOperationState } from '../../../shared/operation-types';

let ui: Elements;
let groups: ClientRepoGroup[] = [];

/** Operation id of the fetch in flight, so it can be cancelled. */
let runningFetch: { groupId: string; operationId: string } | null = null;

export function initGroups(elements: Elements): void {
  ui = elements;
}

function buildMemberRow(
  member: { repoPath: string; missing: boolean },
  outcome: GroupFetchOutcome | undefined
): HTMLLIElement {
  const parts = [member.missing ? 'folder not found' : member.repoPath];
  if (outcome) {
    parts.push(outcome.ok ? 'fetched' : outcome.message);
  }

  return el('li', {
    className: `group-member${outcome && !outcome.ok ? ' group-member-failed' : ''}`,
    data: { path: member.repoPath },
    children: [
      icon(outcome ? (outcome.ok ? 'check_circle' : 'error') : 'folder', 14),
      el('span', { className: 'group-member-name', text: repoBaseName(member.repoPath) }),
      el('span', { className: 'group-member-meta', text: parts.join(' · ') })
    ]
  }) as HTMLLIElement;
}

/** Results of the last fetch, keyed by group, so they survive a re-render. */
const lastResults = new Map<string, Map<string, GroupFetchOutcome>>();

function groupDot(group: ClientRepoGroup): HTMLElement {
  const dot = el('span', { className: 'group-dot' });

  if (group.color) {
    // Assigned as a property, not built into markup. The validator already
    // restricts it to a hex colour; this makes it impossible for the value to
    // be read as anything but one.
    dot.style.background = group.color;
  }

  return dot;
}

function buildGroupBlock(group: ClientRepoGroup): HTMLElement {
  const results = lastResults.get(group.id);
  const isFetching = runningFetch?.groupId === group.id;

  return el('li', {
    className: 'group-block',
    data: { groupId: group.id },
    children: [
      el('div', {
        className: 'group-header',
        children: [
          groupDot(group),
          el('span', { className: 'group-label', text: group.label }),
          el('span', {
            className: 'group-count',
            text: `${group.members.length} repositor${group.members.length === 1 ? 'y' : 'ies'}`
          }),
          el('span', {
            className: 'group-actions',
            children: [
              el('button', {
                className: 'btn btn-icon btn-sm',
                title: isFetching ? 'Cancel this fetch' : 'Fetch every repository in this group',
                data: { action: isFetching ? 'cancel' : 'fetch' },
                children: [icon(isFetching ? 'cancel' : 'sync', 14)]
              }),
              el('button', {
                className: 'btn btn-icon btn-sm',
                title: 'Choose which repositories are in this group',
                data: { action: 'edit' },
                children: [icon('edit', 14)]
              }),
              el('button', {
                className: 'btn btn-icon btn-sm btn-text-danger',
                title: 'Delete this group',
                data: { action: 'delete' },
                children: [icon('delete', 14)]
              })
            ]
          })
        ]
      }),
      el('ul', {
        className: 'group-members',
        children: group.members.map((member) =>
          buildMemberRow(member, results?.get(member.repoPath))
        )
      })
    ]
  });
}

function render(): void {
  ui.groupList.replaceChildren(
    groups.length === 0
      ? el('li', {
          className: 'empty-state',
          text: 'No groups yet — group related repositories to fetch them together'
        })
      : fragment(groups.map(buildGroupBlock))
  );
}

export async function refreshGroups(): Promise<void> {
  try {
    const result = await api.getRepoGroups();
    groups = result.groups;
    render();
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read repository groups: ${errorMessage(error)}`, 'info');
    }
  }
}

export async function createGroup(): Promise<void> {
  const label = await promptDialog({
    title: 'New repository group',
    label: 'Group name',
    type: 'text'
  });

  if (label === null || label.trim() === '') {
    return;
  }

  try {
    // Seeded with the open repository, which is almost always one of the
    // members and saves the first trip through the editor.
    const activeRepo = getState().activeRepo;
    await api.saveRepoGroup({
      label: label.trim(),
      repos: activeRepo ? [activeRepo] : []
    });

    await refreshGroups();
    showToast(`Group "${label.trim()}" created.`, 'success');
  } catch (error) {
    showToast(errorMessage(error, 'Could not create the group.'), 'error', 6000);
  }
}

/**
 * Edits membership by listing the known repositories with checkboxes.
 *
 * Built from the recent-repositories list because those are the folders
 * Multi-Git can still resolve to a real path; a group can only usefully
 * contain repositories it knows where to find.
 */
export function openGroupEditor(groupId: string): void {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    return;
  }

  const member = new Set(group.members.map((entry) => entry.repoPath));

  ui.groupEditorTitle.textContent = `Repositories in "${group.label}"`;
  ui.groupEditorList.dataset['groupId'] = groupId;
  ui.groupEditorList.replaceChildren(
    fragment(
      getState().recentRepos.map((repoPath) => {
        const checkbox = el('input', { className: 'group-member-check' }) as HTMLInputElement;
        checkbox.type = 'checkbox';
        checkbox.value = repoPath;
        checkbox.checked = member.has(repoPath);

        return el('li', {
          className: 'group-editor-item',
          children: [
            el('label', {
              className: 'group-editor-label',
              children: [
                checkbox,
                el('span', { className: 'group-member-name', text: repoBaseName(repoPath) }),
                el('span', { className: 'group-member-meta', text: repoPath })
              ]
            })
          ]
        });
      })
    )
  );

  setHidden(ui.groupEditorModal, false);
}

export function closeGroupEditor(): void {
  setHidden(ui.groupEditorModal, true);
}

export async function saveGroupMembers(): Promise<void> {
  const groupId = ui.groupEditorList.dataset['groupId'];
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    return;
  }

  const repos = [...ui.groupEditorList.querySelectorAll<HTMLInputElement>('.group-member-check')]
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);

  try {
    await api.saveRepoGroup({ id: group.id, label: group.label, order: group.order, repos });
    closeGroupEditor();
    await refreshGroups();
    showToast('Group updated.', 'success');
  } catch (error) {
    showToast(errorMessage(error, 'Could not update the group.'), 'error', 6000);
  }
}

async function deleteGroup(group: ClientRepoGroup): Promise<void> {
  const { confirmed } = await confirmDialog(
    `Delete the group "${group.label}"?\n\nThe repositories themselves are untouched; only the grouping goes.`,
    { title: 'Delete group', confirmLabel: 'Delete' }
  );

  if (!confirmed) {
    return;
  }

  try {
    await api.deleteRepoGroup(group.id);
    lastResults.delete(group.id);
    await refreshGroups();
  } catch (error) {
    showToast(errorMessage(error, 'Could not delete the group.'), 'error');
  }
}

/**
 * Fetches every repository in a group.
 *
 * The request runs to completion even when cancelled — the server reports what
 * each repository ended up doing, including "Cancelled" for the ones that never
 * started, and showing that is more useful than a spinner that just stops.
 */
async function fetchGroup(group: ClientRepoGroup): Promise<void> {
  if (runningFetch) {
    showToast('A group fetch is already running.', 'warn');
    return;
  }

  lastResults.delete(group.id);
  runningFetch = { groupId: group.id, operationId: '' };
  render();

  // The fetch request only answers when it is finished, so the id needed to
  // cancel it has to come from somewhere else. The operation stream already
  // carries it — the server registers the operation before the first git
  // process starts.
  const unsubscribe = subscribeToOperations((operations) => {
    const running = operations.find(
      (operation) => operation.kind === 'group-fetch' && !isTerminalOperationState(operation.state)
    );
    if (running && runningFetch) {
      runningFetch.operationId = running.id;
      render();
    }
  });

  logToTerminal(
    `Fetching ${group.members.length} repositor${group.members.length === 1 ? 'y' : 'ies'} in "${group.label}"...`
  );

  try {
    const result = await api.fetchRepoGroup(group.id);

    lastResults.set(group.id, new Map(result.results.map((outcome) => [outcome.repoPath, outcome])));

    const failed = result.results.filter((outcome) => !outcome.ok);
    for (const outcome of failed) {
      logToTerminal(`${outcome.repoPath}: ${outcome.message}`, 'error');
    }

    showToast(
      result.cancelled
        ? 'Group fetch cancelled.'
        : failed.length === 0
          ? `Fetched ${result.results.length} repositor${result.results.length === 1 ? 'y' : 'ies'}.`
          : `Fetched ${result.results.length - failed.length} of ${result.results.length}; ${failed.length} failed.`,
      result.cancelled ? 'info' : failed.length === 0 ? 'success' : 'warn',
      failed.length === 0 ? 4000 : 8000
    );
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'The group fetch failed.'), 'error', 7000);
    }
  } finally {
    unsubscribe();
    runningFetch = null;
    render();
  }
}

async function cancelGroupFetch(): Promise<void> {
  if (!runningFetch) {
    return;
  }

  try {
    // The operation id is only known once the server answered, so a cancel
    // pressed immediately falls back to letting it finish.
    if (runningFetch.operationId) {
      await cancelOperation(runningFetch.operationId);
    } else {
      showToast('The fetch is still starting — try again in a moment.', 'info');
    }
  } catch (error) {
    showToast(errorMessage(error, 'Could not cancel the fetch.'), 'warn');
  }
}

export function handleGroupAction(target: HTMLElement, event: MouseEvent): void {
  const block = target.closest<HTMLElement>('[data-group-id]');
  const group = groups.find((candidate) => candidate.id === block?.dataset['groupId']);
  if (!group) {
    return;
  }

  const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset['action'];

  if (action === 'fetch') {
    void fetchGroup(group);
    return;
  }
  if (action === 'cancel') {
    void cancelGroupFetch();
    return;
  }
  if (action === 'edit') {
    openGroupEditor(group.id);
    return;
  }
  if (action === 'delete') {
    void deleteGroup(group);
    return;
  }

  // A click on a member row opens it.
  const memberPath = (event.target as Element).closest<HTMLElement>('[data-path]')?.dataset['path'];
  if (memberPath) {
    void openRepository(memberPath);
  }
}
