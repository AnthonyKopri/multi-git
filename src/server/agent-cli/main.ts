import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { commands } from './commands';
import { commandSchema } from './schemas';
import { CliError, prepareRequest, executeRequest } from './client';
import { connectBackend } from '../runtime/connection';
import { appVersion, fromAppRoot } from '../app-root';
import { runMcp } from './mcp';
import { updateTerminal, rollbackUpdate } from '../terminal/update';
import { holdPayloadSession } from '../terminal/sessions';

const USAGE = 'multi-git <command> [--repo path] [--input file|-] [--server http://127.0.0.1:3000] [--dry-run] [--allow-write]';

/** Entry points that are not API commands. Help and --version stay offline. */
const MODES = {
  tui: 'Guided terminal UI: multi-git tui [--repo path]',
  mcp: 'MCP server over stdio: multi-git mcp [--allow-write]. Read-only unless --allow-write.',
  update: 'Update this terminal installation: multi-git update [--check|--rollback]',
  '--version': 'Print the version'
};

function write(envelope: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ...envelope }) + '\n');
}

function fail(command: string | undefined, error: unknown): void {
  const failure = error instanceof CliError
    ? error
    : new CliError(error instanceof Error ? error.message : String(error), 'UNEXPECTED_ERROR', 1);
  write({ success: false, command, error: { code: failure.code, message: failure.message } });
  process.exitCode = failure.exitCode;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length && !['help', '--help', '-h', '--version'].includes(args[0]!) && !args.includes('--dry-run')) holdPayloadSession();
  if (args[0] === '--version') { process.stdout.write(appVersion() + '\n'); return; }
  if (args[0] === 'mcp') { runMcp(args.slice(1)); return; }
  if (args[0] === 'tui') {
    // A separate ES module bundle: Ink is ESM-only, and the JSON commands
    // should not pay for loading React.
    const entry = pathToFileURL(fromAppRoot('out', 'node', 'server', 'terminal.mjs')).href;
    const terminal = await import(entry) as { runTerminal(args: string[]): Promise<void> };
    await terminal.runTerminal(args.slice(1));
    return;
  }
  if (args[0] === 'update') {
    try {
      const extra = args.slice(1).filter((arg) => !['--check', '--rollback'].includes(arg));
      if (extra.length) throw new CliError(`Unknown option: ${extra[0]}`);
      if (args.includes('--check') && args.includes('--rollback')) throw new CliError('Choose either --check or --rollback.');
      write({ success: true, command: 'update', data: args.includes('--rollback') ? rollbackUpdate() : await updateTerminal(args.includes('--check')) });
    } catch (error) { fail('update', error); }
    return;
  }
  if (args.length === 0 || ['help', '--help', '-h'].includes(args[0]!)) {
    write({ success: true, usage: USAGE,
      input: 'UTF-8 JSON object; - reads stdin. JSON output is always enabled. GET input becomes query parameters.',
      commands,
      modes: MODES,
      inputSchemas: Object.fromEntries(Object.keys(commands).map((name) => [name, z.toJSONSchema(commandSchema(name))])) });
    return;
  }
  try {
    // Validate all flags and write intent before reading input or contacting the app.
    prepareRequest(args);
    const inputIndex = args.indexOf('--input');
    let input: unknown = {};
    if (inputIndex !== -1) {
      try { input = JSON.parse(fs.readFileSync(args[inputIndex + 1] === '-' ? 0 : args[inputIndex + 1]!, 'utf8').replace(/^﻿/, '')); }
      catch { throw new CliError('Cannot read input. Supply a UTF-8 JSON object with --input file or --input -.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CliError('Input must be a JSON object.');
    }
    // Validated before a backend is started, so a mistake and a dry run both stay offline.
    const request = prepareRequest(args, input as Record<string, unknown>);
    const explicitServer = args.includes('--server') || process.env['MULTI_GIT_URL'] !== undefined;
    if (request.dryRun || explicitServer) {
      write({ success: true, command: args[0], data: await executeRequest(request) });
      return;
    }
    const connection = await connectBackend().catch((error: unknown) => {
      throw new CliError(error instanceof Error ? error.message : String(error), 'BACKEND_UNAVAILABLE', 1);
    });
    try {
      const shared = prepareRequest([...args, '--server', connection.origin], input as Record<string, unknown>);
      write({ success: true, command: args[0], data: await executeRequest(shared) });
    } finally { await connection.close(); }
  } catch (error) {
    fail(args[0], error);
  }
}
void main().catch((error) => { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 2; });
