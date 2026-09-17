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
  | 'worktree-create';

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
  }
};
