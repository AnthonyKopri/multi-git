export interface Field {
  name: string; label: string; kind?: 'text' | 'boolean' | 'number' | 'list' | 'secret' | 'multiline';
  choices?: string[]; optional?: boolean; value?: string; allowEmpty?: boolean;
}
export interface Action {
  id: string; title: string; group: string; description: string; path?: string;
  method?: 'GET' | 'POST' | 'DELETE'; repo?: boolean; fields?: Field[];
  command?: string; privateMethod?: string; keywords?: string; dangerous?: boolean;
}
const field = (name: string, label: string, optional = false): Field => ({ name, label, optional });
const choice = (name: string, label: string, choices: string[], optional = false): Field => ({ name, label, choices, optional });
const flag = (name: string, label: string): Field => ({ name, label, kind: 'boolean', optional: true });
const list = (name: string, label: string, optional = false): Field => ({ name, label, kind: 'list', optional });
const read = (id: string, title: string, group: string, path: string, fields: Field[] = [], repo = true): Action => ({ id, title, group, path, fields, repo, method: 'GET', description: `Inspect ${title.toLowerCase()}. This does not change your repository.` });
const write = (id: string, title: string, group: string, path: string, description: string, fields: Field[] = [], repo = true): Action => ({ id, title, group, path, fields, repo, method: 'POST', description });
/** The workflow groups, in the order the sidebar lists them. */
export const actionGroups = [
  'Workspace', 'Changes', 'Branches', 'Sync', 'History', 'Integrate', 'Stash', 'Worktrees', 'Recovery',
  'Accounts', 'Remotes', 'Tags', 'Pull requests', 'Patches', 'Signing', 'Submodules', 'LFS', 'Bisect', 'Notes', 'Tools', 'System'
];

export const actions: Action[] = [
  { id: 'files', title: 'Changes', group: 'Workspace', description: 'Inspect changes before staging and committing.', repo: true },
  { id: 'repositories', title: 'Switch repository', group: 'Workspace', description: 'Choose a remembered repository or open another folder.' },
  { id: 'open-repository', title: 'Open a repository folder', group: 'Workspace', description: 'Remember and open a local Git repository.', command: 'repo.remember', fields: [field('repoPath', 'Absolute repository folder')] },
  { id: 'clone', title: 'Clone a repository', group: 'Workspace', description: 'Download a repository into a new folder. Choose an SSH URL when selecting a profile.', command: 'repo.clone', fields: [field('url', 'Repository URL'), field('parentDir', 'Existing parent folder (absolute)'), field('folderName', 'New folder name', true), field('profileId', 'SSH profile ID (optional)', true)] },
  write('new-repository', 'Create a repository', 'Workspace', '/api/git/new-repo', 'Initialize a folder, add templates, and optionally publish to GitHub. Publishing creates a remote and pushes the first commit.', [field('repoPath', 'Absolute folder'), choice('visibility', 'Visibility', ['private', 'public']), field('licenseId', 'License template ID (none to skip)', true), field('gitignoreId', 'Gitignore template ID', true), flag('createRemote', 'Create on GitHub and publish'), { ...flag('useSshRemote', 'Use an SSH remote (recommended with SSH profiles)'), value: 'true' }, field('licenseHolder', 'License holder name', true)], false),
  read('templates', 'Repository templates', 'Workspace', '/api/repo-templates', [], false),
  read('github-repositories', 'Browse GitHub repositories', 'Workspace', '/api/github/repositories', [field('owner', 'Owner or organization', true)], false),
  read('groups', 'Repository groups', 'Workspace', '/api/repo-groups', [], false),
  write('group-save', 'Save repository group', 'Workspace', '/api/repo-groups', 'Group existing repositories for navigation and fetching.', [field('id', 'Existing group ID (blank for new)', true), field('label', 'Group name'), list('repos', 'Absolute repository paths, one per line')], false),
  write('group-fetch', 'Fetch repository group', 'Sync', '/api/repo-groups/fetch', 'Fetch repositories in the selected group; remote-tracking refs may change.', [field('id', 'Group ID')], false),
  { id: 'branches', title: 'Switch branch', group: 'Branches', description: 'Choose a local or remote branch.', repo: true },
  { id: 'branch-create', title: 'Create and switch branch', group: 'Branches', description: 'Create a branch from the current commit and switch to it.', command: 'branches.create', repo: true, fields: [field('branchName', 'New branch name')] },
  read('branch-details', 'Branch maintenance', 'Branches', '/api/git/branches/details'),
  write('branch-rename', 'Rename branch', 'Branches', '/api/git/branch/rename', 'Rename a local branch; remote branches are unchanged.', [field('from', 'Current branch name'), field('to', 'New name')]),
  write('branch-upstream', 'Set upstream', 'Branches', '/api/git/branch/upstream', 'Choose the remote-tracking branch used by pull and ahead/behind indicators.', [field('branch', 'Local branch'), field('upstream', 'Upstream, for example origin/main')]),
  write('branch-pin', 'Pin or unpin branch', 'Branches', '/api/git/branch/pin', 'Keep a branch easily accessible.', [field('branch', 'Branch'), flag('pinned', 'Pin this branch')]),
  write('branch-delete', 'Delete local branch', 'Branches', '/api/git/delete-branch', 'Delete a branch. A recovery point is recorded; force also permits unmerged branches.', [field('branch', 'Branch'), flag('force', 'Delete even when unmerged')]),
  { id: 'fetch', title: 'Fetch', group: 'Sync', description: 'Get remote changes. If auto-pull is enabled and eligible, fast-forward this branch.', command: 'sync.fetch', repo: true },
  { id: 'pull', title: 'Pull latest changes', group: 'Sync', description: 'Inspect the incoming changes and integration strategy before pulling.', command: 'pull', repo: true, keywords: 'get latest download update' },
  { id: 'push', title: 'Push / Publish branch', group: 'Sync', description: 'Publish local commits using the selected account. Never force.', command: 'sync.push', repo: true },
  { id: 'auto-pull', title: 'Auto-pull', group: 'Sync', description: 'Global setting: after a fetch, fast-forward only when there are no tracked edits, local-only commits, or ongoing integrations.', command: 'auto-pull.set', fields: [flag('enabled', 'Enable auto-pull')] },
  { id: 'commit', title: 'Commit staged changes', group: 'Changes', description: 'Commit the complete index shown in the preview. Unstaged files are not included.', command: 'commit', repo: true, fields: [{ ...field('message', 'Commit message'), kind: 'multiline' }] },
  write('amend', 'Amend last commit', 'Changes', '/api/git/commit', 'Replace the last commit with the current staged contents and message. This rewrites history.', [{ ...field('message', 'Replacement commit message'), kind: 'multiline' }, { ...flag('amend', 'Amend'), value: 'true' }]),
  write('undo-commit', 'Undo last commit, keep changes', 'Recovery', '/api/git/undo-commit', 'Move back one commit while preserving its changes for editing.'),
  write('discard', 'Discard a file', 'Changes', '/api/git/discard', 'Discard selected working changes. Review the path carefully; use Safety Net for available recovery.', [field('filePath', 'Repository-relative file'), flag('isUntracked', 'This is an untracked file')]),
  write('ignore', 'Ignore a file', 'Changes', '/api/git/ignore', 'Add this path to .gitignore.', [field('filePath', 'Repository-relative file')]),
  read('history', 'Commit history', 'History', '/api/git/log'),
  read('search-commits', 'Search commits', 'History', '/api/git/search/commits', [field('query', 'Message contains', true), field('author', 'Author contains', true), field('paths', 'File path', true)]),
  read('compare', 'Compare branches or commits', 'History', '/api/git/compare', [field('base', 'Base branch or commit'), field('head', 'Other branch or commit')]),
  read('blame', 'Who changed these lines?', 'History', '/api/git/file/blame', [field('path', 'Repository-relative file')]),
  read('file-history', 'File history', 'History', '/api/git/file/history', [field('path', 'Repository-relative file')]),
  write('cherry-pick', 'Copy a commit onto this branch', 'History', '/api/git/cherry-pick', 'Apply a commit here. Conflicts may require resolution.', [field('hash', 'Commit hash')]),
  write('revert', 'Revert a commit', 'History', '/api/git/revert', 'Create a new commit undoing an earlier commit; keep published history intact.', [field('hash', 'Commit hash')]),
  write('reset', 'Reset branch to a commit', 'Recovery', '/api/git/reset', 'Soft keeps changes staged; mixed unstages them; hard discards tracked changes. A recovery point is recorded.', [field('hash', 'Target commit'), choice('mode', 'What to do with changes', ['soft', 'mixed', 'hard'])]),
  write('merge', 'Merge another branch', 'Integrate', '/api/git/merge', 'Combine another branch into this one. Preview incoming changes and recovery before proceeding.', [field('branch', 'Branch to merge')]),
  write('rebase', 'Rebase onto another branch', 'Integrate', '/api/git/rebase', 'Replay this branch’s commits on another branch. This rewrites commits; review published history first.', [field('branch', 'Branch to replay onto')]),
  read('rebase-plan', 'Plan an interactive rebase', 'Integrate', '/api/git/rebase/plan', [field('onto', 'Base commit'), choice('autosquash', 'Combine fixup commits automatically', ['false', 'true'])]),
  read('rebase-status', 'Rebase progress', 'Integrate', '/api/git/rebase/status'),
  write('rebase-step', 'Continue, skip, or abort rebase', 'Integrate', '/api/git/rebase/step', 'Continue after resolving conflicts, skip the stopped commit, or abort to restore the original branch.', [choice('step', 'Next step', ['continue', 'skip', 'abort'])]),
  write('rebase-split', 'Split the stopped commit', 'Integrate', '/api/git/rebase/split', 'Uncommit the edit-stop commit so you can stage and commit it in smaller pieces.'),
  write('abort', 'Abort merge or rebase', 'Integrate', '/api/git/abort', 'Return to the state before the integration.', [choice('type', 'Operation', ['merge', 'rebase'])]),
  write('continue', 'Continue after resolving conflicts', 'Integrate', '/api/git/conflict/continue', 'Continue the pending integration after checking all resolved files.', [choice('type', 'Operation', ['merge', 'rebase'])]),
  read('conflict', 'Inspect and resolve a conflict', 'Integrate', '/api/git/conflict/file', [field('path', 'Conflicted file')]),
  read('stashes', 'Saved changes (stashes)', 'Stash', '/api/git/stash'),
  write('stash-save', 'Stash changes for later', 'Stash', '/api/git/stash', 'Save uncommitted work and clear it from the working tree.', [field('message', 'Label', true), flag('includeUntracked', 'Include untracked files')]),
  write('stash-apply', 'Restore saved changes', 'Stash', '/api/git/stash/apply', 'Apply saved changes and keep the stash. Conflicts may require resolution.', [field('ref', 'Stash reference')]),
  write('stash-pop', 'Restore and remove stash', 'Stash', '/api/git/stash/apply', 'Apply saved changes, removing the stash only when Git succeeds.', [field('ref', 'Stash reference'), { ...flag('pop', 'Remove the stash afterwards'), value: 'true' }, flag('restoreIndex', 'Restore what was staged as staged')]),
  write('stash-branch', 'Restore stash on a new branch', 'Stash', '/api/git/stash/branch', 'Start a branch where the stash was made and apply it there, where it always applies.', [field('ref', 'Stash reference'), field('branchName', 'New branch name')]),
  write('stash-drop', 'Delete a stash', 'Stash', '/api/git/stash/drop', 'Delete this saved set of changes. Review its contents first.', [field('ref', 'Stash reference')]),
  read('worktrees', 'Worktrees', 'Worktrees', '/api/worktrees'),
  { id: 'worktree-create', title: 'Create worktree', group: 'Worktrees', command: 'worktrees.create', repo: true, description: 'Check out a branch in another folder without disturbing this workspace.', fields: [field('targetPath', 'New absolute folder'), choice('branchMode', 'Branch mode', ['new', 'existing', 'detached']), field('branch', 'Branch name', true)] },
  read('worktree-status', 'Worktree changes at a glance', 'Worktrees', '/api/worktrees/status'),
  write('worktree-lock', 'Lock a worktree', 'Worktrees', '/api/worktrees/lock', 'Protect a worktree from being pruned or removed, for example while it is on a removable drive.', [field('path', 'Worktree folder'), field('reason', 'Reason', true)]),
  write('worktree-unlock', 'Unlock a worktree', 'Worktrees', '/api/worktrees/unlock', 'Allow the worktree to be pruned or removed again.', [field('path', 'Worktree folder')]),
  write('worktree-move', 'Move a worktree', 'Worktrees', '/api/worktrees/move', 'Move a linked worktree to another folder; Git updates its registration.', [field('from', 'Current folder'), field('to', 'New folder (absolute)')]),
  write('worktree-repair', 'Repair worktree links', 'Worktrees', '/api/worktrees/repair', 'Reconnect worktrees whose folders were moved by hand.', [list('paths', 'Moved worktree folders, one per line (blank for all)', true)]),
  { id: 'worktree-remove', title: 'Remove a worktree', group: 'Worktrees', path: '/api/worktrees', method: 'DELETE', repo: true, dangerous: true, description: 'Delete a linked worktree folder. Git refuses when it has uncommitted changes unless you force it, and forced changes are gone: check its status first.', fields: [field('path', 'Worktree folder'), field('confirmName', 'Type the folder name to confirm', true), flag('force', 'Remove even with uncommitted changes')] },
  read('maintenance', 'Find stale worktrees and merged branches', 'Worktrees', '/api/maintenance/survey'),
  write('maintenance-purge', 'Purge stale worktrees', 'Worktrees', '/api/maintenance/purge-worktrees', 'Remove the chosen worktrees, and optionally their merged branches. A recovery point is recorded for the branches.', [list('paths', 'Worktree folders, one per line'), flag('deleteBranches', 'Also delete their branches'), flag('includeDirty', 'Include worktrees with uncommitted changes'), flag('forceBranchDelete', 'Delete unmerged branches too')]),
  write('patch-create', 'Create a patch', 'Patches', '/api/patches/create', 'Turn changes or commits into a patch you can send or save. Nothing in the repository changes.', [choice('source', 'From', ['working', 'staged', 'commits']), choice('format', 'Format', ['diff', 'mailbox']), field('from', 'First commit (commits only)', true), field('to', 'Last commit (commits only)', true)]),
  write('patch-apply', 'Apply a patch', 'Patches', '/api/patches/apply', 'Apply a patch to the working tree, or as commits in mailbox format. Try a dry run first.', [{ ...field('patch', 'Patch text (Ctrl+e opens your editor to paste it)'), kind: 'multiline' }, choice('mode', 'Apply as', ['working', 'commits']), flag('dryRun', 'Only check that it applies'), flag('index', 'Also stage the result'), flag('threeWay', 'Fall back to a three-way merge')]),
  read('patch-state', 'Patch series in progress', 'Patches', '/api/patches/am-state'),
  write('patch-step', 'Continue, skip or abort a patch series', 'Patches', '/api/patches/am', 'Continue after resolving, skip the patch that stopped, or abort and return to where you were.', [choice('action', 'Next step', ['continue', 'skip', 'abort'])]),
  read('pull-request-check', 'Check before opening a pull request', 'Pull requests', '/api/pull-requests/preflight', [field('headBranch', 'Branch to propose (blank for this one)', true), field('baseBranch', 'Into (blank for the default branch)', true)]),
  write('pull-request', 'Open a pull request', 'Pull requests', '/api/pull-requests', 'Open a pull request on GitHub with the GitHub CLI. Push first if the branch is not published.', [field('title', 'Title'), { ...field('body', 'Description', true), kind: 'multiline' }, field('baseBranch', 'Into (blank for the default branch)', true), flag('draft', 'Open as a draft'), flag('pushFirst', 'Push this branch first'), list('reviewers', 'Reviewers, one per line', true), list('labels', 'Labels, one per line', true)]),
  read('recovery', 'Safety Net and recovery', 'Recovery', '/api/git/recovery'),
  read('trash', 'Discarded files', 'Recovery', '/api/git/trash'),
  write('trash-restore', 'Restore discarded file', 'Recovery', '/api/git/trash/restore', 'Restore the selected saved file.', [field('id', 'Trash item ID')]),
  write('recover-branch', 'Recover commit as a new branch', 'Recovery', '/api/git/recovery/branch', 'Preserve a lost commit on a new branch without resetting current work.', [field('oid', 'Commit'), field('branchName', 'New recovery branch')]),
  write('recover-ref', 'Restore a saved ref', 'Recovery', '/api/git/recovery/restore', 'Move the selected ref back to its saved commit.', [field('pointId', 'Recovery point ID'), field('ref', 'Ref to restore')]),
  read('remotes', 'Remote repositories', 'Remotes', '/api/remotes'),
  write('remote-add', 'Add remote', 'Remotes', '/api/remotes', 'Register a remote URL.', [field('name', 'Remote name'), field('fetchUrl', 'Fetch URL'), field('pushUrl', 'Push URL', true)]),
  write('remote-update', 'Edit remote', 'Remotes', '/api/remotes/update', 'Update remote URLs.', [field('name', 'Remote name'), field('fetchUrl', 'Fetch URL'), field('pushUrl', 'Push URL', true)]),
  { id: 'remote-toggle', title: 'Switch SSH / HTTPS', group: 'Accounts', description: 'Review origin before changing authentication protocol.', command: 'remote.toggle', repo: true },
  write('remote-prune', 'Prune obsolete remote refs', 'Remotes', '/api/remotes/prune', 'Remove stale local tracking references; remote branches are not deleted.', [field('name', 'Remote')]),
  write('fetch-all', 'Fetch all remotes', 'Remotes', '/api/remotes/fetch-all', 'Refresh remote-tracking branches from every remote.', [flag('prune', 'Prune stale refs')]),
  read('tags', 'Tags', 'Tags', '/api/git/tags'),
  write('tag-create', 'Create tag', 'Tags', '/api/git/tag', 'Name a commit, optionally with an annotation and signature.', [field('name', 'Tag name'), field('hash', 'Commit (blank for HEAD)', true), field('message', 'Annotation', true), flag('sign', 'Sign tag')]),
  { id: 'tag-delete', title: 'Delete a local tag', group: 'Tags', path: '/api/git/tag', method: 'DELETE', repo: true, dangerous: true, description: 'Delete a tag here. A tag already published stays on the remote.', fields: [field('name', 'Tag name')] },
  write('tag-push', 'Publish tag', 'Tags', '/api/git/tag/push', 'Publish a tag to origin.', [field('name', 'Tag name')]),
  read('signing', 'Signing configuration', 'Signing', '/api/git/signing/status'),
  write('signing-save', 'Configure signing', 'Signing', '/api/git/signing/config', 'Choose repository-local signing settings.', [choice('mode', 'Signature type', ['none', 'ssh', 'gpg']), field('signingKey', 'Signing key', true), field('allowedSignersFile', 'Allowed signers file', true), flag('signCommitsByDefault', 'Sign commits by default'), flag('signTagsByDefault', 'Sign tags by default')]),
  read('submodules', 'Submodules', 'Submodules', '/api/submodules'),
  write('submodule-init', 'Initialize submodules', 'Submodules', '/api/submodules/init', 'Clone the registered submodules.', [list('paths', 'Selected paths (blank for all)', true)]),
  write('submodule-update', 'Update submodules', 'Submodules', '/api/submodules/update', 'Update nested repositories to the requested revision.', [list('paths', 'Paths (blank for all)', true), flag('recursive', 'Include nested submodules'), flag('init', 'Also clone ones not yet initialized')]),
  write('submodule-sync', 'Sync submodule URLs', 'Submodules', '/api/submodules/sync', 'Copy configured submodule URLs into local Git configuration.', [list('paths', 'Paths (blank for all)', true), flag('recursive', 'Include nested submodules')]),
  write('submodule-deinit', 'Deinitialize submodules', 'Submodules', '/api/submodules/deinit', 'Remove submodule checkouts. Force permits removal with local edits.', [list('paths', 'Paths (blank for all)', true), flag('force', 'Allow removal with local edits')]),
  read('lfs', 'Large file storage', 'LFS', '/api/lfs/status'),
  write('lfs-install', 'Enable or disable LFS here', 'LFS', '/api/lfs/installation', 'Change LFS hooks in this repository only.', [choice('action', 'Action', ['install', 'uninstall'])]),
  write('lfs-track', 'Track large file pattern', 'LFS', '/api/lfs/track', 'Store matching files through LFS.', [field('pattern', 'Pattern, for example *.psd')]),
  write('lfs-untrack', 'Stop tracking LFS pattern', 'LFS', '/api/lfs/untrack', 'Remove a pattern from LFS tracking.', [field('pattern', 'Pattern')]),
  write('lfs-transfer', 'Fetch, pull, or prune LFS data', 'LFS', '/api/lfs/transfer', 'Fetch downloads objects; pull also updates files; prune removes unused local objects.', [choice('action', 'Operation', ['fetch', 'pull', 'prune'])]),
  write('lfs-lock', 'Lock a large file', 'LFS', '/api/lfs/lock', 'Claim a remote LFS lock before editing.', [field('path', 'File')]),
  write('lfs-unlock', 'Unlock a large file', 'LFS', '/api/lfs/unlock', 'Release a remote LFS lock.', [field('path', 'File'), flag('force', 'Override another user’s lock')]),
  read('bisect', 'Find a regression (bisect)', 'Bisect', '/api/bisect'),
  write('bisect-start', 'Start guided bisect', 'Bisect', '/api/bisect/start', 'Git checks intermediate commits to narrow down when a bug appeared.', [field('goodRef', 'Known working commit'), field('badRef', 'Known broken commit')]),
  write('bisect-mark', 'Mark this revision', 'Bisect', '/api/bisect/mark', 'Tell Git whether the current revision works.', [choice('verdict', 'Result', ['good', 'bad', 'skip'])]),
  write('bisect-reset', 'Finish bisect and return', 'Bisect', '/api/bisect/reset', 'Return to your original branch.'),
  { id: 'bisect-run', title: 'Run saved bisect test', group: 'Bisect', description: 'Execute a saved test definition to identify the regression.', repo: true, privateMethod: 'bisect', fields: [field('commandId', 'Saved test ID')] },
  read('notes', 'Commit notes', 'Notes', '/api/notes/index'),
  read('note-read', 'Read commit note', 'Notes', '/api/notes', [field('commit', 'Commit'), field('ref', 'Notes ref', true)]),
  write('note-save', 'Write commit note', 'Notes', '/api/notes', 'Annotate a commit without rewriting it.', [field('commit', 'Commit'), { ...field('message', 'Note'), kind: 'multiline' }, field('ref', 'Notes ref', true)]),
  write('notes-sync', 'Sync commit notes', 'Notes', '/api/notes/sync', 'Fetch or publish notes independently of branch history.', [choice('direction', 'Direction', ['fetch', 'push']), { ...field('remote', 'Remote'), value: 'origin' }, field('ref', 'Notes ref', true)]),
  { id: 'accounts', title: 'Switch SSH / account', group: 'Accounts', description: 'Inspect authentication and commit author before changing accounts.', repo: true, keywords: 'change account key profile' },
  read('identity', 'Commit author identity', 'Accounts', '/api/git/identity'),
  write('identity-save', 'Set commit author', 'Accounts', '/api/git/identity', 'Set the author for this repository.', [field('name', 'Author name'), field('email', 'Author email')]),
  { id: 'ssh-verify', title: 'Verify SSH account', group: 'Accounts', description: 'Ask the SSH host which account this key authenticates as.', repo: true, command: 'ssh.verify' },
  write('ssh-save', 'Add or edit SSH profile', 'Accounts', '/api/config/ssh', 'Register an existing private key. Private key contents are never displayed.', [field('id', 'Existing profile ID', true), field('label', 'Profile label'), field('privateKeyPath', 'Private key path'), field('userName', 'Commit author name', true), field('userEmail', 'Commit author email', true)], false),
  write('ssh-rule', 'Add automatic account rule', 'Accounts', '/api/config/account-rules', 'Choose an account automatically when a remote matches this text.', [field('match', 'Remote URL contains'), field('profileId', 'Profile ID')], false),
  write('ssh-generate', 'Create SSH key and account', 'Accounts', '/api/config/ssh/generate', 'Create a new key in your SSH folder. Add the public key shown afterwards to your Git host, then verify the account.', [field('label', 'Account label'), choice('keyType', 'Key type', ['ed25519', 'rsa']), field('userName', 'Commit author name'), field('userEmail', 'Commit author email'), { name: 'passphrase', label: 'Protect key with a passphrase', kind: 'secret', optional: true }, flag('keepPassword', 'Save passphrase in the unlocked vault')], false),
  write('ssh-public', 'Show account public key', 'Accounts', '/api/config/ssh/public', 'Display only the public key to register on your Git host.', [field('profileId', 'Account profile ID')], false),
  write('ssh-default', 'Set default account', 'Accounts', '/api/config/ssh/default-account', 'Set the fallback SSH account for repositories without a pin. Changing the global author also affects other Git tools.', [field('profileId', 'Account profile ID (blank for system SSH)', true), flag('setGlobalIdentity', 'Also change global commit author')], false),
  write('application-settings', 'Git and account settings', 'System', '/api/config/settings', 'Change shared defaults used by the desktop, terminal and agents.', [flag('manageSshConfig', 'Maintain the Multi-Git SSH configuration block'), flag('isolateSshConfig', 'Isolate pinned keys from custom host configuration'), { ...field('recoveryRetentionDays', 'Recovery retention in days (0 keeps forever)'), kind: 'number' }, field('worktreeParentDir', 'Default worktree parent folder', true)], false),
  write('vault-unlock', 'Unlock passphrase vault', 'Accounts', '/api/secrets/unlock', 'Unlock saved passphrases for the shared session. The master password remains in memory only.', [{ name: 'masterKey', label: 'Vault master password', kind: 'secret' }], false),
  write('vault-lock', 'Lock vault', 'Accounts', '/api/secrets/lock', 'Forget the master key and unload SSH keys owned by this session.', [], false),
  write('ssh-load', 'Unlock/load an SSH key', 'Accounts', '/api/ssh/agent/load', 'Load a selected key into the native SSH agent.', [field('profileId', 'Profile ID'), { name: 'passphrase', label: 'Key passphrase', kind: 'secret', optional: true }, flag('savePassphrase', 'Save in unlocked vault')], false),
  read('operations', 'Operations and progress', 'System', '/api/operations', [], false),
  { id: 'operation-cancel', title: 'Cancel an operation', group: 'System', description: 'Ask the operation to stop. Remote effects may already have occurred; inspect status before retrying.', command: 'operations.cancel', fields: [field('id', 'Operation ID')] },
  { id: 'settings', title: 'Settings', group: 'System', description: 'Appearance, keyboard, syncing, accounts, and dependencies.' },
  read('doctor', 'Check dependencies', 'System', '/api/tools/prerequisites', [], false),
  read('agents', 'Configured agents', 'Tools', '/api/agents', [], false),
  write('agents-detect', 'Discover installed agents', 'Tools', '/api/agents/detect', 'Add detected agent definitions; does not launch them.', [], false),
  { id: 'agent-launch', title: 'Launch a configured agent', group: 'Tools', description: 'Start the selected saved agent in this worktree.', privateMethod: 'agent', repo: true, fields: [field('agentId', 'Saved agent ID'), field('initialPrompt', 'Initial prompt', true)] },
  read('tools', 'Configured tools', 'Tools', '/api/tools', [], false),
  write('tools-detect', 'Discover installed tools', 'Tools', '/api/tools/detect', 'Add installed editors and diff/merge tools.', [], false),
  { id: 'editor', title: 'Open repository in editor', group: 'Tools', description: 'Open the configured repository editor.', privateMethod: 'editor', repo: true },
  { id: 'tool-launch', title: 'Open configured tool', group: 'Tools', description: 'Launch a saved tool definition.', privateMethod: 'tool', repo: true, fields: [choice('kind', 'Tool kind', ['diff', 'merge', 'editor', 'terminal', 'file-manager']), field('toolId', 'Saved tool ID', true)] }
];

export function parseFields(fields: Field[], values: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of fields) {
    const value = values[entry.name] ?? entry.value ?? (entry.kind === 'boolean' ? 'false' : entry.choices?.[0] ?? '');
    if (!value && entry.optional && !entry.allowEmpty) continue;
    if (!value && !entry.optional && !entry.allowEmpty) throw new Error(`${entry.label} is required.`);
    if (entry.choices && !entry.choices.includes(value)) throw new Error(`Choose a listed value for ${entry.label}.`);
    result[entry.name] = entry.kind === 'boolean' ? value === 'true' : entry.kind === 'number' ? Number(value) : entry.kind === 'list' ? value.split('\n').map((item) => item.trim()).filter(Boolean) : value;
  }
  return result;
}
