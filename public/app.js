// Global State
let activeRepo = null;
let recentRepos = [];
let sshProfiles = [];
let accountRules = [];
let vaultStatus = { hasVault: false, unlocked: false };
let activeProfileId = ''; // '' = System SSH
let activeDiffFile = null;
let currentStatus = null; // last /api/git/status payload
let currentBranches = { local: [], remote: [] };
let currentIdentity = null;
let isMerging = false;
let isRebasing = false;
let lastGeneratedSshKey = null;
let isGeneratingSshKey = false;
let originRemoteInfo = null;
let lastFocusRefresh = 0;
let appSettings = { manageSshConfig: true };

// DOM Elements
const appContainer = document.getElementById('main-content');
const btnOpenRepo = document.getElementById('btn-open-repo');
const btnCreateRepo = document.getElementById('btn-create-repo');
const btnCloneRepo = document.getElementById('btn-clone-repo');
const btnManageSsh = document.getElementById('btn-manage-ssh');
const btnRefresh = document.getElementById('btn-refresh');

// Header Segments
const repoSegment = document.getElementById('repo-segment');
const repoSegmentName = document.getElementById('repo-segment-name');
const repoSegmentPath = document.getElementById('repo-segment-path');
const repoDropdown = document.getElementById('repo-dropdown');
const repoDropdownList = document.getElementById('repo-dropdown-list');

const branchSegment = document.getElementById('branch-segment');
const branchSegmentName = document.getElementById('branch-segment-name');
const branchAheadBadge = document.getElementById('branch-ahead-badge');
const branchBehindBadge = document.getElementById('branch-behind-badge');
const branchStateBadge = document.getElementById('branch-state-badge');
const branchDropdown = document.getElementById('branch-dropdown');
const branchDropdownList = document.getElementById('branch-dropdown-list');
const branchFilterInput = document.getElementById('branch-filter-input');
const headerNewBranchInput = document.getElementById('header-new-branch-input');
const btnHeaderCreateBranch = document.getElementById('btn-header-create-branch');

const profileSegment = document.getElementById('profile-segment');
const profileSegmentName = document.getElementById('profile-segment-name');
const profileColorDot = document.getElementById('profile-color-dot');
const profileVaultIcon = document.getElementById('profile-vault-icon');
const profileDropdown = document.getElementById('profile-dropdown');
const profileDropdownList = document.getElementById('profile-dropdown-list');
const dropdownVaultStatus = document.getElementById('dropdown-vault-status');
const btnDropdownVault = document.getElementById('btn-dropdown-vault');
const identityText = document.getElementById('identity-text');
const btnEditIdentity = document.getElementById('btn-edit-identity');

// Views Tabs
const tabStaging = document.getElementById('tab-staging');
const tabDiff = document.getElementById('tab-diff');
const tabExplorer = document.getElementById('tab-explorer');
const stagingView = document.getElementById('staging-view');
const diffView = document.getElementById('diff-view');
const explorerView = document.getElementById('explorer-view');
const btnDiffBack = document.getElementById('btn-diff-back');
const diffActions = document.getElementById('diff-actions');
const btnDiffToggleStage = document.getElementById('btn-diff-toggle-stage');
const btnDiffToggleStageLabel = document.getElementById('btn-diff-toggle-stage-label');
const btnDiffDiscard = document.getElementById('btn-diff-discard');
const btnDiffRefresh = document.getElementById('btn-diff-refresh');

// Sidebar
const newBranchInput = document.getElementById('new-branch-input');
const btnCreateBranch = document.getElementById('btn-create-branch');
const localBranchesList = document.getElementById('local-branches-list');
const remoteBranchesList = document.getElementById('remote-branches-list');
const integrateBranchSelect = document.getElementById('integrate-branch-select');
const btnMerge = document.getElementById('btn-merge');
const btnRebase = document.getElementById('btn-rebase');
const btnStashSave = document.getElementById('btn-stash-save');
const stashList = document.getElementById('stash-list');
const checkpointList = document.getElementById('checkpoint-list');
const trashList = document.getElementById('trash-list');
const tagList = document.getElementById('tag-list');

// Staging & Diff
const conflictBanner = document.getElementById('conflict-banner');
const btnContinueConflict = document.getElementById('btn-continue-conflict');
const btnAbortConflict = document.getElementById('btn-abort-conflict');
const unstagedFilesList = document.getElementById('unstaged-files-list');
const stagedFilesList = document.getElementById('staged-files-list');
const btnStageAll = document.getElementById('btn-stage-all');
const btnUnstageAll = document.getElementById('btn-unstage-all');
const btnDiscardAll = document.getElementById('btn-discard-all');
const filenameWrapToggle = document.getElementById('filename-wrap-toggle');
const diffFileTitle = document.getElementById('diff-file-title');
const diffFileType = document.getElementById('diff-file-type');
const diffContent = document.getElementById('diff-content');
const diffFilesList = document.getElementById('diff-files-list');

// Explorer View DOM Elements
const fileTreeContainer = document.getElementById('file-tree-container');
const btnRefreshTree = document.getElementById('btn-refresh-tree');
const explorerFileTitle = document.getElementById('explorer-file-title');
const btnToggleBlame = document.getElementById('btn-toggle-blame');
const explorerFileBody = document.getElementById('explorer-file-body');

// Commit Details Drawer DOM Elements
const commitDetailsDrawer = document.getElementById('commit-details-drawer');
const btnCloseDrawer = document.getElementById('btn-close-drawer');
const drawerHash = document.getElementById('drawer-hash');
const drawerMsg = document.getElementById('drawer-msg');
const drawerAuthor = document.getElementById('drawer-author');
const drawerDate = document.getElementById('drawer-date');
const drawerFilesList = document.getElementById('drawer-files-list');
const drawerFilesHeading = document.getElementById('drawer-files-heading');
const btnDrawerCherryPick = document.getElementById('btn-drawer-cherry-pick');
const btnDrawerRevert = document.getElementById('btn-drawer-revert');
const btnDrawerTag = document.getElementById('btn-drawer-tag');
const btnDrawerCopySha = document.getElementById('btn-drawer-copy-sha');
const drawerResetMode = document.getElementById('drawer-reset-mode');
const btnDrawerReset = document.getElementById('btn-drawer-reset');
let currentDrawerCommit = null;

// Commit
const commitMsgInput = document.getElementById('commit-msg-input');
const btnCommit = document.getElementById('btn-commit');
const btnCommitLabel = document.getElementById('btn-commit-label');
const commitAmendCheckbox = document.getElementById('commit-amend-checkbox');
const commitScopeInput = document.getElementById('commit-scope-input');
const commitTemplateChips = document.getElementById('commit-template-chips');
const commitFormatHint = document.getElementById('commit-format-hint');

// Sync & History
const btnFetch = document.getElementById('btn-fetch');
const btnPull = document.getElementById('btn-pull');
const btnPush = document.getElementById('btn-push');
const pullCountBadge = document.getElementById('pull-count-badge');
const pushCountBadge = document.getElementById('push-count-badge');
const btnRemoteProtocol = document.getElementById('btn-remote-protocol');
const remoteProtocolLabel = document.getElementById('remote-protocol-label');
const btnOpenLogs = document.getElementById('btn-open-logs');
const commitHistoryList = document.getElementById('commit-history-list');
const btnUndoCommit = document.getElementById('btn-undo-commit');

// Overlays & Modals
const noRepoOverlay = document.getElementById('no-repo-overlay');
const btnOverlayOpen = document.getElementById('btn-overlay-open');
const btnOverlayCreate = document.getElementById('btn-overlay-create');
const btnOverlayClone = document.getElementById('btn-overlay-clone');
const overlayRecentList = document.getElementById('overlay-recent-list');

const sshModal = document.getElementById('ssh-modal');
const btnCloseSshModal = document.getElementById('btn-close-ssh-modal');
const sshProfileForm = document.getElementById('ssh-profile-form');
const sshProfileId = document.getElementById('ssh-profile-id');
const sshLabel = document.getElementById('ssh-label');
const sshKeyPath = document.getElementById('ssh-key-path');
const sshUserName = document.getElementById('ssh-user-name');
const sshUserEmail = document.getElementById('ssh-user-email');
const sshPassphrase = document.getElementById('ssh-passphrase');
const sshKeepPassword = document.getElementById('ssh-keep-password');
const sshExistingKeySection = document.getElementById('ssh-existing-key-section');
const sshExistingKeyHeading = document.getElementById('ssh-existing-key-heading');
const btnShowAddKey = document.getElementById('btn-show-add-key');
const btnHideAddKey = document.getElementById('btn-hide-add-key');
const sshGenerateSection = document.getElementById('ssh-generate-section');
const btnShowGenerateKey = document.getElementById('btn-show-generate-key');
const btnHideGenerateKey = document.getElementById('btn-hide-generate-key');
const sshGenerateForm = document.getElementById('ssh-generate-form');
const sshGenerateLabel = document.getElementById('ssh-generate-label');
const sshGenerateKeyName = document.getElementById('ssh-generate-key-name');
const sshGenerateKeyType = document.getElementById('ssh-generate-key-type');
const sshGenerateUserName = document.getElementById('ssh-generate-user-name');
const sshGenerateUserEmail = document.getElementById('ssh-generate-user-email');
const sshGeneratePassphrase = document.getElementById('ssh-generate-passphrase');
const sshGenerateKeepPassword = document.getElementById('ssh-generate-keep-password');
const btnGenerateSsh = document.getElementById('btn-generate-ssh');
const sshGenerateFeedback = document.getElementById('ssh-generate-feedback');
const sshGeneratedResult = document.getElementById('ssh-generated-result');
const sshGeneratedPrivate = document.getElementById('ssh-generated-private');
const sshGeneratedPublic = document.getElementById('ssh-generated-public');
const btnOpenGeneratedLocation = document.getElementById('btn-open-generated-location');
const btnCopyGeneratedPrivatePath = document.getElementById('btn-copy-generated-private-path');
const btnCopyGeneratedPublicPath = document.getElementById('btn-copy-generated-public-path');
const btnCopyGeneratedPublicKey = document.getElementById('btn-copy-generated-public-key');
const vaultStatusCard = document.getElementById('vault-status-card');
const vaultStatusText = document.getElementById('vault-status-text');
const vaultStatusDetail = document.getElementById('vault-status-detail');
const vaultStatusIcon = document.getElementById('vault-status-icon');
const btnSetupVault = document.getElementById('btn-setup-vault');
const btnUnlockVault = document.getElementById('btn-unlock-vault');
const btnLockVault = document.getElementById('btn-lock-vault');
const vaultSetupModal = document.getElementById('vault-setup-modal');
const vaultSetupForm = document.getElementById('vault-setup-form');
const vaultMasterKey = document.getElementById('vault-master-key');
const vaultMasterKeyConfirm = document.getElementById('vault-master-key-confirm');
const vaultSetupFeedback = document.getElementById('vault-setup-feedback');
const btnCancelVaultSetup = document.getElementById('btn-cancel-vault-setup');
const btnSaveVaultSetup = document.getElementById('btn-save-vault-setup');
const btnTestSshForm = document.getElementById('btn-test-ssh-form');
const btnCancelSsh = document.getElementById('btn-cancel-ssh');
const sshProfilesTableBody = document.getElementById('ssh-profiles-table-body');
const ruleMatchInput = document.getElementById('rule-match-input');
const ruleProfileSelect = document.getElementById('rule-profile-select');
const btnAddRule = document.getElementById('btn-add-rule');
const accountRulesList = document.getElementById('account-rules-list');

const conflictModal = document.getElementById('conflict-modal');
const btnCloseConflictModal = document.getElementById('btn-close-conflict-modal');
const conflictFilePathBadge = document.getElementById('conflict-file-path-badge');
const btnConflictKeepOurs = document.getElementById('btn-conflict-keep-ours');
const btnConflictKeepTheirs = document.getElementById('btn-conflict-keep-theirs');
const conflictTextarea = document.getElementById('conflict-textarea');
const btnCancelConflictModal = document.getElementById('btn-cancel-conflict-modal');
const btnSaveConflictResolution = document.getElementById('btn-save-conflict-resolution');

// Clone Modal
const cloneModal = document.getElementById('clone-modal');
const btnCloseCloneModal = document.getElementById('btn-close-clone-modal');
const cloneFeedback = document.getElementById('clone-feedback');
const cloneForm = document.getElementById('clone-form');
const cloneUrlInput = document.getElementById('clone-url');
const cloneParentDirInput = document.getElementById('clone-parent-dir');
const btnCloneBrowse = document.getElementById('btn-clone-browse');
const cloneFolderNameInput = document.getElementById('clone-folder-name');
const cloneProfileSelect = document.getElementById('clone-profile-select');
const btnCancelClone = document.getElementById('btn-cancel-clone');
const btnStartClone = document.getElementById('btn-start-clone');

// Identity Modal
const identityModal = document.getElementById('identity-modal');
const btnCloseIdentityModal = document.getElementById('btn-close-identity-modal');
const identityRepoName = document.getElementById('identity-repo-name');
const identityForm = document.getElementById('identity-form');
const identityNameInput = document.getElementById('identity-name');
const identityEmailInput = document.getElementById('identity-email');
const btnCancelIdentity = document.getElementById('btn-cancel-identity');

// Confirm & Prompt dialogs
const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmCheckboxRow = document.getElementById('confirm-checkbox-row');
const confirmCheckbox = document.getElementById('confirm-checkbox');
const confirmCheckboxLabel = document.getElementById('confirm-checkbox-label');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
const btnConfirmOk = document.getElementById('btn-confirm-ok');

const promptModal = document.getElementById('prompt-modal');
const promptTitle = document.getElementById('prompt-title');
const promptForm = document.getElementById('prompt-form');
const promptLabel = document.getElementById('prompt-label');
const promptInput = document.getElementById('prompt-input');
const btnPromptCancel = document.getElementById('btn-prompt-cancel');

const toastContainer = document.getElementById('toast-container');

// Explorer state
let selectedExplorerFile = null;
let blameActive = false;

// File Status helper map
const statusLabels = {
  'M': { char: 'M', title: 'Modified', class: 'status-m' },
  'A': { char: 'A', title: 'Added', class: 'status-a' },
  'D': { char: 'D', title: 'Deleted', class: 'status-d' },
  'R': { char: 'R', title: 'Renamed', class: 'status-r' },
  'U': { char: '⚠', title: 'Conflict', class: 'status-u' },
  '?': { char: '?', title: 'Untracked', class: 'status-q' }
};

// ----------------- LOGGER HELPER -----------------
// Log lines are streamed to the server, which buffers them and broadcasts to
// the standalone terminal log window (logs.html) over SSE.
function logToTerminal(text, type = 'info') {
  fetch('/api/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, type })
  }).catch(() => console.log(`[${type}] ${text}`));
}

function openLogWindow() {
  if (window.desktopApi && window.desktopApi.openLogWindow) {
    window.desktopApi.openLogWindow();
  } else {
    // Browser mode: reuse the same named tab on repeated clicks
    window.open('/logs.html', 'multi-git-logs');
  }
}

// ----------------- UI HELPERS (toast / confirm / prompt / busy) -----------------
const toastIcons = {
  success: 'check_circle',
  error: 'error',
  warn: 'warning',
  info: 'info'
};

function showToast(message, type = 'info', durationMs = 4000) {
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${toastIcons[type] ? type : 'info'}`;

  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.innerText = toastIcons[type] || toastIcons.info;

  const text = document.createElement('span');
  text.innerText = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  toastContainer.appendChild(toast);

  const dismiss = () => {
    if (!toast.parentNode) return;
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 220);
  };
  toast.onclick = dismiss;
  setTimeout(dismiss, durationMs);
}

let confirmResolve = null;
function confirmDialog(message, options = {}) {
  return new Promise((resolve) => {
    // Only one confirm at a time: auto-cancel a previous unresolved one
    if (confirmResolve) {
      confirmResolve({ confirmed: false, checked: false });
    }
    confirmResolve = resolve;

    confirmTitle.innerText = options.title || 'Are you sure?';
    confirmMessage.innerText = message;
    btnConfirmOk.innerText = options.confirmLabel || 'Confirm';
    btnConfirmOk.className = options.danger ? 'btn btn-danger' : 'btn btn-primary';

    if (options.checkboxLabel) {
      confirmCheckboxLabel.innerText = options.checkboxLabel;
      confirmCheckbox.checked = Boolean(options.checkboxChecked);
      confirmCheckboxRow.classList.remove('hidden');
    } else {
      confirmCheckboxRow.classList.add('hidden');
    }

    confirmModal.classList.remove('hidden');
    btnConfirmOk.focus();
  });
}

function settleConfirm(confirmed) {
  if (!confirmResolve) return;
  const resolve = confirmResolve;
  confirmResolve = null;
  confirmModal.classList.add('hidden');
  resolve({ confirmed, checked: confirmCheckbox.checked });
}

let promptResolve = null;
function promptDialog(options = {}) {
  return new Promise((resolve) => {
    if (promptResolve) {
      promptResolve(null);
    }
    promptResolve = resolve;

    promptTitle.innerText = options.title || 'Input required';
    promptLabel.innerText = options.label || 'Value';
    promptInput.type = options.type || 'password';
    promptInput.value = '';
    promptModal.classList.remove('hidden');
    setTimeout(() => promptInput.focus(), 30);
  });
}

function settlePrompt(value) {
  if (!promptResolve) return;
  const resolve = promptResolve;
  promptResolve = null;
  promptModal.classList.add('hidden');
  resolve(value);
}

function setButtonBusy(btn, busy) {
  if (!btn) return;
  if (busy) {
    if (btn.dataset.busy === 'true') return;
    btn.disabled = true;
    btn.dataset.busy = 'true';

    // Swap the existing icon in place so icon buttons keep their fixed size
    // and text buttons do not shift when an action begins.
    const icon = btn.querySelector('.material-symbols-outlined');
    if (icon) {
      icon.dataset.originalIcon = icon.textContent;
      icon.textContent = 'progress_activity';
      icon.classList.add('btn-spinner-icon');
    }
  } else {
    btn.disabled = false;
    delete btn.dataset.busy;

    const icon = btn.querySelector('.material-symbols-outlined[data-original-icon]');
    if (icon) {
      icon.textContent = icon.dataset.originalIcon;
      delete icon.dataset.originalIcon;
      icon.classList.remove('btn-spinner-icon');
    }
  }
}

// Render a status/error message inside a content pane without injecting HTML
function renderPaneMessage(container, message, isError = false, wrapperClass = 'diff-empty-state') {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = wrapperClass;
  const p = document.createElement('p');
  if (isError) p.className = 'logger-line-error';
  p.innerText = message;
  wrap.appendChild(p);
  container.appendChild(wrap);
}

// Deterministic color per profile id, so each git key keeps a stable identity color
function profileColor(id) {
  let hash = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 70%, 55%)`;
}

function repoBaseName(repoPath) {
  if (!repoPath) return '';
  return String(repoPath).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || repoPath;
}

// ----------------- HEADER DROPDOWNS -----------------
const dropdownRegistry = [];

function registerDropdown(segmentBtn, dropdownEl, onOpen) {
  dropdownRegistry.push({ segmentBtn, dropdownEl });
  segmentBtn.onclick = (e) => {
    e.stopPropagation();
    const wasHidden = dropdownEl.classList.contains('hidden');
    closeAllDropdowns();
    if (wasHidden) {
      if (onOpen) onOpen();
      dropdownEl.classList.remove('hidden');
      segmentBtn.classList.add('open');
    }
  };
}

function closeAllDropdowns() {
  let closedAny = false;
  dropdownRegistry.forEach(({ segmentBtn, dropdownEl }) => {
    if (!dropdownEl.classList.contains('hidden')) {
      closedAny = true;
    }
    dropdownEl.classList.add('hidden');
    segmentBtn.classList.remove('open');
  });
  return closedAny;
}

function openProfileDropdown() {
  closeAllDropdowns();
  renderProfileUI();
  profileDropdown.classList.remove('hidden');
  profileSegment.classList.add('open');
}

// ----------------- INIT & CONFIG LOADING -----------------
async function loadConfig() {
  try {
    const res = await fetch(`/api/config?_=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    recentRepos = data.recentRepos || [];
    sshProfiles = data.sshProfiles || [];
    accountRules = data.accountRules || [];
    vaultStatus = data.vaultStatus || { hasVault: false, unlocked: false };
    appSettings = data.settings || { manageSshConfig: true };

    updateRecentReposUI();
    updateSshProfilesUI();
    renderSshConfigSetting();
  } catch (err) {
    logToTerminal('Failed to load application configurations: ' + err.message, 'error');
  }
}

function updateRecentReposUI() {
  renderRepoHeader();

  // Header dropdown list
  repoDropdownList.innerHTML = '';
  if (recentRepos.length === 0) {
    const li = document.createElement('li');
    li.className = 'dropdown-empty';
    li.innerText = 'No recent repositories';
    repoDropdownList.appendChild(li);
  } else {
    recentRepos.forEach(repoPath => {
      const li = document.createElement('li');
      li.className = 'dropdown-item' + (repoPath === activeRepo ? ' active' : '');

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined' + (repoPath === activeRepo ? ' item-check' : '');
      icon.innerText = repoPath === activeRepo ? 'check' : 'folder';

      const text = document.createElement('span');
      text.className = 'dropdown-item-text';
      const main = document.createElement('span');
      main.className = 'dropdown-item-main';
      main.innerText = repoBaseName(repoPath);
      const sub = document.createElement('span');
      sub.className = 'dropdown-item-sub';
      sub.innerText = repoPath;
      sub.title = repoPath;
      text.appendChild(main);
      text.appendChild(sub);

      const actions = document.createElement('span');
      actions.className = 'dropdown-item-actions';
      const btnRemove = document.createElement('button');
      btnRemove.className = 'btn btn-icon btn-sm';
      btnRemove.title = 'Remove from recents';
      btnRemove.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">close</span>';
      btnRemove.onclick = async (e) => {
        e.stopPropagation();
        await removeRepoFromRecents(repoPath);
      };
      actions.appendChild(btnRemove);

      li.appendChild(icon);
      li.appendChild(text);
      li.appendChild(actions);
      li.onclick = () => {
        closeAllDropdowns();
        if (repoPath !== activeRepo) {
          openRepository(repoPath);
        }
      };
      repoDropdownList.appendChild(li);
    });
  }

  // Welcome overlay list
  if (recentRepos.length === 0) {
    overlayRecentList.innerHTML = '<li class="empty-state">No recently opened repositories</li>';
  } else {
    overlayRecentList.innerHTML = '';
    recentRepos.forEach(path => {
      const li = document.createElement('li');

      const btn = document.createElement('button');
      btn.className = 'recent-item-btn';

      const spanPath = document.createElement('span');
      spanPath.className = 'recent-item-path';
      spanPath.innerText = path;

      const btnDel = document.createElement('button');
      btnDel.className = 'recent-item-delete';
      btnDel.title = 'Remove from recents';
      btnDel.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">delete</span>';

      btnDel.onclick = async (e) => {
        e.stopPropagation();
        await removeRepoFromRecents(path);
      };

      btn.onclick = () => openRepository(path);

      btn.appendChild(spanPath);
      btn.appendChild(btnDel);
      li.appendChild(btn);
      overlayRecentList.appendChild(li);
    });
  }
}

function getActiveProfile() {
  return sshProfiles.find(p => p.id === activeProfileId) || null;
}

function setActiveProfile(id, options = {}) {
  activeProfileId = id || '';
  if (activeRepo) {
    if (activeProfileId) {
      localStorage.setItem(`ssh_key_${activeRepo}`, activeProfileId);
    } else {
      localStorage.removeItem(`ssh_key_${activeRepo}`);
    }
  }
  renderProfileUI();
  applySshConfigForActiveProfile();

  if (!options.silent) {
    const profile = getActiveProfile();
    const label = profile ? profile.label : 'System SSH';
    logToTerminal(`Active SSH key for this repository: ${label}`);
    showToast(`SSH key: ${label}`, 'info', 2500);
    maybeOfferIdentity(profile);
  }
}

// ---- Startup SSH key health check ----
let sshHealthCheckDone = false;

async function validateSshProfilesOnStartup() {
  if (sshHealthCheckDone || sshProfiles.length === 0) return;
  sshHealthCheckDone = true;

  try {
    const res = await fetch('/api/config/ssh/validate-all', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.unavailable) return;

    const problems = (data.results || []).filter(r => r.status === 'missing' || r.status === 'invalid');
    (data.results || []).forEach(r => {
      if (r.status === 'passphrase') {
        logToTerminal(`SSH key "${r.label}" is passphrase-protected.`);
      }
    });
    if (problems.length === 0) return;

    const list = document.getElementById('ssh-health-list');
    list.innerHTML = '';
    problems.forEach(p => {
      logToTerminal(`SSH key problem — ${p.label} (${p.privateKeyPath}): ${p.message}`, 'error');

      const li = document.createElement('li');

      const title = document.createElement('div');
      title.className = 'ssh-health-item-title';
      title.innerText = p.label;

      const pathLine = document.createElement('div');
      pathLine.className = 'ssh-health-item-path';
      pathLine.innerText = p.privateKeyPath || '(no key path)';

      const reason = document.createElement('div');
      reason.className = 'ssh-health-item-reason';
      reason.innerText = p.status === 'missing' ? 'Key file not found on disk.' : p.message;

      li.appendChild(title);
      li.appendChild(pathLine);
      li.appendChild(reason);
      list.appendChild(li);
    });

    document.getElementById('ssh-health-modal').classList.remove('hidden');
  } catch (err) {
    // Never block startup on the health check
    console.warn('SSH key startup validation failed:', err);
  }
}

function renderSshConfigSetting() {
  const checkbox = document.getElementById('ssh-manage-config-checkbox');
  if (checkbox) {
    checkbox.checked = appSettings.manageSshConfig !== false;
  }
}

async function onSshConfigSettingChanged(e) {
  const enabled = e.target.checked;
  let removeManagedBlock = false;

  if (!enabled) {
    const { confirmed, checked } = await confirmDialog(
      'Multi-Git will stop writing to ~/.ssh/config. Pushes and pulls inside the app keep working with the selected key, but external tools will use whatever your own SSH config says.',
      {
        title: 'Manage SSH config yourself?',
        confirmLabel: 'Stop managing',
        checkboxLabel: 'Also remove the multi-git managed block from ~/.ssh/config',
        checkboxChecked: true
      }
    );
    if (!confirmed) {
      e.target.checked = true;
      return;
    }
    removeManagedBlock = checked;
  }

  try {
    const res = await fetch('/api/config/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manageSshConfig: enabled, removeManagedBlock })
    });
    const data = await res.json();

    if (!res.ok) {
      logToTerminal(data.error || 'Failed to save SSH config setting.', 'error');
      showToast(data.error || 'Failed to save SSH config setting.', 'error');
      renderSshConfigSetting();
      return;
    }

    applyConfigSnapshot(data.config);
    if (data.warning) {
      logToTerminal(data.warning, 'error');
    }

    if (enabled) {
      logToTerminal('Multi-Git will keep ~/.ssh/config in sync with the active key.', 'success');
      // Re-apply immediately for the current repository
      applySshConfigForActiveProfile();
    } else {
      logToTerminal('Multi-Git will no longer touch ~/.ssh/config.', 'info');
    }
  } catch (err) {
    logToTerminal('Failed to save SSH config setting: ' + err.message, 'error');
    renderSshConfigSetting();
  }
}

// Keep ~/.ssh/config pointing at the active key so external tools (Git Bash,
// IDEs) use it too. The server no-ops when the user manages their own config.
async function applySshConfigForActiveProfile() {
  if (!activeRepo) return;

  try {
    const res = await fetch('/api/config/ssh/apply-ssh-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: activeProfileId, repoPath: activeRepo })
    });
    const data = await res.json();

    if (!res.ok) {
      logToTerminal(data.error || 'Failed to update ~/.ssh/config.', 'error');
      return;
    }
    if (data.skipped) return;
    if (data.warning) {
      logToTerminal(data.warning, 'error');
    }
    if (data.updated) {
      logToTerminal(
        data.removed
          ? `~/.ssh/config: removed multi-git entry for ${data.host} (System SSH).`
          : `~/.ssh/config updated: ${data.host} now uses the active key.`
      );
    }
  } catch (err) {
    logToTerminal('Failed to update ~/.ssh/config: ' + err.message, 'error');
  }
}

// ---- Account identity helpers (key + authorship as one unit) ----

// An account "carries an identity" when it has a commit email configured
function profileIdentity(profile) {
  if (!profile || !profile.userEmail) return null;
  return { name: profile.userName || profile.label, email: profile.userEmail };
}

async function applyProfileIdentity(profile, options = {}) {
  const identity = profileIdentity(profile);
  if (!identity || !activeRepo) return false;

  try {
    const res = await fetch('/api/git/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify(identity)
    });
    if (res.ok) {
      if (!options.silent) {
        showToast(`Commit identity set to ${identity.name} <${identity.email}>.`, 'success');
      }
      logToTerminal(`git config user.name "${identity.name}" && git config user.email "${identity.email}"`, 'cmd');
      await refreshIdentity();
      return true;
    }
    const data = await res.json();
    showToast(data.error || 'Failed to apply account identity.', 'error');
  } catch (err) {
    logToTerminal('Failed to apply account identity: ' + err.message, 'error');
  }
  return false;
}

// After a manual account switch, offer to align the repo's commit identity
async function maybeOfferIdentity(profile) {
  const identity = profileIdentity(profile);
  if (!identity || !activeRepo) return;
  if (currentIdentity && currentIdentity.email === identity.email && currentIdentity.name === identity.name) return;

  const { confirmed } = await confirmDialog(
    `Also set this repository's commit identity to ${identity.name} <${identity.email}>?`,
    { title: 'Apply account identity', confirmLabel: 'Set Identity' }
  );
  if (confirmed) {
    await applyProfileIdentity(profile);
  }
}

// First auto-select rule whose match text appears in the remote URL
function findRuleProfile(remoteUrl) {
  if (!remoteUrl) return null;
  const url = String(remoteUrl).toLowerCase();
  const rule = accountRules.find(r => r.match && url.includes(r.match.toLowerCase()));
  if (!rule) return null;
  return sshProfiles.find(p => p.id === rule.profileId) || null;
}

// Detects committing/pushing with the wrong authorship for the active account
// or with the wrong account for this remote. Returns null when all is well.
function getAccountMismatch() {
  const profile = getActiveProfile();
  const identity = profileIdentity(profile);

  if (identity && currentIdentity && currentIdentity.email && currentIdentity.email !== identity.email) {
    return {
      type: 'identity',
      profile,
      expected: identity,
      actual: { name: currentIdentity.name, email: currentIdentity.email }
    };
  }

  const ruleProfile = findRuleProfile(originRemoteInfo && originRemoteInfo.remoteUrl);
  if (ruleProfile && ruleProfile.id !== activeProfileId) {
    return { type: 'account', profile, ruleProfile };
  }

  return null;
}

function renderAccountRulesUI() {
  if (!accountRulesList) return;

  // Account choices for new rules
  ruleProfileSelect.innerHTML = '';
  if (sshProfiles.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.innerText = 'No accounts yet';
    ruleProfileSelect.appendChild(opt);
  } else {
    sshProfiles.forEach(profile => {
      const opt = document.createElement('option');
      opt.value = profile.id;
      opt.innerText = profile.label;
      ruleProfileSelect.appendChild(opt);
    });
  }

  accountRulesList.innerHTML = '';
  if (accountRules.length === 0) {
    accountRulesList.innerHTML = '<li class="empty-state">No auto-select rules</li>';
    return;
  }

  accountRules.forEach(rule => {
    const profile = sshProfiles.find(p => p.id === rule.profileId);
    const li = document.createElement('li');
    li.className = 'rule-item';

    const matchSpan = document.createElement('span');
    matchSpan.className = 'rule-match';
    matchSpan.innerText = rule.match;
    matchSpan.title = rule.match;

    const arrow = document.createElement('span');
    arrow.className = 'material-symbols-outlined';
    arrow.style.fontSize = '15px';
    arrow.innerText = 'arrow_forward';

    const accountSpan = document.createElement('span');
    accountSpan.className = 'rule-account';
    if (profile) {
      const dot = document.createElement('span');
      dot.className = 'profile-dot';
      dot.style.backgroundColor = profileColor(profile.id);
      accountSpan.appendChild(dot);
      accountSpan.appendChild(document.createTextNode(profile.label));
    } else {
      accountSpan.innerText = '(deleted account)';
    }

    const btnDel = document.createElement('button');
    btnDel.className = 'btn btn-icon btn-sm rule-delete-btn';
    btnDel.title = 'Delete rule';
    btnDel.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">delete</span>';
    btnDel.onclick = () => deleteAccountRule(rule.id);

    li.appendChild(matchSpan);
    li.appendChild(arrow);
    li.appendChild(accountSpan);
    li.appendChild(btnDel);
    accountRulesList.appendChild(li);
  });
}

async function addAccountRule() {
  const match = ruleMatchInput.value.trim();
  const profileId = ruleProfileSelect.value;
  if (!match) {
    showToast('Enter a remote URL fragment to match (e.g. github.com/your-org).', 'warn');
    return;
  }
  if (!profileId) {
    showToast('Create an account profile first.', 'warn');
    return;
  }

  try {
    const res = await fetch('/api/config/account-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match, profileId })
    });
    const data = await res.json();
    if (res.ok) {
      ruleMatchInput.value = '';
      showToast('Auto-select rule added.', 'success');
      applyConfigSnapshot(data.config);
    } else {
      showToast(data.error || 'Failed to add rule.', 'error');
    }
  } catch (err) {
    logToTerminal('Failed to add rule: ' + err.message, 'error');
  }
}

async function deleteAccountRule(id) {
  try {
    const res = await fetch('/api/config/account-rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Rule deleted.', 'success');
      applyConfigSnapshot(data.config);
    } else {
      showToast(data.error || 'Failed to delete rule.', 'error');
    }
  } catch (err) {
    logToTerminal('Failed to delete rule: ' + err.message, 'error');
  }
}

function renderProfileUI() {
  const profile = getActiveProfile();

  // Header segment
  profileSegmentName.innerText = profile ? profile.label : 'System SSH';
  if (profile) {
    profileColorDot.classList.remove('profile-dot-system');
    profileColorDot.style.backgroundColor = profileColor(profile.id);
  } else {
    profileColorDot.classList.add('profile-dot-system');
    profileColorDot.style.backgroundColor = '';
  }

  // Vault glyph next to the profile name (saved passphrase indicator)
  if (profile && profile.hasSavedPassword) {
    profileVaultIcon.classList.remove('hidden', 'vault-open', 'vault-locked');
    if (vaultStatus.unlocked) {
      profileVaultIcon.innerText = 'lock_open';
      profileVaultIcon.classList.add('vault-open');
      profileVaultIcon.title = 'Saved passphrase available (vault unlocked)';
    } else {
      profileVaultIcon.innerText = 'lock';
      profileVaultIcon.classList.add('vault-locked');
      profileVaultIcon.title = 'Saved passphrase requires unlocking the vault';
    }
  } else {
    profileVaultIcon.classList.add('hidden');
  }

  // Vault chip + button in dropdown
  dropdownVaultStatus.classList.remove('vault-open', 'vault-locked');
  if (vaultStatus.unlocked) {
    dropdownVaultStatus.innerText = 'Vault: Unlocked';
    dropdownVaultStatus.classList.add('vault-open');
    btnDropdownVault.innerText = 'Lock';
  } else if (vaultStatus.hasVault) {
    dropdownVaultStatus.innerText = 'Vault: Locked';
    dropdownVaultStatus.classList.add('vault-locked');
    btnDropdownVault.innerText = 'Unlock';
  } else {
    dropdownVaultStatus.innerText = 'Vault: Not set up';
    btnDropdownVault.innerText = 'Unlock';
  }

  renderProfileDropdownList();
  renderIdentityRow();
}

function renderProfileDropdownList() {
  profileDropdownList.innerHTML = '';

  const addItem = (profile) => {
    const id = profile ? profile.id : '';
    const li = document.createElement('li');
    li.className = 'dropdown-item' + (id === activeProfileId ? ' active' : '');

    const dot = document.createElement('span');
    dot.className = 'profile-dot' + (profile ? '' : ' profile-dot-system');
    if (profile) {
      dot.style.backgroundColor = profileColor(profile.id);
    }

    const text = document.createElement('span');
    text.className = 'dropdown-item-text';
    const main = document.createElement('span');
    main.className = 'dropdown-item-main';
    main.innerText = profile ? profile.label : 'System SSH';
    const sub = document.createElement('span');
    sub.className = 'dropdown-item-sub';
    // Prefer the account's identity as the subtitle; key path stays in the tooltip
    const identity = profileIdentity(profile);
    if (identity) {
      sub.innerText = `${identity.name} <${identity.email}>`;
      sub.title = `${sub.innerText} — ${profile.privateKeyPath}`;
    } else {
      sub.innerText = profile ? profile.privateKeyPath : 'Default ssh configuration / agent';
      sub.title = sub.innerText;
    }
    text.appendChild(main);
    text.appendChild(sub);

    li.appendChild(dot);
    li.appendChild(text);

    if (profile && profile.hasSavedPassword) {
      const lockIcon = document.createElement('span');
      lockIcon.className = 'material-symbols-outlined';
      lockIcon.style.fontSize = '15px';
      lockIcon.innerText = vaultStatus.unlocked ? 'lock_open' : 'lock';
      lockIcon.title = 'Passphrase saved in encrypted vault';
      li.appendChild(lockIcon);
    }

    if (id === activeProfileId) {
      const check = document.createElement('span');
      check.className = 'material-symbols-outlined item-check';
      check.innerText = 'check';
      li.appendChild(check);
    }

    li.onclick = () => {
      closeAllDropdowns();
      if (id !== activeProfileId) {
        setActiveProfile(id);
      }
    };
    profileDropdownList.appendChild(li);
  };

  addItem(null);
  sshProfiles.forEach(profile => addItem(profile));
}

function renderIdentityRow() {
  if (!identityText) return;
  if (currentIdentity && (currentIdentity.name || currentIdentity.email)) {
    const scope = currentIdentity.isLocal ? 'repo' : 'global';
    identityText.innerText = `${currentIdentity.name || '(no name)'} <${currentIdentity.email || 'no email'}> · ${scope}`;
    identityText.title = identityText.innerText;
  } else if (activeRepo) {
    identityText.innerText = 'Commit identity: not set';
  } else {
    identityText.innerText = 'Commit identity: —';
  }
}

function updateSshProfilesUI() {
  // Active profile may have been deleted
  if (activeProfileId && !sshProfiles.some(p => p.id === activeProfileId)) {
    setActiveProfile('', { silent: true });
  } else {
    renderProfileUI();
  }
  updateVaultStatusUI();
  renderAccountRulesUI();

  // Update Profiles Manager Modal Table
  if (sshProfiles.length === 0) {
    sshProfilesTableBody.innerHTML = '<tr><td colspan="4" class="text-center" style="text-align: center; color: var(--text-dim);">No registered profiles.</td></tr>';
  } else {
    sshProfilesTableBody.innerHTML = '';
    sshProfiles.forEach(profile => {
      const tr = document.createElement('tr');

      const tdLabel = document.createElement('td');
      tdLabel.className = 'col-profile-name';
      const labelDot = document.createElement('span');
      labelDot.className = 'profile-dot';
      labelDot.style.cssText = `display:inline-block; margin-right:6px; vertical-align:middle; background-color:${profileColor(profile.id)};`;
      tdLabel.appendChild(labelDot);
      tdLabel.appendChild(document.createTextNode(profile.label));
      const identity = profileIdentity(profile);
      if (identity) {
        const identityLine = document.createElement('div');
        identityLine.style.cssText = 'font-size:0.6875rem; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis;';
        identityLine.innerText = `${identity.name} <${identity.email}>`;
        identityLine.title = identityLine.innerText;
        tdLabel.appendChild(identityLine);
      }

      const tdPath = document.createElement('td');
      tdPath.className = 'col-key-path';
      tdPath.innerText = profile.privateKeyPath;
      tdPath.title = profile.privateKeyPath;

      const tdPassword = document.createElement('td');
      tdPassword.className = 'col-password';
      tdPassword.innerText = profile.hasSavedPassword ? 'Saved' : 'Not saved';
      tdPassword.title = profile.hasSavedPassword ? 'Encrypted passphrase saved in vault' : 'No passphrase stored';

      const tdActions = document.createElement('td');
      tdActions.className = 'action-buttons';

      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-secondary btn-sm';
      btnEdit.type = 'button';
      btnEdit.title = 'Edit profile';
      btnEdit.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">edit</span>';
      btnEdit.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        loadSshProfileIntoForm(profile);
      };

      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-danger btn-sm';
      btnDel.type = 'button';
      btnDel.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">delete</span>';
      btnDel.title = 'Delete SSH profile';
      btnDel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteSshProfile(profile.id, profile.label);
      };

      const btnTest = document.createElement('button');
      btnTest.className = 'btn btn-secondary btn-sm';
      btnTest.type = 'button';
      btnTest.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">fact_check</span>';
      btnTest.title = 'Test SSH key';
      btnTest.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        testSshProfile(profile.id, profile.label);
      };

      const btnCopyPub = document.createElement('button');
      btnCopyPub.className = 'btn btn-secondary btn-sm';
      btnCopyPub.type = 'button';
      btnCopyPub.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">content_copy</span>';
      btnCopyPub.title = 'Copy public key';
      btnCopyPub.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyProfilePublicKey(profile);
      };

      const btnCopyPubPath = document.createElement('button');
      btnCopyPubPath.className = 'btn btn-secondary btn-sm';
      btnCopyPubPath.type = 'button';
      btnCopyPubPath.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">link</span>';
      btnCopyPubPath.title = 'Copy public key path';
      btnCopyPubPath.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyProfilePublicKeyPath(profile);
      };

      const btnOpenFolder = document.createElement('button');
      btnOpenFolder.className = 'btn btn-secondary btn-sm';
      btnOpenFolder.type = 'button';
      btnOpenFolder.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">folder_open</span>';
      btnOpenFolder.title = 'Open key folder';
      btnOpenFolder.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openProfileKeyFolder(profile);
      };

      tdActions.appendChild(btnEdit);
      tdActions.appendChild(btnTest);
      tdActions.appendChild(btnCopyPub);
      tdActions.appendChild(btnCopyPubPath);
      tdActions.appendChild(btnOpenFolder);
      tdActions.appendChild(btnDel);

      tr.appendChild(tdLabel);
      tr.appendChild(tdPath);
      tr.appendChild(tdPassword);
      tr.appendChild(tdActions);
      sshProfilesTableBody.appendChild(tr);
    });
  }
}

function updateVaultStatusUI() {
  let state = 'uninitialized';
  let title = 'Passphrase vault is not set up';
  let detail = 'A vault is optional. Set one up only if you want Multi-Git to save SSH passphrases on this computer.';
  let icon = 'lock';

  if (vaultStatus.unlocked) {
    state = 'unlocked';
    title = 'Passphrase vault is unlocked';
    detail = 'Saved passphrases can be used and new ones can be encrypted for this app session. Lock it when you are finished.';
    icon = 'lock_open';
  } else if (vaultStatus.hasVault) {
    state = 'locked';
    title = 'Passphrase vault is locked';
    detail = 'Saved passphrases stay encrypted on disk. Unlock the vault before using or saving a passphrase.';
    icon = 'lock';
  }

  if (vaultStatusCard) {
    vaultStatusCard.dataset.vaultState = state;
  }
  if (vaultStatusText) {
    vaultStatusText.innerText = title;
  }
  if (vaultStatusDetail) {
    vaultStatusDetail.innerText = detail;
  }
  if (vaultStatusIcon) {
    vaultStatusIcon.innerText = icon;
  }
  if (btnSetupVault) {
    btnSetupVault.classList.toggle('hidden', state !== 'uninitialized');
  }
  if (btnUnlockVault) {
    btnUnlockVault.classList.toggle('hidden', state !== 'locked');
  }
  if (btnLockVault) {
    btnLockVault.classList.toggle('hidden', state !== 'unlocked');
  }

  renderProfileUI();
}

async function refreshVaultStatus() {
  try {
    const res = await fetch('/api/secrets/status');
    const data = await res.json();
    if (res.ok) {
      vaultStatus = { hasVault: data.hasVault, unlocked: data.unlocked };
      updateVaultStatusUI();
    }
  } catch (err) {
    logToTerminal('Could not load vault status: ' + err.message, 'error');
  }
}

// ----------------- REPOSITORY MANAGEMENT -----------------

function renderRepoHeader() {
  if (activeRepo) {
    repoSegmentName.innerText = repoBaseName(activeRepo);
    repoSegmentPath.innerText = activeRepo;
    repoSegmentPath.title = activeRepo;
  } else {
    repoSegmentName.innerText = 'None selected';
    repoSegmentPath.innerText = '';
  }
}

async function pickFolderPath() {
  // In desktop mode, use Electron's native dialog via preload bridge.
  if (window.desktopApi && typeof window.desktopApi.selectFolder === 'function') {
    return window.desktopApi.selectFolder();
  }

  const res = await fetch('/api/git/select-folder');
  const data = await res.json();
  return data.path || '';
}

// Open a native folder browser and then load the chosen repo
async function browseAndOpen() {
  logToTerminal('Opening folder browser...');
  try {
    const selectedPath = await pickFolderPath();
    if (!selectedPath) {
      // User cancelled – do nothing silently
      return;
    }
    openRepository(selectedPath);
  } catch (err) {
    logToTerminal('Could not open folder dialog: ' + err.message, 'error');
    showToast('Could not open the folder dialog. Is the backend server running?', 'error');
  }
}

// Open folder browser and initialise a new repo in the chosen folder
async function createNewRepo() {
  logToTerminal('Opening folder browser to choose new repo location...');
  try {
    const selectedPath = await pickFolderPath();
    if (!selectedPath) return;  // user cancelled

    const initRes = await fetch('/api/git/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath: selectedPath })
    });
    const initData = await initRes.json();

    if (initRes.ok) {
      logToTerminal(`Git repository initialised at: ${selectedPath}`, 'success');
      showToast('Repository initialized.', 'success');
      openRepository(selectedPath);
    } else {
      logToTerminal(initData.error, 'error');
      showToast('Could not initialize repository: ' + initData.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Error creating repository: ' + err.message, 'error');
    showToast('Error creating repository: ' + err.message, 'error');
  }
}

async function openRepository(repoPath) {
  if (!repoPath) {
    showToast('Select a valid repository path first.', 'warn');
    return;
  }

  closeAllDropdowns();
  logToTerminal(`Opening repository: ${repoPath}...`);
  try {
    const res = await fetch('/api/config/repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath })
    });
    const data = await res.json();

    if (res.ok) {
      activeRepo = repoPath;
      appContainer.classList.remove('disabled-view');
      noRepoOverlay.classList.add('hidden');

      logToTerminal(`Loaded repository: ${repoPath}`, 'success');

      await loadConfig();

      // Restore this repo's SSH key preference (supports legacy path values)
      const cachedKey = localStorage.getItem(`ssh_key_${activeRepo}`);
      let mappedId = '';
      if (cachedKey) {
        if (sshProfiles.some(p => p.id === cachedKey)) {
          mappedId = cachedKey;
        } else {
          const legacy = sshProfiles.find(p => p.privateKeyPath === cachedKey);
          if (legacy) mappedId = legacy.id;
        }
      }

      // No saved preference: let auto-select rules pick the account by remote
      let autoSelectedProfile = null;
      if (!mappedId && accountRules.length > 0) {
        await refreshOriginRemoteInfo();
        autoSelectedProfile = findRuleProfile(originRemoteInfo && originRemoteInfo.remoteUrl);
        if (autoSelectedProfile) {
          mappedId = autoSelectedProfile.id;
        }
      }

      setActiveProfile(mappedId, { silent: true });

      if (autoSelectedProfile) {
        logToTerminal(`Auto-selected account "${autoSelectedProfile.label}" for this remote.`);
        showToast(`Auto-selected account "${autoSelectedProfile.label}" for this remote.`, 'info');
        // Accounts switch authorship too: align identity without prompting
        await applyProfileIdentity(autoSelectedProfile, { silent: true });
      }

      renderRepoHeader();
      await Promise.all([refreshAll(), refreshIdentity()]);
    } else {
      logToTerminal(`Failed to load repository: ${data.error}`, 'error');
      showToast(`Could not open repository: ${data.error}`, 'error', 7000);
      if (!activeRepo) {
        noRepoOverlay.classList.remove('hidden');
        appContainer.classList.add('disabled-view');
      }
    }
  } catch (err) {
    logToTerminal(`Failed to connect to API: ${err.message}`, 'error');
    showToast('Connection error: could not reach the backend server.', 'error', 7000);
  }
}

async function removeRepoFromRecents(repoPath) {
  try {
    const res = await fetch('/api/config/repo', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath })
    });
    if (res.ok) {
      logToTerminal(`Removed ${repoPath} from recents.`);
      await loadConfig();
    }
  } catch (err) {
    logToTerminal(`Error removing repository: ${err.message}`, 'error');
  }
}

// ----------------- GIT STATUS & LOADING -----------------
async function refreshAll() {
  if (!activeRepo) return;
  btnRefresh.classList.add('spinning');

  try {
    // Status first so the branch renderers can reuse it
    await refreshGitStatus();
    await Promise.all([
      refreshBranchList(),
      refreshCommitHistory(),
      refreshOriginRemoteInfo(),
      refreshStashList(),
      refreshSafetyNet(),
      refreshTagList()
    ]);
  } catch (err) {
    logToTerminal('Refresh failed: ' + err.message, 'error');
  } finally {
    btnRefresh.classList.remove('spinning');
  }
}

function renderRemoteProtocolButton() {
  if (!btnRemoteProtocol) return;

  if (!activeRepo || !originRemoteInfo || !originRemoteInfo.remoteUrl) {
    btnRemoteProtocol.classList.add('hidden');
    return;
  }

  const { remoteUrl, protocol, canToggle, suggestedUrl } = originRemoteInfo;
  btnRemoteProtocol.classList.remove('hidden');

  if (!canToggle) {
    btnRemoteProtocol.disabled = true;
    remoteProtocolLabel.innerText = 'Remote';
    btnRemoteProtocol.title = `Origin: ${remoteUrl}\nThis URL cannot be switched automatically.`;
    btnRemoteProtocol.classList.remove('protocol-ssh', 'protocol-https');
    return;
  }

  const isSsh = protocol === 'ssh';
  btnRemoteProtocol.disabled = false;
  remoteProtocolLabel.innerText = isSsh ? 'SSH' : 'HTTPS';
  btnRemoteProtocol.classList.toggle('protocol-ssh', isSsh);
  btnRemoteProtocol.classList.toggle('protocol-https', !isSsh);
  btnRemoteProtocol.title = `Origin: ${remoteUrl}\nClick to switch to ${isSsh ? 'HTTPS' : 'SSH'} (${suggestedUrl})`;
}

async function refreshOriginRemoteInfo() {
  if (!activeRepo) {
    originRemoteInfo = null;
    renderRemoteProtocolButton();
    return;
  }

  try {
    const res = await fetch('/api/git/remote/origin', {
      headers: { 'x-repo-path': activeRepo }
    });
    const data = await res.json();
    originRemoteInfo = res.ok ? data : null;
  } catch (err) {
    originRemoteInfo = null;
  }

  renderRemoteProtocolButton();
}

async function toggleRemoteProtocol() {
  if (!activeRepo || !originRemoteInfo || !originRemoteInfo.canToggle) {
    return;
  }

  const targetProtocol = originRemoteInfo.protocol === 'ssh' ? 'HTTPS' : 'SSH';
  const { confirmed } = await confirmDialog(
    `Change the origin remote from\n${originRemoteInfo.remoteUrl}\nto\n${originRemoteInfo.suggestedUrl}`,
    { title: `Switch origin to ${targetProtocol}?`, confirmLabel: `Switch to ${targetProtocol}` }
  );
  if (!confirmed) {
    return;
  }

  try {
    btnRemoteProtocol.disabled = true;

    const res = await fetch('/api/git/remote/origin/toggle-protocol', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo }
    });
    const data = await res.json();

    if (!res.ok) {
      logToTerminal(data.error || 'Failed to switch origin remote protocol.', 'error');
      showToast(data.error || 'Failed to switch origin remote protocol.', 'error', 7000);
      return;
    }

    logToTerminal(`git remote set-url origin ${data.remoteUrl}`, 'cmd');
    logToTerminal(`Origin switched to ${targetProtocol}: ${data.remoteUrl}`, 'success');
    showToast(`Origin remote switched to ${targetProtocol}.`, 'success');
  } catch (err) {
    logToTerminal('Failed to switch origin remote: ' + err.message, 'error');
  } finally {
    btnRemoteProtocol.disabled = false;
    await refreshOriginRemoteInfo();
  }
}

async function refreshGitStatus() {
  const res = await fetch('/api/git/status', {
    headers: { 'x-repo-path': activeRepo }
  });
  const data = await res.json();

  if (!res.ok) {
    logToTerminal('Error loading Git status: ' + data.error, 'error');
    return;
  }

  currentStatus = data;
  isMerging = data.isMerging;
  isRebasing = data.isRebasing;

  renderBranchHeader();

  const conflicts = data.conflicts || [];
  renderStagingLists(data.staged, data.unstaged, conflicts);

  // Handle conflict state banner
  if (isMerging || isRebasing || conflicts.length > 0) {
    if (conflictBanner.classList.contains('hidden')) {
      logToTerminal(`Active conflict status detected! Merging: ${isMerging}, Rebasing: ${isRebasing}. Conflicted files: ${conflicts.length}`, 'error');
    }
    conflictBanner.classList.remove('hidden');
  } else {
    conflictBanner.classList.add('hidden');
  }
}

function setCountBadge(el, count, arrow) {
  if (!el) return;
  if (count > 0) {
    el.innerText = `${arrow}${count}`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function renderBranchHeader() {
  const status = currentStatus;
  if (!status) {
    branchSegmentName.innerText = '—';
    setCountBadge(branchAheadBadge, 0, '↑');
    setCountBadge(branchBehindBadge, 0, '↓');
    branchStateBadge.classList.add('hidden');
    setCountBadge(pushCountBadge, 0, '↑');
    setCountBadge(pullCountBadge, 0, '↓');
    return;
  }

  branchSegmentName.innerText = status.branch || '—';
  branchSegmentName.title = status.branch || '';
  setCountBadge(branchAheadBadge, status.ahead || 0, '↑');
  setCountBadge(branchBehindBadge, status.behind || 0, '↓');

  let state = null;
  if (status.isRebasing) state = 'REBASE';
  else if (status.isMerging) state = 'MERGE';
  else if (status.detached) state = 'DETACHED';
  else if (status.noCommits) state = 'NO COMMITS';
  if (state) {
    branchStateBadge.innerText = state;
    branchStateBadge.classList.remove('hidden');
  } else {
    branchStateBadge.classList.add('hidden');
  }

  // Mirror ahead/behind onto the Push / Pull buttons
  setCountBadge(pushCountBadge, status.ahead || 0, '↑');
  setCountBadge(pullCountBadge, status.behind || 0, '↓');
}

function renderStagingLists(staged, unstaged, conflicts) {
  updateCommitAvailability(staged);

  // Render Unstaged Files
  if (unstaged.length === 0 && conflicts.length === 0) {
    unstagedFilesList.innerHTML = '<li class="empty-state">No modified files</li>';
  } else {
    unstagedFilesList.innerHTML = '';

    // Add conflicts first with a warning
    conflicts.forEach(file => {
      unstagedFilesList.appendChild(createFileListItem(file.path, 'U', false));
    });

    unstaged.forEach(file => {
      unstagedFilesList.appendChild(createFileListItem(file.path, file.status, false));
    });
  }

  // Render Staged Files
  if (staged.length === 0) {
    stagedFilesList.innerHTML = '<li class="empty-state">No staged files</li>';
  } else {
    stagedFilesList.innerHTML = '';
    staged.forEach(file => {
      stagedFilesList.appendChild(createFileListItem(file.path, file.status, true));
    });
  }

  renderDiffFileList(staged, unstaged, conflicts);

  // Retain active diff selection if still modified
  if (activeDiffFile) {
    const found = findDiffEntry(activeDiffFile.path, activeDiffFile.staged);
    if (!found) {
      clearDiffView();
    } else {
      activeDiffFile.status = found.status;
      updateActiveFileItems();
    }
  }
}

function updateCommitAvailability(staged = []) {
  const hasStagedChanges = Array.isArray(staged) && staged.length > 0;
  btnCommit.disabled = !hasStagedChanges;
  btnCommit.title = hasStagedChanges ? 'Commit staged changes' : 'Stage changes before committing';
}

function setFilenameWrapping(enabled) {
  [unstagedFilesList, stagedFilesList].forEach((list) => {
    list.closest('.file-list-card').classList.toggle('wrap-file-names', enabled);
  });
}

function getDiffEntries(staged = [], unstaged = [], conflicts = []) {
  const conflictPaths = new Set(conflicts.map(file => file.path));
  const entries = [];

  conflicts.forEach(file => {
    entries.push({ path: file.path, status: 'U', staged: false, scope: 'Conflict' });
  });

  unstaged.forEach(file => {
    if (!conflictPaths.has(file.path)) {
      entries.push({
        path: file.path,
        status: file.status,
        staged: false,
        scope: file.status === '?' ? 'Untracked' : 'Unstaged'
      });
    }
  });

  staged.forEach(file => {
    entries.push({ path: file.path, status: file.status, staged: true, scope: 'Staged' });
  });

  return entries;
}

function getCurrentDiffEntries() {
  if (!currentStatus) return [];
  return getDiffEntries(currentStatus.staged || [], currentStatus.unstaged || [], currentStatus.conflicts || []);
}

function findDiffEntry(filePath, isStaged) {
  return getCurrentDiffEntries().find(entry => entry.path === filePath && entry.staged === isStaged);
}

function updateActiveFileItems() {
  document.querySelectorAll('.file-item').forEach(item => {
    const isActive = Boolean(activeDiffFile) &&
      item.dataset.path === activeDiffFile.path &&
      item.dataset.staged === String(activeDiffFile.staged);
    item.classList.toggle('active', isActive);
  });
}

function renderDiffFileList(staged = [], unstaged = [], conflicts = []) {
  const entries = getDiffEntries(staged, unstaged, conflicts);
  if (!diffFilesList) return;

  diffFilesList.innerHTML = '';
  if (entries.length === 0) {
    diffFilesList.innerHTML = '<li class="empty-state">No modified files</li>';
    return;
  }

  entries.forEach(entry => {
    diffFilesList.appendChild(createDiffFileListItem(entry));
  });
  updateActiveFileItems();
}

function createDiffFileListItem(entry) {
  const li = document.createElement('li');
  li.className = 'file-item diff-file-item';
  li.dataset.path = entry.path;
  li.dataset.staged = entry.staged;
  li.dataset.status = entry.status;

  const fileInfo = document.createElement('div');
  fileInfo.className = 'file-info';

  const status = statusLabels[entry.status] || { char: entry.status, title: 'Unknown', class: 'status-q' };

  const spanStatus = document.createElement('span');
  spanStatus.className = `status-indicator ${status.class}`;
  spanStatus.title = status.title;
  spanStatus.innerText = status.char;

  const spanName = document.createElement('span');
  spanName.className = 'file-name';
  spanName.innerText = entry.path;
  spanName.title = entry.path;

  const spanScope = document.createElement('span');
  spanScope.className = 'diff-file-scope';
  spanScope.innerText = entry.scope;

  fileInfo.appendChild(spanStatus);
  fileInfo.appendChild(spanName);
  li.appendChild(fileInfo);
  li.appendChild(spanScope);

  li.onclick = () => selectDiffFile(entry.path, entry.staged, entry.status);

  return li;
}

function selectDiffFile(filePath, isStaged, statusChar) {
  activeDiffFile = { path: filePath, staged: isStaged, status: statusChar };
  updateActiveFileItems();
  loadDiff(filePath, isStaged, statusChar === '?');
  switchViewTab('diff');
}

function createFileListItem(filePath, statusChar, isStaged) {
  const li = document.createElement('li');
  li.className = 'file-item';
  li.dataset.path = filePath;
  li.dataset.staged = isStaged;
  li.dataset.status = statusChar;
  li.title = statusChar === 'U'
    ? 'Click to resolve conflict'
    : (isStaged ? 'Click to unstage this file' : 'Click to stage this file');

  if (activeDiffFile && activeDiffFile.path === filePath && activeDiffFile.staged === isStaged) {
    li.classList.add('active');
  }

  const fileInfo = document.createElement('div');
  fileInfo.className = 'file-info';

  const status = statusLabels[statusChar] || { char: statusChar, title: 'Unknown', class: 'status-q' };

  const spanStatus = document.createElement('span');
  spanStatus.className = `status-indicator ${status.class}`;
  spanStatus.title = status.title;
  spanStatus.innerText = status.char;

  const spanName = document.createElement('span');
  spanName.className = 'file-name';
  spanName.innerText = filePath;
  spanName.title = filePath;

  fileInfo.appendChild(spanStatus);
  fileInfo.appendChild(spanName);
  li.appendChild(fileInfo);

  const fileActions = document.createElement('div');
  fileActions.className = 'file-actions';

  if (statusChar === 'U') {
    // Conflict File: Open resolver action
    const btnResolve = document.createElement('button');
    btnResolve.className = 'btn btn-secondary btn-sm';
    btnResolve.style.padding = '2px 6px';
    btnResolve.setAttribute('aria-label', `Resolve conflict in ${filePath}`);
    btnResolve.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">dynamic_form</span> Resolve';
    btnResolve.onclick = (e) => {
      e.stopPropagation();
      openConflictResolver(filePath);
    };
    fileActions.appendChild(btnResolve);
  } else {
    // Normal files: row click toggles stage state; this action opens the diff.
    const btnDiff = document.createElement('button');
    btnDiff.className = 'btn btn-icon btn-sm';
    btnDiff.style.width = '24px';
    btnDiff.style.height = '24px';
    btnDiff.title = 'View Diff';
    btnDiff.setAttribute('aria-label', `View diff for ${filePath}`);
    btnDiff.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">difference</span>';
    btnDiff.onclick = (e) => {
      e.stopPropagation();
      selectDiffFile(filePath, isStaged, statusChar);
    };
    fileActions.appendChild(btnDiff);

    // Discard button (only for unstaged changes)
    if (!isStaged) {
      const btnDiscard = document.createElement('button');
      btnDiscard.className = 'btn btn-icon btn-sm';
      btnDiscard.style.width = '24px';
      btnDiscard.style.height = '24px';
      btnDiscard.title = 'Discard Changes';
      btnDiscard.setAttribute('aria-label', `Discard changes in ${filePath}`);
      btnDiscard.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">delete</span>';
      btnDiscard.onclick = async (e) => {
        e.stopPropagation();
        await discardChanges(filePath, statusChar === '?');
      };
      fileActions.appendChild(btnDiscard);
    }
  }

  li.appendChild(fileActions);

  li.onclick = async () => {
    if (statusChar === 'U') {
      openConflictResolver(filePath);
      return;
    }

    if (isStaged) {
      await unstageFiles([filePath]);
    } else {
      await stageFiles([filePath]);
    }
  };

  return li;
}

// ----------------- DIFF RENDERER -----------------
function renderDiffLines(diffLines) {
  diffContent.innerHTML = '';

  diffLines.forEach((line) => {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'diff-line';

    const lineNums = document.createElement('div');
    lineNums.className = 'diff-line-nums';

    const spanOld = document.createElement('span');
    spanOld.innerText = line.oldLine !== null ? line.oldLine : '';
    const spanNew = document.createElement('span');
    spanNew.innerText = line.newLine !== null ? line.newLine : '';

    lineNums.appendChild(spanOld);
    lineNums.appendChild(spanNew);

    const lineText = document.createElement('div');
    lineText.className = 'diff-line-content';

    if (line.type === 'hunk') {
      lineDiv.classList.add('diff-line-hunk');
      lineText.innerText = line.content;
    } else if (line.type === 'addition') {
      lineDiv.classList.add('diff-line-addition');
      lineText.innerText = '+' + line.content;
    } else if (line.type === 'deletion') {
      lineDiv.classList.add('diff-line-deletion');
      lineText.innerText = '-' + line.content;
    } else {
      lineText.innerText = ' ' + line.content;
    }

    lineDiv.appendChild(lineNums);
    lineDiv.appendChild(lineText);
    diffContent.appendChild(lineDiv);
  });
}

// Show Stage/Unstage + Discard actions in the File Diff tab for the active
// working-tree file; hidden for read-only (commit history) diffs.
function renderDiffActions() {
  if (!activeDiffFile || activeDiffFile.status === 'U') {
    diffActions.classList.add('hidden');
    return;
  }

  diffActions.classList.remove('hidden');
  btnDiffToggleStageLabel.innerText = activeDiffFile.staged ? 'Unstage' : 'Stage';
  btnDiffToggleStage.querySelector('.material-symbols-outlined').innerText = activeDiffFile.staged ? 'remove' : 'add';
  btnDiffDiscard.classList.toggle('hidden', Boolean(activeDiffFile.staged));
}

async function loadDiff(filePath, isStaged, isUntracked) {
  diffFileTitle.innerText = filePath;
  diffFileType.innerText = isStaged ? 'Staged' : (isUntracked ? 'Untracked' : 'Unstaged');
  diffFileType.className = `badge ${isStaged ? 'status-a' : 'status-m'}`;
  renderDiffActions();
  renderPaneMessage(diffContent, 'Loading changes...');

  try {
    const url = `/api/git/diff?path=${encodeURIComponent(filePath)}&staged=${isStaged}&untracked=${isUntracked}`;
    const res = await fetch(url, { headers: { 'x-repo-path': activeRepo } });
    const data = await res.json();

    if (!res.ok) {
      renderPaneMessage(diffContent, `Error loading diff: ${data.error}`, true);
      return;
    }

    if (data.diff.length === 0) {
      renderPaneMessage(diffContent, 'No line changes found (file might be binary or renamed)');
      return;
    }

    renderDiffLines(data.diff);
  } catch (err) {
    renderPaneMessage(diffContent, `Diff error: ${err.message}`, true);
  }
}

function clearDiffView() {
  activeDiffFile = null;
  diffFileTitle.innerText = 'File Diff';
  diffFileType.innerText = 'Unselected';
  diffFileType.className = 'badge';
  diffActions.classList.add('hidden');
  updateActiveFileItems();
  diffContent.innerHTML = `
    <div class="diff-empty-state">
      <span class="material-symbols-outlined">difference</span>
      <p>Select a modified file to view changes</p>
    </div>
  `;
}

// ----------------- GIT BASIC OPERATIONS -----------------
async function stageFiles(files) {
  logToTerminal(`git add ${files.join(' ')}`, 'cmd');
  const res = await fetch('/api/git/stage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
    body: JSON.stringify({ files })
  });
  const data = await res.json();
  if (res.ok) {
    logToTerminal('Staged file(s) successfully.', 'success');
    await refreshGitStatus();
  } else {
    logToTerminal(data.error, 'error');
    showToast(data.error, 'error');
  }
}

async function unstageFiles(files) {
  logToTerminal(`git reset HEAD -- ${files.join(' ')}`, 'cmd');
  const res = await fetch('/api/git/unstage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
    body: JSON.stringify({ files })
  });
  const data = await res.json();
  if (res.ok) {
    logToTerminal('Unstaged file(s) successfully.', 'success');
    await refreshGitStatus();
  } else {
    logToTerminal(data.error, 'error');
    showToast(data.error, 'error');
  }
}

async function discardChanges(filePath, isUntracked) {
  const confirmMsg = isUntracked
    ? `Permanently DELETE untracked file:\n${filePath}?`
    : `Discard all local changes in:\n${filePath}?`;

  const { confirmed } = await confirmDialog(confirmMsg, {
    title: isUntracked ? 'Delete untracked file' : 'Discard changes',
    confirmLabel: isUntracked ? 'Delete' : 'Discard',
    danger: true
  });
  if (!confirmed) return;

  logToTerminal(isUntracked ? `rm ${filePath}` : `git checkout -- ${filePath}`, 'cmd');
  const res = await fetch('/api/git/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
    body: JSON.stringify({ filePath, isUntracked })
  });
  const data = await res.json();
  if (res.ok) {
    logToTerminal('Discarded changes.', 'success');
    if (activeDiffFile && activeDiffFile.path === filePath) {
      clearDiffView();
    }
    await refreshGitStatus();
  } else {
    logToTerminal(data.error, 'error');
    showToast(data.error, 'error');
  }
}

async function discardAllChanges() {
  if (!activeRepo) return;

  const result = await confirmDialog(
    'Discard ALL unstaged changes in tracked files? This cannot be undone.',
    {
      title: 'Discard all changes',
      confirmLabel: 'Discard All',
      danger: true,
      checkboxLabel: 'Also delete untracked files and folders'
    }
  );
  if (!result.confirmed) return;

  logToTerminal(`git checkout -- .${result.checked ? ' && git clean -fd' : ''}`, 'cmd');
  try {
    const res = await fetch('/api/git/discard-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ deleteUntracked: result.checked })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal('All unstaged changes discarded.', 'success');
      showToast('All unstaged changes discarded.', 'success');
      clearDiffView();
      await refreshGitStatus();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Discard all failed: ' + err.message, 'error');
  }
}

async function commitChanges() {
  const message = commitMsgInput.value.trim();
  const amend = commitAmendCheckbox.checked;
  if (!currentStatus || !currentStatus.staged || currentStatus.staged.length === 0) {
    showToast('Stage at least one change before committing.', 'warn');
    updateCommitAvailability(currentStatus ? currentStatus.staged : []);
    return;
  }
  if (!message) {
    showToast('Enter a commit message first.', 'warn');
    commitMsgInput.focus();
    return;
  }

  if (amend) {
    // If nothing is ahead of the remote, the last commit was likely pushed
    const likelyPushed = Boolean(currentStatus && currentStatus.tracking && (currentStatus.ahead || 0) === 0);
    const { confirmed } = await confirmDialog(
      likelyPushed
        ? 'The last commit appears to already be pushed. Amending rewrites history and will require a force push. Continue?'
        : 'Replace the last commit with the staged changes and this message?',
      { title: 'Amend last commit', confirmLabel: 'Amend', danger: likelyPushed }
    );
    if (!confirmed) return;
  }

  // Account guard: committing with authorship that doesn't match the active account
  const mismatch = getAccountMismatch();
  if (mismatch && mismatch.type === 'identity') {
    const result = await confirmDialog(
      `This repository commits as ${mismatch.actual.name || '(no name)'} <${mismatch.actual.email}>, ` +
      `but the active account "${mismatch.profile.label}" uses ${mismatch.expected.name} <${mismatch.expected.email}>.`,
      {
        title: 'Identity mismatch',
        confirmLabel: 'Commit',
        checkboxLabel: `Switch identity to <${mismatch.expected.email}> before committing`,
        checkboxChecked: true
      }
    );
    if (!result.confirmed) return;
    if (result.checked) {
      const applied = await applyProfileIdentity(mismatch.profile);
      if (!applied) return;
    }
  }

  logToTerminal(`git commit ${amend ? '--amend ' : ''}-m "${message}"`, 'cmd');
  btnCommit.disabled = true;

  try {
    const res = await fetch('/api/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ message, amend })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(data.stdout || 'Changes committed successfully.', 'success');
      showToast(amend ? 'Last commit amended.' : 'Changes committed.', 'success');
      commitMsgInput.value = '';
      commitAmendCheckbox.checked = false;
      btnCommitLabel.innerText = 'Commit';
      clearDiffView();
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(`Commit failed: ${data.error}`, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Failed to commit: ' + err.message, 'error');
  } finally {
    updateCommitAvailability(currentStatus ? currentStatus.staged : []);
  }
}

// ----------------- COMMIT MESSAGE TEMPLATES (conventional commits) -----------------
const COMMIT_TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'style', 'perf'];
const CONVENTIONAL_PREFIX = /^([a-z]+)(\([^)]*\))?!?:\s*/;

function insertCommitTemplate(type) {
  const scope = commitScopeInput.value.trim();
  const prefix = scope ? `${type}(${scope}): ` : `${type}: `;

  // Replace an existing conventional prefix instead of stacking them
  const current = commitMsgInput.value;
  const rest = current.replace(CONVENTIONAL_PREFIX, '');
  commitMsgInput.value = prefix + rest;
  commitMsgInput.focus();
  commitMsgInput.setSelectionRange(commitMsgInput.value.length, commitMsgInput.value.length);
  updateCommitFormatHint();
}

function renderCommitTemplateChips() {
  commitTemplateChips.innerHTML = '';
  COMMIT_TYPES.forEach(type => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'template-chip';
    chip.innerText = type;
    chip.title = `Insert "${type}${commitScopeInput.value.trim() ? `(${commitScopeInput.value.trim()})` : ''}: " prefix`;
    chip.onclick = () => insertCommitTemplate(type);
    commitTemplateChips.appendChild(chip);
  });
}

// Subtle, non-blocking hint when the message isn't conventional-commit shaped
function updateCommitFormatHint() {
  const message = commitMsgInput.value.trim();
  const show = message.length > 10 && !CONVENTIONAL_PREFIX.test(message);
  commitFormatHint.classList.toggle('hidden', !show);
}

async function onAmendToggle() {
  btnCommitLabel.innerText = commitAmendCheckbox.checked ? 'Amend' : 'Commit';
  if (commitAmendCheckbox.checked && !commitMsgInput.value.trim() && activeRepo) {
    try {
      const res = await fetch('/api/git/last-commit-message', {
        headers: { 'x-repo-path': activeRepo }
      });
      const data = await res.json();
      if (data.message) {
        commitMsgInput.value = data.message;
      }
    } catch (err) {
      // Prefill is best-effort only
    }
  }
}

async function undoLastCommit() {
  if (!activeRepo) return;

  const { confirmed } = await confirmDialog(
    'Undo the last commit? Its changes will be kept as staged changes.',
    { title: 'Undo last commit', confirmLabel: 'Undo' }
  );
  if (!confirmed) return;

  logToTerminal('git reset --soft HEAD~1', 'cmd');
  try {
    const res = await fetch('/api/git/undo-commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo }
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal('Last commit undone; its changes are staged.', 'success');
      showToast('Last commit undone.', 'success');
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Undo failed: ' + err.message, 'error');
  }
}

// ----------------- BRANCH OPERATIONS -----------------
async function refreshBranchList() {
  const res = await fetch('/api/git/branches', {
    headers: { 'x-repo-path': activeRepo }
  });
  const data = await res.json();

  if (!res.ok) {
    logToTerminal('Failed to load branches: ' + data.error, 'error');
    return;
  }

  currentBranches = { local: data.local || [], remote: data.remote || [] };
  const currentBranch = currentStatus ? currentStatus.branch : '';

  // Render Local list
  localBranchesList.innerHTML = '';
  currentBranches.local.forEach(branch => {
    const li = document.createElement('li');
    li.className = 'branch-item' + (branch === currentBranch ? ' active' : '');

    const divName = document.createElement('div');
    divName.className = 'branch-name';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.innerText = 'call_split';
    const nameSpan = document.createElement('span');
    nameSpan.innerText = branch;
    nameSpan.title = branch;
    divName.appendChild(icon);
    divName.appendChild(nameSpan);
    li.appendChild(divName);

    if (branch !== currentBranch) {
      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn btn-icon btn-sm branch-delete-btn';
      btnDelete.title = `Delete branch ${branch}`;
      btnDelete.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">delete</span>';
      btnDelete.onclick = (e) => {
        e.stopPropagation();
        deleteBranch(branch);
      };
      li.appendChild(btnDelete);
    }

    li.onclick = () => switchBranch(branch, false);
    localBranchesList.appendChild(li);
  });

  // Render Remote list
  remoteBranchesList.innerHTML = '';
  currentBranches.remote.forEach(branch => {
    const li = document.createElement('li');
    li.className = 'branch-item';

    const divName = document.createElement('div');
    divName.className = 'branch-name';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.innerText = 'cloud';
    const nameSpan = document.createElement('span');
    nameSpan.innerText = branch;
    nameSpan.title = branch;
    divName.appendChild(icon);
    divName.appendChild(nameSpan);
    li.appendChild(divName);

    li.onclick = () => switchBranch(branch, true);
    remoteBranchesList.appendChild(li);
  });

  // Populate Integration branch dropdown list (Merge/Rebase select)
  integrateBranchSelect.innerHTML = '<option value="" disabled selected>Select a target branch...</option>';

  currentBranches.local.forEach(b => {
    if (b !== currentBranch) {
      const opt = document.createElement('option');
      opt.value = b;
      opt.innerText = b;
      integrateBranchSelect.appendChild(opt);
    }
  });

  currentBranches.remote.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b;
    opt.innerText = `remote: ${b}`;
    integrateBranchSelect.appendChild(opt);
  });

  renderBranchDropdownList();
}

function renderBranchDropdownList() {
  branchDropdownList.innerHTML = '';
  const filter = (branchFilterInput.value || '').toLowerCase();
  const currentBranch = currentStatus ? currentStatus.branch : '';

  const localMatches = currentBranches.local.filter(b => b.toLowerCase().includes(filter));
  const remoteMatches = currentBranches.remote.filter(b => b.toLowerCase().includes(filter));

  if (localMatches.length === 0 && remoteMatches.length === 0) {
    const li = document.createElement('li');
    li.className = 'dropdown-empty';
    li.innerText = filter ? 'No branches match your filter' : 'No branches';
    branchDropdownList.appendChild(li);
    return;
  }

  const addBranchItem = (branch, isRemote) => {
    const li = document.createElement('li');
    const isCurrent = !isRemote && branch === currentBranch;
    li.className = 'dropdown-item' + (isCurrent ? ' active' : '');

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined' + (isCurrent ? ' item-check' : '');
    icon.innerText = isCurrent ? 'check' : (isRemote ? 'cloud' : 'call_split');

    const text = document.createElement('span');
    text.className = 'dropdown-item-text';
    const main = document.createElement('span');
    main.className = 'dropdown-item-main';
    main.innerText = branch;
    main.title = branch;
    text.appendChild(main);

    li.appendChild(icon);
    li.appendChild(text);
    li.onclick = () => {
      closeAllDropdowns();
      if (!isCurrent) {
        switchBranch(branch, isRemote);
      }
    };
    branchDropdownList.appendChild(li);
  };

  localMatches.forEach(b => addBranchItem(b, false));
  remoteMatches.forEach(b => addBranchItem(b, true));
}

async function switchBranch(branchName, isRemote) {
  logToTerminal(`git checkout ${branchName}`, 'cmd');
  try {
    const res = await fetch('/api/git/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ branch: branchName, isRemote })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(data.stdout || data.stderr || `Switched to branch ${branchName}`, 'success');
      showToast(`Switched to ${branchName}`, 'success');
      clearDiffView();
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(`Switch branch failed: ${data.error}`, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Switch branch failed: ' + err.message, 'error');
  }
}

async function createBranchFromInput(inputEl) {
  const branchName = inputEl.value.trim().replace(/\s+/g, '-');
  if (!branchName) {
    showToast('Enter a branch name first.', 'warn');
    return;
  }

  logToTerminal(`git checkout -b ${branchName}`, 'cmd');
  try {
    const res = await fetch('/api/git/create-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ branchName })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(`Branch ${branchName} created and checked out.`, 'success');
      showToast(`Branch ${branchName} created.`, 'success');
      inputEl.value = '';
      closeAllDropdowns();
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(`Branch creation failed: ${data.error}`, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Branch creation failed: ' + err.message, 'error');
  }
}

async function deleteBranch(branch) {
  const { confirmed } = await confirmDialog(`Delete local branch "${branch}"?`, {
    title: 'Delete branch',
    confirmLabel: 'Delete',
    danger: true
  });
  if (!confirmed) return;

  const attempt = async (force) => {
    const res = await fetch('/api/git/delete-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ branch, force })
    });
    return { res, data: await res.json() };
  };

  logToTerminal(`git branch -d ${branch}`, 'cmd');
  try {
    let { res, data } = await attempt(false);

    if (!res.ok && data.notFullyMerged) {
      const retry = await confirmDialog(
        `Branch "${branch}" is not fully merged. Force delete it and lose its commits?`,
        { title: 'Force delete branch', confirmLabel: 'Force Delete', danger: true }
      );
      if (!retry.confirmed) return;
      logToTerminal(`git branch -D ${branch}`, 'cmd');
      ({ res, data } = await attempt(true));
    }

    if (res.ok) {
      logToTerminal(`Branch ${branch} deleted.`, 'success');
      showToast(`Branch ${branch} deleted.`, 'success');
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Delete branch failed: ' + err.message, 'error');
  }
}

// ----------------- INTEGRATION (MERGE / REBASE) -----------------
async function runBranchIntegration(type) {
  const branch = integrateBranchSelect.value;
  if (!branch) {
    showToast(`Select a branch to ${type} first.`, 'warn');
    return;
  }

  const cleanBranch = branch.startsWith('remote: ') ? branch.replace('remote: ', '') : branch;

  const { confirmed } = await confirmDialog(
    `${type === 'rebase' ? 'Rebase the current branch onto' : 'Merge'} "${cleanBranch}"${type === 'rebase' ? '' : ' into the current branch'}?`,
    { title: type === 'rebase' ? 'Rebase' : 'Merge', confirmLabel: type === 'rebase' ? 'Rebase' : 'Merge' }
  );
  if (!confirmed) return;

  logToTerminal(`git ${type} ${cleanBranch}`, 'cmd');
  try {
    const endpoint = type === 'rebase' ? '/api/git/rebase' : '/api/git/merge';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ branch: cleanBranch })
    });
    const data = await res.json();

    if (data.success) {
      logToTerminal(`${type.toUpperCase()} completed successfully.`, 'success');
      showToast(`${type === 'rebase' ? 'Rebase' : 'Merge'} completed.`, 'success');
      await refreshAll();
    } else if (data.conflict) {
      logToTerminal(`${type.toUpperCase()} failed: conflicts detected. Resolve files in your workspace.`, 'error');
      showToast(`${type === 'rebase' ? 'Rebase' : 'Merge'} hit conflicts — resolve them in the staging area.`, 'warn', 7000);
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(`${type.toUpperCase()} failed: ${data.error}`, 'error', 7000);
    }
  } catch (err) {
    logToTerminal(`Integration failed: ${err.message}`, 'error');
  }
}

async function abortConflict() {
  const type = isRebasing ? 'rebase' : 'merge';

  const { confirmed } = await confirmDialog(
    `Abort the current ${type}? Your workspace will be reverted to the pre-${type} state.`,
    { title: `Abort ${type}`, confirmLabel: 'Abort', danger: true }
  );
  if (!confirmed) return;

  logToTerminal(`git ${type} --abort`, 'cmd');

  try {
    const res = await fetch('/api/git/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ type })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal('Operation aborted successfully. Local workspace reverted.', 'success');
      showToast(`${type === 'rebase' ? 'Rebase' : 'Merge'} aborted.`, 'success');
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Abort failed: ' + err.message, 'error');
  }
}

async function continueConflict() {
  const type = isRebasing ? 'rebase' : 'merge';
  logToTerminal(`git ${isRebasing ? 'rebase --continue' : 'commit (no-edit)'}`, 'cmd');

  try {
    const res = await fetch('/api/git/conflict/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ type })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal('Conflict resolved. Integration continued.', 'success');
      showToast('Integration continued.', 'success');
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(`Failed to continue: ${data.error}. Resolve all conflict markers and stage the files first.`, 'error', 8000);
    }
  } catch (err) {
    logToTerminal('Continue failed: ' + err.message, 'error');
  }
}

// ----------------- SYNC (FETCH / PUSH / PULL) WITH SSH -----------------
async function performSync(action, opts = {}) {
  const selectedProfile = getActiveProfile();
  const profileId = selectedProfile ? selectedProfile.id : null;
  const sshKeyPath = selectedProfile ? selectedProfile.privateKeyPath : '';

  // Account guard: pushing with a different account than this remote's rule
  if (action === 'push' && !opts.force) {
    const mismatch = getAccountMismatch();
    if (mismatch && mismatch.type === 'account') {
      const { confirmed } = await confirmDialog(
        `Your auto-select rules map this remote to account "${mismatch.ruleProfile.label}", ` +
        `but you're pushing with "${selectedProfile ? selectedProfile.label : 'System SSH'}". Push anyway?`,
        { title: 'Account mismatch', confirmLabel: 'Push Anyway', danger: true }
      );
      if (!confirmed) return;
    }
  }

  if (selectedProfile) {
    logToTerminal(`Using SSH profile: ${selectedProfile.label} (${sshKeyPath})`, 'info');
    if (selectedProfile.hasSavedPassword && !vaultStatus.unlocked) {
      showToast('This profile has a saved passphrase, but the vault is locked. Unlock it in the SSH key menu first.', 'warn', 6000);
    }
  } else {
    logToTerminal('Using system default SSH configuration', 'info');
  }

  // Render command in logger
  let logCmd = `git ${action}${action === 'fetch' ? ' --prune' : ''}${opts.force ? ' --force-with-lease' : ''} origin`;
  if (selectedProfile) {
    logCmd = `GIT_SSH_COMMAND="ssh -i ${sshKeyPath}..." ` + logCmd;
  }
  logToTerminal(logCmd, 'cmd');

  const btn = action === 'push' ? btnPush : (action === 'pull' ? btnPull : btnFetch);
  setButtonBusy(btn, true);

  try {
    const endpoint = `/api/git/${action}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ profileId, sshKeyPath, force: Boolean(opts.force) })
    });
    const data = await res.json();

    if (res.ok) {
      if (data.stderr) logToTerminal(data.stderr, 'info');
      if (data.stdout) logToTerminal(data.stdout, 'success');
      if (data.usedAskpass) {
        const profileText = data.profileLabel ? ` for profile "${data.profileLabel}"` : '';
        logToTerminal(`Saved passphrase was used automatically${profileText}.`, 'success');
      }
      logToTerminal(`${action.toUpperCase()} action complete.`, 'success');
      showToast(`${action.charAt(0).toUpperCase() + action.slice(1)} completed${selectedProfile ? ` with key "${selectedProfile.label}"` : ''}.`, 'success');
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');

      // Rejected non-fast-forward push: offer a force-with-lease retry
      const rejected = action === 'push' && !opts.force &&
        /non-fast-forward|fetch first|\[rejected\]|stale info/i.test(data.error || '');
      if (rejected) {
        setButtonBusy(btn, false);
        const { confirmed } = await confirmDialog(
          'The remote has commits your branch does not (the push was rejected). ' +
          'Force-push with lease overwrites the remote branch, but only if it still matches what you last fetched.',
          { title: 'Push rejected', confirmLabel: 'Force Push (with lease)', danger: true }
        );
        if (confirmed) {
          await performSync('push', { force: true });
        }
        return;
      }

      showToast(`${action.charAt(0).toUpperCase() + action.slice(1)} failed: ${data.error}`, 'error', 9000);
    }
  } catch (err) {
    logToTerminal(`Connection error during ${action}: ${err.message}`, 'error');
    showToast(`Connection error during ${action}.`, 'error');
  } finally {
    setButtonBusy(btn, false);
  }
}

// ----------------- COMMIT HISTORY (GRAPH) -----------------
const GRAPH_PAGE_SIZE = 200;
const GRAPH_LANE_COLOR_COUNT = 8;
const GRAPH_LANE_WIDTH = 14;
const GRAPH_ROW_HEIGHT = 46;
const GRAPH_MAX_VISIBLE_LANES = 8;

let graphCommits = [];
let graphHashes = new Set();
let graphHasMore = false;
let graphLoading = false;

// Straight-lane layout over topologically ordered commits. Each lane "waits"
// for a commit hash; a commit lands on the first lane waiting for it (new
// tips open a lane), its first parent continues the lane, extra parents fork
// out, and other lanes waiting for the same hash merge in.
function computeGraphLayout(commits) {
  const lanes = [];      // lanes[i] = hash this lane is waiting for, or null (free)
  const laneColors = [];
  let colorCounter = 0;
  const rows = [];
  let maxLanes = 1;

  const allocLane = (hash, allocatedThisRow) => {
    let idx = lanes.indexOf(null);
    if (idx === -1) {
      idx = lanes.length;
      lanes.push(null);
      laneColors.push(0);
    }
    lanes[idx] = hash;
    laneColors[idx] = colorCounter++ % GRAPH_LANE_COLOR_COUNT;
    allocatedThisRow.add(idx);
    return idx;
  };

  commits.forEach((commit) => {
    const allocatedThisRow = new Set();
    const activeAbove = lanes.slice();

    const matching = [];
    lanes.forEach((h, i) => { if (h === commit.hash) matching.push(i); });

    const lane = matching.length > 0 ? matching[0] : allocLane(commit.hash, allocatedThisRow);
    const edges = [];

    // Other lanes waiting for this same commit collapse into its dot
    for (let k = 1; k < matching.length; k++) {
      const i = matching[k];
      edges.push({ type: 'in', lane: i, color: laneColors[i] });
      lanes[i] = null;
    }

    const parents = commit.parents || [];
    lanes[lane] = parents[0] || null;

    // Extra parents of a merge commit fork out of the dot
    for (let p = 1; p < parents.length; p++) {
      let j = lanes.indexOf(parents[p]);
      if (j === -1 || j === lane) {
        j = allocLane(parents[p], allocatedThisRow);
      }
      edges.push({ type: 'out', lane: j, color: laneColors[j] });
    }

    // Lanes that simply pass through this row (active above and below,
    // untouched by this commit)
    const passLanes = [];
    lanes.forEach((h, i) => {
      if (h !== null && i !== lane && !allocatedThisRow.has(i)) {
        passLanes.push({ lane: i, color: laneColors[i] });
      }
    });

    rows.push({
      commit,
      lane,
      color: laneColors[lane],
      lineAbove: activeAbove[lane] === commit.hash,
      lineBelow: lanes[lane] !== null,
      passLanes,
      edges
    });
    maxLanes = Math.max(maxLanes, lanes.length);
  });

  return { rows, maxLanes };
}

function graphLaneX(lane) {
  return Math.min(lane, GRAPH_MAX_VISIBLE_LANES - 1) * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;
}

function buildGraphRowSvg(row, gutterWidth) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', gutterWidth);
  svg.setAttribute('height', GRAPH_ROW_HEIGHT);
  svg.classList.add('commit-graph-gutter');

  const midY = GRAPH_ROW_HEIGHT / 2;
  const dotX = graphLaneX(row.lane);

  const addPath = (d, colorIdx) => {
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-width', '2');
    p.style.stroke = `var(--graph-lane-${colorIdx})`;
    svg.appendChild(p);
  };

  row.passLanes.forEach(({ lane, color }) => {
    const x = graphLaneX(lane);
    addPath(`M ${x} 0 V ${GRAPH_ROW_HEIGHT}`, color);
  });

  if (row.lineAbove) {
    addPath(`M ${dotX} 0 V ${midY}`, row.color);
  }
  if (row.lineBelow) {
    addPath(`M ${dotX} ${midY} V ${GRAPH_ROW_HEIGHT}`, row.color);
  }

  row.edges.forEach((edge) => {
    const x = graphLaneX(edge.lane);
    if (edge.type === 'in') {
      // A lane above merges into this commit's dot
      addPath(`M ${x} 0 C ${x} ${midY * 0.8}, ${dotX} ${midY * 0.4}, ${dotX} ${midY}`, edge.color);
    } else {
      // This commit forks out to a parent lane below
      addPath(`M ${dotX} ${midY} C ${dotX} ${midY + midY * 0.6}, ${x} ${midY + midY * 0.2}, ${x} ${GRAPH_ROW_HEIGHT}`, edge.color);
    }
  });

  const dot = document.createElementNS(svgNS, 'circle');
  dot.setAttribute('cx', dotX);
  dot.setAttribute('cy', midY);
  dot.setAttribute('r', '4');
  dot.style.fill = `var(--graph-lane-${row.color})`;
  dot.style.stroke = 'var(--bg-card)';
  dot.setAttribute('stroke-width', '1.5');
  svg.appendChild(dot);

  return svg;
}

function renderCommitGraph() {
  const previousScrollTop = commitHistoryList.scrollTop;
  commitHistoryList.innerHTML = '';

  if (graphCommits.length === 0) {
    commitHistoryList.innerHTML = '<li class="empty-state">No commits yet</li>';
    return;
  }

  const { rows, maxLanes } = computeGraphLayout(graphCommits);
  const gutterWidth = Math.min(maxLanes, GRAPH_MAX_VISIBLE_LANES) * GRAPH_LANE_WIDTH;

  rows.forEach((row) => {
    const commit = row.commit;
    const li = document.createElement('li');
    li.className = 'commit-graph-row';
    li.onclick = () => showCommitDetails(commit.hash);

    li.appendChild(buildGraphRowSvg(row, gutterWidth));

    const content = document.createElement('div');
    content.className = 'commit-graph-content';

    const msgRow = document.createElement('div');
    msgRow.className = 'commit-graph-msg-row';

    const refs = (commit.refs || []).slice(0, 2);
    refs.forEach(ref => {
      const chip = document.createElement('span');
      chip.className = 'ref-chip';
      chip.innerText = ref.replace(/^HEAD -> /, '');
      chip.title = ref;
      chip.style.borderColor = `var(--graph-lane-${row.color})`;
      msgRow.appendChild(chip);
    });

    const msg = document.createElement('span');
    msg.className = 'commit-msg';
    msg.innerText = commit.message;
    msg.title = commit.message;
    msgRow.appendChild(msg);

    const meta = document.createElement('div');
    meta.className = 'commit-meta';

    const author = document.createElement('span');
    author.className = 'commit-author';
    author.innerText = commit.author;

    const date = document.createElement('span');
    date.innerText = commit.date;

    meta.appendChild(author);
    meta.appendChild(date);

    content.appendChild(msgRow);
    content.appendChild(meta);
    li.appendChild(content);

    commitHistoryList.appendChild(li);
  });

  if (graphHasMore) {
    const loader = document.createElement('li');
    loader.className = 'empty-state commit-graph-loader';
    loader.innerText = 'Scroll to load more…';
    commitHistoryList.appendChild(loader);
  }

  commitHistoryList.scrollTop = previousScrollTop;
}

async function fetchCommitPage(skip) {
  const res = await fetch(`/api/git/log?limit=${GRAPH_PAGE_SIZE}&skip=${skip}&all=1`, {
    headers: { 'x-repo-path': activeRepo }
  });
  return res.json();
}

async function refreshCommitHistory() {
  try {
    const data = await fetchCommitPage(0);
    graphCommits = data.commits || [];
    graphHashes = new Set(graphCommits.map(c => c.hash));
    graphHasMore = Boolean(data.hasMore);
  } catch (err) {
    graphCommits = [];
    graphHashes = new Set();
    graphHasMore = false;
  }
  renderCommitGraph();
}

async function loadMoreCommits() {
  if (graphLoading || !graphHasMore || !activeRepo) return;
  graphLoading = true;

  try {
    const data = await fetchCommitPage(graphCommits.length);
    const fresh = (data.commits || []).filter(c => !graphHashes.has(c.hash));
    fresh.forEach(c => graphHashes.add(c.hash));
    graphCommits = graphCommits.concat(fresh);
    graphHasMore = Boolean(data.hasMore);
    renderCommitGraph();
  } catch (err) {
    logToTerminal('Failed to load more commits: ' + err.message, 'error');
  } finally {
    graphLoading = false;
  }
}

// ----------------- STASHES -----------------
async function refreshStashList() {
  if (!activeRepo || !stashList) return;

  try {
    const res = await fetch('/api/git/stash', {
      headers: { 'x-repo-path': activeRepo }
    });
    const data = await res.json();
    const stashes = (res.ok && data.stashes) || [];

    stashList.innerHTML = '';
    if (stashes.length === 0) {
      stashList.innerHTML = '<li class="empty-state">No stashes</li>';
      return;
    }

    stashes.forEach(stash => {
      const li = document.createElement('li');
      li.className = 'stash-item';
      li.title = `${stash.ref}: ${stash.message}${stash.date ? ` (${stash.date})` : ''}`;

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.innerText = 'inventory_2';

      const msg = document.createElement('span');
      msg.className = 'stash-msg';
      msg.innerText = stash.message || stash.ref;

      const actions = document.createElement('span');
      actions.className = 'stash-actions';

      const btnPop = document.createElement('button');
      btnPop.className = 'btn btn-icon btn-sm';
      btnPop.title = 'Pop (apply and remove)';
      btnPop.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">unarchive</span>';
      btnPop.onclick = (e) => {
        e.stopPropagation();
        applyStash(stash.ref, true);
      };

      const btnApply = document.createElement('button');
      btnApply.className = 'btn btn-icon btn-sm';
      btnApply.title = 'Apply (keep stash)';
      btnApply.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">content_paste</span>';
      btnApply.onclick = (e) => {
        e.stopPropagation();
        applyStash(stash.ref, false);
      };

      const btnDrop = document.createElement('button');
      btnDrop.className = 'btn btn-icon btn-sm';
      btnDrop.title = 'Drop stash';
      btnDrop.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">delete</span>';
      btnDrop.onclick = (e) => {
        e.stopPropagation();
        dropStash(stash.ref);
      };

      actions.appendChild(btnPop);
      actions.appendChild(btnApply);
      actions.appendChild(btnDrop);

      li.appendChild(icon);
      li.appendChild(msg);
      li.appendChild(actions);
      stashList.appendChild(li);
    });
  } catch (err) {
    stashList.innerHTML = '<li class="empty-state">No stashes</li>';
  }
}

async function stashChanges() {
  if (!activeRepo) return;

  const { confirmed } = await confirmDialog(
    'Stash all local changes? Untracked files are included. You can re-apply them later from the Stashes list.',
    { title: 'Stash changes', confirmLabel: 'Stash' }
  );
  if (!confirmed) return;

  logToTerminal('git stash push -u', 'cmd');
  try {
    const res = await fetch('/api/git/stash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ includeUntracked: true })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(data.stdout || 'Changes stashed.', 'success');
      showToast('Changes stashed.', 'success');
      clearDiffView();
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Stash failed: ' + err.message, 'error');
  }
}

async function applyStash(ref, pop) {
  logToTerminal(`git stash ${pop ? 'pop' : 'apply'} ${ref}`, 'cmd');
  try {
    const res = await fetch('/api/git/stash/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ ref, pop })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(`Stash ${pop ? 'popped' : 'applied'}.`, 'success');
      showToast(`Stash ${pop ? 'popped' : 'applied'}.`, 'success');
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 8000);
    }
  } catch (err) {
    logToTerminal('Apply stash failed: ' + err.message, 'error');
  }
}

async function dropStash(ref) {
  const { confirmed } = await confirmDialog(`Drop ${ref}? Its stashed changes will be lost.`, {
    title: 'Drop stash',
    confirmLabel: 'Drop',
    danger: true
  });
  if (!confirmed) return;

  logToTerminal(`git stash drop ${ref}`, 'cmd');
  try {
    const res = await fetch('/api/git/stash/drop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ ref })
    });
    const data = await res.json();

    if (res.ok) {
      showToast('Stash dropped.', 'success');
      await refreshStashList();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Drop stash failed: ' + err.message, 'error');
  }
}

// ----------------- SAFETY NET (checkpoints + discard trash) -----------------
async function refreshSafetyNet() {
  if (!activeRepo || !checkpointList) return;

  try {
    const [cpRes, trashRes] = await Promise.all([
      fetch('/api/git/checkpoints', { headers: { 'x-repo-path': activeRepo } }),
      fetch('/api/git/trash', { headers: { 'x-repo-path': activeRepo } })
    ]);
    const cpData = await cpRes.json();
    const trashData = await trashRes.json();
    renderCheckpointList((cpRes.ok && cpData.checkpoints) || []);
    renderTrashList((trashRes.ok && trashData.entries) || []);
  } catch (err) {
    renderCheckpointList([]);
    renderTrashList([]);
  }
}

function renderCheckpointList(checkpoints) {
  checkpointList.innerHTML = '';
  if (checkpoints.length === 0) {
    checkpointList.innerHTML = '<li class="empty-state">No recent operations</li>';
    return;
  }

  checkpoints.forEach(cp => {
    const li = document.createElement('li');
    li.className = 'stash-item';
    li.title = `Undo "${cp.label}" — resets the branch back to ${cp.head}`;

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.innerText = 'history';

    const msg = document.createElement('span');
    msg.className = 'stash-msg';
    msg.innerText = cp.label;

    const actions = document.createElement('span');
    actions.className = 'stash-actions';
    const btnUndo = document.createElement('button');
    btnUndo.className = 'btn btn-icon btn-sm';
    btnUndo.title = 'Undo this operation (hard reset to the checkpoint)';
    btnUndo.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">undo</span>';
    btnUndo.onclick = (e) => {
      e.stopPropagation();
      undoOperation(cp);
    };
    actions.appendChild(btnUndo);

    li.appendChild(icon);
    li.appendChild(msg);
    li.appendChild(actions);
    checkpointList.appendChild(li);
  });
}

function renderTrashList(entries) {
  trashList.innerHTML = '';
  if (entries.length === 0) {
    trashList.innerHTML = '<li class="empty-state">Nothing discarded recently</li>';
    return;
  }

  entries.forEach(entry => {
    const li = document.createElement('li');
    li.className = 'stash-item';
    li.title = `Restore ${entry.path} as it was when discarded`;

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.innerText = 'restore_from_trash';

    const msg = document.createElement('span');
    msg.className = 'stash-msg';
    msg.innerText = entry.path;

    const actions = document.createElement('span');
    actions.className = 'stash-actions';
    const btnRestore = document.createElement('button');
    btnRestore.className = 'btn btn-icon btn-sm';
    btnRestore.title = 'Restore this file';
    btnRestore.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">settings_backup_restore</span>';
    btnRestore.onclick = (e) => {
      e.stopPropagation();
      restoreTrashEntry(entry);
    };
    actions.appendChild(btnRestore);

    li.appendChild(icon);
    li.appendChild(msg);
    li.appendChild(actions);
    trashList.appendChild(li);
  });
}

async function undoOperation(checkpoint) {
  const { confirmed } = await confirmDialog(
    `Undo "${checkpoint.label}"? The branch will be hard-reset to ${checkpoint.head}, discarding commits and uncommitted changes made after it.`,
    { title: 'Undo operation', confirmLabel: 'Undo', danger: true }
  );
  if (!confirmed) return;

  logToTerminal(`git reset --hard ${checkpoint.head}`, 'cmd');
  try {
    const res = await fetch('/api/git/undo-operation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ checkpointId: checkpoint.id })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(`Operation undone. HEAD is back at ${data.restoredHead}.`, 'success');
      showToast(`"${checkpoint.label}" undone.`, 'success');
      clearDiffView();
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Undo operation failed: ' + err.message, 'error');
  }
}

async function restoreTrashEntry(entry) {
  try {
    const res = await fetch('/api/git/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ id: entry.id })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(`Restored discarded file: ${data.restoredPath}`, 'success');
      showToast(`Restored ${data.restoredPath}.`, 'success');
      await refreshGitStatus();
      await refreshSafetyNet();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Restore failed: ' + err.message, 'error');
  }
}

// ----------------- GIT IDENTITY (per-repo author) -----------------
async function refreshIdentity() {
  if (!activeRepo) {
    currentIdentity = null;
    renderIdentityRow();
    return;
  }

  try {
    const res = await fetch('/api/git/identity', {
      headers: { 'x-repo-path': activeRepo }
    });
    const data = await res.json();
    currentIdentity = res.ok ? data : null;
  } catch (err) {
    currentIdentity = null;
  }
  renderIdentityRow();
}

function openIdentityModal() {
  if (!activeRepo) {
    showToast('Open a repository first.', 'warn');
    return;
  }
  closeAllDropdowns();
  identityRepoName.innerText = repoBaseName(activeRepo);
  identityNameInput.value = (currentIdentity && currentIdentity.name) || '';
  identityEmailInput.value = (currentIdentity && currentIdentity.email) || '';
  identityModal.classList.remove('hidden');
  setTimeout(() => identityNameInput.focus(), 30);
}

async function saveIdentity() {
  const name = identityNameInput.value.trim();
  const email = identityEmailInput.value.trim();
  if (!name || !email) {
    showToast('Both name and email are required.', 'warn');
    return;
  }

  logToTerminal(`git config user.name "${name}" && git config user.email "${email}"`, 'cmd');
  try {
    const res = await fetch('/api/git/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ name, email })
    });
    const data = await res.json();

    if (res.ok) {
      identityModal.classList.add('hidden');
      showToast('Commit identity saved for this repository.', 'success');
      await refreshIdentity();
    } else {
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Save identity failed: ' + err.message, 'error');
  }
}

// ----------------- CLONE REPOSITORY -----------------
function setCloneFeedback(message, type = 'info', hide = false) {
  if (!cloneFeedback) return;
  if (hide || !message) {
    cloneFeedback.className = 'inline-feedback hidden';
    cloneFeedback.innerText = '';
    return;
  }
  cloneFeedback.className = `inline-feedback ${type}`;
  cloneFeedback.innerText = message;
}

function openCloneModal() {
  closeAllDropdowns();

  // Populate profile choices
  cloneProfileSelect.innerHTML = '<option value="">Default (System SSH)</option>';
  sshProfiles.forEach(profile => {
    const opt = document.createElement('option');
    opt.value = profile.id;
    opt.innerText = `${profile.label}${profile.hasSavedPassword ? ' [saved key]' : ''}`;
    cloneProfileSelect.appendChild(opt);
  });
  cloneProfileSelect.value = activeProfileId || '';
  if (cloneProfileSelect.value !== (activeProfileId || '')) {
    cloneProfileSelect.value = '';
  }

  setCloneFeedback('', 'info', true);
  cloneModal.classList.remove('hidden');
  setTimeout(() => cloneUrlInput.focus(), 30);
}

async function startClone() {
  const url = cloneUrlInput.value.trim();
  const parentDir = cloneParentDirInput.value.trim();
  const folderName = cloneFolderNameInput.value.trim();
  const profileId = cloneProfileSelect.value || null;

  if (!url || !parentDir) {
    setCloneFeedback('Repository URL and destination folder are both required.', 'error');
    return;
  }

  setButtonBusy(btnStartClone, true);
  setCloneFeedback('Cloning… this can take a while for large repositories.', 'info');
  logToTerminal(`git clone ${url}`, 'cmd');

  try {
    const res = await fetch('/api/git/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, parentDir, folderName, profileId })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(`Cloned into: ${data.repoPath}`, 'success');
      showToast(`Repository cloned${data.profileLabel ? ` with key "${data.profileLabel}"` : ''}.`, 'success');

      // Remember which key this repo should use from the start
      if (profileId && data.repoPath) {
        localStorage.setItem(`ssh_key_${data.repoPath}`, profileId);
      }

      cloneModal.classList.add('hidden');
      cloneUrlInput.value = '';
      cloneFolderNameInput.value = '';
      await openRepository(data.repoPath);
    } else {
      logToTerminal(data.error, 'error');
      setCloneFeedback(data.error || 'Clone failed.', 'error');
      showToast('Clone failed.', 'error');
    }
  } catch (err) {
    logToTerminal('Clone failed: ' + err.message, 'error');
    setCloneFeedback('Clone failed: ' + err.message, 'error');
  } finally {
    setButtonBusy(btnStartClone, false);
  }
}

// ----------------- CONFLICT EDITOR RENDERER -----------------
async function openConflictResolver(filePath) {
  conflictFilePathBadge.innerText = filePath;
  conflictTextarea.value = 'Loading file content...';
  conflictModal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/git/conflict/file?path=${encodeURIComponent(filePath)}`, {
      headers: { 'x-repo-path': activeRepo }
    });
    const data = await res.json();

    if (res.ok) {
      conflictTextarea.value = data.rawContent;
    } else {
      conflictTextarea.value = 'Failed to load file contents: ' + data.error;
    }
  } catch (err) {
    conflictTextarea.value = 'Network error loading file: ' + err.message;
  }
}

// Client-side conflict markers parser/resolver
function resolveConflictText(text, choice) {
  // Matches <<<<<<< [branch] \n [ours] \n ======= \n [theirs] \n >>>>>>> [branch]
  const regex = /<<<<<<<[^\r\n]*\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>[^\r\n]*/g;
  if (choice === 'ours') {
    return text.replace(regex, '$1');
  } else if (choice === 'theirs') {
    return text.replace(regex, '$2');
  }
  return text;
}

async function saveConflictResolution() {
  const filePath = conflictFilePathBadge.innerText;
  const resolvedContent = conflictTextarea.value;

  logToTerminal(`Saving conflict resolution for: ${filePath}...`);
  try {
    const res = await fetch('/api/git/conflict/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ filePath, resolvedContent })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(`Conflict in ${filePath} resolved and staged.`, 'success');
      showToast('Conflict resolved and staged.', 'success');
      conflictModal.classList.add('hidden');
      await refreshGitStatus();
    } else {
      logToTerminal(data.error, 'error');
      showToast('Failed to save resolution: ' + data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Resolve conflict failed: ' + err.message, 'error');
  }
}

// ----------------- SSH PROFILES MANAGER -----------------
function openSshModal() {
  resetSshProfileForm();
  sshGenerateLabel.value = '';
  sshGenerateKeyName.value = '';
  sshGenerateKeyType.value = 'ed25519';
  sshGenerateUserName.value = '';
  sshGenerateUserEmail.value = '';
  sshGeneratePassphrase.value = '';
  sshGenerateKeepPassword.checked = false;
  ruleMatchInput.value = '';
  clearGeneratedSshResult();
  setGenerateFeedback('', 'info', true);
  hideSshKeyForms();
  closeAllDropdowns();
  sshModal.classList.remove('hidden');
  ensureSshManagerInteractive();
  refreshVaultStatus();
}

function hideSshKeyForms() {
  if (sshExistingKeySection) sshExistingKeySection.classList.add('hidden');
  if (sshGenerateSection) sshGenerateSection.classList.add('hidden');
  if (btnShowAddKey) btnShowAddKey.setAttribute('aria-expanded', 'false');
  if (btnShowGenerateKey) btnShowGenerateKey.setAttribute('aria-expanded', 'false');
  if (sshExistingKeyHeading) sshExistingKeyHeading.innerText = 'Add an Existing Key';
  resetSshProfileForm();
}

function resetSshProfileForm() {
  sshProfileId.value = '';
  sshLabel.value = '';
  sshKeyPath.value = '';
  sshUserName.value = '';
  sshUserEmail.value = '';
  sshPassphrase.value = '';
  sshKeepPassword.checked = false;
}

function showSshKeyForm(type) {
  const showExisting = type === 'existing';
  const section = showExisting ? sshExistingKeySection : sshGenerateSection;

  if (!section) {
    return;
  }

  if (sshExistingKeySection) sshExistingKeySection.classList.toggle('hidden', !showExisting);
  if (sshGenerateSection) sshGenerateSection.classList.toggle('hidden', showExisting);
  if (btnShowAddKey) btnShowAddKey.setAttribute('aria-expanded', String(showExisting));
  if (btnShowGenerateKey) btnShowGenerateKey.setAttribute('aria-expanded', String(!showExisting));

  const firstField = section.querySelector('input:not([type="hidden"]), select');
  if (firstField) {
    setTimeout(() => firstField.focus(), 30);
  }
}

function ensureSshManagerInteractive() {
  if (!sshModal) {
    return;
  }

  const controls = sshModal.querySelectorAll('input, select, textarea, button');
  controls.forEach((el) => {
    if (isGeneratingSshKey && el === btnGenerateSsh) {
      return;
    }

    if (el.disabled) {
      el.disabled = false;
    }
    el.style.pointerEvents = 'auto';
    el.removeAttribute('aria-disabled');
  });
}

function setGenerateFeedback(message, type = 'info', hide = false) {
  if (!sshGenerateFeedback) {
    return;
  }

  if (hide || !message) {
    sshGenerateFeedback.className = 'inline-feedback hidden';
    sshGenerateFeedback.innerText = '';
    return;
  }

  sshGenerateFeedback.className = `inline-feedback ${type}`;
  sshGenerateFeedback.innerText = message;
}

function applyConfigSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }

  recentRepos = snapshot.recentRepos || [];
  sshProfiles = snapshot.sshProfiles || [];
  accountRules = snapshot.accountRules || [];
  vaultStatus = snapshot.vaultStatus || { hasVault: false, unlocked: false };
  if (snapshot.settings) {
    appSettings = snapshot.settings;
  }
  updateRecentReposUI();
  updateSshProfilesUI();
  renderSshConfigSetting();
  return true;
}

function clearGeneratedSshResult() {
  lastGeneratedSshKey = null;
  if (sshGeneratedPrivate) sshGeneratedPrivate.value = '';
  if (sshGeneratedPublic) sshGeneratedPublic.value = '';
  if (sshGeneratedResult) sshGeneratedResult.classList.add('hidden');
}

function renderGeneratedSshResult(result) {
  lastGeneratedSshKey = {
    privateKeyPath: result.privateKeyPath,
    publicKeyPath: result.publicKeyPath,
    publicKey: result.publicKey || ''
  };

  sshGeneratedPrivate.value = result.privateKeyPath;
  sshGeneratedPublic.value = result.publicKeyPath;
  sshGeneratedResult.classList.remove('hidden');
}

async function copyTextToClipboard(text) {
  if (!text) return false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', 'true');
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  return ok;
}

async function openGeneratedSshLocation() {
  if (!lastGeneratedSshKey || !lastGeneratedSshKey.privateKeyPath) {
    showToast('No generated key location is available yet.', 'warn');
    return;
  }

  try {
    const res = await fetch('/api/config/ssh/open-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath: lastGeneratedSshKey.privateKeyPath })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(`Opened SSH key location: ${data.openedPath || lastGeneratedSshKey.privateKeyPath}`, 'success');
    } else {
      logToTerminal(data.error || 'Failed to open SSH key location.', 'error');
      showToast(data.error || 'Failed to open SSH key location.', 'error');
    }
  } catch (err) {
    logToTerminal('Failed to open SSH key location: ' + err.message, 'error');
  }
}

async function copyGeneratedPublicPath() {
  if (!lastGeneratedSshKey || !lastGeneratedSshKey.publicKeyPath) {
    showToast('No generated public key path is available yet.', 'warn');
    return;
  }

  try {
    await copyTextToClipboard(lastGeneratedSshKey.publicKeyPath);
    showToast('Public key path copied to clipboard.', 'success');
  } catch (err) {
    logToTerminal('Failed to copy public key path: ' + err.message, 'error');
    showToast('Failed to copy public key path.', 'error');
  }
}

async function copyGeneratedPrivatePath() {
  if (!lastGeneratedSshKey || !lastGeneratedSshKey.privateKeyPath) {
    showToast('No generated private key path is available yet.', 'warn');
    return;
  }

  try {
    await copyTextToClipboard(lastGeneratedSshKey.privateKeyPath);
    showToast('Private key path copied to clipboard.', 'success');
  } catch (err) {
    logToTerminal('Failed to copy private key path: ' + err.message, 'error');
    showToast('Failed to copy private key path.', 'error');
  }
}

async function copyGeneratedPublicKey() {
  if (!lastGeneratedSshKey || !lastGeneratedSshKey.publicKey) {
    showToast('No generated public key is available yet.', 'warn');
    return;
  }

  try {
    await copyTextToClipboard(lastGeneratedSshKey.publicKey);
    showToast('Public key copied to clipboard.', 'success');
  } catch (err) {
    logToTerminal('Failed to copy public key: ' + err.message, 'error');
    showToast('Failed to copy public key.', 'error');
  }
}

async function getPublicKeyForProfile(profile) {
  const res = await fetch('/api/config/ssh/public', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: profile.id })
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Failed to load public key.');
  }

  return data;
}

async function copyProfilePublicKey(profile) {
  try {
    const data = await getPublicKeyForProfile(profile);
    await copyTextToClipboard(data.publicKey);
    showToast(`Public key copied for "${profile.label}".`, 'success');
  } catch (err) {
    logToTerminal(`Failed to copy public key for "${profile.label}": ${err.message}`, 'error');
    showToast(`Failed to copy public key: ${err.message}`, 'error');
  }
}

async function copyProfilePublicKeyPath(profile) {
  try {
    const data = await getPublicKeyForProfile(profile);
    await copyTextToClipboard(data.publicKeyPath);
    showToast(`Public key path copied for "${profile.label}".`, 'success');
  } catch (err) {
    logToTerminal(`Failed to copy public key path for "${profile.label}": ${err.message}`, 'error');
    showToast(`Failed to copy public key path: ${err.message}`, 'error');
  }
}

async function openProfileKeyFolder(profile) {
  try {
    const res = await fetch('/api/config/ssh/open-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath: profile.privateKeyPath })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to open key folder.');
    }

    logToTerminal(`Opened key folder for profile "${profile.label}".`, 'success');
  } catch (err) {
    logToTerminal(`Failed to open key folder for "${profile.label}": ${err.message}`, 'error');
    showToast(`Failed to open key folder: ${err.message}`, 'error');
  }
}

async function generateSshKeyAndProfile() {
  const label = sshGenerateLabel.value.trim();
  const keyType = sshGenerateKeyType.value;
  const keyName = sshGenerateKeyName.value.trim();
  const userName = sshGenerateUserName.value.trim();
  const userEmail = sshGenerateUserEmail.value.trim();
  const passphrase = sshGeneratePassphrase.value;
  const keepPassword = sshGenerateKeepPassword.checked;

  if (!label) {
    setGenerateFeedback('Profile name is required to generate a key.', 'error');
    return;
  }

  if (keepPassword && !vaultStatus.unlocked) {
    setGenerateFeedback(vaultStatus.hasVault
      ? 'Unlock the vault before saving a passphrase.'
      : 'Set up and unlock the vault before saving a passphrase.', 'error');
    return;
  }

  if (keepPassword && !passphrase) {
    setGenerateFeedback('Passphrase is required when Keep Password is enabled.', 'error');
    return;
  }

  const originalButtonText = btnGenerateSsh.innerHTML;
  isGeneratingSshKey = true;
  btnGenerateSsh.disabled = true;
  btnGenerateSsh.innerHTML = '<span>Generating...</span>';
  setGenerateFeedback('Generating SSH key and registering profile...', 'info');

  try {
    const res = await fetch('/api/config/ssh/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, keyType, keyName, passphrase, keepPassword, userName, userEmail, repoPath: activeRepo })
    });
    const data = await res.json();

    if (!res.ok) {
      logToTerminal(data.error || 'Failed to generate SSH key.', 'error');
      setGenerateFeedback(data.error || 'Failed to generate SSH key.', 'error');
      showToast(data.error || 'Failed to generate SSH key.', 'error', 7000);
      return;
    }

    logToTerminal(`SSH key created and profile "${label}" registered.`, 'success');
    showToast(`SSH key created and profile "${label}" registered.`, 'success');
    if (data.sshConfigUpdated) {
      logToTerminal(`~/.ssh/config updated: ${data.sshConfigHost} now uses the new key.`, 'success');
    }
    if (data.sshConfigWarning) {
      logToTerminal(data.sshConfigWarning, 'error');
    }
    renderGeneratedSshResult(data);
    sshGeneratePassphrase.value = '';
    sshGenerateKeepPassword.checked = false;
    const appliedSnapshot = applyConfigSnapshot(data.config);
    if (!appliedSnapshot) {
      await loadConfig();
    }

    const profileCreated = sshProfiles.some((profile) => profile.id === data.profileId);
    if (profileCreated) {
      setGenerateFeedback(`Key created successfully. Profile "${label}" is now available in Registered Profiles.`, 'success');
    } else {
      setGenerateFeedback('Key was created, but profile list did not refresh automatically. Please reopen the modal.', 'warn');
    }

    // Make the new key the active one for the current repo
    if (data.profileId && activeRepo) {
      setActiveProfile(data.profileId, { silent: true });
    }
  } catch (err) {
    logToTerminal('SSH key generation failed: ' + err.message, 'error');
    setGenerateFeedback('SSH key generation failed: ' + err.message, 'error');
    showToast('SSH key generation failed: ' + err.message, 'error', 7000);
  } finally {
    isGeneratingSshKey = false;
    btnGenerateSsh.disabled = false;
    btnGenerateSsh.innerHTML = originalButtonText;
    ensureSshManagerInteractive();
  }
}

function loadSshProfileIntoForm(profile) {
  sshProfileId.value = profile.id;
  sshLabel.value = profile.label;
  sshKeyPath.value = profile.privateKeyPath;
  sshUserName.value = profile.userName || '';
  sshUserEmail.value = profile.userEmail || '';
  sshPassphrase.value = '';
  sshKeepPassword.checked = Boolean(profile.hasSavedPassword);
  if (sshExistingKeyHeading) sshExistingKeyHeading.innerText = 'Edit SSH Key Profile';
  showSshKeyForm('existing');
}

async function saveSshProfile() {
  const id = sshProfileId.value;
  const label = sshLabel.value.trim();
  const privateKeyPath = sshKeyPath.value.trim();
  const userName = sshUserName.value.trim();
  const userEmail = sshUserEmail.value.trim();
  const passphrase = sshPassphrase.value;
  const keepPassword = sshKeepPassword.checked;

  if (!label || !privateKeyPath) {
    showToast('Profile name and private key path are required.', 'warn');
    return;
  }

  if (keepPassword && !vaultStatus.unlocked) {
    showToast(vaultStatus.hasVault
      ? 'Unlock the vault before saving a passphrase.'
      : 'Set up and unlock the vault before saving a passphrase.', 'warn');
    return;
  }

  if (keepPassword && !passphrase) {
    showToast('Passphrase is required when Keep Password is enabled.', 'warn');
    return;
  }

  try {
    const res = await fetch('/api/config/ssh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label, privateKeyPath, keepPassword, passphrase, userName, userEmail })
    });
    const data = await res.json();

    if (res.ok) {
      logToTerminal(`SSH Profile "${label}" saved.`, 'success');
      showToast(`SSH profile "${label}" saved.`, 'success');
      // Reset form
      hideSshKeyForms();

      const snapshotApplied = applyConfigSnapshot(data.config);
      if (!snapshotApplied) {
        await loadConfig();
      }
    } else {
      logToTerminal(data.error, 'error');
      showToast(`Failed to save SSH profile: ${data.error}`, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Network error saving SSH Profile: ' + err.message, 'error');
  }
}

async function unlockVault() {
  if (!vaultStatus.hasVault) {
    openVaultSetupModal();
    return;
  }

  const masterKey = await promptDialog({
    title: 'Unlock Vault',
    label: 'Master key',
    type: 'password'
  });
  if (!masterKey) {
    return;
  }

  try {
    const res = await fetch('/api/secrets/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterKey })
    });
    const data = await res.json();
    if (res.ok) {
      vaultStatus = { hasVault: data.hasVault, unlocked: data.unlocked };
      updateVaultStatusUI();
      logToTerminal('Vault unlocked.', 'success');
      showToast('Vault unlocked.', 'success');
      await loadConfig();
    } else {
      logToTerminal(data.error || 'Failed to unlock vault.', 'error');
      showToast(data.error || 'Failed to unlock vault.', 'error');
    }
  } catch (err) {
    logToTerminal('Unlock vault failed: ' + err.message, 'error');
  }
}

function setVaultSetupFeedback(message, type = 'error', hide = false) {
  if (!vaultSetupFeedback) {
    return;
  }

  if (hide || !message) {
    vaultSetupFeedback.className = 'inline-feedback hidden';
    vaultSetupFeedback.innerText = '';
    return;
  }

  vaultSetupFeedback.className = `inline-feedback ${type}`;
  vaultSetupFeedback.innerText = message;
}

function openVaultSetupModal() {
  if (!vaultSetupModal || vaultStatus.hasVault) {
    return;
  }

  vaultMasterKey.value = '';
  vaultMasterKeyConfirm.value = '';
  setVaultSetupFeedback('', 'error', true);
  vaultSetupModal.classList.remove('hidden');
  setTimeout(() => vaultMasterKey.focus(), 30);
}

function closeVaultSetupModal() {
  if (!vaultSetupModal) {
    return;
  }

  vaultMasterKey.value = '';
  vaultMasterKeyConfirm.value = '';
  setVaultSetupFeedback('', 'error', true);
  vaultSetupModal.classList.add('hidden');
}

async function setupVault() {
  const masterKey = vaultMasterKey.value;
  const confirmation = vaultMasterKeyConfirm.value;

  if (!masterKey) {
    setVaultSetupFeedback('Choose a master key before creating the vault.');
    vaultMasterKey.focus();
    return;
  }
  if (masterKey !== confirmation) {
    setVaultSetupFeedback('The master keys do not match. Enter the same key in both fields.');
    vaultMasterKeyConfirm.focus();
    return;
  }

  setButtonBusy(btnSaveVaultSetup, true);
  setVaultSetupFeedback('Creating encrypted vault...', 'info');
  try {
    const res = await fetch('/api/secrets/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterKey })
    });
    const data = await res.json();
    if (!res.ok) {
      setVaultSetupFeedback(data.error || 'Failed to create the vault.');
      return;
    }

    vaultStatus = { hasVault: data.hasVault, unlocked: data.unlocked };
    updateVaultStatusUI();
    closeVaultSetupModal();
    logToTerminal('Passphrase vault created and unlocked.', 'success');
    showToast('Passphrase vault created and unlocked.', 'success');
    await loadConfig();
  } catch (err) {
    logToTerminal('Create vault failed: ' + err.message, 'error');
    setVaultSetupFeedback('Create vault failed: ' + err.message);
  } finally {
    setButtonBusy(btnSaveVaultSetup, false);
  }
}

async function lockVault() {
  try {
    const res = await fetch('/api/secrets/lock', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      vaultStatus = { hasVault: data.hasVault, unlocked: data.unlocked };
      updateVaultStatusUI();
      logToTerminal('Vault locked.', 'success');
      showToast('Vault locked.', 'info');
    }
  } catch (err) {
    logToTerminal('Lock vault failed: ' + err.message, 'error');
  }
}

async function testSshForm() {
  const privateKeyPath = sshKeyPath.value.trim();
  if (!privateKeyPath) {
    showToast('Enter a private key path first.', 'warn');
    return;
  }

  const payload = {
    privateKeyPath,
    passphrase: sshPassphrase.value || ''
  };

  try {
    const res = await fetch('/api/config/ssh/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      logToTerminal(data.message || 'SSH key test passed.', 'success');
      showToast(data.message || 'SSH key test passed.', 'success');
    } else {
      logToTerminal(data.message || data.error || 'SSH key test failed.', 'error');
      showToast(data.message || data.error || 'SSH key test failed.', 'error', 7000);
    }
  } catch (err) {
    logToTerminal('SSH key test failed: ' + err.message, 'error');
  }
}

async function testSshProfile(profileId, profileLabel) {
  try {
    const res = await fetch('/api/config/ssh/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId })
    });
    const data = await res.json();

    if (data.success) {
      logToTerminal(`SSH profile "${profileLabel}" passed test.`, 'success');
      showToast(`"${profileLabel}": ${data.message || 'key test passed.'}`, 'success');
    } else {
      logToTerminal(`SSH profile "${profileLabel}" failed test: ${data.message || data.error}`, 'error');
      showToast(`"${profileLabel}" test failed: ${data.message || data.error}`, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('SSH profile test failed: ' + err.message, 'error');
  }
}

async function deleteSshProfile(id, label = 'Profile') {
  const { confirmed } = await confirmDialog(
    `Delete SSH profile "${label}"? The key files on disk are not touched.`,
    { title: 'Delete SSH profile', confirmLabel: 'Delete', danger: true }
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/config/ssh', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (res.ok) {
      logToTerminal(`Deleted SSH profile "${label}".`);
      showToast(`SSH profile "${label}" deleted.`, 'success');
      const snapshotApplied = applyConfigSnapshot(data.config);
      if (!snapshotApplied) {
        await loadConfig();
      }
      ensureSshManagerInteractive();
    } else {
      const message = data.error || 'Failed to delete SSH profile.';
      logToTerminal(message, 'error');
      showToast(message, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Network error deleting SSH Profile: ' + err.message, 'error');
  } finally {
    ensureSshManagerInteractive();
    updateSshProfilesUI();
  }
}

// ----------------- EXPLORER FILE TREE & BLAME VIEW -----------------

// Toggle views tabs
function switchViewTab(tabName) {
  const tabs = {
    staging: { btn: tabStaging, pane: stagingView },
    diff: { btn: tabDiff, pane: diffView },
    explorer: { btn: tabExplorer, pane: explorerView }
  };

  Object.entries(tabs).forEach(([name, { btn, pane }]) => {
    const isActive = name === tabName;
    btn.classList.toggle('active', isActive);
    pane.classList.toggle('hidden', !isActive);
  });

  if (tabName === 'explorer') {
    loadWorkspaceTree();
  } else if (tabName === 'diff' && activeRepo) {
    if (currentStatus) {
      renderDiffFileList(currentStatus.staged || [], currentStatus.unstaged || [], currentStatus.conflicts || []);
    } else {
      refreshGitStatus();
    }
  }
}

// Fetch files list and render tree
async function loadWorkspaceTree() {
  if (!activeRepo) return;
  renderPaneMessage(fileTreeContainer, 'Loading files list...', false, 'tree-loading');

  try {
    const res = await fetch('/api/git/files', {
      headers: { 'x-repo-path': activeRepo }
    });
    const data = await res.json();

    if (!res.ok) {
      renderPaneMessage(fileTreeContainer, `Error loading files: ${data.error}`, true, 'tree-loading');
      return;
    }

    // Combine tracked and untracked files
    const allFiles = [
      ...data.tracked.map(path => ({ path, untracked: false })),
      ...data.untracked.map(path => ({ path, untracked: true }))
    ];

    if (allFiles.length === 0) {
      renderPaneMessage(fileTreeContainer, 'No files in repository', false, 'tree-loading');
      return;
    }

    // Build tree structure
    const root = { type: 'directory', name: 'root', children: {} };
    for (const fileObj of allFiles) {
      const parts = fileObj.path.split('/');
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = (i === parts.length - 1);

        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            type: isLast ? 'file' : 'directory',
            path: parts.slice(0, i + 1).join('/'),
            untracked: fileObj.untracked,
            children: isLast ? null : {}
          };
        }
        current = current.children[part];
      }
    }

    // Render root children
    fileTreeContainer.innerHTML = '';

    // Sort keys: directories first, then files
    const sortedKeys = Object.keys(root.children).sort((a, b) => {
      const typeA = root.children[a].type;
      const typeB = root.children[b].type;
      if (typeA !== typeB) {
        return typeA === 'directory' ? -1 : 1;
      }
      return a.localeCompare(b);
    });

    sortedKeys.forEach(key => {
      fileTreeContainer.appendChild(renderTreeNode(root.children[key], 0));
    });
  } catch (err) {
    renderPaneMessage(fileTreeContainer, `Failed to connect: ${err.message}`, true, 'tree-loading');
  }
}

// DOM generator for tree node
function renderTreeNode(node, depth = 0) {
  const container = document.createElement('div');
  container.className = 'tree-node';

  const item = document.createElement('div');
  item.className = 'tree-item';
  item.dataset.path = node.path;
  item.style.paddingLeft = `${depth * 16 + 8}px`;

  if (node.type === 'directory') {
    const arrow = document.createElement('span');
    arrow.className = 'material-symbols-outlined tree-toggle-arrow';
    arrow.innerText = 'keyboard_arrow_right';

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined tree-icon folder-icon';
    icon.innerText = 'folder';

    const name = document.createElement('span');
    name.innerText = node.name;

    item.appendChild(arrow);
    item.appendChild(icon);
    item.appendChild(name);
    container.appendChild(item);

    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children hidden';
    container.appendChild(childrenDiv);

    item.onclick = (e) => {
      e.stopPropagation();
      const isHidden = childrenDiv.classList.toggle('hidden');
      arrow.classList.toggle('expanded', !isHidden);
      arrow.innerText = isHidden ? 'keyboard_arrow_right' : 'keyboard_arrow_down';

      // Lazy render directory children
      if (!isHidden && childrenDiv.innerHTML === '') {
        const sortedKeys = Object.keys(node.children).sort((a, b) => {
          const typeA = node.children[a].type;
          const typeB = node.children[b].type;
          if (typeA !== typeB) {
            return typeA === 'directory' ? -1 : 1;
          }
          return a.localeCompare(b);
        });

        sortedKeys.forEach(key => {
          childrenDiv.appendChild(renderTreeNode(node.children[key], depth + 1));
        });
      }
    };
  } else {
    // File
    const indent = document.createElement('span');
    indent.className = 'tree-indent';

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined tree-icon file-icon';
    if (node.untracked) {
      icon.innerText = 'draft';
      icon.style.color = 'var(--text-dim)';
    } else {
      icon.innerText = 'description';
    }

    const name = document.createElement('span');
    name.innerText = node.name;
    if (node.untracked) {
      name.style.fontStyle = 'italic';
      name.style.color = 'var(--text-muted)';
    }

    item.appendChild(indent);
    item.appendChild(icon);
    item.appendChild(name);
    container.appendChild(item);

    item.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      selectedExplorerFile = node.path;
      openExplorerFile(node.path, node.untracked);
    };
  }

  return container;
}

// Load normal file content
async function openExplorerFile(filePath, isUntracked = false) {
  btnToggleBlame.disabled = isUntracked;
  blameActive = false;
  btnToggleBlame.querySelector('span:nth-child(2)').innerText = 'Show Blame';

  explorerFileTitle.innerText = filePath;
  renderPaneMessage(explorerFileBody, 'Loading file content...', false, 'file-empty-state');

  try {
    const res = await fetch(`/api/git/file/content?path=${encodeURIComponent(filePath)}`, {
      headers: { 'x-repo-path': activeRepo }
    });
    const data = await res.json();

    if (!res.ok) {
      renderPaneMessage(explorerFileBody, `Error: ${data.error}`, true, 'file-empty-state');
      return;
    }

    // Render content with lines
    explorerFileBody.innerHTML = '';
    const lines = data.content.split('\n');
    lines.forEach((line, index) => {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'blame-line';

      const lineNum = document.createElement('span');
      lineNum.className = 'diff-line-nums';
      lineNum.style.width = '40px';
      lineNum.style.paddingRight = '8px';
      lineNum.innerText = index + 1;

      const lineCode = document.createElement('div');
      lineCode.className = 'blame-code';
      lineCode.innerText = line;

      lineDiv.appendChild(lineNum);
      lineDiv.appendChild(lineCode);
      explorerFileBody.appendChild(lineDiv);
    });
  } catch (err) {
    renderPaneMessage(explorerFileBody, `Connection Error: ${err.message}`, true, 'file-empty-state');
  }
}

// Toggle blame view
async function toggleBlameView() {
  if (!selectedExplorerFile) return;

  blameActive = !blameActive;
  if (!blameActive) {
    btnToggleBlame.querySelector('span:nth-child(2)').innerText = 'Show Blame';
    openExplorerFile(selectedExplorerFile);
    return;
  }

  btnToggleBlame.querySelector('span:nth-child(2)').innerText = 'Hide Blame';
  renderPaneMessage(explorerFileBody, 'Running git blame...', false, 'file-empty-state');

  try {
    const res = await fetch(`/api/git/file/blame?path=${encodeURIComponent(selectedExplorerFile)}`, {
      headers: { 'x-repo-path': activeRepo }
    });
    const data = await res.json();

    if (!res.ok) {
      renderPaneMessage(explorerFileBody, `Blame failed: ${data.error}`, true, 'file-empty-state');
      blameActive = false;
      btnToggleBlame.querySelector('span:nth-child(2)').innerText = 'Show Blame';
      return;
    }

    explorerFileBody.innerHTML = '';
    data.blame.forEach(line => {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'blame-line';

      const blameMeta = document.createElement('div');
      blameMeta.className = 'blame-meta';

      const hashSpan = document.createElement('span');
      hashSpan.className = 'blame-hash';
      hashSpan.innerText = line.hash.substring(0, 8);
      hashSpan.title = 'Click to view commit details';
      hashSpan.onclick = () => showCommitDetails(line.hash);

      const authorSpan = document.createElement('span');
      authorSpan.className = 'blame-author';
      authorSpan.innerText = line.author;
      authorSpan.title = line.author;

      const dateSpan = document.createElement('span');
      dateSpan.className = 'blame-date';
      dateSpan.innerText = line.date;

      blameMeta.appendChild(hashSpan);
      blameMeta.appendChild(authorSpan);
      blameMeta.appendChild(dateSpan);

      const lineCode = document.createElement('div');
      lineCode.className = 'blame-code';
      lineCode.innerText = line.content;

      lineDiv.appendChild(blameMeta);
      lineDiv.appendChild(lineCode);
      explorerFileBody.appendChild(lineDiv);
    });
  } catch (err) {
    renderPaneMessage(explorerFileBody, `Blame Error: ${err.message}`, true, 'file-empty-state');
  }
}

// ----------------- COMMIT DETAILS DRAWER -----------------

async function showCommitDetails(commitHash) {
  if (!commitHash || commitHash.startsWith('00000000') || commitHash === 'unknown') return;

  logToTerminal(`Fetching details for commit: ${commitHash.substring(0, 8)}...`);

  try {
    const res = await fetch(`/api/git/commit/details?hash=${commitHash}`, {
      headers: { 'x-repo-path': activeRepo }
    });
    const data = await res.json();

    if (!res.ok) {
      logToTerminal(`Failed to load commit details: ${data.error}`, 'error');
      return;
    }

    currentDrawerCommit = data.commit;
    drawerHash.innerText = data.commit.hash.substring(0, 8);
    drawerHash.title = data.commit.hash;
    drawerMsg.innerText = data.commit.message;
    drawerAuthor.innerText = data.commit.author;
    drawerDate.innerText = data.commit.date;
    drawerFilesHeading.innerText = 'Files Changed';

    drawerFilesList.innerHTML = '';
    data.files.forEach(file => {
      const li = document.createElement('li');
      li.className = 'changed-file-item';

      const pathSpan = document.createElement('span');
      pathSpan.className = 'changed-file-path';
      pathSpan.innerText = file.path;
      pathSpan.title = file.path;

      const rightGroup = document.createElement('span');
      rightGroup.style.cssText = 'display:flex; align-items:center; gap:4px; flex-shrink:0;';

      const btnHistory = document.createElement('button');
      btnHistory.className = 'btn btn-icon btn-sm file-history-btn';
      btnHistory.title = `Show commit history of ${file.path}`;
      btnHistory.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">history</span>';
      btnHistory.onclick = (e) => {
        e.stopPropagation();
        showFileHistory(file.path);
      };

      const status = statusLabels[file.status] || { char: file.status, title: 'Modified', class: 'status-m' };
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-indicator ${status.class}`;
      statusBadge.innerText = status.char;
      statusBadge.title = status.title;

      rightGroup.appendChild(btnHistory);
      rightGroup.appendChild(statusBadge);

      li.appendChild(pathSpan);
      li.appendChild(rightGroup);

      li.onclick = () => loadCommitFileDiff(data.commit.hash, file.path);

      drawerFilesList.appendChild(li);
    });

    commitDetailsDrawer.classList.remove('hidden');
  } catch (err) {
    logToTerminal('Error showing commit details: ' + err.message, 'error');
  }
}

function closeCommitDrawer() {
  commitDetailsDrawer.classList.add('hidden');
  currentDrawerCommit = null;
}

// ----------------- HISTORY ACTIONS (cherry-pick / revert / reset / tags) -----------------

// Shared runner for commit-targeted operations that may produce conflicts
async function runHistoryAction(endpoint, body, cmdLabel, successMsg) {
  logToTerminal(cmdLabel, 'cmd');
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.success) {
      logToTerminal(successMsg, 'success');
      showToast(successMsg, 'success');
      closeCommitDrawer();
      await refreshAll();
    } else if (data.conflict) {
      logToTerminal(data.error, 'error');
      showToast('The operation hit conflicts — resolve them in the staging area.', 'warn', 7000);
      closeCommitDrawer();
      await refreshAll();
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Operation failed: ' + err.message, 'error');
  }
}

async function drawerCherryPick() {
  if (!currentDrawerCommit) return;
  const short = currentDrawerCommit.hash.substring(0, 8);
  const { confirmed } = await confirmDialog(
    `Apply commit ${short} ("${currentDrawerCommit.message}") onto the current branch?`,
    { title: 'Cherry-pick commit', confirmLabel: 'Cherry-pick' }
  );
  if (!confirmed) return;
  await runHistoryAction('/api/git/cherry-pick', { hash: currentDrawerCommit.hash },
    `git cherry-pick ${short}`, `Commit ${short} cherry-picked.`);
}

async function drawerRevert() {
  if (!currentDrawerCommit) return;
  const short = currentDrawerCommit.hash.substring(0, 8);
  const { confirmed } = await confirmDialog(
    `Create a new commit that undoes ${short} ("${currentDrawerCommit.message}")?`,
    { title: 'Revert commit', confirmLabel: 'Revert' }
  );
  if (!confirmed) return;
  await runHistoryAction('/api/git/revert', { hash: currentDrawerCommit.hash },
    `git revert --no-edit ${short}`, `Commit ${short} reverted.`);
}

async function drawerReset() {
  if (!currentDrawerCommit) return;
  const mode = drawerResetMode.value;
  const short = currentDrawerCommit.hash.substring(0, 8);
  const explanations = {
    soft: 'later changes stay staged',
    mixed: 'later changes stay in your working tree, unstaged',
    hard: 'ALL later commits and changes are discarded'
  };
  const { confirmed } = await confirmDialog(
    `Reset the current branch to ${short} (--${mode})? After this, ${explanations[mode]}. A checkpoint is saved so you can undo.`,
    { title: `Reset (${mode})`, confirmLabel: 'Reset', danger: mode === 'hard' }
  );
  if (!confirmed) return;
  await runHistoryAction('/api/git/reset', { hash: currentDrawerCommit.hash, mode },
    `git reset --${mode} ${short}`, `Branch reset to ${short} (${mode}).`);
}

async function drawerCreateTag() {
  if (!currentDrawerCommit) return;
  const name = await promptDialog({
    title: 'Create Tag',
    label: `Tag name for commit ${currentDrawerCommit.hash.substring(0, 8)} (e.g. v1.2.0)`,
    type: 'text'
  });
  if (!name) return;

  logToTerminal(`git tag ${name} ${currentDrawerCommit.hash.substring(0, 8)}`, 'cmd');
  try {
    const res = await fetch('/api/git/tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ name: name.trim(), hash: currentDrawerCommit.hash })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Tag "${name.trim()}" created.`, 'success');
      await Promise.all([refreshTagList(), refreshCommitHistory()]);
    } else {
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Create tag failed: ' + err.message, 'error');
  }
}

async function drawerCopySha() {
  if (!currentDrawerCommit) return;
  try {
    await copyTextToClipboard(currentDrawerCommit.hash);
    showToast('Commit SHA copied to clipboard.', 'success');
  } catch (err) {
    showToast('Failed to copy SHA.', 'error');
  }
}

// Per-file commit history shown inside the drawer's files area
async function showFileHistory(filePath) {
  if (!currentDrawerCommit) return;
  const returnHash = currentDrawerCommit.hash;

  drawerFilesHeading.innerText = `History: ${filePath}`;
  drawerFilesList.innerHTML = '<li class="empty-state">Loading history...</li>';

  try {
    const res = await fetch(`/api/git/file/history?path=${encodeURIComponent(filePath)}`, {
      headers: { 'x-repo-path': activeRepo }
    });
    const data = await res.json();

    drawerFilesList.innerHTML = '';

    // Back row to return to the commit's file list
    const backLi = document.createElement('li');
    backLi.className = 'changed-file-item';
    backLi.innerHTML = '<span class="changed-file-path" style="display:flex; align-items:center; gap:6px;"><span class="material-symbols-outlined" style="font-size:14px;">arrow_back</span>Back to files</span>';
    backLi.onclick = () => showCommitDetails(returnHash);
    drawerFilesList.appendChild(backLi);

    if (!res.ok || !data.commits || data.commits.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-state';
      li.innerText = res.ok ? 'No history for this file' : (data.error || 'Failed to load history');
      drawerFilesList.appendChild(li);
      return;
    }

    data.commits.forEach(commit => {
      const li = document.createElement('li');
      li.className = 'changed-file-item';
      li.title = `${commit.hash.substring(0, 8)} — ${commit.author}, ${commit.date}`;

      const text = document.createElement('span');
      text.className = 'changed-file-path';
      text.innerText = commit.message;

      const dateSpan = document.createElement('span');
      dateSpan.style.cssText = 'font-size:0.6875rem; color:var(--text-dim); flex-shrink:0;';
      dateSpan.innerText = commit.date;

      li.appendChild(text);
      li.appendChild(dateSpan);
      li.onclick = () => loadCommitFileDiff(commit.hash, filePath);
      drawerFilesList.appendChild(li);
    });
  } catch (err) {
    drawerFilesList.innerHTML = '<li class="empty-state">Failed to load history</li>';
  }
}

// ----------------- TAGS -----------------
async function refreshTagList() {
  if (!activeRepo || !tagList) return;

  try {
    const res = await fetch('/api/git/tags', { headers: { 'x-repo-path': activeRepo } });
    const data = await res.json();
    const tags = (res.ok && data.tags) || [];

    tagList.innerHTML = '';
    if (tags.length === 0) {
      tagList.innerHTML = '<li class="empty-state">No tags</li>';
      return;
    }

    tags.forEach(tag => {
      const li = document.createElement('li');
      li.className = 'stash-item';
      li.title = `${tag.name} → ${tag.hash} (${tag.date})`;

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.innerText = 'sell';

      const msg = document.createElement('span');
      msg.className = 'stash-msg';
      msg.innerText = tag.name;

      const actions = document.createElement('span');
      actions.className = 'stash-actions';

      const btnShow = document.createElement('button');
      btnShow.className = 'btn btn-icon btn-sm';
      btnShow.title = 'Show tagged commit';
      btnShow.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">visibility</span>';
      btnShow.onclick = (e) => {
        e.stopPropagation();
        showCommitDetails(tag.hash);
      };

      const btnPushTag = document.createElement('button');
      btnPushTag.className = 'btn btn-icon btn-sm';
      btnPushTag.title = 'Push tag to origin';
      btnPushTag.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">upload</span>';
      btnPushTag.onclick = (e) => {
        e.stopPropagation();
        pushTag(tag.name);
      };

      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-icon btn-sm';
      btnDel.title = 'Delete local tag';
      btnDel.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">delete</span>';
      btnDel.onclick = (e) => {
        e.stopPropagation();
        deleteTag(tag.name);
      };

      actions.appendChild(btnShow);
      actions.appendChild(btnPushTag);
      actions.appendChild(btnDel);

      li.appendChild(icon);
      li.appendChild(msg);
      li.appendChild(actions);
      tagList.appendChild(li);
    });
  } catch (err) {
    tagList.innerHTML = '<li class="empty-state">No tags</li>';
  }
}

async function pushTag(name) {
  const profile = getActiveProfile();
  logToTerminal(`git push origin refs/tags/${name}`, 'cmd');
  try {
    const res = await fetch('/api/git/tag/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({
        name,
        profileId: profile ? profile.id : null,
        sshKeyPath: profile ? profile.privateKeyPath : ''
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Tag "${name}" pushed to origin.`, 'success');
      logToTerminal(data.stderr || data.stdout || `Tag ${name} pushed.`, 'success');
    } else {
      logToTerminal(data.error, 'error');
      showToast(data.error, 'error', 8000);
    }
  } catch (err) {
    logToTerminal('Push tag failed: ' + err.message, 'error');
  }
}

async function deleteTag(name) {
  const { confirmed } = await confirmDialog(
    `Delete local tag "${name}"? (The tag stays on the remote if it was pushed.)`,
    { title: 'Delete tag', confirmLabel: 'Delete', danger: true }
  );
  if (!confirmed) return;

  logToTerminal(`git tag -d ${name}`, 'cmd');
  try {
    const res = await fetch('/api/git/tag', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-repo-path': activeRepo },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Tag "${name}" deleted.`, 'success');
      await Promise.all([refreshTagList(), refreshCommitHistory()]);
    } else {
      showToast(data.error, 'error', 7000);
    }
  } catch (err) {
    logToTerminal('Delete tag failed: ' + err.message, 'error');
  }
}

function closeOpenModalOnEscape() {
  if (promptModal && !promptModal.classList.contains('hidden')) {
    settlePrompt(null);
    return;
  }

  if (confirmModal && !confirmModal.classList.contains('hidden')) {
    settleConfirm(false);
    return;
  }

  if (vaultSetupModal && !vaultSetupModal.classList.contains('hidden')) {
    closeVaultSetupModal();
    return;
  }

  if (cloneModal && !cloneModal.classList.contains('hidden')) {
    cloneModal.classList.add('hidden');
    return;
  }

  if (identityModal && !identityModal.classList.contains('hidden')) {
    identityModal.classList.add('hidden');
    return;
  }

  if (conflictModal && !conflictModal.classList.contains('hidden')) {
    conflictModal.classList.add('hidden');
    return;
  }

  if (sshModal && !sshModal.classList.contains('hidden')) {
    sshModal.classList.add('hidden');
    return;
  }

  closeAllDropdowns();
}

async function loadCommitFileDiff(hash, filePath) {
  logToTerminal(`git show ${hash.substring(0, 8)} -- ${filePath}`, 'cmd');

  switchViewTab('diff');

  // Historical diff is read-only: no stage/discard actions
  activeDiffFile = null;
  updateActiveFileItems();
  diffActions.classList.add('hidden');
  diffFileTitle.innerText = filePath;
  diffFileType.innerText = `Commit ${hash.substring(0, 8)}`;
  diffFileType.className = 'badge status-m';
  renderPaneMessage(diffContent, 'Generating historical diff...');

  try {
    const url = `/api/git/commit/diff?hash=${hash}&path=${encodeURIComponent(filePath)}`;
    const res = await fetch(url, { headers: { 'x-repo-path': activeRepo } });
    const data = await res.json();

    if (!res.ok) {
      renderPaneMessage(diffContent, `Error loading commit diff: ${data.error}`, true);
      return;
    }

    if (data.diff.length === 0) {
      renderPaneMessage(diffContent, 'No changes in this file in this commit');
      return;
    }

    renderDiffLines(data.diff);
  } catch (err) {
    renderPaneMessage(diffContent, `Error: ${err.message}`, true);
  }
}

// ----------------- EVENT LISTENERS SETUP -----------------
function setupListeners() {
  // Header dropdowns
  registerDropdown(repoSegment, repoDropdown);
  registerDropdown(branchSegment, branchDropdown, () => {
    branchFilterInput.value = '';
    renderBranchDropdownList();
    setTimeout(() => branchFilterInput.focus(), 30);
  });
  registerDropdown(profileSegment, profileDropdown, () => renderProfileUI());

  // Clicking outside any segment closes open dropdowns
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.segment-wrapper')) {
      closeAllDropdowns();
    }
  });

  branchFilterInput.oninput = () => renderBranchDropdownList();
  btnHeaderCreateBranch.onclick = () => createBranchFromInput(headerNewBranchInput);
  headerNewBranchInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createBranchFromInput(headerNewBranchInput);
    }
  };

  // Open / New / Clone repo (header dropdown + welcome overlay)
  btnOpenRepo.onclick = () => { closeAllDropdowns(); browseAndOpen(); };
  btnCreateRepo.onclick = () => { closeAllDropdowns(); createNewRepo(); };
  btnCloneRepo.onclick = openCloneModal;
  btnOverlayOpen.onclick = browseAndOpen;
  if (btnOverlayCreate) btnOverlayCreate.onclick = createNewRepo;
  if (btnOverlayClone) btnOverlayClone.onclick = openCloneModal;

  // SSH profile dropdown extras
  btnManageSsh.onclick = () => { closeAllDropdowns(); openSshModal(); };
  btnDropdownVault.onclick = () => {
    closeAllDropdowns();
    if (vaultStatus.unlocked) {
      lockVault();
    } else if (vaultStatus.hasVault) {
      unlockVault();
    } else {
      openVaultSetupModal();
    }
  };
  btnEditIdentity.onclick = openIdentityModal;

  // SSH Modal
  btnCloseSshModal.onclick = () => sshModal.classList.add('hidden');
  btnCancelSsh.onclick = hideSshKeyForms;
  sshModal.onclick = (e) => {
    if (e.target === sshModal) {
      sshModal.classList.add('hidden');
    }
  };
  sshProfileForm.onsubmit = (e) => {
    e.preventDefault();
    saveSshProfile();
  };
  if (btnShowAddKey) {
    btnShowAddKey.onclick = () => {
      resetSshProfileForm();
      showSshKeyForm('existing');
    };
  }
  if (btnHideAddKey) btnHideAddKey.onclick = hideSshKeyForms;
  if (btnShowGenerateKey) btnShowGenerateKey.onclick = () => showSshKeyForm('generate');
  if (btnHideGenerateKey) btnHideGenerateKey.onclick = hideSshKeyForms;
  if (btnSetupVault) btnSetupVault.onclick = openVaultSetupModal;
  if (btnUnlockVault) btnUnlockVault.onclick = unlockVault;
  if (btnLockVault) btnLockVault.onclick = lockVault;
  if (btnCancelVaultSetup) btnCancelVaultSetup.onclick = closeVaultSetupModal;
  if (vaultSetupForm) {
    vaultSetupForm.onsubmit = (e) => {
      e.preventDefault();
      setupVault();
    };
  }
  if (vaultSetupModal) {
    vaultSetupModal.onclick = (e) => {
      if (e.target === vaultSetupModal) {
        closeVaultSetupModal();
      }
    };
  }
  if (btnTestSshForm) btnTestSshForm.onclick = testSshForm;
  const sshManageConfigCheckbox = document.getElementById('ssh-manage-config-checkbox');
  if (sshManageConfigCheckbox) sshManageConfigCheckbox.onchange = onSshConfigSettingChanged;

  // SSH key health modal (startup validation)
  const sshHealthModal = document.getElementById('ssh-health-modal');
  document.getElementById('btn-ssh-health-dismiss').onclick = () => sshHealthModal.classList.add('hidden');
  document.getElementById('btn-ssh-health-open').onclick = () => {
    sshHealthModal.classList.add('hidden');
    openSshModal();
  };
  sshHealthModal.onclick = (e) => {
    if (e.target === sshHealthModal) {
      sshHealthModal.classList.add('hidden');
    }
  };
  if (sshGenerateForm) {
    sshGenerateForm.onsubmit = (e) => {
      e.preventDefault();
      generateSshKeyAndProfile();
    };
  }
  btnAddRule.onclick = addAccountRule;
  ruleMatchInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addAccountRule();
    }
  };
  if (btnOpenGeneratedLocation) btnOpenGeneratedLocation.onclick = openGeneratedSshLocation;
  if (btnCopyGeneratedPrivatePath) btnCopyGeneratedPrivatePath.onclick = copyGeneratedPrivatePath;
  if (btnCopyGeneratedPublicPath) btnCopyGeneratedPublicPath.onclick = copyGeneratedPublicPath;
  if (btnCopyGeneratedPublicKey) btnCopyGeneratedPublicKey.onclick = copyGeneratedPublicKey;

  // Refresh
  btnRefresh.onclick = refreshAll;

  // Branch create (sidebar)
  btnCreateBranch.onclick = () => createBranchFromInput(newBranchInput);
  newBranchInput.onkeydown = (e) => {
    if (e.key === 'Enter') createBranchFromInput(newBranchInput);
  };

  // Integrate Merge/Rebase
  btnMerge.onclick = () => runBranchIntegration('merge');
  btnRebase.onclick = () => runBranchIntegration('rebase');

  // Conflict Action Banner
  btnAbortConflict.onclick = abortConflict;
  btnContinueConflict.onclick = continueConflict;

  // Staging controls
  btnStageAll.onclick = () => stageFiles(['.']);
  btnUnstageAll.onclick = () => unstageFiles(['.']);
  btnDiscardAll.onclick = discardAllChanges;
  filenameWrapToggle.onchange = () => setFilenameWrapping(filenameWrapToggle.checked);

  // Stash
  btnStashSave.onclick = stashChanges;

  // Commit triggers
  btnCommit.onclick = commitChanges;
  commitAmendCheckbox.onchange = onAmendToggle;
  commitMsgInput.onkeydown = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      commitChanges();
    }
  };
  commitMsgInput.oninput = updateCommitFormatHint;
  renderCommitTemplateChips();

  // Remote Fetch/Push/Pull
  btnFetch.onclick = () => performSync('fetch');
  btnPull.onclick = () => performSync('pull');
  btnPush.onclick = () => performSync('push');
  btnRemoteProtocol.onclick = toggleRemoteProtocol;

  // Undo last commit
  btnUndoCommit.onclick = undoLastCommit;

  // Lazy-load older commits when the history graph is scrolled near the bottom
  commitHistoryList.addEventListener('scroll', () => {
    if (commitHistoryList.scrollTop + commitHistoryList.clientHeight >= commitHistoryList.scrollHeight - 300) {
      loadMoreCommits();
    }
  });

  // Terminal log window
  btnOpenLogs.onclick = openLogWindow;

  // Conflict Modal
  btnCloseConflictModal.onclick = () => conflictModal.classList.add('hidden');
  btnCancelConflictModal.onclick = () => conflictModal.classList.add('hidden');
  conflictModal.onclick = (e) => {
    if (e.target === conflictModal) {
      conflictModal.classList.add('hidden');
    }
  };
  btnSaveConflictResolution.onclick = saveConflictResolution;
  btnConflictKeepOurs.onclick = () => {
    conflictTextarea.value = resolveConflictText(conflictTextarea.value, 'ours');
    logToTerminal('Replaced conflict blocks with Ours (HEAD) text in editor.');
  };
  btnConflictKeepTheirs.onclick = () => {
    conflictTextarea.value = resolveConflictText(conflictTextarea.value, 'theirs');
    logToTerminal('Replaced conflict blocks with Theirs (Incoming) text in editor.');
  };

  // Clone Modal
  btnCloseCloneModal.onclick = () => cloneModal.classList.add('hidden');
  btnCancelClone.onclick = () => cloneModal.classList.add('hidden');
  cloneModal.onclick = (e) => {
    if (e.target === cloneModal) cloneModal.classList.add('hidden');
  };
  cloneForm.onsubmit = (e) => {
    e.preventDefault();
    startClone();
  };
  btnCloneBrowse.onclick = async () => {
    try {
      const folder = await pickFolderPath();
      if (folder) cloneParentDirInput.value = folder;
    } catch (err) {
      showToast('Could not open the folder dialog.', 'error');
    }
  };

  // Identity Modal
  btnCloseIdentityModal.onclick = () => identityModal.classList.add('hidden');
  btnCancelIdentity.onclick = () => identityModal.classList.add('hidden');
  identityModal.onclick = (e) => {
    if (e.target === identityModal) identityModal.classList.add('hidden');
  };
  identityForm.onsubmit = (e) => {
    e.preventDefault();
    saveIdentity();
  };

  // Confirm / Prompt dialogs
  btnConfirmOk.onclick = () => settleConfirm(true);
  btnConfirmCancel.onclick = () => settleConfirm(false);
  btnPromptCancel.onclick = () => settlePrompt(null);
  promptForm.onsubmit = (e) => {
    e.preventDefault();
    settlePrompt(promptInput.value || null);
  };

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeOpenModalOnEscape();
      return;
    }

    // F5 / Ctrl+R: in-app refresh instead of reloading the page
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
      if (activeRepo) {
        e.preventDefault();
        refreshAll();
      }
    }
  });

  // Refresh status when the window regains focus (throttled)
  window.addEventListener('focus', () => {
    if (activeRepo && Date.now() - lastFocusRefresh > 5000) {
      lastFocusRefresh = Date.now();
      refreshAll();
    }
  });

  // Views tab toggles
  tabStaging.onclick = () => switchViewTab('staging');
  tabDiff.onclick = () => switchViewTab('diff');
  tabExplorer.onclick = () => switchViewTab('explorer');

  // File Diff tab actions
  btnDiffBack.onclick = () => switchViewTab('staging');
  btnDiffRefresh.onclick = refreshGitStatus;
  btnDiffToggleStage.onclick = async () => {
    if (!activeDiffFile) return;
    const { path, staged } = activeDiffFile;
    // Flip before refresh so the selection-retain logic tracks the file
    // into its new list instead of clearing the diff.
    activeDiffFile = { ...activeDiffFile, staged: !staged };
    if (staged) {
      await unstageFiles([path]);
    } else {
      await stageFiles([path]);
    }
    if (!activeDiffFile) return;
    const entry = findDiffEntry(path, !staged);
    if (entry) {
      activeDiffFile.status = entry.status;
      loadDiff(path, !staged, entry.status === '?');
    } else {
      clearDiffView();
    }
  };
  btnDiffDiscard.onclick = async () => {
    if (!activeDiffFile) return;
    await discardChanges(activeDiffFile.path, activeDiffFile.status === '?');
    if (!activeDiffFile) {
      switchViewTab('staging');
    }
  };

  // Explorer actions
  btnRefreshTree.onclick = loadWorkspaceTree;
  btnToggleBlame.onclick = toggleBlameView;

  // Commit drawer closing
  btnCloseDrawer.onclick = closeCommitDrawer;

  // Commit drawer history actions
  btnDrawerCherryPick.onclick = drawerCherryPick;
  btnDrawerRevert.onclick = drawerRevert;
  btnDrawerTag.onclick = drawerCreateTag;
  btnDrawerCopySha.onclick = drawerCopySha;
  btnDrawerReset.onclick = drawerReset;
}

// ----------------- APPLICATION START -----------------
window.onload = async () => {
  setupListeners();
  renderRepoHeader();
  renderBranchHeader();
  renderProfileUI();
  await loadConfig();

  // Warn about missing/corrupt SSH keys (fire-and-forget; must not delay startup)
  validateSshProfilesOnStartup();

  // Auto-open last repository if available
  if (recentRepos.length > 0) {
    const lastOpened = recentRepos[0];
    logToTerminal(`Auto-loading last opened repository...`);
    openRepository(lastOpened);
  } else {
    // Show startup select repository overlay
    noRepoOverlay.classList.remove('hidden');
    appContainer.classList.add('disabled-view');
  }
};
