// Launching an external coding agent in a worktree.
//
// The product boundary this file is written to: Multi-Git starts a program the
// user configured, in the folder they chose, with the account they selected
// already usable. It does not install hooks, read the tool's session state, or
// report what the tool is doing. `launched` means the process started — no
// more is claimed anywhere in this application.

import type { ExternalAgentDefinition } from './config-types';

export type { ExternalAgentDefinition };

export interface AgentLaunchInput {
  repoPath: string;
  worktreePath: string;
  agentId: string;
  /** Optional first instruction. Passed as one argv element, never a string
   *  the shell would parse. Not written to launch history. */
  initialPrompt?: string;
  /**
   * A model preset from the definition's catalogue entry.
   *
   * An id, like `agentId` is, and for the same reason: the arguments and the
   * environment it stands for come from the table compiled into this build,
   * so a page cannot name a flag or a base URL of its own. An id the entry
   * does not have is ignored rather than refused — the tool's own default is
   * always a valid thing to launch.
   */
  modelId?: string;
}

export interface AgentLaunchResult {
  launched: boolean;
  processId?: number;
  /** The command as it would read in the Terminal Log. Never includes the prompt. */
  commandPreview: string;
  error?: string;
  /** Why pushing from the launched agent might not work, when it might not. */
  sshWarning?: string;
}

/**
 * One entry of the known-agent catalogue, as this machine finds it.
 *
 * Every entry is reported, installed or not, so the interface can show what a
 * tool is and where to get it rather than leaving a gap where an uninstalled
 * one would be. `installed` is the field that decides whether a definition can
 * be seeded from it.
 */
export interface DetectedAgent {
  id: string;
  label: string;
  vendor: string;
  summary: string;
  homepage: string;
  executable: string;
  /** Absolute path the lookup resolved to, or '' when it is not installed. */
  resolvedPath: string;
  installed: boolean;
  /** True when a definition for it already exists. */
  configured: boolean;
  /** True when the entry offers model presets. */
  hasModels: boolean;
}

export interface AgentDetectResponse {
  success: true;
  detected: DetectedAgent[];
  /** False in browser mode, where nothing can be launched. */
  canLaunch: boolean;
}

/** How ready the selected SSH identity is for a folder about to be handed over. */
export interface AgentSshReadiness {
  /** '' when the family uses the System profile. */
  profileId: string;
  profileLabel: string;
  /** True when the repository family is pinned to the selected key. */
  pinned: boolean;
  /** True when the key is loaded in the agent. */
  keyLoaded: boolean;
  /** Present when something would stop the agent pushing. */
  warning?: string;
}
