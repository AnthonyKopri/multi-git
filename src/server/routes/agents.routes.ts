// External agent definitions over HTTP.
//
// There is deliberately no launch route here. Reading, writing and detecting
// definitions is safe to answer on a loopback port; starting a program is not,
// so that lives behind the Electron IPC bridge in src/main/main.ts and is
// unavailable in browser mode. Anything added to this file should be checked
// against that line.
import { Router } from 'express';

import { HttpError, asyncRoute } from '../middleware/error-handler';
import { sanitizeConfigForClient } from '../config/sanitize';
import { readConfig } from '../config/store';
import {
  AgentDefinitionError,
  definitionFromDetected,
  deleteAgentDefinition,
  detectAgents,
  listAgentDefinitions,
  listLaunches,
  saveAgentDefinition
} from '../agents/definitions';
import type { ExternalAgentDefinition } from '../../shared/config-types';

export const agentsRouter: Router = Router();

/** Turns a definition error into the 400 it describes. */
function rethrow(error: unknown): never {
  if (error instanceof AgentDefinitionError) {
    throw new HttpError(error.message, error.statusCode);
  }
  throw error;
}

agentsRouter.get(
  '/api/agents',
  asyncRoute(async (_req, res) => {
    res.json({ success: true, agents: listAgentDefinitions(), launches: listLaunches() });
  })
);

agentsRouter.get(
  '/api/agents/detect',
  asyncRoute(async (_req, res) => {
    res.json({ success: true, detected: await detectAgents() });
  })
);

/**
 * Adds definitions for the tools that were found installed.
 *
 * Seeded enabled, because detection means the tool is there, and editable
 * afterwards — the defaults are a starting point rather than a claim about how
 * anyone wants to run it.
 */
agentsRouter.post(
  '/api/agents/detect',
  asyncRoute(async (_req, res) => {
    const added: ExternalAgentDefinition[] = [];

    for (const detected of await detectAgents()) {
      if (detected.configured) {
        continue;
      }

      try {
        added.push(saveAgentDefinition(definitionFromDetected(detected)));
      } catch (error) {
        // One tool that cannot be described on this platform must not stop the
        // others being added.
        if (!(error instanceof AgentDefinitionError)) {
          throw error;
        }
      }
    }

    res.json({ success: true, added, config: sanitizeConfigForClient(readConfig()) });
  })
);

agentsRouter.post(
  '/api/agents',
  asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Partial<ExternalAgentDefinition>;

    if (typeof body.executable !== 'string' || body.executable.trim() === '') {
      throw new HttpError('An agent needs an executable.', 400);
    }
    if (
      body.terminal !== 'direct' &&
      body.terminal !== 'windows-terminal' &&
      body.terminal !== 'powershell'
    ) {
      throw new HttpError('Choose how the agent should be launched.', 400);
    }

    try {
      const saved = saveAgentDefinition({
        ...(body.id ? { id: body.id } : {}),
        label: typeof body.label === 'string' ? body.label : '',
        executable: body.executable,
        args: Array.isArray(body.args) ? body.args.map((value) => String(value)) : [],
        terminal: body.terminal,
        enabled: body.enabled !== false,
        ...(body.promptMode ? { promptMode: body.promptMode } : {}),
        ...(body.env ? { env: body.env } : {})
      });

      res.json({ success: true, agent: saved, config: sanitizeConfigForClient(readConfig()) });
    } catch (error) {
      rethrow(error);
    }
  })
);

agentsRouter.delete(
  '/api/agents',
  asyncRoute(async (req, res) => {
    const { id } = (req.body ?? {}) as { id?: unknown };

    if (!deleteAgentDefinition(String(id))) {
      throw new HttpError('That agent is no longer configured.', 404);
    }

    res.json({ success: true, config: sanitizeConfigForClient(readConfig()) });
  })
);
