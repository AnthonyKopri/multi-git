// The contract a code-hosting provider implements. No provider implements it
// yet — Phase 1 brings GitHub through the `gh` CLI, and Phase 5 the rest.
//
// It exists now, empty, for one reason: the alternative is Phase 1 writing
// GitHub-shaped functions straight into the routes, and Phase 5 then having to
// extract an interface from working code while adding four providers to it.
// Declaring the seam before the first implementation is what keeps `gh`
// specifics from leaking into the request handlers.
//
// Capabilities are declared rather than discovered. Providers differ in what
// they support, and a UI that offers a button the provider cannot honour is
// worse than one that hides it.

export type HostingProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'gitea';

export interface HostingProviderCapabilities {
  createPullRequest: boolean;
  listPullRequests: boolean;
  reviewPullRequest: boolean;
  /** CI status attached to a commit or pull request. */
  commitChecks: boolean;
  createRepository: boolean;
}

/** Why a provider cannot be used right now, if it cannot. */
export type ProviderUnavailableReason = 'not-installed' | 'not-authenticated' | 'unsupported-host';

export interface ProviderAvailability {
  available: boolean;
  reason?: ProviderUnavailableReason;
  /** The signed-in account, when there is one. Never a token. */
  account?: string | null;
  /** Version of the backing CLI or API, for diagnostics. */
  version?: string | null;
  /** Actionable text for the user, such as how to authenticate. */
  message?: string;
}

export interface HostingProvider {
  readonly id: HostingProviderId;
  /** Shown in the UI, such as "GitHub". */
  readonly displayName: string;
  readonly capabilities: HostingProviderCapabilities;

  /**
   * Whether this provider handles a remote.
   *
   * Takes the URL rather than a parsed host so a provider can recognise its
   * own self-hosted deployments, which share no common host name.
   */
  handlesRemote(remoteUrl: string): boolean;

  /** Checked before any operation is offered. Must not prompt or block long. */
  checkAvailability(): Promise<ProviderAvailability>;
}
