// What the Agents panel says about a launch. Words only, no DOM.
import type { AgentLaunchState, AgentLaunchView } from '../../../shared/agent-types';

/** A launch this recent is still having its process looked for. */
export const STARTING_MS = 12_000;

/** `D:\work\api-login` → `api-login`, with the full path left for the tooltip. */
export function folderName(folder: string): string {
  const parts = folder.split(/[\\/]+/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? folder;
}

export interface StatusText {
  label: string;
  /** A sentence under the entry, when the state needs one. */
  note?: string;
}

/**
 * What a state is called, and what there is to say about it.
 *
 * "Running" and "Finished" are claims about a process existing and nothing
 * more. A launch whose process was never found gets neither: it says so, and
 * says how to stop it by hand.
 */
export function describeState(run: AgentLaunchView, now: number): StatusText {
  const labels: Record<Exclude<AgentLaunchState, 'untracked' | 'failed'>, string> = {
    running: 'Running',
    finished: 'Finished',
    stopped: 'Stopped'
  };

  if (run.state === 'failed') {
    return { label: 'Did not start', ...(run.error ? { note: run.error } : {}) };
  }

  if (run.state === 'untracked') {
    if (run.id !== undefined && now - Date.parse(run.at) < STARTING_MS) {
      return { label: 'Starting' };
    }
    return {
      label: 'Started',
      note: 'Multi-Git could not find this one’s program afterwards, so it cannot say whether it is still running. To stop it, close its window.'
    };
  }

  return { label: labels[run.state] };
}

/** How many launches are known to be running. */
export function countRunning(list: readonly AgentLaunchView[]): number {
  return list.filter((run) => run.state === 'running').length;
}
