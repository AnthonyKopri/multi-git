// What the rest of the application needs to know about a code host.
//
// This began as an interface plus a registry, declared ahead of any
// implementation so that adding a second host would not mean extracting a seam
// from working code. Nothing ever registered anything: GitHub is reached
// directly through isGithubRemote and checkGithubAvailability, and the registry
// sat empty from the day it was written until the day it was deleted. What is
// left is what is actually used -- the identifier a pull request carries, and
// the shape of "can this host be used right now".
//
// Bring the seam back alongside the second host, where two real cases can
// decide its shape instead of one guess.

export type HostingProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'gitea';

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
