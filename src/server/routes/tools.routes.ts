// External tool definitions over HTTP.
//
// The same split as agents.routes.ts, and for the same reason. Reading,
// writing and detecting definitions is safe to answer on a loopback port;
// starting a program is not, so launching lives behind the Electron IPC bridge
// and is absent in browser mode. Anything added here should be checked against
// that line.
import { Router } from 'express';

import { HttpError, asyncRoute } from '../middleware/error-handler';
import {
  ToolDefinitionError,
  confirmToolKind,
  definitionFromDetected,
  deleteToolDefinition,
  detectTools,
  isToolKindConfirmed,
  listToolDefinitions,
  saveToolDefinition
} from '../tools/definitions';
import { readConfig } from '../config/store';
import { EXTERNAL_TOOL_KINDS } from '../../shared/config-types';
import type { ExternalToolKind } from '../../shared/config-types';

export const toolsRouter: Router = Router();

function rethrow(error: unknown): never {
  if (error instanceof ToolDefinitionError) {
    throw new HttpError(error.message, error.statusCode);
  }
  throw error;
}

function toolKind(value: unknown): ExternalToolKind {
  if (EXTERNAL_TOOL_KINDS.includes(value as ExternalToolKind)) {
    return value as ExternalToolKind;
  }
  throw new HttpError(`"${String(value)}" is not a kind of tool this build knows.`, 400);
}

toolsRouter.get(
  '/api/tools',
  asyncRoute(async (_req, res) => {
    res.json({
      success: true,
      tools: listToolDefinitions(),
      confirmed: readConfig().toolsConfirmed ?? {}
    });
  })
);

toolsRouter.get(
  '/api/tools/detect',
  asyncRoute(async (_req, res) => {
    res.json({ success: true, detected: await detectTools() });
  })
);

/**
 * Seeds definitions from what is installed.
 *
 * Adding a definition is not permission to run it: the first use of each kind
 * still shows the exact command and asks. Detection only saves the user typing
 * an argument template from memory.
 */
toolsRouter.post(
  '/api/tools/detect',
  asyncRoute(async (_req, res) => {
    const detected = await detectTools();
    const added = [];

    for (const tool of detected) {
      if (tool.configured) {
        continue;
      }
      try {
        added.push(saveToolDefinition(definitionFromDetected(tool)));
      } catch (error) {
        // One template this build got wrong must not stop the others being
        // offered.
        if (!(error instanceof ToolDefinitionError)) {
          throw error;
        }
      }
    }

    res.json({ success: true, added, tools: listToolDefinitions() });
  })
);

toolsRouter.post(
  '/api/tools',
  asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    try {
      const tool = saveToolDefinition({
        ...(typeof body['id'] === 'string' ? { id: body['id'] } : {}),
        kind: toolKind(body['kind']),
        ...(typeof body['label'] === 'string' ? { label: body['label'] } : {}),
        executable: String(body['executable'] ?? ''),
        args: Array.isArray(body['args'])
          ? (body['args'] as unknown[]).map((value) => String(value))
          : [],
        enabled: body['enabled'] !== false
      });

      res.json({ success: true, tool, tools: listToolDefinitions() });
    } catch (error) {
      rethrow(error);
    }
  })
);

toolsRouter.delete(
  '/api/tools',
  asyncRoute(async (req, res) => {
    const id = (req.body ?? {})['id'];

    if (typeof id !== 'string' || id === '') {
      throw new HttpError('Which tool?', 400);
    }

    deleteToolDefinition(id);
    res.json({ success: true, tools: listToolDefinitions() });
  })
);

/** Records that the user has agreed to the definition used for a kind. */
toolsRouter.post(
  '/api/tools/confirm',
  asyncRoute(async (req, res) => {
    const kind = toolKind((req.body ?? {})['kind']);

    confirmToolKind(kind);
    res.json({ success: true, confirmed: isToolKindConfirmed(kind) });
  })
);
