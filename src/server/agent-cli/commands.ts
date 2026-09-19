/** Stable application-level effects; these are descriptive, not permission grants. */
export type LocalEffect =
  | 'app-config'
  | 'repository-create'
  | 'index'
  | 'local-history'
  | 'local-refs'
  | 'head'
  | 'working-tree'
  | 'repo-config'
  | 'object-database'
  | 'ref-prune'
  | 'worktree-create'
  | 'ssh-agent'
  | 'operation-control';

/**
 * Conservative possible effects across supported inputs, not an execution forecast.
 * Excludes incidental logging/caching and arbitrary hooks or external helpers.
 */
export interface CommandEffects {
  readonly mutates: boolean;
  readonly local: readonly LocalEffect[];
  readonly remote: 'none' | 'read' | 'write';
}

export interface AgentCommand {
  method: 'GET' | 'POST';
  path: string;
  repo: boolean;
  description: string;
  input: Record<string, string>;
  effects: CommandEffects;
}

export const commands: Record<string, AgentCommand> = {
  'app.info': {
    method: 'GET', path: '/api/app-info', repo: false, description: 'Identify the running app.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'repositories.list': {
    method: 'GET', path: '/api/github/repositories', repo: false, description: 'List up to 100 owned GitHub repositories using gh authentication.', input: { owner: 'optional GitHub user or organization' },
    effects: { mutates: false, local: [], remote: 'read' }
  },
  'repo.clone': {
    method: 'POST', path: '/api/git/clone', repo: false, description: 'Clone into an existing parent directory.', input: { url: 'required remote URL', parentDir: 'required absolute parent directory', folderName: 'optional child folder name', profileId: 'optional SSH profile id' },
    effects: { mutates: true, local: ['repository-create'], remote: 'read' }
  },
  'repo.remember': {
    method: 'POST', path: '/api/config/repo', repo: false, description: 'Remember a local repository in recent repositories.', input: { repoPath: 'required absolute repository path' },
    effects: { mutates: true, local: ['app-config'], remote: 'none' }
  },
  'status': {
    method: 'GET', path: '/api/git/status', repo: true, description: 'Read branch and working tree status.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'branches.list': {
    method: 'GET', path: '/api/git/branches', repo: true, description: 'List local and remote branches.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'branches.create': {
    method: 'POST', path: '/api/git/create-branch', repo: true, description: 'Create and check out a new branch.', input: { branchName: 'required new branch name' },
    effects: { mutates: true, local: ['local-refs', 'head', 'index', 'working-tree', 'repo-config'], remote: 'none' }
  },
  'branches.checkout': {
    method: 'POST', path: '/api/git/checkout', repo: true, description: 'Check out an existing branch.', input: { branch: 'required branch name', isRemote: 'optional boolean' },
    effects: { mutates: true, local: ['local-refs', 'head', 'index', 'working-tree', 'repo-config'], remote: 'none' }
  },
  'diff': {
    method: 'GET', path: '/api/git/diff/structured', repo: true, description: 'Read a structured diff before staging.', input: { path: 'required repository-relative path', source: 'working-tree or index' },
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'stage': {
    method: 'POST', path: '/api/git/stage', repo: true, description: 'Stage explicitly selected files.', input: { files: 'required array of repository-relative paths' },
    effects: { mutates: true, local: ['index'], remote: 'none' }
  },
  'unstage': {
    method: 'POST', path: '/api/git/unstage', repo: true, description: 'Unstage explicitly selected files.', input: { files: 'required array of repository-relative paths' },
    effects: { mutates: true, local: ['index'], remote: 'none' }
  },
  'commit': {
    method: 'POST', path: '/api/git/commit', repo: true, description: 'Commit the current index.', input: { message: 'required commit message' },
    effects: { mutates: true, local: ['index', 'local-history'], remote: 'none' }
  },
  'fetch': {
    method: 'POST', path: '/api/git/fetch', repo: true, description: 'Fetch origin and prune remote-tracking refs.', input: { profileId: 'optional SSH profile id' },
    effects: { mutates: true, local: ['object-database', 'local-refs', 'ref-prune'], remote: 'read' }
  },
  'push': {
    method: 'POST', path: '/api/git/push', repo: true, description: 'Push to origin and establish tracking; never force.', input: { branch: 'optional branch name', profileId: 'optional SSH profile id' },
    effects: { mutates: true, local: ['local-refs', 'repo-config'], remote: 'write' }
  },
  'worktrees.list': {
    method: 'GET', path: '/api/worktrees', repo: true, description: 'List worktrees.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'worktrees.create': {
    method: 'POST', path: '/api/worktrees', repo: true, description: 'Create a worktree.', input: { targetPath: 'required absolute path', branchMode: 'new, existing or detached', branch: 'branch name' },
    effects: { mutates: true, local: ['worktree-create', 'local-refs', 'repo-config'], remote: 'none' }
  },
  'recovery.list': {
    method: 'GET', path: '/api/git/recovery', repo: true, description: 'Read durable recovery points and reflog.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'agents.list': {
    method: 'GET', path: '/api/agents', repo: false, description: 'List configured agent launchers.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'repositories.local': {
    method: 'GET', path: '/api/workflows/repositories', repo: false, description: 'List remembered local repositories.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'history': {
    method: 'GET', path: '/api/git/log', repo: true, description: 'Read commit history, newest first.', input: { limit: 'optional integer 1-500, default 50', skip: 'optional non-negative integer' },
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'sync.fetch': {
    method: 'POST', path: '/api/workflows/fetch', repo: true, description: 'Fetch origin; when auto-pull is on and the branch is purely behind with no local edits, fast-forward it. Reports autoPull as off, current, blocked with a reason, or pulled.', input: { profileId: 'optional SSH profile id' },
    effects: { mutates: true, local: ['object-database', 'local-refs', 'ref-prune', 'head', 'index', 'working-tree'], remote: 'read' }
  },
  'pull': {
    method: 'POST', path: '/api/workflows/pull', repo: true, description: 'Pull the upstream. A fast-forward proceeds; a merge or rebase answers DECISION_REQUIRED until confirmed.', input: { profileId: 'optional SSH profile id', confirmed: 'optional true after the user reviewed the incoming and outgoing commits' },
    effects: { mutates: true, local: ['object-database', 'local-refs', 'head', 'index', 'working-tree', 'local-history'], remote: 'read' }
  },
  'sync.push': {
    method: 'POST', path: '/api/workflows/push', repo: true, description: 'Push the current branch, or publish it when it has no upstream; never force. A key that signs in as an unexpected account answers DECISION_REQUIRED until confirmed.', input: { profileId: 'optional SSH profile id', confirmed: 'optional true after the user accepted the account' },
    effects: { mutates: true, local: ['local-refs', 'repo-config', 'app-config'], remote: 'write' }
  },
  'auto-pull.get': {
    method: 'GET', path: '/api/workflows/auto-pull', repo: false, description: 'Read the global auto-pull setting (off by default).', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'auto-pull.set': {
    method: 'POST', path: '/api/workflows/auto-pull', repo: false, description: 'Turn global auto-pull on or off. It only ever fast-forwards, after a sync.fetch.', input: { enabled: 'required boolean' },
    effects: { mutates: true, local: ['app-config'], remote: 'none' }
  },
  'ssh.profiles': {
    method: 'GET', path: '/api/workflows/ssh/profiles', repo: false, description: 'List SSH profiles; no secrets.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'ssh.inspect': {
    method: 'GET', path: '/api/workflows/ssh', repo: true, description: 'Show the repository account and author setup, and whether switching to a profile would overwrite it.', input: { profileId: 'optional profile id; default is the current one' },
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'ssh.select': {
    method: 'POST', path: '/api/workflows/ssh', repo: true, description: 'Switch the repository to an SSH profile and its author, keeping custom SSH commands. Overwriting an existing setup answers DECISION_REQUIRED until confirmed.', input: { profileId: 'required profile id, or empty string for System SSH', confirmed: 'optional true after ssh.inspect was reviewed', keepIdentity: 'optional boolean: keep the current commit author' },
    effects: { mutates: true, local: ['app-config', 'repo-config', 'ssh-agent'], remote: 'none' }
  },
  'ssh.verify': {
    method: 'POST', path: '/api/workflows/ssh/verify', repo: true, description: 'Ask the SSH host which account the profile signs in as, and remember it.', input: { profileId: 'optional profile id; default is the current one' },
    effects: { mutates: true, local: ['app-config'], remote: 'read' }
  },
  'remote.inspect': {
    method: 'GET', path: '/api/git/remote/origin', repo: true, description: 'Show origin, its protocol, and the SSH/HTTPS URL it would switch to.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'remote.toggle': {
    method: 'POST', path: '/api/workflows/remote', repo: true, description: 'Switch origin between SSH and HTTPS. Answers DECISION_REQUIRED until confirmed.', input: { confirmed: 'required true after remote.inspect was reviewed' },
    effects: { mutates: true, local: ['repo-config'], remote: 'none' }
  },
  'operations.list': {
    method: 'GET', path: '/api/operations', repo: false, description: 'List running and recent backend operations.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  },
  'operations.cancel': {
    method: 'POST', path: '/api/operations/cancel', repo: false, description: 'Ask an operation to stop. A remote may already have received part of it; inspect status before retrying.', input: { id: 'required operation id' },
    effects: { mutates: true, local: ['operation-control'], remote: 'none' }
  },
  'doctor': {
    method: 'GET', path: '/api/tools/prerequisites', repo: false, description: 'Check Git and optional tools.', input: {},
    effects: { mutates: false, local: [], remote: 'none' }
  }
};
