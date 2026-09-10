import fs from 'node:fs';
import { commands } from './commands';
import { CliError, prepareRequest, executeRequest } from './client';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || ['help', '--help', '-h'].includes(args[0]!)) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, success: true,
      usage: 'multi-git <command> [--repo path] [--input file|-] [--server http://127.0.0.1:3000] [--dry-run] [--allow-write]',
      input: 'UTF-8 JSON object; - reads stdin. JSON output is always enabled. GET input becomes query parameters.',
      commands }) + '\n');
    return;
  }
  try {
    // Validate all flags and write intent before reading input or contacting the app.
    prepareRequest(args);
    const inputIndex = args.indexOf('--input');
    let input: unknown = {};
    if (inputIndex !== -1) {
      try { input = JSON.parse(fs.readFileSync(args[inputIndex + 1] === '-' ? 0 : args[inputIndex + 1]!, 'utf8').replace(/^\uFEFF/, '')); }
      catch { throw new CliError('Cannot read input. Supply a UTF-8 JSON object with --input file or --input -.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CliError('Input must be a JSON object.');
    }
    const data = await executeRequest(prepareRequest(args, input as Record<string, unknown>));
    process.stdout.write(JSON.stringify({ schemaVersion: 1, success: true, command: args[0], data }) + '\n');
  } catch (error) {
    const failure = error instanceof CliError ? error : new CliError(error instanceof Error ? error.message : String(error), 'UNEXPECTED_ERROR', 1);
    process.stdout.write(JSON.stringify({ schemaVersion: 1, success: false, command: args[0], error: { code: failure.code, message: failure.message } }) + '\n');
    process.exitCode = failure.exitCode;
  }
}
void main();
