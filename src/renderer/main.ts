// Application bootstrap: resolve the DOM, wire the features together, and
// start.
//
// Every listener lives here rather than being scattered through the features,
// so the set of things the UI reacts to is readable in one place. Lists use
// delegation: one listener per container reading data-* attributes, instead of
// a closure per row rebuilt on every render.
import { asInput, resolveElements } from './dom/elements';
import type { Elements } from './dom/elements';
import { delegate, setHidden } from './dom/create';
import { getState, update } from './state/store';
import { isStale, errorMessage } from './api/client';
import * as api from './api/endpoints';

import { initToasts } from './ui/toast';
import { cancelOpenDialog, hasOpenDialog, initDialogs } from './ui/dialogs';
import { closeAllDropdowns, initDropdowns, registerDropdown } from './ui/dropdown';
import { initPanes } from './ui/panes';
import { logToTerminal, openLogWindow } from './ui/log';

import * as accounts from './features/accounts';
import * as branches from './features/branches';
import * as conflicts from './features/conflicts';
import * as diff from './features/diff';
import * as explorer from './features/explorer';
import * as history from './features/history';
import * as newRepo from './features/new-repo';
import * as pullRequest from './features/pull-request';
import * as repo from './features/repo';
import * as shelf from './features/shelf';
import * as ssh from './features/ssh-manager';
import * as staging from './features/staging';
import * as sync from './features/sync';
import * as workspace from './features/workspace';

import type { CommitType } from './features/commit/conventional';

let ui: Elements;

/**
 * Puts the running version in the page title.
 *
 * Only the browser tab needs this. The desktop window keeps the title the main
 * process gave it, because that process can read package.json and the renderer
 * cannot.
 */
async function applyAppTitle(): Promise<void> {
  try {
    const { title } = await api.getAppInfo();
    if (title !== '') {
      document.title = title;
    }
  } catch {
    // Not knowing the version is not worth an error; the static title stands.
  }
}

/** Refreshes everything that depends on the repository's current state. */
async function refreshStatus(): Promise<void> {
  try {
    update({ status: await api.getStatus() });
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Error loading Git status: ${errorMessage(error)}`, 'error');
    }
    return;
  }

  workspace.renderBranchHeader();
  workspace.renderConflictBanner();
  staging.renderStaging();
  diff.renderDiffActions();
}

async function refreshAll(): Promise<void> {
  if (!getState().activeRepo) {
    return;
  }

  ui.btnRefresh.classList.add('spinning');

  try {
    // Status first: the branch header and staging lists read from it.
    await refreshStatus();

    await Promise.all([
      branches.refreshBranchList(),
      history.refreshCommitHistory(),
      repo.refreshOrigin(),
      shelf.refreshStashList(),
      shelf.refreshSafetyNet(),
      shelf.refreshTagList()
    ]);
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Refresh failed: ${errorMessage(error)}`, 'error');
    }
  } finally {
    ui.btnRefresh.classList.remove('spinning');
  }
}

/** Closes whatever is topmost, so Escape always does the least surprising thing. */
function closeTopmostLayer(): void {
  if (hasOpenDialog()) {
    cancelOpenDialog();
    return;
  }

  const modals = [
    ui.vaultSetupModal,
    ui.newRepoModal,
    ui.cloneModal,
    ui.identityModal,
    ui.conflictModal,
    ui.sshHealthModal,
    ui.sshModal
  ];

  for (const modal of modals) {
    if (!modal.classList.contains('hidden')) {
      setHidden(modal, true);
      return;
    }
  }

  if (!ui.commitDetailsDrawer.classList.contains('hidden')) {
    history.closeCommitDrawer();
    return;
  }

  closeAllDropdowns();
}

function wireHeader(): void {
  registerDropdown(ui.repoSegment, ui.repoDropdown, () => repo.renderRepoLists());
  registerDropdown(ui.branchSegment, ui.branchDropdown, () => {
    asInput(ui.branchFilterInput).value = '';
    branches.renderBranchDropdown();
  });
  registerDropdown(ui.profileSegment, ui.profileDropdown, () => accounts.renderAccounts());

  ui.btnOpenRepo.addEventListener('click', () => void repo.browseAndOpen());
  ui.btnCreateRepo.addEventListener('click', () => void newRepo.openNewRepoModal());
  ui.btnCloneRepo.addEventListener('click', () => repo.openCloneModal());
  ui.btnManageSsh.addEventListener('click', () => ssh.openSshModal());
  ui.btnRefresh.addEventListener('click', () => void refreshAll());
  ui.btnOpenLogs.addEventListener('click', () => openLogWindow());

  ui.btnFetch.addEventListener('click', () => void sync.performSync('fetch'));
  ui.btnPull.addEventListener('click', () => void sync.performSync('pull'));
  ui.btnPush.addEventListener('click', () => void sync.performSync('push'));
  ui.btnRemoteProtocol.addEventListener('click', () => void sync.toggleRemoteProtocol());

  ui.btnEditIdentity.addEventListener('click', () => workspace.openIdentityModal());
  ui.btnDropdownVault.addEventListener('click', (event) => {
    event.stopPropagation();
    void (getState().vaultStatus.unlocked ? accounts.lockVault() : accounts.unlockVault());
  });

  // Repository dropdown and welcome overlay share a row shape.
  const repoRowHandler = (target: HTMLElement): void => {
    const path = target.dataset['path'];
    if (!path) {
      return;
    }

    if (target.dataset['action'] === 'forget') {
      void repo.forgetRepository(path);
      return;
    }

    closeAllDropdowns();
    if (path !== getState().activeRepo) {
      void repo.openRepository(path);
    }
  };

  delegate(ui.repoDropdownList, 'click', '[data-path]', repoRowHandler);
  delegate(ui.overlayRecentList, 'click', '[data-path]', repoRowHandler);

  delegate(ui.branchDropdownList, 'click', '[data-branch]', (target) => {
    closeAllDropdowns();
    if (target.dataset['current'] !== 'true') {
      void branches.switchBranch(
        target.dataset['branch'] as string,
        target.dataset['remote'] === 'true'
      );
    }
  });
  ui.branchFilterInput.addEventListener('input', () => branches.renderBranchDropdown());

  delegate(ui.profileDropdownList, 'click', '[data-profile-id]', (target) => {
    closeAllDropdowns();
    const id = target.dataset['profileId'] ?? '';
    if (id !== getState().activeProfileId) {
      void accounts.setActiveProfile(id);
    }
  });

  ui.btnHeaderCreateBranch.addEventListener('click', () => {
    void branches.createBranchFromInput(asInput(ui.headerNewBranchInput));
  });
  ui.headerNewBranchInput.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      void branches.createBranchFromInput(asInput(ui.headerNewBranchInput));
    }
  });
}

function wireWorkspaceTabs(): void {
  ui.tabStaging.addEventListener('click', () => workspace.switchViewTab('staging'));
  ui.tabDiff.addEventListener('click', () => workspace.switchViewTab('diff'));
  ui.tabExplorer.addEventListener('click', () => workspace.switchViewTab('explorer'));

  ui.btnDiffBack.addEventListener('click', () => workspace.switchViewTab('staging'));
}

function wireStaging(): void {
  // One handler per list. The row carries what it is; the button, if any,
  // carries what to do with it.
  const fileRowHandler = (target: HTMLElement, event: MouseEvent): void => {
    const path = target.dataset['path'];
    const statusChar = target.dataset['status'] ?? '';
    const isStaged = target.dataset['staged'] === 'true';
    if (!path) {
      return;
    }

    const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset[
      'action'
    ];

    if (action === 'resolve') {
      void conflicts.openConflictResolver(path);
      return;
    }
    if (action === 'ignore') {
      void staging.ignoreFile(path);
      return;
    }
    if (action === 'diff') {
      workspace.switchViewTab('diff');
      void diff.loadDiff(path, isStaged, statusChar === '?', statusChar);
      return;
    }
    if (action === 'discard') {
      void staging.discardChanges(path, statusChar === '?');
      return;
    }

    // A click on the row itself toggles staged state.
    if (statusChar === 'U') {
      void conflicts.openConflictResolver(path);
      return;
    }
    void (isStaged ? staging.unstageFiles([path]) : staging.stageFiles([path]));
  };

  delegate(ui.unstagedFilesList, 'click', 'li[data-path]', fileRowHandler);
  delegate(ui.stagedFilesList, 'click', 'li[data-path]', fileRowHandler);

  // The File Diff picker selects rather than stages.
  delegate(ui.diffFilesList, 'click', 'li[data-path]', (target) => {
    const path = target.dataset['path'] as string;
    const statusChar = target.dataset['status'] ?? '';
    void diff.loadDiff(path, target.dataset['staged'] === 'true', statusChar === '?', statusChar);
  });

  ui.btnStageAll.addEventListener('click', () => void staging.stageFiles(['.']));
  ui.btnUnstageAll.addEventListener('click', () => void staging.unstageFiles(['.']));
  ui.btnDiscardAll.addEventListener('click', () => void staging.discardAllChanges());

  ui.filenameWrapToggle.addEventListener('change', (event) => {
    staging.setFilenameWrapping((event.target as HTMLInputElement).checked);
  });

  ui.btnDiffToggleStage.addEventListener('click', () => {
    const active = getState().activeDiffFile;
    if (active) {
      void (active.staged ? staging.unstageFiles([active.path]) : staging.stageFiles([active.path]));
    }
  });
  ui.btnDiffDiscard.addEventListener('click', () => {
    const active = getState().activeDiffFile;
    if (active) {
      void staging.discardChanges(active.path, active.statusChar === '?');
    }
  });
  ui.btnDiffRefresh.addEventListener('click', () => {
    const active = getState().activeDiffFile;
    if (active) {
      void diff.loadDiff(active.path, active.staged, active.statusChar === '?', active.statusChar);
    }
  });
}

function wireCommitBox(): void {
  ui.btnCommit.addEventListener('click', () => void staging.commitChanges());
  ui.btnUndoCommit.addEventListener('click', () => void staging.undoLastCommit());

  ui.commitMsgInput.addEventListener('input', () => staging.updateCommitFormatHint());
  ui.commitMsgInput.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;
    // Ctrl+Enter commits, matching the convention in most Git clients.
    if (key.key === 'Enter' && (key.ctrlKey || key.metaKey)) {
      event.preventDefault();
      void staging.commitChanges();
    }
  });

  ui.commitScopeInput.addEventListener('input', () => staging.renderCommitTemplateChips());
  ui.commitAmendCheckbox.addEventListener('change', () => void staging.onAmendToggle());

  delegate(ui.commitTemplateChips, 'click', '[data-commit-type]', (target) => {
    staging.insertCommitTemplate(target.dataset['commitType'] as CommitType);
  });
}

function wireBranchPanel(): void {
  ui.btnCreateBranch.addEventListener('click', () => {
    void branches.createBranchFromInput(asInput(ui.newBranchInput));
  });
  ui.newBranchInput.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      void branches.createBranchFromInput(asInput(ui.newBranchInput));
    }
  });

  const branchRowHandler = (target: HTMLElement, event: MouseEvent): void => {
    const branch = target.dataset['branch'];
    if (!branch) {
      return;
    }

    const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset[
      'action'
    ];

    if (action === 'delete') {
      void branches.deleteBranch(branch);
      return;
    }
    void branches.switchBranch(branch, target.dataset['remote'] === 'true');
  };

  delegate(ui.localBranchesList, 'click', 'li[data-branch]', branchRowHandler);
  delegate(ui.remoteBranchesList, 'click', 'li[data-branch]', branchRowHandler);

  ui.btnMerge.addEventListener('click', () => void branches.runIntegration('merge'));
  ui.btnRebase.addEventListener('click', () => void branches.runIntegration('rebase'));
  ui.btnAbortConflict.addEventListener('click', () => void branches.abortIntegration());
  ui.btnContinueConflict.addEventListener('click', () => void branches.continueIntegration());
}

function wireShelves(): void {
  ui.btnStashSave.addEventListener('click', () => void shelf.stashChanges());

  delegate(ui.stashList, 'click', '[data-action]', (target) => {
    const ref = target.closest<HTMLElement>('[data-ref]')?.dataset['ref'];
    if (!ref) {
      return;
    }

    const action = target.dataset['action'];
    if (action === 'drop') {
      void shelf.dropStash(ref);
    } else {
      void shelf.applyStash(ref, action === 'pop');
    }
  });

  delegate(ui.tagList, 'click', '[data-action]', (target) => {
    const row = target.closest<HTMLElement>('[data-tag]');
    const tag = row?.dataset['tag'];
    if (!tag) {
      return;
    }

    const action = target.dataset['action'];
    if (action === 'push') {
      void shelf.pushTag(tag);
    } else if (action === 'delete') {
      void shelf.deleteTag(tag);
    }
    // "show" needs the tag's commit, which the list does not carry; the
    // History panel is the place to inspect it.
  });

  delegate(ui.checkpointList, 'click', '[data-action="undo"]', (target) => {
    const row = target.closest<HTMLElement>('[data-checkpoint-id]');
    if (row?.dataset['checkpointId']) {
      void shelf.undoOperation(row.dataset['checkpointId'], row.dataset['label'] ?? 'operation');
    }
  });

  delegate(ui.trashList, 'click', '[data-action="restore"]', (target) => {
    const row = target.closest<HTMLElement>('[data-trash-id]');
    if (row?.dataset['trashId']) {
      void shelf.restoreTrashEntry(row.dataset['trashId'], row.dataset['path'] ?? '');
    }
  });
}

function wireHistory(): void {
  delegate(ui.commitHistoryList, 'click', 'li[data-hash]', (target) => {
    void history.showCommitDetails(target.dataset['hash'] as string);
  });

  ui.btnCloseDrawer.addEventListener('click', () => history.closeCommitDrawer());
  ui.btnDrawerCherryPick.addEventListener('click', () => void history.drawerCherryPick());
  ui.btnDrawerRevert.addEventListener('click', () => void history.drawerRevert());
  ui.btnDrawerReset.addEventListener('click', () => void history.drawerReset());
  ui.btnDrawerTag.addEventListener('click', () => void history.drawerCreateTag());
  ui.btnDrawerCopySha.addEventListener('click', () => void history.drawerCopySha());

  delegate(ui.drawerFilesList, 'click', 'li[data-action]', (target, event) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset[
      'action'
    ];

    if (action === 'file-history') {
      const path = (event.target as Element).closest<HTMLElement>('[data-path]')?.dataset['path'];
      if (path) {
        void history.showFileHistory(path);
      }
      return;
    }

    if (target.dataset['action'] === 'open-commit') {
      void history.showCommitDetails(target.dataset['hash'] as string);
      return;
    }

    const path = target.dataset['path'];
    const hash = target.dataset['hash'];
    if (path && hash) {
      void history.showCommitFileDiff(hash, path);
    }
  });
}

function wireExplorer(): void {
  ui.btnRefreshTree.addEventListener('click', () => void explorer.loadWorkspaceTree());
  ui.btnToggleBlame.addEventListener('click', () => void explorer.toggleBlameView());

  delegate(ui.fileTreeContainer, 'click', '.tree-item', async (target) => {
    const path = target.dataset['path'];
    if (!path) {
      return;
    }

    if (target.dataset['type'] === 'directory') {
      const { toggleDirectory } = await import('./features/explorer/file-tree');
      toggleDirectory(target, explorer.lookupTreeNode);
      return;
    }

    void explorer.openExplorerFile(path, target.dataset['untracked'] === 'true');
  });

  // Blame rows link back to the commit that last touched the line.
  delegate(ui.explorerFileBody, 'click', '[data-commit-hash]', (target) => {
    void explorer.openBlameCommit(target.dataset['commitHash'] as string);
  });
}

function wireModals(): void {
  // Conflict editor
  ui.btnCloseConflictModal.addEventListener('click', () => setHidden(ui.conflictModal, true));
  ui.btnCancelConflictModal.addEventListener('click', () => setHidden(ui.conflictModal, true));
  ui.btnConflictKeepOurs.addEventListener('click', () => conflicts.applyConflictChoice('ours'));
  ui.btnConflictKeepTheirs.addEventListener('click', () => conflicts.applyConflictChoice('theirs'));
  ui.btnSaveConflictResolution.addEventListener('click', () => void conflicts.saveConflictResolution());

  // Clone
  ui.btnCloseCloneModal.addEventListener('click', () => setHidden(ui.cloneModal, true));
  ui.btnCancelClone.addEventListener('click', () => setHidden(ui.cloneModal, true));
  ui.btnCloneBrowse.addEventListener('click', () => void repo.browseCloneDestination());
  ui.cloneForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void repo.startClone();
  });

  // Identity
  ui.btnCloseIdentityModal.addEventListener('click', () => setHidden(ui.identityModal, true));
  ui.btnCancelIdentity.addEventListener('click', () => setHidden(ui.identityModal, true));
  ui.identityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void workspace.saveIdentity();
  });

  // New repository wizard
  ui.btnCloseNewRepoModal.addEventListener('click', () => setHidden(ui.newRepoModal, true));
  ui.btnCancelNewRepo.addEventListener('click', () => setHidden(ui.newRepoModal, true));
  ui.btnNewRepoBrowse.addEventListener('click', () => void newRepo.browseNewRepoFolder());
  ui.newRepoPathInput.addEventListener('change', () => void newRepo.refreshFolderHint());
  ui.newRepoLicense.addEventListener('change', () => newRepo.onLicenseChanged());
  ui.newRepoGitignore.addEventListener('change', () => newRepo.onGitignoreChanged());
  ui.newRepoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void newRepo.submitNewRepo();
  });

  // SSH health banner
  ui.btnSshHealthDismiss.addEventListener('click', () => setHidden(ui.sshHealthModal, true));
  ui.btnSshHealthOpen.addEventListener('click', () => {
    setHidden(ui.sshHealthModal, true);
    ssh.openSshModal({ showForm: 'existing' });
  });

  // Welcome overlay
  ui.btnOverlayOpen.addEventListener('click', () => void repo.browseAndOpen());
  ui.btnOverlayCreate.addEventListener('click', () => void newRepo.openNewRepoModal());
  ui.btnOverlayClone.addEventListener('click', () => repo.openCloneModal());
  ui.btnOverlaySsh.addEventListener('click', () => ssh.openSshManagerForSetup());
}

function wireSshManager(): void {
  ui.btnCloseSshModal.addEventListener('click', () => setHidden(ui.sshModal, true));
  ui.btnCancelSsh.addEventListener('click', () => ssh.hideKeyForms());

  ui.btnShowAddKey.addEventListener('click', () => ssh.showKeyForm('existing'));
  ui.btnHideAddKey.addEventListener('click', () => ssh.hideKeyForms());
  ui.btnShowGenerateKey.addEventListener('click', () => ssh.showKeyForm('generate'));
  ui.btnHideGenerateKey.addEventListener('click', () => ssh.hideKeyForms());

  ui.sshProfileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void ssh.saveSshProfile();
  });
  ui.sshGenerateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void ssh.generateSshKeyAndProfile();
  });
  ui.btnTestSshForm.addEventListener('click', () => void ssh.testSshForm());

  ui.btnCopyGeneratedPrivatePath.addEventListener('click', () => void ssh.copyGeneratedValue('private'));
  ui.btnCopyGeneratedPublicPath.addEventListener('click', () => void ssh.copyGeneratedValue('public'));
  ui.btnCopyGeneratedPublicKey.addEventListener('click', () => void ssh.copyGeneratedValue('key'));
  ui.btnOpenGeneratedLocation.addEventListener('click', () => void ssh.openGeneratedLocation());

  // Registered-profile table actions.
  delegate(ui.sshProfilesTableBody, 'click', '[data-action]', (target) => {
    const id = target.dataset['profileId'];
    const profile = getState().sshProfiles.find((candidate) => candidate.id === id);
    if (!profile) {
      return;
    }

    switch (target.dataset['action']) {
      case 'edit':
        ssh.loadProfileIntoForm(profile);
        break;
      case 'test':
        void ssh.testSshProfile(profile.id, profile.label);
        break;
      case 'copy-key':
        void ssh.copyProfilePublicKey(profile);
        break;
      case 'copy-path':
        void ssh.copyProfilePublicKeyPath(profile);
        break;
      case 'open-folder':
        void ssh.openProfileKeyFolder(profile);
        break;
      case 'delete':
        void ssh.deleteSshProfile(profile.id, profile.label);
        break;
    }
  });

  // Vault
  ui.btnSetupVault.addEventListener('click', () => ssh.openVaultSetupModal());
  ui.btnUnlockVault.addEventListener('click', () => void accounts.unlockVault());
  ui.btnLockVault.addEventListener('click', () => void accounts.lockVault());
  ui.btnCancelVaultSetup.addEventListener('click', () => ssh.closeVaultSetupModal());
  ui.vaultSetupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void ssh.setupVault();
  });

  // Auto-select rules
  ui.btnAddRule.addEventListener('click', () => void accounts.addAccountRule());
  delegate(ui.accountRulesList, 'click', '[data-action="delete-rule"]', (target) => {
    const id = target.dataset['ruleId'];
    if (id) {
      void accounts.deleteAccountRule(id);
    }
  });

  ui.sshManageConfigCheckbox.addEventListener('change', (event) => {
    void accounts.onManageSshConfigChanged((event.target as HTMLInputElement).checked);
  });
}

function wireGlobal(): void {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeTopmostLayer();
    }
  });

  // Picking up changes made outside the app, without polling.
  let lastFocusRefresh = 0;
  window.addEventListener('focus', () => {
    const now = Date.now();
    if (getState().activeRepo && now - lastFocusRefresh > 5000) {
      lastFocusRefresh = now;
      void refreshAll();
    }
  });
}

async function start(): Promise<void> {
  ui = resolveElements();

  initToasts(ui.toastContainer);
  initDialogs(ui);
  initDropdowns();
  initPanes();

  accounts.initAccounts(ui);
  repo.initRepo(ui, refreshAll);
  newRepo.initNewRepo(ui);
  branches.initBranches(ui, refreshAll);
  shelf.initShelf(ui, refreshAll);
  sync.initSync(ui, refreshAll);
  diff.initDiff(ui);
  staging.initStaging(ui, { refreshAll, refreshStatus, clearDiffView: diff.clearDiffView });
  conflicts.initConflicts(ui, refreshStatus);
  explorer.initExplorer(ui, { showCommitDetails: history.showCommitDetails });
  history.initHistory(ui, { refreshAll, showDiffTab: () => workspace.switchViewTab('diff') });
  ssh.initSshManager(ui);
  pullRequest.initPullRequests(ui, { refreshStatus });
  workspace.initWorkspace(ui, { refreshStatus });

  wireHeader();
  wireWorkspaceTabs();
  wireStaging();
  wireCommitBox();
  wireBranchPanel();
  wireShelves();
  wireHistory();
  wireExplorer();
  wireModals();
  wireSshManager();
  wireGlobal();

  repo.renderRepoHeader();
  workspace.renderBranchHeader();
  staging.renderCommitTemplateChips();
  diff.clearDiffView();

  await accounts.loadConfig();
  repo.renderRepoLists();

  // Fire and forget: neither a slow key check nor a title lookup should delay
  // the first paint.
  void accounts.validateSshProfilesOnStartup();
  void applyAppTitle();

  const { recentRepos } = getState();
  if (recentRepos.length > 0) {
    logToTerminal('Auto-loading last opened repository...');
    await repo.openRepository(recentRepos[0] as string);
    return;
  }

  setHidden(ui.noRepoOverlay, false);
  ui.appContainer.classList.add('disabled-view');
}

// The bundle is loaded with a plain <script> tag at the end of <body>, so the
// DOM is already parsed; DOMContentLoaded may have fired.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void start());
} else {
  void start();
}
