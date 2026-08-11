// The update notice: an icon in the navbar and a modal behind it.
//
// Everything here is display and intent. The renderer never learns which URL
// an update comes from or where it lands — it asks for "the update" the main
// process already resolved. See src/shared/desktop-api.ts.
//
// In browser mode, on anything but Windows, and in an unpackaged dev run there
// is no bridge or the bridge reports `supported: false`, and this module
// registers nothing and shows nothing.

import { setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { showToast } from '../../ui/toast';
import type { UpdateState } from '../../../shared/update-types';
import {
  badgeText,
  bodyText,
  headline,
  iconTitle,
  primaryDisabled,
  primaryIntent,
  primaryLabel,
  showsIcon,
  showsSkip
} from './presentation';

let ui: Elements;
let current: UpdateState | null = null;

/** True only in the desktop app, matching isDesktop() in features/windows. */
export function isSupported(): boolean {
  return typeof window.desktopApi?.onUpdateState === 'function';
}

function render(): void {
  if (!current) {
    return;
  }

  const state = current;

  setHidden(ui.btnUpdate, !showsIcon(state));
  ui.btnUpdate.title = iconTitle(state);
  ui.btnUpdate.classList.toggle('update-failed', state.phase === 'error');

  const badge = badgeText(state);
  ui.updateBadge.textContent = badge;
  setHidden(ui.updateBadge, badge === '');

  ui.updateModalTitle.textContent = headline(state);
  ui.updateMessage.textContent = bodyText(state);

  // Release notes are remote text. textContent, never innerHTML.
  const notes = state.latest?.notes.trim() ?? '';
  ui.updateNotes.textContent = notes;
  setHidden(ui.updateNotes, notes === '' || state.phase === 'error');

  const downloading = state.phase === 'downloading';
  setHidden(ui.updateProgress, !downloading);
  ui.updateProgressBar.style.width = `${downloading ? (state.percent ?? 0) : 0}%`;

  ui.btnUpdateInstall.textContent = primaryLabel(state);
  (ui.btnUpdateInstall as HTMLButtonElement).disabled = primaryDisabled(state);
  setHidden(ui.btnUpdateSkip, !showsSkip(state));
}

function openModal(): void {
  setHidden(ui.updateModal, false);
}

function closeModal(): void {
  setHidden(ui.updateModal, true);
}

/** True when some other overlay already owns the screen. */
function anotherModalIsOpen(): boolean {
  for (const overlay of document.querySelectorAll('.modal-overlay')) {
    if (overlay !== ui.updateModal && !overlay.classList.contains('hidden')) {
      return true;
    }
  }
  return false;
}

async function runPrimary(): Promise<void> {
  if (!current) {
    return;
  }

  const intent = primaryIntent(current);
  try {
    if (intent === 'download') {
      await window.desktopApi?.downloadUpdate?.();
    } else if (intent === 'install') {
      await window.desktopApi?.installUpdate?.();
    } else if (intent === 'check') {
      await window.desktopApi?.checkForUpdate?.();
    }
  } catch {
    // Failures are reported through the broadcast state, which renders into
    // the modal that is already open. A toast on top would say it twice.
  }
}

export async function checkNow(): Promise<void> {
  if (!isSupported()) {
    return;
  }
  try {
    await window.desktopApi?.checkForUpdate?.();
  } catch {
    showToast('Could not check for updates.', 'error', 6000);
  }
}

export function initUpdates(elements: Elements): void {
  ui = elements;

  // The single early return that covers browser mode, macOS and Linux, and a
  // dev run from a checkout: no listeners, no requests, nothing shown.
  if (!isSupported()) {
    return;
  }

  window.desktopApi?.onUpdateState?.((state) => {
    current = state;
    render();
  });

  window.desktopApi?.onUpdatePopup?.(() => {
    render();
    // The SSH health notice fires at startup too. Two stacked startup modals
    // is worse than showing the icon and waiting for the user to click it.
    if (!anotherModalIsOpen()) {
      openModal();
    }
  });

  ui.btnUpdate.addEventListener('click', () => {
    render();
    openModal();
  });
  ui.btnUpdateLater.addEventListener('click', closeModal);
  ui.btnUpdateInstall.addEventListener('click', () => {
    void runPrimary();
  });
  ui.btnUpdateSkip.addEventListener('click', () => {
    closeModal();
    void window.desktopApi?.skipUpdateVersion?.();
  });

  // Seeded rather than waiting for a broadcast, so a window opened after the
  // check still shows the icon.
  void window.desktopApi
    ?.getUpdateState?.()
    .then((state) => {
      if (state) {
        current = state;
        render();
      }
    })
    .catch(() => {
      // Nothing to show is the correct outcome of not knowing.
    });
}
