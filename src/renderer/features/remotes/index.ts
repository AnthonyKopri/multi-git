// The Remotes tab, and the sidebar summary beside it.
//
// A remote is more than its URL, and the panel says so: fetch and push URLs are
// separate rows because the fork workflow needs them to be, refspecs are shown
// rather than assumed, and prune says whether it was set here or inherited from
// `fetch.prune`. A UI that only edits the URL silently drops the rest whenever
// it writes.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { el, fragment, icon, setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { getState } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import { registerHubTab } from '../repo-hub';
import type { RemoteInfo } from '../../../shared/remote-types';

let ui: Elements;
let remotes: RemoteInfo[] = [];
/** The remote whose editor is open, or null for the "add" form. */
let editing: string | null = null;

export function initRemotes(elements: Elements): void {
  ui = elements;
  registerHubTab('remotes', { render: renderPanel });
}

// ---------- the sidebar summary ----------

/**
 * Refreshes the sidebar count.
 *
 * Cheap enough to run with every other repository read: one `git remote` plus
 * one `git config --get-regexp`, neither of which touches the network.
 */
export async function refreshRemotes(): Promise<void> {
  if (!getState().activeRepo) {
    remotes = [];
    renderSummary();
    return;
  }

  try {
    remotes = (await api.getRemotes()).remotes;
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read remotes: ${errorMessage(error)}`, 'error');
    }
    remotes = [];
  }

  renderSummary();
}

function renderSummary(): void {
  ui.remoteCount.textContent = remotes.length === 0 ? '' : String(remotes.length);
  setHidden(ui.remoteCount, remotes.length === 0);

  ui.remoteSummaryList.replaceChildren(
    remotes.length === 0
      ? el('li', { className: 'empty-state', text: 'No remotes' })
      : fragment(
          remotes.map((remote) =>
            el('li', {
              className: 'stash-item',
              title: remote.fetchUrl,
              children: [
                el('span', { className: 'worktree-name', text: remote.name }),
                el('span', { className: 'worktree-meta', text: hostOf(remote.fetchUrl) })
              ]
            })
          )
        )
  );
}

/** The recognisable part of a URL, for a line that has no room for all of it. */
function hostOf(url: string): string {
  const match = url.match(/^[a-z+]+:\/\/(?:[^@/]*@)?([^/:]+)/i) ?? url.match(/^[^@]+@([^:]+):/);
  return match?.[1] ?? url;
}

// ---------- the hub tab ----------

async function renderPanel(panel: HTMLElement): Promise<void> {
  await refreshRemotes();

  panel.replaceChildren(
    el('p', {
      className: 'modal-desc',
      text: 'Where this repository fetches from and pushes to. A push URL that differs from the fetch URL is the fork workflow: read from upstream, write to your own.'
    }),
    buildToolbar(),
    buildList(),
    buildEditor()
  );
}

function buildToolbar(): HTMLElement {
  const fetchAll = el('button', {
    className: 'btn btn-secondary btn-sm',
    children: [icon('sync', 16), el('span', { text: 'Fetch all' })]
  }) as HTMLButtonElement;

  fetchAll.addEventListener('click', () => {
    void withButtonBusy(fetchAll, async () => {
      const { results, cancelled } = await api.fetchAllRemotes();
      const failed = results.filter((entry) => !entry.ok);

      // Per remote, not one verdict: a remote that is down should not hide the
      // ones that worked, and the user needs to know which is which.
      for (const failure of failed) {
        logToTerminal(`Fetch failed for ${failure.remote}: ${failure.message ?? ''}`, 'error');
      }

      showToast(
        cancelled
          ? 'Fetch all cancelled'
          : `Fetched ${results.length - failed.length} of ${results.length} remote(s)`,
        failed.length > 0 ? 'error' : 'success'
      );
    });
  });

  const add = el('button', {
    className: 'btn btn-primary btn-sm',
    children: [icon('add', 16), el('span', { text: 'Add remote' })]
  });
  add.addEventListener('click', () => {
    editing = null;
    void refreshPanel();
  });

  return el('div', { className: 'section-header', children: [fetchAll, add] });
}

function buildList(): HTMLElement {
  if (remotes.length === 0) {
    return el('ul', {
      className: 'worktree-list',
      children: [el('li', { className: 'empty-state', text: 'No remotes configured' })]
    });
  }

  return el('ul', {
    className: 'worktree-list',
    children: remotes.map((remote) => buildRow(remote))
  });
}

function buildRow(remote: RemoteInfo): HTMLLIElement {
  const details: string[] = [];
  if (remote.pushUrl !== remote.fetchUrl) {
    details.push(`push → ${remote.pushUrl}`);
  }
  if (remote.prune) {
    details.push(remote.pruneInherited ? 'prune (inherited)' : 'prune');
  }
  if (remote.isDefaultPush) {
    details.push('default push remote');
  }

  const actions = el('span', { className: 'worktree-actions' });

  actions.append(
    action('edit', 'Edit this remote', () => {
      editing = remote.name;
      void refreshPanel();
    }),
    action('lan', 'Test the connection', async (button) => {
      await withButtonBusy(button, async () => {
        const { result } = await api.testRemote(remote.name);

        if (result.reachable) {
          showToast(`${remote.name} is reachable — ${result.refCount ?? 0} ref(s)`, 'success');
          return;
        }

        // An auth failure is a different problem from an unreachable host, and
        // pointing at the wrong one wastes the user's time.
        showToast(
          result.authFailure
            ? `${remote.name} refused the connection. Check the SSH key selected for this repository.`
            : `${remote.name} could not be reached.`,
          'error'
        );
        logToTerminal(`${remote.name}: ${result.message ?? 'unreachable'}`, 'error');
      });
    }),
    action('cleaning_services', 'Remove stale remote-tracking branches', () => confirmPrune(remote)),
    action('delete', 'Remove this remote', () => confirmRemove(remote), true)
  );

  return el('li', {
    className: 'worktree-item',
    children: [
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', { className: 'worktree-name', text: remote.name }),
          el('span', {
            className: 'worktree-meta',
            text: remote.fetchUrl,
            title: remote.fetchUrl
          }),
          ...(details.length > 0
            ? [el('span', { className: 'worktree-meta', text: details.join(' · ') })]
            : [])
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

// ---------- destructive paths ----------

async function confirmPrune(remote: RemoteInfo): Promise<void> {
  const { preview } = await api.previewRemotePrune(remote.name);

  if (preview.staleRefs.length === 0) {
    showToast(`${remote.name} has no stale remote-tracking branches`, 'success');
    return;
  }

  // Shown before, not after. A remote-tracking ref is the only local record
  // that a branch existed once its remote is gone.
  const { confirmed } = await confirmDialog(
    `These ${preview.staleRefs.length} remote-tracking branch(es) no longer exist on ${remote.name} and will be removed:\n\n${preview.staleRefs.join('\n')}`,
    { title: 'Prune remote-tracking branches', confirmLabel: 'Prune', danger: true }
  );

  if (!confirmed) {
    return;
  }

  const { pruned } = await api.pruneRemote(remote.name);
  showToast(`Pruned ${pruned.length} stale ref(s)`, 'success');
  await refreshPanel();
}

async function confirmRemove(remote: RemoteInfo): Promise<void> {
  const { confirmed } = await confirmDialog(
    `Remove the remote "${remote.name}"? Its remote-tracking branches go with it. A recovery point is saved first.`,
    { title: 'Remove remote', confirmLabel: 'Remove', danger: true }
  );

  if (!confirmed) {
    return;
  }

  await api.removeRemote(remote.name);
  showToast(`Removed ${remote.name}`, 'success');
  editing = null;
  await refreshPanel();
}

// ---------- the editor ----------

function field(
  label: string,
  value: string,
  placeholder = '',
  hint?: string
): { row: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { attrs: { type: 'text', placeholder } }) as HTMLInputElement;
  input.value = value;

  const row = el('div', {
    className: 'form-row',
    children: [
      el('label', { text: label }),
      input,
      ...(hint ? [el('span', { className: 'modal-desc', text: hint })] : [])
    ]
  });

  return { row, input };
}

function buildEditor(): HTMLElement {
  const existing = editing === null ? null : (remotes.find((r) => r.name === editing) ?? null);

  const name = field('Name', existing?.name ?? '', 'origin');
  const fetchUrl = field('Fetch URL', existing?.fetchUrl ?? '', 'git@github.com:owner/repo.git');
  const pushUrl = field(
    'Push URL',
    existing && existing.pushUrl !== existing.fetchUrl ? existing.pushUrl : '',
    'Leave empty to push where you fetch'
  );
  const fetchRefspecs = field(
    'Fetch refspecs',
    (existing?.fetchRefspecs ?? []).join(' '),
    '+refs/heads/*:refs/remotes/origin/*',
    'Space separated. Empty leaves git’s default in place.'
  );

  const prune = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  prune.checked = existing?.prune ?? false;

  const pruneRow = el('label', {
    className: 'amend-row',
    title: existing?.pruneInherited
      ? 'Currently inherited from fetch.prune. Setting it here makes it explicit for this remote.'
      : '',
    children: [
      prune,
      el('span', {
        text: existing?.pruneInherited
          ? 'Delete stale remote-tracking branches on fetch (inherited)'
          : 'Delete stale remote-tracking branches on fetch'
      })
    ]
  });

  const save = el('button', {
    className: 'btn btn-primary',
    text: existing ? 'Save changes' : 'Add remote',
    attrs: { type: 'submit' }
  }) as HTMLButtonElement;

  const form = el('form', {
    className: 'worktree-form',
    children: [
      el('h4', { text: existing ? `Edit ${existing.name}` : 'Add a remote' }),
      name.row,
      fetchUrl.row,
      pushUrl.row,
      fetchRefspecs.row,
      pruneRow,
      el('div', { className: 'form-actions', children: [save] })
    ]
  }) as HTMLFormElement;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    void withButtonBusy(save, async () => {
      const refspecs = fetchRefspecs.input.value
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value !== '');

      try {
        if (existing) {
          await api.updateRemote({
            name: existing.name,
            newName: name.input.value.trim(),
            fetchUrl: fetchUrl.input.value.trim(),
            pushUrl: pushUrl.input.value.trim(),
            fetchRefspecs: refspecs,
            prune: prune.checked
          });
          showToast(`Saved ${name.input.value.trim()}`, 'success');
        } else {
          await api.addRemote({
            name: name.input.value.trim(),
            fetchUrl: fetchUrl.input.value.trim(),
            pushUrl: pushUrl.input.value.trim(),
            fetchRefspecs: refspecs,
            prune: prune.checked
          });
          showToast(`Added ${name.input.value.trim()}`, 'success');
        }

        editing = null;
        await refreshPanel();
      } catch (error) {
        showToast(errorMessage(error), 'error');
      }
    });
  });

  return form;
}

/** Redraws the tab in place, after something changed what it shows. */
async function refreshPanel(): Promise<void> {
  const panel = document.getElementById('hub-panel-remotes');
  if (panel) {
    await renderPanel(panel);
  }
}
