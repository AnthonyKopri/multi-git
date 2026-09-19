// What the backend does only for clients holding its token.
//
// Launching programs and writing the desktop's own settings used to happen in
// the Electron main process, deliberately off the loopback HTTP port: anything
// on the machine can reach that port, and a request there must never be able
// to start a program. Moving the work into the shared backend keeps that line.
// These methods are reachable only over the private control channel, and each
// takes a fixed shape of input, never a command line.
import fs from 'node:fs';
import path from 'node:path';

import { readConfig, writeConfig } from '../config/store';
import { resolveRepoPath } from '../middleware/repo-path';
import {
  availableShells,
  installPrerequisite,
  launchAgent,
  openEditorAt,
  openShellAt,
  openTerminalAt
} from '../agents/service';
import { launchTool } from '../tools/launch';
import { runBisect } from '../git/bisect';
import { withRepoLock } from '../git/lock';
import type { ExternalToolKind } from '../../shared/config-types';
import { runtimeDirectory } from './connection';
import { defaultPreferences, validatePreferences } from '../terminal/preferences';
import type { TerminalPreferences } from '../terminal/preferences';

const VERSION = /^\d+\.\d+\.\d+$/;

function preferencesPath(): string {
  return path.join(runtimeDirectory(), 'terminal-preferences.json');
}

function readPreferences(): TerminalPreferences {
  try {
    const saved = JSON.parse(fs.readFileSync(preferencesPath(), 'utf8')) as unknown;
    return validatePreferences(saved) === null ? (saved as TerminalPreferences) : defaultPreferences();
  } catch {
    return defaultPreferences();
  }
}

function writePreferences(input: unknown): TerminalPreferences {
  const problem = validatePreferences(input);
  if (problem) {
    throw new Error(problem);
  }
  const target = preferencesPath();
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(input), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
  return input as TerminalPreferences;
}

/**
 * The few fields the desktop app records about itself. A fixed list, so this
 * is not a way to replace the configuration wholesale.
 */
function writeDesktopState(input: Record<string, unknown>): true {
  const config = readConfig();

  if (input['windowState'] && typeof input['windowState'] === 'object') {
    config.windowState = input['windowState'] as typeof config.windowState;
  }
  if (typeof input['shellIntegration'] === 'boolean') {
    config.shellIntegration = { contextMenuInstalled: input['shellIntegration'] };
  }
  if (typeof input['skippedUpdateVersion'] === 'string' && VERSION.test(input['skippedUpdateVersion'])) {
    config.settings = {
      ...(config.settings ?? { manageSshConfig: false }),
      skippedUpdateVersion: input['skippedUpdateVersion']
    };
  }

  writeConfig(config);
  return true;
}

export async function privateMethod(method: string, input: Record<string, unknown>): Promise<unknown> {
  const repo = (): string => resolveRepoPath(String(input['repoPath'] ?? ''));

  switch (method) {
    case 'config.read':
      return readConfig();
    case 'config.desktop':
      return writeDesktopState(input);
    case 'preferences.read':
      return readPreferences();
    case 'preferences.write':
      return writePreferences(input);
    case 'shells':
      return availableShells();
    case 'terminal':
      return openTerminalAt(repo());
    case 'shell':
      return openShellAt(repo(), input['kind'] === 'git-bash' ? 'git-bash' : 'terminal');
    case 'editor':
      return openEditorAt(repo());
    case 'prerequisite':
      // Checked against a fixed table in the service.
      return installPrerequisite(String(input['id'] ?? ''));
    case 'agent': {
      // The agent is picked by id from the saved configuration, so the caller
      // never names a program to run.
      const worktreePath = resolveRepoPath(String(input['worktreePath'] ?? input['repoPath'] ?? ''));
      return launchAgent({
        repoPath: worktreePath,
        worktreePath,
        agentId: String(input['agentId'] ?? ''),
        ...(typeof input['initialPrompt'] === 'string' ? { initialPrompt: input['initialPrompt'] } : {}),
        ...(typeof input['modelId'] === 'string' ? { modelId: input['modelId'] } : {})
      });
    }
    case 'tool': {
      const placeholders =
        input['placeholders'] && typeof input['placeholders'] === 'object'
          ? Object.fromEntries(
              Object.entries(input['placeholders'] as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string'
              )
            )
          : {};
      return launchTool({
        repoPath: repo(),
        kind: String(input['kind'] ?? '') as ExternalToolKind,
        ...(typeof input['toolId'] === 'string' ? { toolId: input['toolId'] } : {}),
        placeholders
      });
    }
    case 'bisect': {
      const definition = (readConfig().bisectCommands ?? []).find(
        (candidate) => candidate.id === input['commandId']
      );
      if (!definition) {
        throw new Error('That test command is not one of the saved ones.');
      }
      const folder = repo();
      return withRepoLock(folder, () => runBisect(folder, definition));
    }
    default:
      throw new Error(`Unknown backend method: ${method}`);
  }
}
