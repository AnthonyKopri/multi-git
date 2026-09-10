import path from 'node:path';
import { commands } from './commands';

export class CliError extends Error {
  constructor(message: string, readonly code = 'INVALID_ARGUMENT', readonly exitCode = 2) { super(message); }
}

export interface CliRequest {
  command: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  dryRun: boolean;
}

/** Reject remote origins, URL credentials and redirects: repo paths stay local. */
export function serverOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new CliError('Server must be a loopback HTTP origin.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new CliError('Server must be a loopback HTTP origin without credentials, path, query or fragment.');
  }
  return url.origin;
}

export function prepareRequest(args: string[], input: Record<string, unknown> = {}): CliRequest {
  const command = args[0] ?? '';
  if (!Object.hasOwn(commands, command)) throw new CliError(`Unknown command: ${command}. Run help for commands.`);
  const spec = commands[command]!;
  const flags = new Map<string, string>();
  const booleans = new Set(['--allow-write', '--dry-run', '--json']);
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (flags.has(flag)) throw new CliError(`Duplicate option: ${flag}`);
    if (booleans.has(flag)) { flags.set(flag, 'true'); continue; }
    if (!['--repo', '--server', '--input'].includes(flag)) throw new CliError(`Unknown option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new CliError(`Missing value for ${flag}`);
    flags.set(flag, value);
  }
  if (spec.repo && !flags.get('--repo')) throw new CliError('--repo is required for this command.');
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(spec.input, key)) throw new CliError(`Unknown input field: ${key}`);
  }
  const dryRun = flags.has('--dry-run');
  if (spec.method !== 'GET' && !dryRun && !flags.has('--allow-write')) {
    throw new CliError('This command changes state. Review --dry-run, then pass --allow-write for an authorized action.', 'WRITE_NOT_ALLOWED');
  }
  const origin = serverOrigin(flags.get('--server') ?? process.env['MULTI_GIT_URL'] ?? 'http://127.0.0.1:3000');
  const url = new URL(spec.path, origin);
  const headers: Record<string, string> = {};
  if (spec.repo) {
    headers['x-repo-path'] = Buffer.from(path.resolve(flags.get('--repo')!), 'utf8').toString('base64');
    headers['x-repo-path-encoding'] = 'base64';
  }
  if (spec.method === 'GET') {
    for (const [key, value] of Object.entries(input)) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) throw new CliError(`Query field ${key} must be a scalar.`);
      url.searchParams.set(key, String(value));
    }
  } else headers['Content-Type'] = 'application/json';
  return { command, url: url.href, method: spec.method, headers, dryRun,
    ...(spec.method === 'GET' ? {} : { body: JSON.stringify(input) }) };
}

export async function executeRequest(request: CliRequest, fetcher: typeof fetch = fetch): Promise<unknown> {
  if (request.dryRun) return { request, note: 'Preview only; server validation and execution have not run.' };
  let response: Response;
  try {
    response = await fetcher(request.url, {
      method: request.method, headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      redirect: 'error', signal: AbortSignal.timeout(15 * 60_000)
    });
  } catch {
    throw new CliError('Cannot reach Multi-Git, or request timed out. Start the app and check --server. After a write, inspect status before retrying; the operation may still have completed.', 'CONNECTION_FAILED', 1);
  }
  let data: unknown;
  try { data = await response.json(); } catch { throw new CliError('Server returned a non-JSON response. Check --server.', 'INVALID_RESPONSE', 1); }
  if (!response.ok || (data && typeof data === 'object' && 'success' in data && data.success === false)) {
    const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : `HTTP ${response.status}`;
    throw new CliError(message, `API_${response.status}`, 1);
  }
  return data;
}
