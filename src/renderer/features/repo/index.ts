// Opening, remembering, and cloning repositories.
import * as api from '../../api/endpoints';
import { errorMessage, isStale, setActiveRepo } from '../../api/client';
import { asInput, asSelect } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { getState, update } from '../../state/store';
import { repoBaseName } from '../../ui/format';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { closeAllDropdowns } from '../../ui/dropdown';
import { withButtonBusy } from '../../ui/busy';
import { renderRecentRepos } from './repo-list';
import { applyConfigSnapshot, loadConfig, renderAccounts, restoreProfileForRepo } from '../accounts';
import { refreshIdentity } from '../accounts/identity';

let ui: Elements;

/** Set by the bootstrap so opening a repository can trigger a full refresh. */
let refreshAll: () => Promise<void> = async () => {};

export function initRepo(elements: Elements, onOpened: () => Promise<void>): void {
  ui = elements;
  refreshAll = onOpened;
}

export function renderRepoHeader(): void {
  const { activeRepo } = getState();

  if (activeRepo) {
    ui.repoSegmentName.textContent = repoBaseName(activeRepo);
    ui.repoSegmentPath.textContent = activeRepo;
    ui.repoSegmentPath.title = activeRepo;
    return;
  }

  ui.repoSegmentName.textContent = 'None selected';
  ui.repoSegmentPath.textContent = '';
}

export function renderRepoLists(): void {
  const { recentRepos, activeRepo } = getState();
  renderRecentRepos(ui.repoDropdownList, ui.overlayRecentList, recentRepos, activeRepo);
  renderRepoHeader();
}

/** Native folder picker: Electron's dialog in desktop mode, the API otherwise. */
export async function pickFolderPath(): Promise<string> {
  if (window.desktopApi?.selectFolder) {
    return window.desktopApi.selectFolder();
  }

  return (await api.selectFolderViaServer()).path;
}

export async function browseAndOpen(): Promise<void> {
  logToTerminal('Opening folder browser...');

  try {
    const selectedPath = await pickFolderPath();
    if (selectedPath) {
      await openRepository(selectedPath);
    }
    // An empty path means the user cancelled; say nothing.
  } catch (error) {
    logToTerminal(`Could not open folder dialog: ${errorMessage(error)}`, 'error');
    showToast('Could not open the folder dialog. Is the backend server running?', 'error');
  }
}

export async function openRepository(repoPath: string): Promise<void> {
  if (!repoPath) {
    showToast('Select a valid repository path first.', 'warn');
    return;
  }

  closeAllDropdowns();
  logToTerminal(`Opening repository: ${repoPath}...`);

  try {
    const { repoPath: resolved, repoKey } = await api.rememberRepo(repoPath);
    const opened = resolved || repoPath;

    // Point the API client at the new repository before anything queries it,
    // so responses for the previous one are abandoned rather than applied.
    setActiveRepo(opened);
    update({ activeRepo: opened, activeRepoKey: repoKey || opened });

    ui.appContainer.classList.remove('disabled-view');
    setHidden(ui.noRepoOverlay, true);
    logToTerminal(`Loaded repository: ${repoPath}`, 'success');

    await loadConfig();

    // The origin URL is needed before auto-select rules can pick an account.
    await refreshOrigin();
    await restoreProfileForRepo(opened);

    renderRepoLists();
    await Promise.all([refreshAll(), refreshIdentity()]);
    renderAccounts();
  } catch (error) {
    if (isStale(error)) {
      return;
    }

    const message = errorMessage(error, 'Could not open repository');
    logToTerminal(`Failed to load repository: ${message}`, 'error');
    showToast(`Could not open repository: ${message}`, 'error', 7000);

    if (!getState().activeRepo) {
      setHidden(ui.noRepoOverlay, false);
      ui.appContainer.classList.add('disabled-view');
    }
  }
}

export async function forgetRepository(repoPath: string): Promise<void> {
  try {
    const { config } = await api.forgetRepo(repoPath);
    logToTerminal(`Removed ${repoPath} from recents.`);
    applyConfigSnapshot(config);
    renderRepoLists();
  } catch (error) {
    logToTerminal(`Error removing repository: ${errorMessage(error)}`, 'error');
  }
}

/** Reads the origin remote and updates the SSH/HTTPS toggle. */
export async function refreshOrigin(): Promise<void> {
  if (!getState().activeRepo) {
    update({ origin: null });
    renderRemoteProtocolButton();
    return;
  }

  try {
    update({ origin: await api.getOrigin() });
  } catch {
    // A repository with no origin is perfectly normal.
    update({ origin: null });
  }

  renderRemoteProtocolButton();
}

export function renderRemoteProtocolButton(): void {
  const { activeRepo, origin } = getState();
  const button = ui.btnRemoteProtocol as HTMLButtonElement;

  if (!activeRepo || !origin?.remoteUrl) {
    setHidden(button, true);
    return;
  }

  setHidden(button, false);

  if (!origin.canToggle) {
    button.disabled = true;
    ui.remoteProtocolLabel.textContent = 'Remote';
    button.title = `Origin: ${origin.remoteUrl}\nThis URL cannot be switched automatically.`;
    button.classList.remove('protocol-ssh', 'protocol-https');
    return;
  }

  const isSsh = origin.protocol === 'ssh';
  button.disabled = false;
  ui.remoteProtocolLabel.textContent = isSsh ? 'SSH' : 'HTTPS';
  button.classList.toggle('protocol-ssh', isSsh);
  button.classList.toggle('protocol-https', !isSsh);
  button.title = `Origin: ${origin.remoteUrl}\nClick to switch to ${isSsh ? 'HTTPS' : 'SSH'} (${origin.suggestedUrl})`;
}

// ---------- clone ----------

function setCloneFeedback(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  if (!message) {
    ui.cloneFeedback.className = 'inline-feedback hidden';
    ui.cloneFeedback.textContent = '';
    return;
  }

  ui.cloneFeedback.className = `inline-feedback ${type}`;
  ui.cloneFeedback.textContent = message;
}

export function openCloneModal(): void {
  closeAllDropdowns();

  const select = asSelect(ui.cloneProfileSelect);
  select.replaceChildren();

  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'System SSH (default)';
  select.appendChild(none);

  for (const profile of getState().sshProfiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.label;
    select.appendChild(option);
  }

  setCloneFeedback('');
  setHidden(ui.cloneModal, false);
  setTimeout(() => asInput(ui.cloneUrlInput).focus(), 30);
}

export async function browseCloneDestination(): Promise<void> {
  try {
    const selectedPath = await pickFolderPath();
    if (selectedPath) {
      asInput(ui.cloneParentDirInput).value = selectedPath;
    }
  } catch (error) {
    setCloneFeedback(`Could not open the folder dialog: ${errorMessage(error)}`, 'error');
  }
}

export async function startClone(): Promise<void> {
  const url = asInput(ui.cloneUrlInput).value.trim();
  const parentDir = asInput(ui.cloneParentDirInput).value.trim();
  const folderName = asInput(ui.cloneFolderNameInput).value.trim();
  const profileId = asSelect(ui.cloneProfileSelect).value;

  if (!url || !parentDir) {
    setCloneFeedback('Repository URL and destination folder are both required.', 'error');
    return;
  }

  setCloneFeedback('Cloning… this can take a while for large repositories.', 'info');
  logToTerminal(`git clone ${url}`, 'cmd');

  await withButtonBusy(ui.btnStartClone, async () => {
    try {
      const data = await api.clone({
        url,
        parentDir,
        ...(folderName ? { folderName } : {}),
        ...(profileId ? { profileId } : {})
      });

      logToTerminal(`Cloned into: ${data.repoPath}`, 'success');
      showToast(
        `Repository cloned${data.profileLabel ? ` with key "${data.profileLabel}"` : ''}.`,
        'success'
      );

      // Remember which key this repository should use from the start.
      if (profileId && data.repoPath) {
        localStorage.setItem(`ssh_key_${data.repoPath}`, profileId);
      }

      setHidden(ui.cloneModal, true);
      asInput(ui.cloneUrlInput).value = '';
      asInput(ui.cloneFolderNameInput).value = '';

      await openRepository(data.repoPath);
    } catch (error) {
      const message = errorMessage(error, 'Clone failed.');
      logToTerminal(message, 'error');
      setCloneFeedback(message, 'error');
      showToast('Clone failed.', 'error');
    }
  });
}
