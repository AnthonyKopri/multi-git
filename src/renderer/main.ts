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
import { initPanes, toggleSide } from './ui/panes';
import { initCollapsibleSections } from './ui/sections';
import { attachHorizontalWheel } from './ui/wheel-scroll';
import { logToTerminal, openLogWindow } from './ui/log';

import * as accounts from './features/accounts';
import * as branches from './features/branches';
import * as conflicts from './features/conflicts';
import * as diff from './features/diff';
import * as explorer from './features/explorer';
import * as history from './features/history';
import * as newRepo from './features/new-repo';
import * as pullRequest from './features/pull-request';
import * as branchAdmin from './features/branch-admin';
import * as palette from './features/palette';
import * as rebase from './features/rebase';
import * as recovery from './features/recovery';
import * as search from './features/search';
import * as signing from './features/signing';
import * as repo from './features/repo';
import * as shelf from './features/shelf';
import * as ssh from './features/ssh-manager';
import * as staging from './features/staging';
import * as sync from './features/sync';
import * as workspace from './features/workspace';
import * as worktrees from './features/worktrees';
import * as groups from './features/groups';
import * as agents from './features/agents';
import * as repoHub from './features/repo-hub';
import { openRepoInNewWindow } from './features/windows';
import { unlockSelectedKey } from './features/accounts/unlock';

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
      shelf.refreshTagList(),
      recovery.refreshRecovery(),
      signing.refreshCommitSignControl(),
      worktrees.refreshWorktrees()
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
    ui.paletteModal,
    ui.signingModal,
    ui.rebaseModal,
    ui.searchModal,
    ui.branchAdminModal,
    ui.recoveryModal,
    // Innermost first: the launch dialog and the group editor open on top of
    // the managers behind them, so Escape must close those before their parent.
    ui.agentLaunchModal,
    ui.groupEditorModal,
    ui.agentsModal,
    ui.worktreeModal,
    ui.repoHubModal,
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

  ui.btnDiffLayout.addEventListener('click', () => diff.toggleLayout());
  ui.diffWhitespace.addEventListener('change', (event) => {
    const mode = (event.target as HTMLSelectElement).value;
    diff.setWhitespaceMode(mode as 'show' | 'ignore-change' | 'ignore-all');
  });

  wirePrecisionStaging();
}

/** Line and hunk level actions inside the diff pane. */
function wirePrecisionStaging(): void {
  // One listener for a pane that can hold tens of thousands of rows. A hunk
  // button wins over the row it sits in, so clicking Stage does not also
  // toggle a selection underneath it.
  delegate(ui.diffContent, 'click', '[data-hunk-action], [data-line-id]', (target, event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-hunk-action]');

    if (button) {
      event.stopPropagation();
      diff.applyHunk(
        button.dataset['hunkAction'] as 'stage' | 'unstage' | 'discard',
        button.dataset['hunkId'] as string
      );
      return;
    }

    const lineId = target.dataset['lineId'];
    if (lineId) {
      diff.toggleLineSelection(lineId);
    }
  });

  // Space and Enter on a focused line, so a selection can be built without a
  // mouse. The rows carry role="checkbox", which is the behaviour that implies.
  ui.diffContent.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;
    if (key.key !== ' ' && key.key !== 'Enter') {
      return;
    }

    const row = (event.target as Element).closest<HTMLElement>('[data-line-id]');
    if (row?.dataset['lineId']) {
      event.preventDefault();
      diff.toggleLineSelection(row.dataset['lineId']);
    }
  });

  ui.btnDiffStageSelection.addEventListener('click', () => diff.applySelectedLines('stage'));
  ui.btnDiffUnstageSelection.addEventListener('click', () => diff.applySelectedLines('unstage'));
  ui.btnDiffDiscardSelection.addEventListener('click', () => diff.applySelectedLines('discard'));
  ui.btnDiffClearSelection.addEventListener('click', () => diff.clearLineSelection());
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

  let stashFilterTimer: ReturnType<typeof setTimeout> | null = null;
  ui.stashSearch.addEventListener('input', (event) => {
    // A search that looks inside every stash is one git call per stash, so it
    // waits for the typing to stop rather than running per keystroke.
    if (stashFilterTimer !== null) {
      clearTimeout(stashFilterTimer);
    }
    const value = (event.target as HTMLInputElement).value;
    stashFilterTimer = setTimeout(() => shelf.setStashQuery(value), 250);
  });

  delegate(ui.stashList, 'click', '[data-action]', (target) => {
    const ref = target.closest<HTMLElement>('[data-ref]')?.dataset['ref'];
    if (!ref) {
      return;
    }

    switch (target.dataset['action']) {
      case 'drop':
        void shelf.dropStash(ref);
        return;
      case 'inspect':
        void shelf.inspectStash(ref);
        return;
      case 'branch':
        void shelf.branchFromStash(ref);
        return;
      case 'apply-index':
        void shelf.applyStash(ref, false, true);
        return;
      case 'pop':
        void shelf.applyStash(ref, true);
        return;
      default:
        void shelf.applyStash(ref, false);
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

  ui.btnRecoveryOpen.addEventListener('click', () => recovery.openRecoveryBrowser());
  ui.btnCloseRecoveryModal.addEventListener('click', () => recovery.closeRecoveryBrowser());
  wireWorktrees();
  wireGroups();
  wireAgents();
  delegate(ui.recoveryPointsList, 'click', '[data-action]', recovery.handleRecoveryAction);
  delegate(ui.recoveryReflogList, 'click', '[data-action]', recovery.handleRecoveryAction);

  delegate(ui.trashList, 'click', '[data-action="restore"]', (target) => {
    const row = target.closest<HTMLElement>('[data-trash-id]');
    if (row?.dataset['trashId']) {
      void shelf.restoreTrashEntry(row.dataset['trashId'], row.dataset['path'] ?? '');
    }
  });
}

function wireWorktrees(): void {
  ui.btnWorktreeManage.addEventListener('click', () => worktrees.openWorktreeManager());
  ui.btnCloseWorktreeModal.addEventListener('click', () => worktrees.closeWorktreeManager());

  // One handler per list, both dispatching on the row's data-worktree-path.
  delegate(ui.worktreeList, 'click', '[data-worktree-path]', worktrees.handleWorktreeAction);
  delegate(ui.worktreeManagerList, 'click', '[data-worktree-path]', worktrees.handleWorktreeAction);

  ui.worktreeBranchMode.addEventListener('change', () => worktrees.onCreateFormChanged());
  ui.worktreeBranchInput.addEventListener('input', () => worktrees.onCreateFormChanged());
  ui.worktreePathInput.addEventListener('input', () => worktrees.markPathTouched());
  ui.btnWorktreeBrowse.addEventListener('click', () => void worktrees.browseWorktreeParent());
  ui.btnWorktreeRepair.addEventListener('click', () => void worktrees.repairWorktreeLinks());

  ui.worktreeCreateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void worktrees.submitCreateWorktree();
  });
}

function wireGroups(): void {
  ui.btnGroupCreate.addEventListener('click', () => void groups.createGroup());
  delegate(ui.groupList, 'click', '[data-group-id]', groups.handleGroupAction);

  ui.btnCloseGroupEditor.addEventListener('click', () => groups.closeGroupEditor());
  ui.btnCancelGroupEditor.addEventListener('click', () => groups.closeGroupEditor());
  ui.btnSaveGroupMembers.addEventListener('click', () => void groups.saveGroupMembers());
}

function wireAgents(): void {
  ui.btnCloseAgentsModal.addEventListener('click', () => agents.closeAgentManager());
  ui.btnDetectAgents.addEventListener('click', () => void agents.detectInstalledAgents());
  delegate(ui.agentList, 'click', '[data-agent-id]', agents.handleAgentAction);

  ui.agentForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void agents.submitAgentForm();
  });

  ui.btnCloseAgentLaunch.addEventListener('click', () => agents.closeLaunchDialog());
  ui.btnCancelAgentLaunch.addEventListener('click', () => agents.closeLaunchDialog());
  ui.agentLaunchSelect.addEventListener('change', () => agents.onLaunchAgentChanged());
  ui.agentLaunchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void agents.submitLaunch();
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

/**
 * The command palette and the two screens it is the fastest way to reach.
 *
 * The palette's command set is rebuilt on open rather than held: what is worth
 * offering depends on whether a repository is open and which branch it is on.
 */
function wireDiscovery(): void {
  palette.attachPaletteInput();
  search.wireSearch();
  rebase.wireRebase();
  signing.wireSigning();
  branchAdmin.wireBranchAdmin({ compareWith: search.openCompareWith });

  palette.setCommands(buildCommands());

  delegate(ui.paletteList, 'click', '[data-command-id]', (target) => {
    palette.runCommandById(target.dataset['commandId'] as string);
  });
}

/** Everything the palette can start. Destructive entries still confirm. */
function buildCommands(): palette.Command[] {
  const branch = (): string => getState().status?.branch ?? 'HEAD';

  return [
    { id: 'search', group: 'Find', title: 'Search commits', keywords: 'log grep history', run: () => search.openSearch('commits') },
    { id: 'compare', group: 'Find', title: 'Compare two refs', keywords: 'diff ahead behind', run: () => search.openSearch('compare') },
    { id: 'compare-upstream', group: 'Find', title: 'Compare this branch with its upstream', keywords: 'ahead behind', run: () => search.openCompareWith(`origin/${branch()}`, branch()) },
    { id: 'signing', group: 'Accounts', title: 'Commit signing settings', keywords: 'gpg ssh sign verify', run: () => void signing.openSigningSettings() },
    { id: 'rebase', group: 'History', title: 'Interactive rebase', keywords: 'squash reword reorder drop fixup split', run: () => void rebase.openRebase() },
    { id: 'branches', group: 'Branch', title: 'Branch maintenance', keywords: 'prune stale merged rename pin delete', run: () => branchAdmin.openBranchAdmin() },
    { id: 'recovery', group: 'Safety Net', title: 'Recovery points and reflog', keywords: 'undo restore reflog', run: () => recovery.openRecoveryBrowser() },
    { id: 'refresh', group: 'Repository', title: 'Refresh everything', keywords: 'reload', run: () => void refreshAll() },
    { id: 'open-repo', group: 'Repository', title: 'Open a repository', keywords: 'folder', run: () => void repo.browseAndOpen() },
    { id: 'clone', group: 'Repository', title: 'Clone a repository', run: () => repo.openCloneModal() },
    { id: 'new-repo', group: 'Repository', title: 'Create a repository', run: () => void newRepo.openNewRepoModal() },
    { id: 'stage-all', group: 'Staging', title: 'Stage everything', run: () => void staging.stageFiles(['.']) },
    { id: 'unstage-all', group: 'Staging', title: 'Unstage everything', run: () => void staging.unstageFiles(['.']) },
    { id: 'discard-all', group: 'Staging', title: 'Discard all changes', keywords: 'revert reset working tree', run: () => void staging.discardAllChanges() },
    { id: 'stash', group: 'Stash', title: 'Stash changes', run: () => void shelf.stashChanges() },
    { id: 'fetch', group: 'Sync', title: 'Fetch', run: () => void sync.performSync('fetch') },
    { id: 'pull', group: 'Sync', title: 'Pull', run: () => void sync.performSync('pull') },
    { id: 'push', group: 'Sync', title: 'Push', run: () => void sync.performSync('push') },
    { id: 'pull-request', group: 'Sync', title: 'Create a pull request', keywords: 'pr github', run: () => void pullRequest.openCreator() },
    { id: 'diff-tab', group: 'View', title: 'Go to the File Diff tab', run: () => workspace.switchViewTab('diff') },
    { id: 'staging-tab', group: 'View', title: 'Go to the Staging Area', run: () => workspace.switchViewTab('staging') },
    { id: 'explorer-tab', group: 'View', title: 'Go to the Explorer', run: () => workspace.switchViewTab('explorer') },
    { id: 'ssh', group: 'Accounts', title: 'Manage SSH profiles', keywords: 'keys accounts', run: () => ssh.openSshModal() },
    { id: 'unlock-key', group: 'Accounts', title: 'Unlock the selected SSH key', keywords: 'passphrase vault agent load', run: () => void unlockSelectedKey() },
    { id: 'worktrees', group: 'Worktrees', title: 'Manage worktrees', keywords: 'worktree create remove branch folder', run: () => worktrees.openWorktreeManager() },
    { id: 'new-window', group: 'Worktrees', title: 'Open this repository in a new window', keywords: 'window split', run: () => void openRepoInNewWindow(getState().activeRepo ?? '') },
    { id: 'agent-launch', group: 'Worktrees', title: 'Launch a coding agent here', keywords: 'claude codex tool', run: () => void agents.launchAgentForActiveRepo() },
    { id: 'agent-settings', group: 'Worktrees', title: 'Coding agent settings', keywords: 'claude codex configure', run: () => agents.openAgentManager() },
    { id: 'group-new', group: 'Repository', title: 'Create a repository group', keywords: 'group fetch all', run: () => void groups.createGroup() },
    { id: 'remotes', group: 'Repository', title: 'Manage remotes', keywords: 'origin url fetch push refspec prune', run: () => repoHub.openRepoHub('remotes') },
    { id: 'submodules', group: 'Repository', title: 'Manage submodules', keywords: 'gitmodules init update sync', run: () => repoHub.openRepoHub('submodules') },
    { id: 'lfs', group: 'Repository', title: 'Git LFS', keywords: 'large file storage pointer lock track', run: () => repoHub.openRepoHub('lfs') },
    { id: 'patches', group: 'Repository', title: 'Create or apply a patch', keywords: 'diff format-patch am apply mailbox', run: () => repoHub.openRepoHub('patches') },
    { id: 'bisect', group: 'History', title: 'Bisect', keywords: 'good bad regression find', run: () => repoHub.openRepoHub('bisect') },
    { id: 'notes', group: 'History', title: 'Git notes', keywords: 'annotate note ref', run: () => repoHub.openRepoHub('notes') },
    { id: 'external-tools', group: 'Repository', title: 'External tool settings', keywords: 'diff merge editor terminal explorer', run: () => repoHub.openRepoHub('tools') },
    { id: 'toggle-sidebar', group: 'View', title: 'Show or hide the branches panel', keywords: 'collapse expand sidebar left panel', run: () => toggleSide('sidebar') },
    { id: 'toggle-history', group: 'View', title: 'Show or hide the commit history', keywords: 'collapse expand right panel', run: () => toggleSide('history') },
    { id: 'logs', group: 'View', title: 'Open the Terminal Log', run: () => openLogWindow() }
  ];
}

function wireGlobal(): void {
  document.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;

    // Ctrl+K / Cmd+K, the convention every palette uses. Ctrl+Shift+P too,
    // for anyone whose muscle memory came from an editor.
    if ((key.ctrlKey || key.metaKey) && (key.key === 'k' || (key.shiftKey && key.key === 'P'))) {
      event.preventDefault();
      palette.setCommands(buildCommands());
      palette.openPalette();
      return;
    }

    // Ctrl+B for the left panel, as every editor does it, and Ctrl+Shift+B for
    // the right. `key` is compared case-insensitively because Shift changes it.
    if ((key.ctrlKey || key.metaKey) && key.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleSide(key.shiftKey ? 'history' : 'sidebar');
      return;
    }

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
  initCollapsibleSections();
  // The chip row scrolls sideways and would otherwise need a shift-wheel or a
  // trackpad to reach the chips past its edge.
  attachHorizontalWheel(ui.commitTemplateChips);

  accounts.initAccounts(ui);
  repo.initRepo(ui, refreshAll);
  newRepo.initNewRepo(ui);
  branches.initBranches(ui, refreshAll);
  shelf.initShelf(ui, refreshAll);
  recovery.initRecovery(ui, refreshAll);
  palette.initPalette(ui);
  search.initSearch(ui, { showCommit: (hash) => void history.showCommitDetails(hash) });
  branchAdmin.initBranchAdmin(ui, refreshAll);
  rebase.initRebase(ui, refreshAll);
  signing.initSigning(ui);
  sync.initSync(ui, refreshAll);
  diff.initDiff(ui, { refreshAll });
  staging.initStaging(ui, { refreshAll, refreshStatus, clearDiffView: diff.clearDiffView });
  conflicts.initConflicts(ui, refreshStatus);
  explorer.initExplorer(ui, { showCommitDetails: history.showCommitDetails });
  history.initHistory(ui, { refreshAll, showDiffTab: () => workspace.switchViewTab('diff') });
  ssh.initSshManager(ui);
  pullRequest.initPullRequests(ui, { refreshStatus });
  workspace.initWorkspace(ui, { refreshStatus });
  worktrees.initWorktrees(ui, refreshAll);
  groups.initGroups(ui);
  agents.initAgents(ui);
  repoHub.initRepoHub(ui);

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
  wireDiscovery();
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
  void groups.refreshGroups();

  // A window opened for a specific repository says so in its URL. That wins
  // over the most recent one, which is what stops every restored window from
  // briefly loading the same repository and then switching.
  const requested = new URLSearchParams(window.location.search).get('repo');
  if (requested) {
    logToTerminal(`Opening ${requested}...`);
    await repo.openRepository(requested);
    return;
  }

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
