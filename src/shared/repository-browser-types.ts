export interface HostedRepository {
  nameWithOwner: string;
  description: string;
  url: string;
  sshUrl: string;
  isPrivate: boolean;
  isArchived: boolean;
  /** Size on GitHub in KiB, when it says. Close to what a clone downloads. */
  diskUsage?: number;
}

export interface RepositoryBrowserResponse {
  success: true;
  repositories: HostedRepository[];
  limit: number;
  atLimit: boolean;
}
