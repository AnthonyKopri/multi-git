// The New Repository wizard.
import * as api from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { asInput, asSelect } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { getState, update } from '../../state/store';
import { repoBaseName } from '../../ui/format';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { closeAllDropdowns } from '../../ui/dropdown';
import { withButtonBusy } from '../../ui/busy';
import { openRepository } from '../repo';
import { profileIdentity } from '../accounts/identity';
import { describeAccountChoice, initialAccountChoice } from './account-choice';
import { joinRepoPath, repoNameProblem } from './folder-choice';
import { ensureKeyUsable } from '../accounts/unlock';
import type { NewRepoPreflightResponse } from '../../../shared/api-types';
import type { LicenseSummary } from '../../../shared/template-types';
import type { ClientSshProfile } from '../../../shared/config-types';

let ui: Elements;

/** The last parent folder used, offered again next time. */
const PARENT_KEY = 'mg_new_repo_parent';

/** The folder the repository will be made in: the name, inside the parent. */
function chosenRepoPath(): string {
  const parent = asInput(ui.newRepoParentInput).value.trim();
  const name = asInput(ui.newRepoNameInput).value.trim();
  return parent && name ? joinRepoPath(parent, name) : '';
}

function rememberedParent(): string {
  try {
    return localStorage.getItem(PARENT_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The account picked in the dialog, or null for System SSH. */
function chosenProfile(): ClientSshProfile | null {
  const id = asSelect(ui.newRepoProfileSelect).value;
  return getState().sshProfiles.find((profile) => profile.id === id) ?? null;
}

function renderAccountHint(): void {
  ui.newRepoProfileHint.textContent = describeAccountChoice(chosenProfile());
}

/**
 * Fills the account picker. It starts on the account set as the default for
 * new folders, then on the one this window is using, then on System SSH.
 */
function populateAccounts(): void {
  const { sshProfiles, defaultAccountProfileId, activeProfileId } = getState();
  const select = asSelect(ui.newRepoProfileSelect);

  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'System SSH (default)';

  select.replaceChildren(
    none,
    ...sshProfiles.map((profile) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.userEmail ? `${profile.label} (${profile.userEmail})` : profile.label;
      return option;
    })
  );
  select.value = initialAccountChoice(sshProfiles, defaultAccountProfileId, activeProfileId);
  renderAccountHint();
}

export function initNewRepo(elements: Elements): void {
  ui = elements;
  ui.newRepoProfileSelect.addEventListener('change', renderAccountHint);
}

type Tone = 'info' | 'error' | 'success' | 'warn';

function setFeedback(message: string, tone: Tone = 'info'): void {
  if (!message) {
    ui.newRepoFeedback.className = 'inline-feedback hidden';
    ui.newRepoFeedback.textContent = '';
    return;
  }

  ui.newRepoFeedback.className = `inline-feedback ${tone}`;
  ui.newRepoFeedback.textContent = message;
}

function setFieldHint(element: HTMLElement, message: string, tone = ''): void {
  if (!message) {
    element.className = 'field-hint hidden';
    element.textContent = '';
    return;
  }

  element.className = `field-hint${tone ? ` ${tone}` : ''}`;
  element.textContent = message;
}

/** The catalogue never changes while the app runs, so one fetch is enough. */
async function loadCatalogue(): Promise<void> {
  if (getState().templateCatalogue) {
    return;
  }
  update({ templateCatalogue: await api.getTemplateCatalogue() });
}

function findLicense(id: string): LicenseSummary | null {
  return getState().templateCatalogue?.licenses.find((entry) => entry.id === id) ?? null;
}

function populateTemplateSelects(): void {
  const catalogue = getState().templateCatalogue;
  if (!catalogue) {
    return;
  }

  const option = (value: string, label: string): HTMLOptionElement => {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  };

  const licenses = asSelect(ui.newRepoLicense);
  licenses.replaceChildren(
    option('none', 'None'),
    ...catalogue.licenses.map((entry) => option(entry.id, entry.name))
  );

  const gitignores = asSelect(ui.newRepoGitignore);
  gitignores.replaceChildren(
    option('none', 'None'),
    ...catalogue.gitignores.map((entry) => option(entry.id, entry.name)),
    option('custom', 'Custom (write my own)')
  );
}

/**
 * Pre-fills the copyright holder from a name the user already gave the app,
 * so the common case is a glance rather than retyping.
 */
function defaultLicenseHolder(): string {
  const state = getState();

  const picked = ui.newRepoProfileSelect ? chosenProfile() : null;
  if (picked?.userName) {
    return picked.userName;
  }
  const active = state.sshProfiles.find((profile) => profile.id === state.activeProfileId);
  if (active?.userName) {
    return active.userName;
  }
  if (state.identity?.name) {
    return state.identity.name;
  }

  return state.sshProfiles.find((profile) => profile.userName)?.userName ?? '';
}

export function onLicenseChanged(): void {
  const license = findLicense(asSelect(ui.newRepoLicense).value);
  setFieldHint(ui.newRepoLicenseSummary, license?.summary ?? '');

  const fields = license?.fields ?? [];
  setHidden(ui.newRepoLicenseFields, fields.length === 0);

  // Only show the inputs a template actually substitutes.
  ui.newRepoLicenseYear.closest('.form-group')?.classList.toggle('hidden', !fields.includes('year'));
  ui.newRepoLicenseHolder
    .closest('.form-group')
    ?.classList.toggle('hidden', !fields.includes('holder'));
}

export function onGitignoreChanged(): void {
  const isCustom = asSelect(ui.newRepoGitignore).value === 'custom';
  setFieldHint(
    ui.newRepoGitignoreHint,
    isCustom
      ? 'A starter .gitignore is created and opened in your default editor once the repository exists.'
      : ''
  );
}

/**
 * Reflects whether `gh` can be used.
 *
 * Visibility can only reach GitHub through the CLI — this app holds no API
 * token — so the checkbox is disabled and the reason spelled out whenever gh
 * is unavailable, rather than silently doing nothing.
 */
function renderGithubCliStatus(): void {
  const status = getState().githubCli;
  const checkbox = asInput(ui.newRepoCreateRemote);

  if (!status?.available) {
    checkbox.checked = false;
    checkbox.disabled = true;
    setFieldHint(
      ui.newRepoGhStatus,
      'GitHub CLI (gh) was not found, so this stays a local repository. Create the remote yourself to apply the visibility.',
      'warn'
    );
    return;
  }

  if (!status.authenticated) {
    checkbox.checked = false;
    checkbox.disabled = true;
    setFieldHint(
      ui.newRepoGhStatus,
      'GitHub CLI is installed but not signed in. Run "gh auth login" to create remotes from here.',
      'warn'
    );
    return;
  }

  checkbox.disabled = false;
  const account = status.account ? ` as ${status.account}` : '';
  setFieldHint(
    ui.newRepoGhStatus,
    // Says that turning this on commits, because that is the one thing here that
    // writes history rather than files, and it is not obvious from the label.
    `GitHub CLI is signed in${account}. Turning this on commits the folder's contents and pushes them; origin is switched to SSH first.`,
    'success'
  );
}

async function refreshGithubCliStatus(): Promise<void> {
  setFieldHint(ui.newRepoGhStatus, 'Looking for the GitHub CLI…');

  try {
    update({ githubCli: await api.getGithubCliStatus() });
  } catch {
    update({ githubCli: null });
  }

  renderGithubCliStatus();
}

function renderFolderHint(repoPath: string, info: NewRepoPreflightResponse): void {
  if (!info.folderExists) {
    setFieldHint(ui.newRepoFolderHint, `Creates ${repoPath}`);
    return;
  }
  if (!info.isDirectory) {
    setFieldHint(ui.newRepoFolderHint, 'That path is a file, not a folder.', 'warn');
    return;
  }
  if (info.isGitRepo) {
    setFieldHint(
      ui.newRepoFolderHint,
      'This folder is already a Git repository — use Open Folder instead.',
      'warn'
    );
    return;
  }

  const existing: string[] = [];
  if (info.existingLicense) {
    existing.push(info.existingLicense);
  }
  if (info.existingGitignore) {
    existing.push('.gitignore');
  }

  if (existing.length > 0) {
    setFieldHint(
      ui.newRepoFolderHint,
      `This folder already has ${existing.join(' and ')}. You will be asked before anything is replaced.`,
      'warn'
    );
    return;
  }

  setFieldHint(
    ui.newRepoFolderHint,
    info.isEmpty
      ? `${repoPath} already exists and is empty; it becomes the repository.`
      : `${repoPath} already exists; it becomes the repository and its files are left untouched.`
  );
}

export async function refreshFolderHint(): Promise<void> {
  const name = asInput(ui.newRepoNameInput).value;
  if (name.trim()) {
    const problem = repoNameProblem(name);
    if (problem) {
      setFieldHint(ui.newRepoFolderHint, problem, 'warn');
      return;
    }
  }

  const repoPath = chosenRepoPath();
  if (!repoPath) {
    setFieldHint(ui.newRepoFolderHint, '');
    return;
  }

  try {
    const info = await api.newRepoPreflight(repoPath);
    // The fields may have changed while the check was out.
    if (chosenRepoPath() === repoPath) {
      renderFolderHint(repoPath, info);
    }
  } catch (error) {
    setFieldHint(ui.newRepoFolderHint, errorMessage(error), 'warn');
  }
}

let hintTimer: ReturnType<typeof setTimeout> | undefined;

/** Checks the folder once typing in the name pauses, not on every key. */
export function scheduleFolderHint(): void {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => void refreshFolderHint(), 250);
}

export async function browseNewRepoFolder(): Promise<void> {
  const { pickFolderPath } = await import('../repo');

  try {
    const selectedPath = await pickFolderPath();
    if (!selectedPath) {
      return;
    }

    asInput(ui.newRepoParentInput).value = selectedPath;
    await refreshFolderHint();
    if (!asInput(ui.newRepoNameInput).value.trim()) {
      asInput(ui.newRepoNameInput).focus();
    }
  } catch (error) {
    const message = `Could not open the folder dialog: ${errorMessage(error)}`;
    logToTerminal(message, 'error');
    setFeedback(message, 'error');
  }
}

export async function openNewRepoModal(): Promise<void> {
  closeAllDropdowns();

  const parent = rememberedParent();
  asInput(ui.newRepoParentInput).value = parent;
  asInput(ui.newRepoNameInput).value = '';
  asSelect(ui.newRepoVisibility).value = 'private';
  asInput(ui.newRepoCreateRemote).checked = false;
  populateAccounts();
  asInput(ui.newRepoLicenseYear).value = String(new Date().getFullYear());
  asInput(ui.newRepoLicenseHolder).value = defaultLicenseHolder();

  setFeedback('');
  setFieldHint(ui.newRepoFolderHint, '');
  setHidden(ui.newRepoModal, false);
  // With a parent remembered, the name is the only thing left to type.
  setTimeout(() => asInput(parent ? ui.newRepoNameInput : ui.newRepoParentInput).focus(), 30);

  try {
    await loadCatalogue();
    populateTemplateSelects();
    asSelect(ui.newRepoLicense).value = 'none';
    // "General" is the sensible default when no specific stack is chosen.
    asSelect(ui.newRepoGitignore).value = 'general';
  } catch (error) {
    setFeedback(errorMessage(error, 'Could not load the license and .gitignore templates.'), 'error');
  }

  onLicenseChanged();
  onGitignoreChanged();
  void refreshGithubCliStatus();
}

async function openRepoFileInEditor(repoPath: string, filePath: string): Promise<void> {
  try {
    await api.openInEditor(repoPath, filePath);
    logToTerminal(`Opened ${filePath} in your default editor.`, 'success');
    showToast(`Opened ${filePath} for editing.`, 'info');
  } catch (error) {
    const message = errorMessage(error);
    logToTerminal(message, 'error');
    showToast(`Could not open ${filePath}: ${message}`, 'warn', 7000);
  }
}

export async function submitNewRepo(): Promise<void> {
  const parent = asInput(ui.newRepoParentInput).value.trim();
  if (!parent) {
    setFeedback('Choose the folder the new repository goes in.', 'error');
    asInput(ui.newRepoParentInput).focus();
    return;
  }

  const nameProblem = repoNameProblem(asInput(ui.newRepoNameInput).value);
  if (nameProblem) {
    setFeedback(nameProblem, 'error');
    asInput(ui.newRepoNameInput).focus();
    return;
  }

  const repoPath = chosenRepoPath();

  const licenseId = asSelect(ui.newRepoLicense).value;
  const gitignoreId = asSelect(ui.newRepoGitignore).value;
  const license = findLicense(licenseId);
  const licenseHolder = asInput(ui.newRepoLicenseHolder).value.trim();

  if (license?.fields.includes('holder') && !licenseHolder) {
    setFeedback(`The ${license.name} template needs a copyright holder name.`, 'error');
    asInput(ui.newRepoLicenseHolder).focus();
    return;
  }

  setFeedback('Checking the folder…', 'info');

  await withButtonBusy(ui.btnCreateNewRepo, async () => {
    try {
      // Re-inspect right before writing: the folder may have changed since
      // the path field was last touched.
      const info = await api.newRepoPreflight(repoPath);
      if (info.folderExists && !info.isDirectory) {
        setFeedback('That path is a file, not a folder.', 'error');
        return;
      }
      if (info.isGitRepo) {
        setFeedback('A Git repository already exists in this folder.', 'error');
        return;
      }

      const visibility = asSelect(ui.newRepoVisibility).value as 'private' | 'public';
      const remoteCheckbox = asInput(ui.newRepoCreateRemote);
      const createRemote = remoteCheckbox.checked && !remoteCheckbox.disabled;

      if (createRemote) {
        const account = getState().githubCli?.account;
        const { confirmed } = await confirmDialog(
          `Create the ${visibility} GitHub repository "${repoBaseName(repoPath)}"${account ? ` under ${account}` : ''}, then commit this folder's contents and push them to it?`,
          { title: 'Create repository on GitHub?', confirmLabel: 'Create and Publish' }
        );
        if (!confirmed) {
          setFeedback('Cancelled. Nothing was created.', 'info');
          return;
        }

        // The push at the end of the wizard authenticates with the same key
        // every other network operation uses, so ask for it here rather than
        // letting the push be the thing that discovers the key is locked.
        const picked = chosenProfile();
        if (!(await ensureKeyUsable({ reason: 'push', ...(picked ? { profileId: picked.id } : {}) }))) {
          setFeedback(
            'Cancelled: the selected SSH key is not unlocked, so the first push could not be made.',
            'error'
          );
          return;
        }
      }

      // Never replace a file the user wrote without asking.
      let replaceLicense = false;
      if (license && info.existingLicense) {
        const { confirmed } = await confirmDialog(
          `${info.existingLicense} already exists in this folder. Replace it with the ${license.name} template?`,
          { title: `Replace ${info.existingLicense}?`, confirmLabel: 'Replace', danger: true }
        );
        replaceLicense = confirmed;
      }

      let replaceGitignore = false;
      if (gitignoreId !== 'none' && info.existingGitignore) {
        const { confirmed } = await confirmDialog(
          gitignoreId === 'custom'
            ? '.gitignore already exists in this folder. Replace it with a fresh starter file?'
            : '.gitignore already exists in this folder. Replace it with the selected template?',
          { title: 'Replace .gitignore?', confirmLabel: 'Replace', danger: true }
        );
        replaceGitignore = confirmed;
      }

      setFeedback('Creating the repository…', 'info');
      logToTerminal(
        createRemote
          ? `git init "${repoPath}" && git add -A && git commit -m "Initial commit" && gh repo create && git push -u origin <branch>`
          : `git init "${repoPath}"`,
        'cmd'
      );

      try {
        localStorage.setItem(PARENT_KEY, parent);
      } catch {
        // Only a convenience for next time.
      }

      const profile = chosenProfile();
      const author = profileIdentity(profile);

      const data = await api.createNewRepo({
        repoPath,
        visibility,
        licenseId,
        licenseYear: asInput(ui.newRepoLicenseYear).value.trim(),
        licenseHolder,
        gitignoreId,
        replaceLicense,
        replaceGitignore,
        createRemote,
        useSshRemote: true,
        ...(author ? { authorName: author.name, authorEmail: author.email } : {}),
        ...(profile ? { profileId: profile.id, sshKeyPath: profile.privateKeyPath } : {})
      });

      for (const step of data.steps) {
        logToTerminal(step, 'success');
      }
      for (const warning of data.warnings) {
        logToTerminal(warning, 'error');
      }
      if (data.remote?.remoteUrl) {
        logToTerminal(`origin → ${data.remote.remoteUrl}`, 'success');
      }

      setHidden(ui.newRepoModal, true);
      showToast(
        data.pushed
          ? `Repository created at ${repoBaseName(data.repoPath)} and published to origin/${data.branch}.`
          : `Repository created at ${repoBaseName(data.repoPath)}.`,
        'success'
      );
      if (data.warnings[0]) {
        showToast(data.warnings[0], 'warn', 8000);
      }

      // Remembered before opening, so the repository opens already set to the
      // account picked here: its key for every push, and its name and email on
      // every commit. The same record a clone leaves.
      if (profile) {
        localStorage.setItem(`ssh_key_${data.repoPath}`, profile.id);
      }

      await openRepository(data.repoPath);

      if (data.openCustomGitignore) {
        await openRepoFileInEditor(data.repoPath, '.gitignore');
      }
    } catch (error) {
      const message = `Error creating repository: ${errorMessage(error)}`;
      logToTerminal(message, 'error');
      setFeedback(message, 'error');
    }
  });
}
