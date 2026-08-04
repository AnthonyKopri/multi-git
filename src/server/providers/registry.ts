// Where hosting providers register themselves. Empty until Phase 1.
//
// A registry rather than a switch on the remote host: the resolution order and
// the "no provider handles this remote" case get written once, here, instead
// of at each call site that wants to know whether it can offer a pull request.
import type { HostingProvider, HostingProviderId } from '../../shared/provider-types';

const providers = new Map<HostingProviderId, HostingProvider>();

export function registerHostingProvider(provider: HostingProvider): void {
  providers.set(provider.id, provider);
}

export function getHostingProvider(id: HostingProviderId): HostingProvider | null {
  return providers.get(id) ?? null;
}

export function listHostingProviders(): HostingProvider[] {
  return [...providers.values()];
}

/**
 * The provider for a remote, or null when none claims it.
 *
 * Null is an ordinary answer, not an error: a repository with no remote, or
 * one on a host nobody implements, still works for everything local.
 */
export function providerForRemote(remoteUrl: string | null | undefined): HostingProvider | null {
  if (!remoteUrl) {
    return null;
  }

  return listHostingProviders().find((provider) => provider.handlesRemote(remoteUrl)) ?? null;
}

/** Empties the registry. Used by tests. */
export function clearHostingProviders(): void {
  providers.clear();
}
