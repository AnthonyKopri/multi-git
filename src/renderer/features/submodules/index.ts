// The Submodules tab, and the sidebar summary beside it.
//
// The panel is built around the distinction that causes most submodule
// confusion: the superproject's gitlink says which commit a submodule *should*
// be at, and the submodule's own working tree is at whatever it is at. Those
// differ constantly and legitimately, so the row states which of the two is out
// of step rather than showing one "out of date" badge that could mean either.
import * as api from '../../api/endpoints';
import { errorMessage, isStale, setActiveRepo } from '../../api/client';
import { el, fragment, icon, setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { getState } from '../../state/store';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import { registerHubTab, closeRepoHub } from '../repo-hub';
import type { SubmoduleActionResult, SubmoduleInfo } from '../../../shared/submodule-types';

let ui: Elements;
let submodules: SubmoduleInfo[] = [];
let openRepository: (repoPath: string) => Promise<void> = async () => {};

export function initSubmodules(
  elements: Elements,
  hooks: { openRepository: (repoPath: string) => Promise<void> }
): void {
  ui = elements;
  openRepository = hooks.openRepository;
  registerHubTab('submodules', { render: renderPanel });
}

// ---------- the sidebar summary ----------

export async function refreshSubmodules(): Promise<void> {
  if (!getState().activeRepo) {
    submodules = [];
    renderSummary();
    return;
  }

  try {
    submodules = (await api.getSubmodules()).submodules;
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read submodules: ${errorMessage(error)}`, 'error');
    }
    submodules = [];
  }

  renderSummary();
}

function renderSummary(): void {
  ui.submoduleCount.textContent = submodules.length === 0 ? '' : String(submodules.length);
  setHidden(ui.submoduleCount, submodules.length === 0);

  ui.submoduleSummaryList.replaceChildren(
    submodules.length === 0
      ? el('li', { className: 'empty-state', text: 'No submodules' })
      : fragment(
          submodules.map((submodule) =>
            el('li', {
              className: 'stash-item',
              title: submodule.url,
              children: [
                el('span', { className: 'worktree-name', text: submodule.path }),
                el('span', { className: 'worktree-meta', text: describe(submodule) })
              ]
            })
          )
        )
  );
}

/** One line saying which of the two commits is the one out of step. */
function describe(submodule: SubmoduleInfo): string {
  if (!submodule.initialized) {
    return 'not initialized';
  }
  if (submodule.missingCommit) {
    return 'no commit checked out';
  }

  const parts: string[] = [];

  if (
    submodule.expectedOid &&
    submodule.checkedOutOid &&
    submodule.expectedOid !== submodule.checkedOutOid
  ) {
    // Deliberately not "out of date": which way round it is depends on what
    // the user did, and the panel does not know.
    parts.push(`at ${short(submodule.checkedOutOid)}, superproject expects ${short(submodule.expectedOid)}`);
  } else if (submodule.checkedOutOid) {
    parts.push(short(submodule.checkedOutOid));
  }

  if (submodule.dirty) {
    parts.push('uncommitted changes');
  }
  if (submodule.branch) {
    parts.push(`tracks ${submodule.branch}`);
  }

  return parts.join(' · ');
}

const short = (oid: string): string => oid.slice(0, 7);

// ---------- the hub tab ----------

async function renderPanel(panel: HTMLElement): Promise<void> {
  await refreshSubmodules();

  panel.replaceChildren(
    el('p', {
      className: 'modal-desc',
      text: 'A submodule is a second repository pinned to one commit. The superproject records which commit; the submodule’s own working tree is whatever you left it at. Updating moves the working tree to the pinned commit — it does not change what is pinned.'
    }),
    buildToolbar(),
    buildList()
  );
}

function buildToolbar(): HTMLElement {
  const recursive = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  const initToo = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  initToo.checked = true;

  const updateAll = el('button', {
    className: 'btn btn-primary btn-sm',
    children: [icon('download', 16), el('span', { text: 'Update all' })]
  }) as HTMLButtonElement;

  updateAll.addEventListener('click', () => {
    void withButtonBusy(updateAll, async () => {
      const { results } = await api.updateSubmodules({
        init: initToo.checked,
        recursive: recursive.checked
      });
      reportResults(results, 'updated');
      await refreshPanel();
    });
  });

  const syncAll = el('button', {
    className: 'btn btn-secondary btn-sm',
    title: 'Copy the URLs from .gitmodules into this clone’s config. Needed after a remote moves.',
    children: [icon('sync_alt', 16), el('span', { text: 'Sync URLs' })]
  }) as HTMLButtonElement;

  syncAll.addEventListener('click', () => {
    void withButtonBusy(syncAll, async () => {
      const { results } = await api.syncSubmodules(undefined, recursive.checked);
      reportResults(results, 'synced');
      await refreshPanel();
    });
  });

  return el('div', {
    className: 'submodule-toolbar',
    children: [
      el('label', {
        className: 'amend-row',
        children: [initToo, el('span', { text: 'Initialize any that are not yet' })]
      }),
      el('label', {
        className: 'amend-row',
        title: 'Also act on submodules nested inside these ones.',
        children: [recursive, el('span', { text: 'Recursive' })]
      }),
      el('span', { className: 'spacer' }),
      syncAll,
      updateAll
    ]
  });
}

/**
 * Reports a per-target run.
 *
 * The whole point of running one git command per submodule is that a partial
 * failure stays inspectable, so the failures are named rather than counted.
 */
function reportResults(results: SubmoduleActionResult[], verb: string): void {
  const failed = results.filter((entry) => !entry.ok);

  for (const failure of failed) {
    logToTerminal(`${failure.path}: ${failure.message ?? 'failed'}`, 'error');
  }

  showToast(
    failed.length === 0
      ? `${results.length} submodule(s) ${verb}`
      : `${results.length - failed.length} of ${results.length} ${verb}; ${failed.map((entry) => entry.path).join(', ')} failed`,
    failed.length === 0 ? 'success' : 'error'
  );
}

function buildList(): HTMLElement {
  if (submodules.length === 0) {
    return el('ul', {
      className: 'worktree-list',
      children: [
        el('li', { className: 'empty-state', text: 'This repository declares no submodules' })
      ]
    });
  }

  return el('ul', {
    className: 'worktree-list',
    children: submodules.map((submodule) => buildRow(submodule))
  });
}

function buildRow(submodule: SubmoduleInfo): HTMLLIElement {
  const actions = el('span', { className: 'worktree-actions' });

  if (!submodule.initialized) {
    actions.append(
      action('play_arrow', 'Initialize and check out', async (button) => {
        await withButtonBusy(button, async () => {
          const { results } = await api.updateSubmodules({ paths: [submodule.path], init: true });
          reportResults(results, 'initialized');
          await refreshPanel();
        });
      })
    );
  } else {
    actions.append(
      action('download', 'Move to the commit the superproject pins', async (button) => {
        await withButtonBusy(button, async () => {
          const { results } = await api.updateSubmodules({ paths: [submodule.path] });
          reportResults(results, 'updated');
          await refreshPanel();
        });
      }),
      action('open_in_new', 'Open as its own repository', () => openSubmodule(submodule)),
      action('call_split', 'Set the branch this submodule tracks', () => setBranch(submodule))
    );
  }

  actions.append(
    action('sync_alt', 'Copy its URL from .gitmodules into this clone', async (button) => {
      await withButtonBusy(button, async () => {
        const { results } = await api.syncSubmodules([submodule.path]);
        reportResults(results, 'synced');
        await refreshPanel();
      });
    }),
    action('delete', 'Remove its working tree', () => confirmDeinit(submodule), true)
  );

  const classes = ['worktree-item'];
  if (!submodule.initialized) {
    classes.push('submodule-uninitialized');
  }

  return el('li', {
    className: classes.join(' '),
    children: [
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', { className: 'worktree-name', text: submodule.path, title: submodule.path }),
          el('span', { className: 'worktree-meta', text: describe(submodule) }),
          el('span', { className: 'worktree-meta', text: submodule.url, title: submodule.url })
        ]
      }),
      actions
    ]
  }) as HTMLLIElement;
}

function action(
  glyph: string,
  title: string,
  run: (button: HTMLButtonElement) => void | Promise<void>,
  danger = false
): HTMLButtonElement {
  const button = el('button', {
    className: `btn btn-icon btn-sm${danger ? ' btn-text-danger' : ''}`,
    title,
    children: [icon(glyph, 14)]
  }) as HTMLButtonElement;

  button.addEventListener('click', () => void run(button));
  return button;
}

async function openSubmodule(submodule: SubmoduleInfo): Promise<void> {
  try {
    // The absolute path is resolved server-side, because resolving it is
    // exactly the step that has to be checked for containment.
    const { path } = await api.getSubmoduleRepoPath(submodule.path);

    closeRepoHub();
    setActiveRepo(path);
    await openRepository(path);
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
}

async function setBranch(submodule: SubmoduleInfo): Promise<void> {
  const branch = await promptDialog({
    title: 'Tracked branch',
    label: `Branch for ${submodule.path}. Leave empty to go back to the default.`,
    // Not a password: the default masks the field, which would be absurd here.
    type: 'text'
  });

  if (branch === null) {
    return;
  }

  try {
    await api.setSubmoduleBranch(submodule.path, branch.trim() === '' ? null : branch.trim());
    showToast(`Updated the branch for ${submodule.path}`, 'success');
    await refreshPanel();
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
}

async function confirmDeinit(submodule: SubmoduleInfo): Promise<void> {
  // The dirty case is refused by the server unless forced, so the dialog says
  // which of the two things is about to happen rather than one vague warning.
  const message = submodule.dirty
    ? `${submodule.path} has uncommitted changes. Removing its working tree discards them, and they are not in any commit, so a recovery point cannot bring them back.`
    : `Remove the working tree of ${submodule.path}? The submodule stays declared and can be checked out again.`;

  const { confirmed } = await confirmDialog(message, {
    title: 'Remove submodule working tree',
    confirmLabel: submodule.dirty ? 'Discard and remove' : 'Remove',
    danger: true
  });

  if (!confirmed) {
    return;
  }

  try {
    const { results } = await api.deinitSubmodules([submodule.path], submodule.dirty);
    reportResults(results, 'removed');
    await refreshPanel();
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
}

async function refreshPanel(): Promise<void> {
  const panel = document.getElementById('hub-panel-submodules');
  if (panel) {
    await renderPanel(panel);
  }
}
