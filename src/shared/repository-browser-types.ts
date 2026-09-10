export interface HostedRepository {
  nameWithOwner: string;
  description: string;
  url: string;
  sshUrl: string;
  isPrivate: boolean;
  isArchived: boolean;
}

export interface RepositoryBrowserResponse {
  success: true;
  repositories: HostedRepository[];
  limit: number;
  atLimit: boolean;
}
