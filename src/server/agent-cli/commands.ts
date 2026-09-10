export interface AgentCommand {
  method: 'GET' | 'POST';
  path: string;
  repo: boolean;
  description: string;
  input: Record<string, string>;
}

export const commands: Record<string, AgentCommand> = {
  'app.info': { method: 'GET', path: '/api/app-info', repo: false, description: 'Identify the running app.', input: {} },
  'repositories.list': { method: 'GET', path: '/api/github/repositories', repo: false, description: 'List up to 100 owned GitHub repositories using gh authentication.', input: { owner: 'optional GitHub user or organization' } },
  'repo.clone': { method: 'POST', path: '/api/git/clone', repo: false, description: 'Clone into an existing parent directory.', input: { url: 'required remote URL', parentDir: 'required absolute parent directory', folderName: 'optional child folder name', profileId: 'optional SSH profile id' } },
  'repo.remember': { method: 'POST', path: '/api/config/repo', repo: false, description: 'Remember a local repository in recent repositories.', input: { repoPath: 'required absolute repository path' } },
  'status': { method: 'GET', path: '/api/git/status', repo: true, description: 'Read branch and working tree status.', input: {} },
  'branches.list': { method: 'GET', path: '/api/git/branches', repo: true, description: 'List local and remote branches.', input: {} },
  'branches.create': { method: 'POST', path: '/api/git/create-branch', repo: true, description: 'Create and check out a new branch.', input: { branchName: 'required new branch name' } },
  'branches.checkout': { method: 'POST', path: '/api/git/checkout', repo: true, description: 'Check out an existing branch.', input: { branch: 'required branch name', isRemote: 'optional boolean' } },
  'diff': { method: 'GET', path: '/api/git/diff/structured', repo: true, description: 'Read a structured diff before staging.', input: { path: 'required repository-relative path', source: 'working-tree or index' } },
  'stage': { method: 'POST', path: '/api/git/stage', repo: true, description: 'Stage explicitly selected files.', input: { files: 'required array of repository-relative paths' } },
  'unstage': { method: 'POST', path: '/api/git/unstage', repo: true, description: 'Unstage explicitly selected files.', input: { files: 'required array of repository-relative paths' } },
  'commit': { method: 'POST', path: '/api/git/commit', repo: true, description: 'Commit the current index.', input: { message: 'required commit message' } },
  'fetch': { method: 'POST', path: '/api/git/fetch', repo: true, description: 'Fetch origin and prune remote-tracking refs.', input: { profileId: 'optional SSH profile id' } },
  'push': { method: 'POST', path: '/api/git/push', repo: true, description: 'Push to origin and establish tracking; never force.', input: { branch: 'optional branch name', profileId: 'optional SSH profile id' } },
  'worktrees.list': { method: 'GET', path: '/api/worktrees', repo: true, description: 'List worktrees.', input: {} },
  'worktrees.create': { method: 'POST', path: '/api/worktrees', repo: true, description: 'Create a worktree.', input: { targetPath: 'required absolute path', branchMode: 'new, existing or detached', branch: 'branch name' } },
  'recovery.list': { method: 'GET', path: '/api/git/recovery', repo: true, description: 'Read durable recovery points and reflog.', input: {} },
  'agents.list': { method: 'GET', path: '/api/agents', repo: false, description: 'List configured agent launchers.', input: {} }
};
