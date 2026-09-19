import { z } from 'zod';
import path from 'node:path';

const text = z.string().min(1);
const absolute = text.refine((value) => path.isAbsolute(value), 'Use an absolute path.');
const profileId = z.string().optional();
const confirmation = z.boolean().optional().describe('True only after the user reviewed the workflow preflight.');
export const inputSchemas: Record<string, z.ZodObject<z.ZodRawShape>> = {
  'app.info': z.object({}),
  'repositories.list': z.object({ owner: z.string().optional() }),
  'repo.clone': z.object({ url: text, parentDir: absolute, folderName: text.optional(), profileId }),
  'repo.remember': z.object({ repoPath: absolute }),
  status: z.object({}),
  'branches.list': z.object({}),
  'branches.create': z.object({ branchName: text }),
  'branches.checkout': z.object({ branch: text, isRemote: z.boolean().optional() }),
  diff: z.object({ path: text, source: z.enum(['working-tree', 'index']) }),
  stage: z.object({ files: z.array(text).min(1) }),
  unstage: z.object({ files: z.array(text).min(1) }),
  commit: z.object({ message: text }),
  fetch: z.object({ profileId }),
  push: z.object({ branch: text.optional(), profileId }),
  'worktrees.list': z.object({}),
  'worktrees.create': z.object({ targetPath: absolute, branchMode: z.enum(['new', 'existing', 'detached']), branch: text.optional() }),
  'recovery.list': z.object({}),
  'agents.list': z.object({}),
  'repositories.local': z.object({}),
  'history': z.object({ limit: z.number().int().min(1).max(500).optional(), skip: z.number().int().min(0).optional() }),
  'sync.fetch': z.object({ profileId }),
  'pull': z.object({ profileId, confirmed: confirmation }),
  'sync.push': z.object({ profileId, confirmed: confirmation }),
  'auto-pull.get': z.object({}),
  'auto-pull.set': z.object({ enabled: z.boolean() }),
  'ssh.profiles': z.object({}),
  'ssh.inspect': z.object({ profileId }),
  'ssh.select': z.object({ profileId: z.string(), confirmed: confirmation, keepIdentity: z.boolean().optional() }),
  'ssh.verify': z.object({ profileId }),
  'remote.inspect': z.object({}),
  'remote.toggle': z.object({ confirmed: confirmation }),
  'operations.list': z.object({}),
  'operations.cancel': z.object({ id: text }),
  doctor: z.object({})
};

export function commandSchema(name: string): z.ZodObject<z.ZodRawShape> {
  const schema = inputSchemas[name];
  if (!schema) throw new Error(`Missing input schema for ${name}`);
  return schema.strict();
}
