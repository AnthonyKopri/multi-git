// Git notes: the hub tab, the commit-list marker, and the drawer editor.
//
// A note lives in its own ref rather than in the commit, which is why editing
// one does not rewrite history — and also why it does not travel with a normal
// push, and why most hosts never display it. The tab says both of those things,
// because a user who assumes otherwise loses notes without being told.
//
// Which commits carry a note is answered once per ref, not once per commit: the
// history list asks that question for every row it draws.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { el, icon, setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { getState } from '../../state/store';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import { registerHubTab } from '../repo-hub';

let ui: Elements;
let activeRef: string | undefined;
let refs: string[] = [];
/** Commits known to carry a note under `activeRef`. */
let annotated = new Set<string>();

export function initNotes(elements: Elements): void {
  ui = elements;
  registerHubTab('notes', { render: renderPanel });
}

/** The ref the rest of the app should read notes from. */
export function currentNotesRef(): string | undefined {
  return activeRef;
}

export function hasNote(commitHash: string): boolean {
  return annotated.has(commitHash);
}

/**
 * Refreshes the set of annotated commits.
 *
 * One `git notes list` for the whole ref. Cheap enough to run beside the other
 * repository reads, and the only alternative is a process per history row.
 */
export async function refreshNotesIndex(): Promise<void> {
  if (!getState().activeRepo) {
    annotated = new Set();
    return;
  }

  try {
    annotated = new Set((await api.getNotesIndex(activeRef)).commits);
  } catch (error) {
    if (!isStale(error)) {
      // A repository with no notes ref is the normal case, not an error.
      annotated = new Set();
    }
  }
}

// ---------- the drawer editor ----------

/**
 * Loads the note for the commit the drawer is showing.
 *
 * Called when a commit is opened, so the read happens once per commit rather
 * than for every row in the list.
 */
export async function loadNoteForDrawer(commitHash: string): Promise<void> {
  const box = ui.drawerNoteInput as HTMLTextAreaElement;

  try {
    const { note } = await api.getNote(commitHash, activeRef);
    box.value = note ?? '';
    box.dataset['commit'] = commitHash;
  } catch {
    box.value = '';
    box.dataset['commit'] = commitHash;
  }
}

export function initDrawerControls(): void {
  ui.btnSaveNote.addEventListener('click', () => {
    const box = ui.drawerNoteInput as HTMLTextAreaElement;
    const commit = box.dataset['commit'];

    if (!commit) {
      return;
    }

    void withButtonBusy(ui.btnSaveNote, async () => {
      try {
        await api.saveNote(commit, box.value, activeRef);
        await refreshNotesIndex();

        // An empty box removes the note, which is what the server does with an
        // empty message — so the marker has to follow either way.
        showToast(box.value.trim() === '' ? 'Note removed' : 'Note saved', 'success');
      } catch (error) {
        showToast(errorMessage(error), 'error');
      }
    });
  });
}

// ---------- the hub tab ----------

async function renderPanel(panel: HTMLElement): Promise<void> {
  try {
    const state = await api.getNotesRefs();
    refs = state.refs;
    activeRef = activeRef ?? state.defaultRef;
  } catch (error) {
    showToast(errorMessage(error), 'error');
    refs = [];
  }

  await refreshNotesIndex();

  panel.replaceChildren(
    el('p', {
      className: 'modal-desc',
      text: 'A note is text attached to a commit afterwards. It lives in its own ref, so writing one does not rewrite history — and it does not travel with an ordinary push, which is why fetching and pushing notes are separate actions here. Most hosting sites do not display notes at all.'
    }),
    buildRefPicker(),
    buildSummary(),
    buildSync()
  );
}

function buildRefPicker(): HTMLElement {
  const select = el('select') as HTMLSelectElement;

  for (const ref of refs) {
    const option = document.createElement('option');
    option.value = ref;
    option.textContent = ref;
    option.selected = ref === activeRef;
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    activeRef = select.value;
    void refreshPanel();
  });

  return el('div', {
    className: 'form-row',
    children: [el('label', { text: 'Notes ref' }), select]
  });
}

function buildSummary(): HTMLElement {
  return el('div', {
    className: 'inline-feedback',
    children: [
      el('p', {
        text:
          annotated.size === 0
            ? 'No commits in this repository carry a note under this ref.'
            : `${annotated.size} commit(s) carry a note. They are marked in the history list; open one to read or edit it.`
      })
    ]
  });
}

function buildSync(): HTMLElement {
  const buttons = (['fetch', 'push'] as const).map((direction) => {
    const button = el('button', {
      className: 'btn btn-secondary btn-sm',
      children: [
        icon(direction === 'fetch' ? 'download' : 'upload', 16),
        el('span', { text: `${direction} notes` })
      ]
    }) as HTMLButtonElement;

    button.addEventListener('click', () => {
      void withButtonBusy(button, async () => {
        try {
          await api.syncNotes(direction, 'origin', activeRef);
          await refreshNotesIndex();
          showToast(`Notes ${direction === 'fetch' ? 'fetched' : 'pushed'}`, 'success');
          await refreshPanel();
        } catch (error) {
          showToast(errorMessage(error), 'error', 8000);
          logToTerminal(`Notes ${direction} failed: ${errorMessage(error)}`, 'error');
        }
      });
    });

    return button;
  });

  return el('section', {
    children: [
      el('div', {
        className: 'section-header',
        children: [el('h4', { text: 'Sharing' })]
      }),
      el('p', {
        className: 'modal-desc',
        text: 'Notes refs are outside the default refspec, so an ordinary push leaves them behind.'
      }),
      el('div', { className: 'btn-group', children: buttons })
    ]
  });
}

/** Shows or hides the note marker on a drawer, for the currently open commit. */
export function renderDrawerNoteState(commitHash: string): void {
  setHidden(ui.drawerNoteMarker, !annotated.has(commitHash));
}

async function refreshPanel(): Promise<void> {
  const panel = document.getElementById('hub-panel-notes');
  if (panel) {
    await renderPanel(panel);
  }
}
