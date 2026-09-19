import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { commands } from './commands';
import { commandSchema } from './schemas';
import { executeRequest, prepareRequest } from './client';
import { appVersion } from '../app-root';
import { connectBackend } from '../runtime/connection';
import type { BackendConnection } from '../runtime/connection';

export function createMcpServer(options: { allowWrite: boolean; server?: string; connect?: typeof connectBackend }): { server: McpServer; close: () => Promise<void> } {
  const server = new McpServer({ name: 'multi-git', version: appVersion() });
  let connection: Promise<BackendConnection> | undefined;
  for (const [name, spec] of Object.entries(commands)) {
    if (spec.effects.mutates && !options.allowWrite) continue;
    // The legacy push intentionally retains its contract; MCP uses the guided counterpart.
    if (name === 'push') continue;
    const schema = commandSchema(name).extend({
      ...(spec.repo ? { repo: z.string().refine(path.isAbsolute, 'Use an absolute repository path.') } : {}),
      dryRun: z.boolean().optional()
    }).strict();
    server.registerTool(name.replaceAll('.', '_'), {
      title: spec.description, description: `${spec.description} Effects: ${JSON.stringify(spec.effects)}`,
      inputSchema: schema,
      annotations: { readOnlyHint: !spec.effects.mutates, destructiveHint: spec.effects.mutates, idempotentHint: !spec.effects.mutates, openWorldHint: spec.effects.remote !== 'none' }
    }, async (raw) => {
      const { repo, dryRun, ...input } = raw as Record<string, unknown>;
      try {
        let origin = options.server;
        if (!origin && dryRun !== true) {
          connection ??= (options.connect ?? connectBackend)();
          origin = (await connection).origin;
        }
        const args = [name, ...(typeof repo === 'string' ? ['--repo', repo] : []),
          ...(origin ? ['--server', origin] : []), ...(dryRun === true ? ['--dry-run'] : []),
          ...(options.allowWrite ? ['--allow-write'] : [])];
        const result = { schemaVersion: 1, success: true, command: name, data: await executeRequest(prepareRequest(args, input)) };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  }
  return { server, close: async () => { await server.close(); await connection?.then((value) => value.close()).catch(() => {}); } };
}

export function runMcp(args: string[]): void {
  let allowWrite = false;
  let origin = process.env['MULTI_GIT_URL'];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--allow-write') allowWrite = true;
    else if (args[index] === '--server' && args[index + 1]) origin = args[++index];
    else throw new Error(`Unknown MCP option: ${args[index]}`);
  }
  const instances: ReturnType<typeof createMcpServer>[] = [];
  const handle = serveStdio(() => {
    const instance = createMcpServer({ allowWrite, ...(origin ? { server: origin } : {}) });
    instances.push(instance); return instance.server;
  }, { onerror: (error) => process.stderr.write(error.message + '\n') });
  const close = (): void => { void Promise.all(instances.map((instance) => instance.close())).finally(() => handle.close()); };
  process.stdin.once('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
