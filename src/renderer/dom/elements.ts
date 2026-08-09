// Every DOM id the renderer looks up, in one place.
//
// The previous code ran 236 `document.getElementById` calls at module load and
// assigned each to a const. A typo produced a silent `null` that only surfaced
// as a TypeError much later, in whatever handler happened to touch it first.
//
// Here the ids are data. `resolveElements` looks them all up once at startup
// and throws naming every missing one, so a broken template fails immediately
// and says what is wrong. ELEMENT_IDS is also what tests/packaging.test.ts
// checks against index.html.

/** Element ids, grouped the way index.html lays the page out. */
export const ELEMENT_MAP = {
  // DOM Elements
  appContainer: 'main-content',
  btnOpenRepo: 'btn-open-repo',
  btnCreateRepo: 'btn-create-repo',
  btnCloneRepo: 'btn-clone-repo',
  btnManageSsh: 'btn-manage-ssh',
  btnRefresh: 'btn-refresh',

  // Collapsing the side panels. Each side has two controls: the header button
  // that hides it, and the strip left behind that brings it back.
  btnToggleSidebar: 'btn-toggle-sidebar',
  btnToggleHistory: 'btn-toggle-history',
  sidebarReveal: 'sidebar-reveal',
  historyReveal: 'history-reveal',

  // Repository hub. The panels are found by id from the tab name, so they are
  // not listed individually.
  btnRepoHub: 'btn-repo-hub',
  repoHubModal: 'repo-hub-modal',
  repoHubTabs: 'repo-hub-tabs',
  btnCloseRepoHub: 'btn-close-repo-hub',
  remoteCount: 'remote-count',
  remoteSummaryList: 'remote-summary-list',
  submoduleCount: 'submodule-count',
  submoduleSummaryList: 'submodule-summary-list',
  lfsSummary: 'lfs-summary',

  // Operations bar
  operationsBar: 'operations-bar',
  operationsSummary: 'operations-summary',
  operationsHeadline: 'operations-headline',
  operationsCount: 'operations-count',
  operationsElapsed: 'operations-elapsed',
  operationsPanel: 'operations-panel',
  operationsList: 'operations-list',

  // Header Segments
  repoSegment: 'repo-segment',
  repoSegmentName: 'repo-segment-name',
  repoSegmentPath: 'repo-segment-path',
  repoDropdown: 'repo-dropdown',
  repoDropdownList: 'repo-dropdown-list',
  branchSegment: 'branch-segment',
  branchSegmentName: 'branch-segment-name',
  branchAheadBadge: 'branch-ahead-badge',
  branchBehindBadge: 'branch-behind-badge',
  branchStateBadge: 'branch-state-badge',
  branchDropdown: 'branch-dropdown',
  branchDropdownList: 'branch-dropdown-list',
  branchFilterInput: 'branch-filter-input',
  headerNewBranchInput: 'header-new-branch-input',
  btnHeaderCreateBranch: 'btn-header-create-branch',
  profileSegment: 'profile-segment',
  profileSegmentName: 'profile-segment-name',
  profileColorDot: 'profile-color-dot',
  profileVaultIcon: 'profile-vault-icon',
  profileDropdown: 'profile-dropdown',
  profileDropdownList: 'profile-dropdown-list',
  dropdownVaultStatus: 'dropdown-vault-status',
  btnDropdownVault: 'btn-dropdown-vault',
  identityText: 'identity-text',
  btnEditIdentity: 'btn-edit-identity',

  // Views Tabs
  tabStaging: 'tab-staging',
  tabDiff: 'tab-diff',
  tabExplorer: 'tab-explorer',
  stagingView: 'staging-view',
  diffView: 'diff-view',
  explorerView: 'explorer-view',
  btnDiffBack: 'btn-diff-back',
  diffActions: 'diff-actions',
  btnDiffToggleStage: 'btn-diff-toggle-stage',
  btnDiffToggleStageLabel: 'btn-diff-toggle-stage-label',
  btnDiffDiscard: 'btn-diff-discard',
  btnDiffRefresh: 'btn-diff-refresh',

  // Sidebar
  newBranchInput: 'new-branch-input',
  btnCreateBranch: 'btn-create-branch',
  localBranchesList: 'local-branches-list',
  remoteBranchesList: 'remote-branches-list',
  integrateBranchSelect: 'integrate-branch-select',
  btnMerge: 'btn-merge',
  btnRebase: 'btn-rebase',
  btnStashSave: 'btn-stash-save',
  stashList: 'stash-list',
  stashSearch: 'stash-search',
  checkpointList: 'checkpoint-list',
  trashList: 'trash-list',
  tagList: 'tag-list',

  // Signing
  commitSignRow: 'commit-sign-row',
  commitSignCheckbox: 'commit-sign-checkbox',
  btnSigningSettings: 'btn-signing-settings',
  signingModal: 'signing-modal',
  btnCloseSigningModal: 'btn-close-signing-modal',
  signingForm: 'signing-form',
  signingMode: 'signing-mode',
  signingKeyGroup: 'signing-key-group',
  signingKey: 'signing-key',
  signingKeyPicker: 'signing-key-picker',
  signingAllowedGroup: 'signing-allowed-group',
  signingAllowedSigners: 'signing-allowed-signers',
  signingDefaultCommits: 'signing-default-commits',
  signingDefaultTags: 'signing-default-tags',
  signingDiagnostics: 'signing-diagnostics',
  btnCancelSigning: 'btn-cancel-signing',
  btnSaveSigning: 'btn-save-signing',
  drawerSignature: 'drawer-signature',

  // Interactive rebase
  rebaseModal: 'rebase-modal',
  btnCloseRebaseModal: 'btn-close-rebase-modal',
  rebasePublishedWarning: 'rebase-published-warning',
  rebaseValidation: 'rebase-validation',
  rebasePlanner: 'rebase-planner',
  rebaseOnto: 'rebase-onto',
  rebaseAutosquash: 'rebase-autosquash',
  btnRebaseReload: 'btn-rebase-reload',
  rebasePlanList: 'rebase-plan-list',
  btnRebaseStart: 'btn-rebase-start',
  rebaseProgress: 'rebase-progress',
  rebaseProgressSummary: 'rebase-progress-summary',
  rebaseConflictList: 'rebase-conflict-list',
  btnRebaseSplit: 'btn-rebase-split',
  btnRebaseContinue: 'btn-rebase-continue',
  btnRebaseSkip: 'btn-rebase-skip',
  btnRebaseAbort: 'btn-rebase-abort',

  // Command palette
  paletteModal: 'palette-modal',
  paletteInput: 'palette-input',
  paletteList: 'palette-list',

  // Search and compare
  searchModal: 'search-modal',
  btnCloseSearchModal: 'btn-close-search-modal',
  tabSearchCommits: 'tab-search-commits',
  tabSearchCompare: 'tab-search-compare',
  searchCommitsPane: 'search-commits-pane',
  searchComparePane: 'search-compare-pane',
  searchQuery: 'search-query',
  searchAuthor: 'search-author',
  searchPaths: 'search-paths',
  searchSince: 'search-since',
  searchUntil: 'search-until',
  btnRunSearch: 'btn-run-search',
  searchSummary: 'search-summary',
  searchResults: 'search-results',
  btnSearchMore: 'btn-search-more',
  compareBase: 'compare-base',
  compareHead: 'compare-head',
  btnRunCompare: 'btn-run-compare',
  compareSummary: 'compare-summary',
  compareAhead: 'compare-ahead',
  compareBehind: 'compare-behind',
  compareFiles: 'compare-files',

  // Branch maintenance
  branchAdminModal: 'branch-admin-modal',
  btnCloseBranchAdmin: 'btn-close-branch-admin',
  branchAdminSummary: 'branch-admin-summary',
  branchAdminList: 'branch-admin-list',
  branchFilterMerged: 'branch-filter-merged',
  branchFilterStale: 'branch-filter-stale',
  branchFilterGone: 'branch-filter-gone',
  btnPruneRemote: 'btn-prune-remote',
  btnDeleteSelectedBranches: 'btn-delete-selected-branches',

  // Recovery
  recoveryList: 'recovery-list',
  btnRecoveryOpen: 'btn-recovery-open',
  recoveryModal: 'recovery-modal',
  btnCloseRecoveryModal: 'btn-close-recovery-modal',
  recoveryRetentionNote: 'recovery-retention-note',
  recoveryOperationWarning: 'recovery-operation-warning',
  recoveryPointsList: 'recovery-points-list',
  recoveryReflogList: 'recovery-reflog-list',

  // Staging & Diff
  conflictBanner: 'conflict-banner',
  btnContinueConflict: 'btn-continue-conflict',
  btnAbortConflict: 'btn-abort-conflict',
  unstagedFilesList: 'unstaged-files-list',
  stagedFilesList: 'staged-files-list',
  btnStageAll: 'btn-stage-all',
  btnUnstageAll: 'btn-unstage-all',
  btnDiscardAll: 'btn-discard-all',
  filenameWrapToggle: 'filename-wrap-toggle',
  diffFileTitle: 'diff-file-title',
  diffFileType: 'diff-file-type',
  diffContent: 'diff-content',
  diffFilesList: 'diff-files-list',

  // Diff presentation
  btnDiffLayout: 'btn-diff-layout',
  btnDiffLayoutLabel: 'btn-diff-layout-label',
  diffWhitespace: 'diff-whitespace',

  // Precision staging
  diffSelectionBar: 'diff-selection-bar',
  diffSelectionCount: 'diff-selection-count',
  btnDiffStageSelection: 'btn-diff-stage-selection',
  btnDiffUnstageSelection: 'btn-diff-unstage-selection',
  btnDiffDiscardSelection: 'btn-diff-discard-selection',
  btnDiffClearSelection: 'btn-diff-clear-selection',

  // Explorer View DOM Elements
  fileTreeContainer: 'file-tree-container',
  btnRefreshTree: 'btn-refresh-tree',
  explorerFileTitle: 'explorer-file-title',
  btnToggleBlame: 'btn-toggle-blame',
  explorerFileBody: 'explorer-file-body',

  // Commit Details Drawer DOM Elements
  commitDetailsDrawer: 'commit-details-drawer',
  btnCloseDrawer: 'btn-close-drawer',
  drawerHash: 'drawer-hash',
  drawerMsg: 'drawer-msg',
  drawerAuthor: 'drawer-author',
  drawerDate: 'drawer-date',
  drawerFilesList: 'drawer-files-list',
  drawerFilesHeading: 'drawer-files-heading',
  btnDrawerCherryPick: 'btn-drawer-cherry-pick',
  btnDrawerRevert: 'btn-drawer-revert',
  btnDrawerTag: 'btn-drawer-tag',
  btnDrawerCopySha: 'btn-drawer-copy-sha',
  drawerResetMode: 'drawer-reset-mode',
  btnDrawerReset: 'btn-drawer-reset',

  // Commit
  commitMsgInput: 'commit-msg-input',
  btnCommit: 'btn-commit',
  btnCommitLabel: 'btn-commit-label',
  commitAmendCheckbox: 'commit-amend-checkbox',
  commitScopeInput: 'commit-scope-input',
  commitTemplateChips: 'commit-template-chips',
  commitFormatHint: 'commit-format-hint',

  // Sync & History
  btnFetch: 'btn-fetch',
  btnPull: 'btn-pull',
  btnPush: 'btn-push',
  pullCountBadge: 'pull-count-badge',
  pushCountBadge: 'push-count-badge',
  btnRemoteProtocol: 'btn-remote-protocol',
  remoteProtocolLabel: 'remote-protocol-label',
  btnOpenLogs: 'btn-open-logs',
  commitHistoryList: 'commit-history-list',
  btnUndoCommit: 'btn-undo-commit',

  // Overlays & Modals
  noRepoOverlay: 'no-repo-overlay',
  btnOverlayOpen: 'btn-overlay-open',
  btnOverlayCreate: 'btn-overlay-create',
  btnOverlayClone: 'btn-overlay-clone',
  overlayRecentList: 'overlay-recent-list',
  overlaySshRow: 'overlay-ssh-row',
  overlaySshTitle: 'overlay-ssh-title',
  overlaySshDetail: 'overlay-ssh-detail',
  btnOverlaySsh: 'btn-overlay-ssh',
  overlaySshBtnLabel: 'overlay-ssh-btn-label',
  sshModal: 'ssh-modal',
  btnCloseSshModal: 'btn-close-ssh-modal',
  sshProfileForm: 'ssh-profile-form',
  sshProfileId: 'ssh-profile-id',
  sshLabel: 'ssh-label',
  sshKeyPath: 'ssh-key-path',
  sshUserName: 'ssh-user-name',
  sshUserEmail: 'ssh-user-email',
  sshPassphrase: 'ssh-passphrase',
  btnSshPassphraseReveal: 'btn-ssh-passphrase-reveal',
  sshKeepPassword: 'ssh-keep-password',
  sshExistingKeySection: 'ssh-existing-key-section',
  sshExistingKeyHeading: 'ssh-existing-key-heading',
  btnShowAddKey: 'btn-show-add-key',
  btnHideAddKey: 'btn-hide-add-key',
  sshGenerateSection: 'ssh-generate-section',
  btnShowGenerateKey: 'btn-show-generate-key',
  btnHideGenerateKey: 'btn-hide-generate-key',
  sshGenerateForm: 'ssh-generate-form',
  sshGenerateLabel: 'ssh-generate-label',
  sshGenerateKeyName: 'ssh-generate-key-name',
  sshGenerateKeyType: 'ssh-generate-key-type',
  sshGenerateUserName: 'ssh-generate-user-name',
  sshGenerateUserEmail: 'ssh-generate-user-email',
  sshGeneratePassphrase: 'ssh-generate-passphrase',
  btnSshGeneratePassphraseReveal: 'btn-ssh-generate-passphrase-reveal',
  sshGenerateKeepPassword: 'ssh-generate-keep-password',
  btnGenerateSsh: 'btn-generate-ssh',
  sshGenerateFeedback: 'ssh-generate-feedback',
  sshGeneratedResult: 'ssh-generated-result',
  sshGeneratedPrivate: 'ssh-generated-private',
  sshGeneratedPublic: 'ssh-generated-public',
  btnOpenGeneratedLocation: 'btn-open-generated-location',
  btnCopyGeneratedPrivatePath: 'btn-copy-generated-private-path',
  btnCopyGeneratedPublicPath: 'btn-copy-generated-public-path',
  btnCopyGeneratedPublicKey: 'btn-copy-generated-public-key',
  vaultStatusCard: 'vault-status-card',
  vaultStatusText: 'vault-status-text',
  vaultStatusDetail: 'vault-status-detail',
  vaultStatusIcon: 'vault-status-icon',
  btnSetupVault: 'btn-setup-vault',
  btnUnlockVault: 'btn-unlock-vault',
  btnLockVault: 'btn-lock-vault',
  vaultSetupModal: 'vault-setup-modal',
  vaultSetupForm: 'vault-setup-form',
  vaultMasterKey: 'vault-master-key',
  btnVaultMasterKeyReveal: 'btn-vault-master-key-reveal',
  vaultMasterKeyConfirm: 'vault-master-key-confirm',
  btnVaultMasterKeyConfirmReveal: 'btn-vault-master-key-confirm-reveal',
  vaultSetupFeedback: 'vault-setup-feedback',
  btnCancelVaultSetup: 'btn-cancel-vault-setup',
  btnSaveVaultSetup: 'btn-save-vault-setup',
  btnTestSshForm: 'btn-test-ssh-form',
  btnCancelSsh: 'btn-cancel-ssh',
  sshProfilesTableBody: 'ssh-profiles-table-body',
  ruleMatchInput: 'rule-match-input',
  ruleProfileSelect: 'rule-profile-select',
  btnAddRule: 'btn-add-rule',
  accountRulesList: 'account-rules-list',
  conflictModal: 'conflict-modal',
  btnCloseConflictModal: 'btn-close-conflict-modal',
  conflictFilePathBadge: 'conflict-file-path-badge',
  btnConflictKeepOurs: 'btn-conflict-keep-ours',
  btnConflictKeepTheirs: 'btn-conflict-keep-theirs',
  conflictTextarea: 'conflict-textarea',
  btnCancelConflictModal: 'btn-cancel-conflict-modal',
  btnSaveConflictResolution: 'btn-save-conflict-resolution',

  // Clone Modal
  cloneModal: 'clone-modal',
  btnCloseCloneModal: 'btn-close-clone-modal',
  cloneFeedback: 'clone-feedback',
  cloneForm: 'clone-form',
  cloneUrlInput: 'clone-url',
  cloneParentDirInput: 'clone-parent-dir',
  btnCloneBrowse: 'btn-clone-browse',
  cloneFolderNameInput: 'clone-folder-name',
  cloneProfileSelect: 'clone-profile-select',
  btnCancelClone: 'btn-cancel-clone',
  btnStartClone: 'btn-start-clone',

  // Native SSH agent
  agentStatusChip: 'agent-status-chip',
  btnRepairAgent: 'btn-repair-agent',
  btnUnloadKey: 'btn-unload-key',
  agentDiagnostic: 'agent-diagnostic',

  // Pull Request Creator
  btnCreatePr: 'btn-create-pr',
  prModal: 'pr-modal',
  btnClosePrModal: 'btn-close-pr-modal',
  prLoading: 'pr-loading',
  prFeedback: 'pr-feedback',
  prWarnings: 'pr-warnings',
  prForm: 'pr-form',
  prBaseBranch: 'pr-base-branch',
  prHeadBranch: 'pr-head-branch',
  prTargetSummary: 'pr-target-summary',
  prTitle: 'pr-title',
  prBody: 'pr-body',
  prReviewers: 'pr-reviewers',
  prAssignees: 'pr-assignees',
  prLabels: 'pr-labels',
  prDraft: 'pr-draft',
  prMaintainerEdit: 'pr-maintainer-edit',
  prCommitSummary: 'pr-commit-summary',
  btnPrCancel: 'btn-pr-cancel',
  btnPrCreate: 'btn-pr-create',
  prSuccess: 'pr-success',
  prSuccessText: 'pr-success-text',
  btnPrCopyLink: 'btn-pr-copy-link',
  btnPrOpen: 'btn-pr-open',

  // New Repository Modal
  newRepoModal: 'new-repo-modal',
  btnCloseNewRepoModal: 'btn-close-new-repo-modal',
  newRepoForm: 'new-repo-form',
  newRepoFeedback: 'new-repo-feedback',
  newRepoPathInput: 'new-repo-path',
  btnNewRepoBrowse: 'btn-new-repo-browse',
  newRepoFolderHint: 'new-repo-folder-hint',
  newRepoVisibility: 'new-repo-visibility',
  newRepoCreateRemote: 'new-repo-create-remote',
  newRepoGhStatus: 'new-repo-gh-status',
  newRepoLicense: 'new-repo-license',
  newRepoLicenseSummary: 'new-repo-license-summary',
  newRepoLicenseFields: 'new-repo-license-fields',
  newRepoLicenseYear: 'new-repo-license-year',
  newRepoLicenseHolder: 'new-repo-license-holder',
  newRepoGitignore: 'new-repo-gitignore',
  newRepoGitignoreHint: 'new-repo-gitignore-hint',
  btnCancelNewRepo: 'btn-cancel-new-repo',
  btnCreateNewRepo: 'btn-create-new-repo',

  // Identity Modal
  identityModal: 'identity-modal',
  btnCloseIdentityModal: 'btn-close-identity-modal',
  identityRepoName: 'identity-repo-name',
  identityForm: 'identity-form',
  identityNameInput: 'identity-name',
  identityEmailInput: 'identity-email',
  btnCancelIdentity: 'btn-cancel-identity',

  // Confirm & Prompt dialogs
  confirmModal: 'confirm-modal',
  confirmTitle: 'confirm-title',
  confirmMessage: 'confirm-message',
  confirmCheckboxRow: 'confirm-checkbox-row',
  confirmCheckbox: 'confirm-checkbox',
  confirmCheckboxLabel: 'confirm-checkbox-label',
  btnConfirmCancel: 'btn-confirm-cancel',
  btnConfirmOk: 'btn-confirm-ok',
  promptModal: 'prompt-modal',
  promptTitle: 'prompt-title',
  promptForm: 'prompt-form',
  promptLabel: 'prompt-label',
  promptInput: 'prompt-input',
  btnPromptReveal: 'btn-prompt-reveal',
  btnPromptCancel: 'btn-prompt-cancel',
  toastContainer: 'toast-container',

  // Startup SSH key health check
  sshHealthModal: 'ssh-health-modal',
  sshHealthList: 'ssh-health-list',
  btnSshHealthDismiss: 'btn-ssh-health-dismiss',
  btnSshHealthOpen: 'btn-ssh-health-open',

  // SSH config management toggle
  sshManageConfigCheckbox: 'ssh-manage-config-checkbox',

  // Worktrees
  worktreeCount: 'worktree-count',
  worktreeList: 'worktree-list',
  btnWorktreeManage: 'btn-worktree-manage',
  worktreeModal: 'worktree-modal',
  btnCloseWorktreeModal: 'btn-close-worktree-modal',
  worktreeCreateForm: 'worktree-create-form',
  worktreeBranchMode: 'worktree-branch-mode',
  worktreeBranchRow: 'worktree-branch-row',
  worktreeBranchInput: 'worktree-branch-input',
  worktreeStartPointRow: 'worktree-start-point-row',
  worktreeStartPoint: 'worktree-start-point',
  worktreePathInput: 'worktree-path-input',
  btnWorktreeBrowse: 'btn-worktree-browse',
  worktreePathPreview: 'worktree-path-preview',
  worktreeLockNew: 'worktree-lock-new',
  btnCreateWorktree: 'btn-create-worktree',
  worktreeManagerList: 'worktree-manager-list',
  btnWorktreeRepair: 'btn-worktree-repair',
  worktreePruneList: 'worktree-prune-list',

  // Repository groups
  groupList: 'group-list',
  btnGroupCreate: 'btn-group-create',
  groupEditorModal: 'group-editor-modal',
  groupEditorTitle: 'group-editor-title',
  groupEditorList: 'group-editor-list',
  btnCloseGroupEditor: 'btn-close-group-editor',
  btnCancelGroupEditor: 'btn-cancel-group-editor',
  btnSaveGroupMembers: 'btn-save-group-members',

  // External coding agents
  agentsModal: 'agents-modal',
  btnCloseAgentsModal: 'btn-close-agents-modal',
  agentDesktopOnlyNote: 'agent-desktop-only-note',
  agentList: 'agent-list',
  btnDetectAgents: 'btn-detect-agents',
  agentForm: 'agent-form',
  agentLabelInput: 'agent-label-input',
  agentExecutableInput: 'agent-executable-input',
  agentArgsInput: 'agent-args-input',
  agentTerminalSelect: 'agent-terminal-select',
  agentPromptModeCheckbox: 'agent-prompt-mode',
  btnSaveAgent: 'btn-save-agent',
  agentHistoryList: 'agent-history-list',
  agentLaunchModal: 'agent-launch-modal',
  btnCloseAgentLaunch: 'btn-close-agent-launch',
  agentLaunchTarget: 'agent-launch-target',
  agentLaunchForm: 'agent-launch-form',
  agentLaunchSelect: 'agent-launch-select',
  agentLaunchPromptRow: 'agent-launch-prompt-row',
  agentLaunchPrompt: 'agent-launch-prompt',
  btnCancelAgentLaunch: 'btn-cancel-agent-launch',
  btnLaunchAgent: 'btn-launch-agent',

  // Loading a locked key on demand
  btnUnlockKey: 'btn-unlock-key'
} as const;

export type ElementKey = keyof typeof ELEMENT_MAP;

/** Flat list of ids, for the check that every one exists in index.html. */
export const ELEMENT_IDS: readonly string[] = Object.values(ELEMENT_MAP);

export type Elements = Record<ElementKey, HTMLElement>;

/**
 * Looks up every id once.
 *
 * Missing ids are collected and reported together: fixing a template five
 * elements at a time, one reload each, is the failure mode this avoids.
 */
export function resolveElements(root: Document = document): Elements {
  const resolved = {} as Record<ElementKey, HTMLElement>;
  const missing: string[] = [];

  for (const [key, id] of Object.entries(ELEMENT_MAP) as [ElementKey, string][]) {
    const element = root.getElementById(id);
    if (element === null) {
      missing.push(`${key} (#${id})`);
      continue;
    }
    resolved[key] = element;
  }

  if (missing.length > 0) {
    const detail = missing.map((entry) => `  - ${entry}`).join('\n');
    throw new Error(
      `index.html is missing ${missing.length} element(s) the app requires:\n${detail}`
    );
  }

  return resolved;
}

/**
 * Narrows an element to a specific tag.
 *
 * The registry is typed as HTMLElement because it is built from a plain map.
 * Call sites that need `.value` or `.checked` state the tag they expect, and
 * a mismatch throws instead of silently reading undefined.
 */
export function as<T extends HTMLElement>(
  element: HTMLElement,
  constructor: new () => T
): T {
  if (!(element instanceof constructor)) {
    throw new Error(
      `Expected #${element.id} to be ${constructor.name}, found ${element.constructor.name}`
    );
  }
  return element;
}

export const asInput = (element: HTMLElement): HTMLInputElement =>
  as(element, HTMLInputElement);
export const asTextArea = (element: HTMLElement): HTMLTextAreaElement =>
  as(element, HTMLTextAreaElement);
export const asSelect = (element: HTMLElement): HTMLSelectElement =>
  as(element, HTMLSelectElement);
export const asForm = (element: HTMLElement): HTMLFormElement =>
  as(element, HTMLFormElement);
export const asButton = (element: HTMLElement): HTMLButtonElement =>
  as(element, HTMLButtonElement);
