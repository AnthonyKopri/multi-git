// GitHub, through the `gh` CLI.
//
// The CLI rather than the REST API, deliberately: Multi-Git stores no token
// anywhere, and `gh` already holds the user's own credentials with their own
// scopes. Adding token storage would make this app a credential target for a
// feature the user's existing tooling already authenticates.
//
// Everything goes through the injectable runner, so every case below — no CLI,
// expired auth, protected branch, duplicate PR — is testable without a GitHub
// account.
import fs from 'node:fs';
import path from 'node:path';

import { executableRunner } from '../process/runner';
import type { ExecutableRunner } from '../process/runner';
import { CommandFailedError, CommandSpawnError } from '../process/runner';
import { parseRemoteUrl } from '../git/remote';
import type {
  HostingProvider,
  HostingProviderCapabilities,
  ProviderAvailability
} from '../../shared/provider-types';

const GH_TIMEOUT_MS = 60_000;

/** Keeps gh from colouring output or trying to open a browser prompt. */
const GH_ENV: NodeJS.ProcessEnv = {
  NO_COLOR: '1',
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1'
};

export const GITHUB_CAPABILITIES: HostingProviderCapabilities = {
  createPullRequest: true,
  listPullRequests: false,
  reviewPullRequest: false,
  commitChecks: false,
  createRepository: true
};

/** Recognises github.com and GitHub Enterprise hosts. */
export function isGithubRemote(remoteUrl: string | null | undefined): boolean {
  const host = parseRemoteUrl(remoteUrl)?.host;
  if (!host) {
    return false;
  }

  return host === 'github.com' || host.startsWith('github.') || host.includes('.github.');
}

/** `owner/repo` from a remote URL, or null when it is not parseable. */
export function ownerRepoFromRemote(remoteUrl: string | null | undefined): string | null {
  const repoPath = parseRemoteUrl(remoteUrl)?.repoPath;
  if (!repoPath) {
    return null;
  }

  const segments = repoPath.replace(/\.git$/i, '').split('/').filter(Boolean);
  return segments.length >= 2 ? segments.slice(-2).join('/') : null;
}

export interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Set when gh itself could not be run. */
  missing: boolean;
}

/**
 * Runs gh without throwing.
 *
 * Every interesting outcome here — not installed, not signed in, branch
 * protected, PR already exists — arrives as a non-zero exit with a message,
 * and each needs different handling. Turning them all into an exception first
 * would mean unwrapping them again immediately.
 */
export async function runGh(
  args: readonly string[],
  options: { cwd?: string; input?: string; runner?: ExecutableRunner } = {}
): Promise<GhResult> {
  const runner = options.runner ?? executableRunner;

  try {
    const result = await runner.run('gh', args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.input ? { input: options.input } : {}),
      env: { ...process.env, ...GH_ENV },
      timeoutMs: GH_TIMEOUT_MS
    });

    return {
      ok: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      missing: false
    };
  } catch (error) {
    if (error instanceof CommandSpawnError) {
      return { ok: false, stdout: '', stderr: error.message, exitCode: -1, missing: true };
    }
    if (error instanceof CommandFailedError) {
      return {
        ok: false,
        stdout: error.result.stdout,
        stderr: error.result.stderr,
        exitCode: error.result.exitCode,
        missing: false
      };
    }

    return {
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: -1,
      missing: false
    };
  }
}

/**
 * The last meaningful line of gh's diagnostics.
 *
 * gh prefixes errors with a banner and sometimes appends a "Try this" hint;
 * the actionable sentence is the last non-empty line.
 */
export function ghErrorMessage(result: GhResult, fallback: string): string {
  const line = `${result.stderr}\n${result.stdout}`
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && !/^[-=]+$/.test(entry))
    .pop();

  return line ?? fallback;
}

export async function checkGithubAvailability(
  runner?: ExecutableRunner
): Promise<ProviderAvailability> {
  const version = await runGh(['--version'], { ...(runner ? { runner } : {}) });

  if (version.missing || !version.ok) {
    return {
      available: false,
      reason: 'not-installed',
      message:
        'GitHub CLI (gh) was not found on PATH. Install it from cli.github.com to create pull requests from Multi-Git.'
    };
  }

  const auth = await runGh(['auth', 'status'], { ...(runner ? { runner } : {}) });

  if (!auth.ok) {
    return {
      available: false,
      reason: 'not-authenticated',
      version: (version.stdout.split('\n')[0] ?? '').trim(),
      message: 'GitHub CLI is installed but not signed in. Run "gh auth login" and try again.'
    };
  }

  return {
    available: true,
    // gh has moved this between stdout and stderr across versions.
    account: /account\s+([A-Za-z0-9-]+)/i.exec(`${auth.stdout}\n${auth.stderr}`)?.[1] ?? null,
    version: (version.stdout.split('\n')[0] ?? '').trim()
  };
}

/**
 * The repository's pull-request template, if it has one.
 *
 * GitHub looks in these locations, and so does this. Only the single-template
 * form is used; a `PULL_REQUEST_TEMPLATE/` directory offers a choice that
 * belongs in the UI rather than being picked arbitrarily here.
 */
export function readPullRequestTemplate(repoPath: string): string | null {
  const candidates = [
    '.github/pull_request_template.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'docs/pull_request_template.md',
    'docs/PULL_REQUEST_TEMPLATE.md',
    'pull_request_template.md',
    'PULL_REQUEST_TEMPLATE.md'
  ];

  for (const candidate of candidates) {
    const full = path.join(repoPath, candidate);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return fs.readFileSync(full, 'utf8');
      }
    } catch {
      // An unreadable template is not worth failing the whole preflight for.
    }
  }

  return null;
}

export const githubProvider: HostingProvider = {
  id: 'github',
  displayName: 'GitHub',
  capabilities: GITHUB_CAPABILITIES,
  handlesRemote: isGithubRemote,
  checkAvailability: () => checkGithubAvailability()
};
