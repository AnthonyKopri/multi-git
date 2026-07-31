// Recognises the remote URL shapes this app can rewrite between SSH and HTTPS.
import type { ParsedRemote } from '../../shared/git-types';

export function isLikelyHttpRemote(remoteUrl: string | null | undefined): boolean {
  if (!remoteUrl) {
    return false;
  }

  return /^https?:\/\//i.test(remoteUrl.trim());
}

/**
 * Classifies a remote URL. URLs with embedded credentials, a custom SSH user
 * or port, or a non-URL path are reported as 'other' with null fields, so the
 * protocol toggle never rewrites something it cannot round-trip safely.
 */
export function parseRemoteUrl(remoteUrl: string | null | undefined): ParsedRemote | null {
  if (!remoteUrl || typeof remoteUrl !== 'string') {
    return null;
  }

  const trimmed = remoteUrl.trim();

  const httpsMatch = trimmed.match(/^https?:\/\/([^/@:]+)\/(.+?)(\.git)?\/?$/i);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { protocol: 'https', host: httpsMatch[1].toLowerCase(), repoPath: httpsMatch[2] };
  }

  // scp-like syntax: git@host:owner/repo.git
  const scpMatch = trimmed.match(/^git@([^/:]+):(.+?)(\.git)?$/i);
  if (scpMatch?.[1] && scpMatch[2]) {
    return { protocol: 'ssh', host: scpMatch[1].toLowerCase(), repoPath: scpMatch[2] };
  }

  // ssh:// URLs: only the plain git@host form, with no port, is toggle-safe.
  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@([^/:]+)\/(.+?)(\.git)?\/?$/i);
  if (sshUrlMatch?.[1] && sshUrlMatch[2]) {
    return { protocol: 'ssh', host: sshUrlMatch[1].toLowerCase(), repoPath: sshUrlMatch[2] };
  }

  return { protocol: 'other', host: null, repoPath: null };
}

/** The same repository addressed over the other protocol, or null if unknown. */
export function getToggledRemoteUrl(remoteUrl: string | null | undefined): string | null {
  const parsed = parseRemoteUrl(remoteUrl);
  if (!parsed?.host || !parsed.repoPath) {
    return null;
  }

  if (parsed.protocol === 'https') {
    return `git@${parsed.host}:${parsed.repoPath}.git`;
  }
  if (parsed.protocol === 'ssh') {
    return `https://${parsed.host}/${parsed.repoPath}.git`;
  }

  return null;
}
